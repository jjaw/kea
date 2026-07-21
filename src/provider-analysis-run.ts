import { AnalysisSchema } from "./analysis-definitions.ts";
import type {
  AnalysisProvider,
  AnalysisProviderResult
} from "./analysis-provider.ts";
import { serializeError } from "./analysis-provider.ts";
import { renderAnalysisHtmlReport } from "./analysis-html-report.ts";
import { renderAnalysisReport } from "./analysis-report.ts";
import {
  AnalysisRunStageError,
  persistAnalysisRun,
  validateAndPersistAnalysisRun,
  type AnalysisRunArtifacts
} from "./analysis-run-store.ts";
import {
  measureEvidenceCorpus,
  type EvidenceBundle,
  type EvidenceCorpusStatus
} from "./evidence-bundle.ts";

export type ProviderAnalysisRunResult =
  | {
      kind: "success";
      artifacts: AnalysisRunArtifacts;
      summary: {
        rejectedCount: number;
        downgradedCount: number;
        amendedCount: number;
      };
    }
  | {
      kind: "failure";
      failureKind:
        | Exclude<AnalysisProviderResult["kind"], "success">
        | "bundle_too_large";
      message: string;
      artifacts: AnalysisRunArtifacts;
    };

export async function runProviderAnalysisForBundle(options: {
  projectRoot: string;
  bundle: EvidenceBundle;
  selector: string;
  provider: AnalysisProvider;
  now?: Date;
  corpusStatus?: EvidenceCorpusStatus;
}): Promise<ProviderAnalysisRunResult> {
  const corpusStatus =
    options.corpusStatus ?? measureEvidenceCorpus(options.bundle);
  const now = options.now ?? new Date();
  if (!corpusStatus.eligibleForSingleRequest) {
    return persistOversizedAnalysisRun(
      options.projectRoot,
      options.bundle,
      options.selector,
      corpusStatus
    );
  }

  let providerResult: AnalysisProviderResult;
  try {
    providerResult = await options.provider.analyze(options.bundle);
  } catch (error) {
    providerResult = {
      kind: "request_failed",
      error: serializeError(error),
      metadata: {
        provider: "unknown",
        model: "unknown",
        reasoningEffort: "unknown",
        store: false,
        requestedAt: now.toISOString(),
        completedAt: new Date().toISOString()
      }
    };
  }

  if (providerResult.kind !== "success") {
    return persistFailure(
      options.projectRoot,
      options.bundle,
      options.selector,
      providerResult,
      corpusStatus
    );
  }

  const parsedCandidate = AnalysisSchema.safeParse(providerResult.candidate);
  if (!parsedCandidate.success) {
    return persistFailure(
      options.projectRoot,
      options.bundle,
      options.selector,
      {
        kind: "schema_invalid",
        error: serializeError(parsedCandidate.error),
        metadata: providerResult.metadata,
        rawResponse: providerResult.rawResponse
      },
      corpusStatus,
      providerResult.candidate
    );
  }

  const persisted = validateAndPersistAnalysisRun(
    options.projectRoot,
    options.bundle,
    parsedCandidate.data,
    now,
    {
      candidateAnalysis: providerResult.candidate,
      providerResponse: providerResult.rawResponse,
      metadata: runMetadata(
        options.bundle,
        options.selector,
        "completed",
        providerResult,
        corpusStatus
      ),
      renderMarkdown: (analysis, summary, runId) =>
        renderAnalysisReport(options.bundle, analysis, summary, runId),
      renderHtml: (analysis, summary, runId) =>
        renderAnalysisHtmlReport(options.bundle, analysis, summary, runId)
    }
  );

  // The canonical run store is authoritative. These checks only defend the
  // contract expected after its successful validated persistence operation.
  if (
    persisted.artifacts.analysisPath === null ||
    persisted.artifacts.validationSummaryPath === null ||
    persisted.artifacts.reportPath === null ||
    persisted.artifacts.htmlReportPath === null
  ) {
    throw new AnalysisRunStageError(
      "validated_artifact_persistence",
      "Canonical validated run persistence returned incomplete artifact references"
    );
  }

  return {
    kind: "success",
    artifacts: persisted.artifacts,
    summary: {
      rejectedCount: persisted.summary.rejectedCount,
      downgradedCount: persisted.summary.downgradedCount,
      amendedCount: persisted.summary.amendedCount
    }
  };
}

export function persistOversizedAnalysisRun(
  projectRoot: string,
  bundle: EvidenceBundle,
  selector: string,
  corpusStatus: EvidenceCorpusStatus
): ProviderAnalysisRunResult {
  const message =
    `Complete sanitized session evidence is ${corpusStatus.serializedCorpusBytes} bytes, ` +
    `which exceeds the ${corpusStatus.requestBudgetBytes}-byte single-request budget. ` +
    "No evidence was omitted and no provider request was made. Chronological segmentation with complete coverage is required to analyze this session.";
  const artifacts = persistAnalysisRun(projectRoot, bundle, {
    providerError: {
      kind: "bundle_too_large",
      code: "bundle_too_large",
      message,
      ...corpusStatus,
      requiredCapability: "complete_coverage_chronological_segmentation"
    },
    metadata: {
      ...corpusMetadata(bundle, selector, "live", "failed", corpusStatus),
      resultKind: "bundle_too_large",
      diagnostic: {
        code: "bundle_too_large",
        requiredCapability: "complete_coverage_chronological_segmentation"
      }
    }
  });
  return {
    kind: "failure",
    failureKind: "bundle_too_large",
    message,
    artifacts
  };
}

function persistFailure(
  root: string,
  bundle: EvidenceBundle,
  selector: string,
  result: Exclude<AnalysisProviderResult, { kind: "success" }>,
  corpusStatus: EvidenceCorpusStatus,
  candidate?: unknown
): ProviderAnalysisRunResult {
  const message = failureMessage(result);
  const artifacts = persistAnalysisRun(root, bundle, {
    candidateAnalysis: candidate,
    providerResponse: result.rawResponse,
    providerError: failureDetails(result),
    metadata: runMetadata(bundle, selector, "failed", result, corpusStatus)
  });
  return { kind: "failure", failureKind: result.kind, message, artifacts };
}

function failureMessage(
  result: Exclude<AnalysisProviderResult, { kind: "success" }>
): string {
  switch (result.kind) {
    case "refusal":
      return result.refusal;
    case "incomplete":
      return `Provider response was incomplete${result.reason ? `: ${result.reason}` : "."}`;
    case "missing_parsed_output":
      return result.message;
    case "schema_invalid":
    case "request_failed":
      return result.error.message;
  }
}

function failureDetails(
  result: Exclude<AnalysisProviderResult, { kind: "success" }>
): Record<string, unknown> {
  switch (result.kind) {
    case "refusal":
      return { kind: result.kind, refusal: result.refusal };
    case "incomplete":
      return { kind: result.kind, reason: result.reason };
    case "missing_parsed_output":
      return { kind: result.kind, message: result.message };
    case "schema_invalid":
    case "request_failed":
      return { kind: result.kind, error: result.error };
  }
}

function runMetadata(
  bundle: EvidenceBundle,
  selector: string,
  status: "completed" | "failed",
  result: AnalysisProviderResult,
  corpusStatus: EvidenceCorpusStatus
): Record<string, unknown> {
  return {
    ...corpusMetadata(bundle, selector, "live", status, corpusStatus),
    resultKind: result.kind,
    provider: result.metadata
  };
}

function corpusMetadata(
  bundle: EvidenceBundle,
  selector: string,
  mode: "dry_run" | "live",
  status: "completed" | "failed",
  corpusStatus: EvidenceCorpusStatus
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    mode,
    status,
    selector,
    sessionId: bundle.session.sessionId,
    corpus: corpusStatus
  };
}
