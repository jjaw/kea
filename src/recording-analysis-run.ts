import { existsSync, realpathSync } from "node:fs";
import type {
  AnalysisProvider,
  AnalysisProviderResult
} from "./analysis-provider.ts";
import type { AnalysisRunArtifacts } from "./analysis-run-store.ts";
import { readCodexSessionFile } from "./codex-session-adapter.ts";
import {
  buildEvidenceBundle,
  measureEvidenceCorpus
} from "./evidence-bundle.ts";
import { runProviderAnalysisForBundle } from "./provider-analysis-run.ts";
import { rebuildStaticReportIndex } from "./report-index.ts";
import {
  buildStructuralSessionReceipt,
  createFullReportDisposition
} from "./session-disposition.ts";
import { persistLatestSessionDisposition } from "./session-disposition-store.ts";

export type RecordingAnalysisResult =
  | {
      kind: "success";
      artifacts: AnalysisRunArtifacts;
      summary: {
        rejectedCount: number;
        downgradedCount: number;
        amendedCount: number;
      };
      dispositionPath: string;
      indexPath: string;
    }
  | {
      kind: "failure";
      failureKind:
        | Exclude<AnalysisProviderResult["kind"], "success">
        | "bundle_too_large";
      message: string;
      artifacts: AnalysisRunArtifacts;
    };

export class RecordingAnalysisIntegrationError extends Error {
  readonly stage:
    | "final_disposition_persistence"
    | "report_index_rebuild";
  readonly artifacts: AnalysisRunArtifacts;
  readonly dispositionPath?: string;

  constructor(
    stage:
      | "final_disposition_persistence"
      | "report_index_rebuild",
    message: string,
    artifacts: AnalysisRunArtifacts,
    dispositionPath?: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "RecordingAnalysisIntegrationError";
    this.stage = stage;
    this.artifacts = artifacts;
    this.dispositionPath = dispositionPath;
  }
}

export async function runAnalysisForRecording(options: {
  projectRoot: string;
  recordingPath: string;
  selector: string;
  provider: AnalysisProvider;
  now?: Date;
}): Promise<RecordingAnalysisResult> {
  const root = realpathSync(options.projectRoot);
  if (!existsSync(options.recordingPath)) {
    throw new Error(
      `No recording found for ${options.selector} at ${options.recordingPath}`
    );
  }
  const session = readCodexSessionFile(options.recordingPath);
  if (session.events.length === 0) {
    throw new Error(`No valid hook events found in ${session.sourcePath}`);
  }
  const bundle = buildEvidenceBundle(session);
  const corpusStatus = measureEvidenceCorpus(bundle);
  const now = options.now ?? new Date();
  const providerRun = await runProviderAnalysisForBundle({
    projectRoot: root,
    bundle,
    selector: options.selector,
    provider: options.provider,
    now,
    corpusStatus
  });
  if (providerRun.kind === "failure") return providerRun;

  const receipt = buildStructuralSessionReceipt(
    bundle,
    corpusStatus,
    now.toISOString()
  );
  let persistedDisposition;
  try {
    persistedDisposition = persistLatestSessionDisposition(
      root,
      createFullReportDisposition(receipt, {
        runId: providerRun.artifacts.runId,
        analysisArtifact: "analysis.json",
        validationSummaryArtifact: "validation-summary.json",
        renderedArtifacts: {
          markdown: "report.md",
          html: "report.html"
        }
      })
    );
  } catch (error) {
    throw new RecordingAnalysisIntegrationError(
      "final_disposition_persistence",
      `Final full-report disposition persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      providerRun.artifacts,
      undefined,
      { cause: error }
    );
  }

  let rebuiltIndex;
  try {
    rebuiltIndex = rebuildStaticReportIndex(root, now);
  } catch (error) {
    throw new RecordingAnalysisIntegrationError(
      "report_index_rebuild",
      `Static report inbox rebuilding failed: ${error instanceof Error ? error.message : String(error)}`,
      providerRun.artifacts,
      persistedDisposition.path,
      { cause: error }
    );
  }

  return {
    kind: "success",
    artifacts: providerRun.artifacts,
    summary: providerRun.summary,
    dispositionPath: persistedDisposition.path,
    indexPath: rebuiltIndex.path
  };
}
