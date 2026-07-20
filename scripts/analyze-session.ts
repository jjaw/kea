import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AnalysisSchema } from "../src/analysis-definitions.ts";
import type {
  AnalysisProvider,
  AnalysisProviderResult
} from "../src/analysis-provider.ts";
import { serializeError } from "../src/analysis-provider.ts";
import { renderAnalysisReport } from "../src/analysis-report.ts";
import {
  persistAnalysisRun,
  serializeJson,
  validateAndPersistAnalysisRun,
  type AnalysisRunArtifacts
} from "../src/analysis-run-store.ts";
import { readCodexSessionFile } from "../src/codex-session-adapter.ts";
import {
  buildEvidenceBundle,
  measureEvidenceCorpus,
  type EvidenceBundle,
  type EvidenceCorpusStatus
} from "../src/evidence-bundle.ts";
import { OpenAIAnalysisProvider } from "../src/openai-analysis-provider.ts";
import { generateSessionReport } from "./report-session.ts";
import { resolveSessionFile } from "./report-session.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export type LiveAnalysisResult =
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

type Output = { write(value: string): unknown };

export function generateDryRun(
  projectRoot: string,
  selector: string = "latest"
): {
  bundle: EvidenceBundle;
  corpusStatus: EvidenceCorpusStatus;
  serializedBundle: string;
  artifacts: AnalysisRunArtifacts;
} {
  const { root, bundle } = loadEvidenceBundle(projectRoot, selector);
  const corpusStatus = measureEvidenceCorpus(bundle);
  const serializedBundle = serializeJson(bundle);
  const artifacts = persistAnalysisRun(root, bundle, {
    metadata: corpusMetadata(bundle, selector, "dry_run", "completed", corpusStatus)
  });
  return { bundle, corpusStatus, serializedBundle, artifacts };
}

export async function runLiveAnalysis(options: {
  projectRoot: string;
  selector?: string;
  provider: AnalysisProvider;
  now?: Date;
}): Promise<LiveAnalysisResult> {
  const selector = options.selector ?? "latest";
  const { root, bundle } = loadEvidenceBundle(options.projectRoot, selector);
  const corpusStatus = measureEvidenceCorpus(bundle);
  const now = options.now ?? new Date();
  if (!corpusStatus.eligibleForSingleRequest) {
    return persistOversizedRun(root, bundle, selector, corpusStatus);
  }
  let providerResult: AnalysisProviderResult;

  try {
    providerResult = await options.provider.analyze(bundle);
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
    return persistFailure(root, bundle, selector, providerResult, corpusStatus);
  }

  const parsedCandidate = AnalysisSchema.safeParse(providerResult.candidate);
  if (!parsedCandidate.success) {
    return persistFailure(
      root,
      bundle,
      selector,
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
    root,
    bundle,
    parsedCandidate.data,
    now,
    {
      candidateAnalysis: providerResult.candidate,
      providerResponse: providerResult.rawResponse,
      metadata: runMetadata(
        bundle,
        selector,
        "completed",
        providerResult,
        corpusStatus
      ),
      renderMarkdown: (analysis, summary, runId) =>
        renderAnalysisReport(bundle, analysis, summary, runId)
    }
  );

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

export async function runAnalyzeCommand(options: {
  projectRoot: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  stdout?: Output;
  stderr?: Output;
  providerFactory?: (apiKey: string) => AnalysisProvider;
  now?: Date;
}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const { selector, dryRun } = parseArguments(options.args);
    if (dryRun) {
      const result = generateDryRun(options.projectRoot, selector);
      stdout.write(result.serializedBundle);
      stderr.write(`${formatCorpusStatus(result.corpusStatus)}\n`);
      stderr.write(`Bundle saved to ${displayPath(result.artifacts.bundlePath)}\n`);
      return 0;
    }

    const apiKey = (
      options.env === undefined
        ? process.env.OPENAI_API_KEY
        : options.env.OPENAI_API_KEY
    )?.trim();
    if (!apiKey) {
      const fallback = generateSessionReport(options.projectRoot, selector);
      stdout.write(
        "OPENAI_API_KEY is not configured; live analysis is unavailable. Showing the deterministic report instead.\n\n"
      );
      stdout.write(`${fallback.markdown}\n`);
      stdout.write(`Deterministic report saved to ${displayPath(fallback.reportPath)}\n`);
      return 0;
    }

    const provider = options.providerFactory
      ? options.providerFactory(apiKey)
      : new OpenAIAnalysisProvider({ apiKey });
    const result = await runLiveAnalysis({
      projectRoot: options.projectRoot,
      selector,
      provider,
      now: options.now
    });
    if (result.kind === "failure") {
      stderr.write(
        `Live analysis failed (${result.failureKind}): ${result.message}\nArtifacts saved to ${displayPath(result.artifacts.directory)}\n`
      );
      return 1;
    }

    stdout.write(`Report saved to ${displayPath(result.artifacts.reportPath ?? result.artifacts.directory)}\n`);
    stdout.write(
      `Validation: ${result.summary.rejectedCount} rejected, ${result.summary.downgradedCount} downgraded, ${result.summary.amendedCount} amended.\n`
    );
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function persistFailure(
  root: string,
  bundle: EvidenceBundle,
  selector: string,
  result: Exclude<AnalysisProviderResult, { kind: "success" }>,
  corpusStatus: EvidenceCorpusStatus,
  candidate?: unknown
): LiveAnalysisResult {
  const message = failureMessage(result);
  const artifacts = persistAnalysisRun(root, bundle, {
    candidateAnalysis: candidate,
    providerResponse: result.rawResponse,
    providerError: failureDetails(result),
    metadata: runMetadata(bundle, selector, "failed", result, corpusStatus)
  });
  return { kind: "failure", failureKind: result.kind, message, artifacts };
}

function persistOversizedRun(
  root: string,
  bundle: EvidenceBundle,
  selector: string,
  corpusStatus: EvidenceCorpusStatus
): LiveAnalysisResult {
  const message =
    `Complete sanitized session evidence is ${corpusStatus.serializedCorpusBytes} bytes, ` +
    `which exceeds the ${corpusStatus.requestBudgetBytes}-byte single-request budget. ` +
    "No evidence was omitted and no provider request was made. Chronological segmentation with complete coverage is required to analyze this session.";
  const artifacts = persistAnalysisRun(root, bundle, {
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

function formatCorpusStatus(status: EvidenceCorpusStatus): string {
  return [
    `Complete sanitized session evidence: ${status.serializedCorpusBytes} bytes`,
    `request budget: ${status.requestBudgetBytes} bytes`,
    `evidence: ${status.totalEvidenceCount} total, ${status.retainedEvidenceCount} retained, ${status.omittedEvidenceCount} omitted`,
    `one-request eligible: ${status.eligibleForSingleRequest ? "yes" : "no"}`
  ].join("; ");
}

function loadEvidenceBundle(
  projectRoot: string,
  selector: string
): { root: string; bundle: EvidenceBundle } {
  const root = realpathSync(projectRoot);
  const sessionFile = resolveSessionFile(root, selector);
  if (!existsSync(sessionFile)) {
    throw new Error(`No recording found for ${selector} at ${sessionFile}`);
  }
  const session = readCodexSessionFile(sessionFile);
  if (session.events.length === 0) {
    throw new Error(`No valid hook events found in ${session.sourcePath}`);
  }
  return { root, bundle: buildEvidenceBundle(session) };
}

function parseArguments(args: string[]): { selector: string; dryRun: boolean } {
  const dryRunArguments = args.filter((argument) => argument === "--dry-run");
  const unknownFlags = args.filter(
    (argument) => argument.startsWith("--") && argument !== "--dry-run"
  );
  const selectors = args.filter((argument) => !argument.startsWith("--"));
  if (
    dryRunArguments.length > 1 ||
    unknownFlags.length > 0 ||
    selectors.length > 1
  ) {
    throw new Error("Usage: npm run analyze -- [--dry-run] [latest|session-id]");
  }
  return { selector: selectors[0] ?? "latest", dryRun: dryRunArguments.length === 1 };
}

function displayPath(path: string): string {
  return relative(process.cwd(), path) || path;
}

async function main(): Promise<void> {
  process.exitCode = await runAnalyzeCommand({
    projectRoot: PROJECT_ROOT,
    args: process.argv.slice(2),
    env: process.env
  });
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  void main();
}
