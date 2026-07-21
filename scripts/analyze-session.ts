import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalysisProvider } from "../src/analysis-provider.ts";
import {
  AnalysisRunStageError,
  persistAnalysisRun,
  serializeJson,
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
import {
  RecordingAnalysisIntegrationError,
  runAnalysisForRecording,
  type RecordingAnalysisResult
} from "../src/recording-analysis-run.ts";
import { generateSessionReport } from "./report-session.ts";
import { resolveSessionFile } from "./report-session.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export type LiveAnalysisResult = RecordingAnalysisResult;

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
  const root = realpathSync(options.projectRoot);
  const recordingPath = resolveSessionFile(root, selector);
  return runAnalysisForRecording({
    projectRoot: root,
    recordingPath,
    selector,
    provider: options.provider,
    now: options.now
  });
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
      `HTML report saved to ${displayPath(result.artifacts.htmlReportPath ?? result.artifacts.directory)}\n`
    );
    stdout.write(`Report inbox saved to ${displayPath(result.indexPath)}\n`);
    stdout.write(
      `Validation: ${result.summary.rejectedCount} rejected, ${result.summary.downgradedCount} downgraded, ${result.summary.amendedCount} amended.\n`
    );
    return 0;
  } catch (error) {
    if (error instanceof RecordingAnalysisIntegrationError) {
      stderr.write(`${error.message}\n`);
      if (error.artifacts.htmlReportPath !== null) {
        stderr.write(
          `HTML report exists at ${displayPath(error.artifacts.htmlReportPath)}\n`
        );
      }
      if (error.dispositionPath !== undefined) {
        stderr.write(
          `Full-report disposition exists at ${displayPath(error.dispositionPath)}\n`
        );
      }
      stderr.write("The report was not successfully added to the report inbox.\n");
      return 1;
    }
    if (error instanceof AnalysisRunStageError) {
      stderr.write(`${error.stage}: ${error.message}\n`);
      stderr.write("No report was successfully added to the report inbox.\n");
      return 1;
    }
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
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
