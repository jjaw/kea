import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { AnalysisSchema, type Analysis } from "./analysis-definitions.ts";
import { renderAnalysisHtmlReport } from "./analysis-html-report.ts";
import {
  ValidationSummarySchema,
  validateAnalysis,
  type ValidationResult,
  type ValidationSummary
} from "./analysis-validator.ts";
import {
  EvidenceBundleSchema,
  type EvidenceBundle
} from "./evidence-bundle.ts";
import { SafeAnalysisRunIdSchema } from "./session-disposition.ts";

export type AnalysisRunArtifacts = {
  runId: string;
  directory: string;
  bundlePath: string;
  analysisPath: string | null;
  validationSummaryPath: string | null;
  candidateAnalysisPath: string | null;
  providerResponsePath: string | null;
  providerErrorPath: string | null;
  metadataPath: string | null;
  reportPath: string | null;
  htmlReportPath: string | null;
};

export type PersistedValidationResult = ValidationResult & {
  artifacts: AnalysisRunArtifacts;
};

export class AnalysisRunStageError extends Error {
  readonly stage:
    | "validated_artifact_persistence"
    | "html_rendering_or_persistence";

  constructor(
    stage:
      | "validated_artifact_persistence"
      | "html_rendering_or_persistence",
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AnalysisRunStageError";
    this.stage = stage;
  }
}

export function createAnalysisRunId(now: Date = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
}

export function persistAnalysisRun(
  projectRoot: string,
  bundle: EvidenceBundle,
  options: {
    runId?: string;
    analysis?: Analysis;
    validationSummary?: ValidationSummary;
    candidateAnalysis?: unknown;
    providerResponse?: unknown;
    providerError?: unknown;
    metadata?: Record<string, unknown>;
    reportMarkdown?: string;
    reportHtml?: string;
  } = {}
): AnalysisRunArtifacts {
  const runId = options.runId ?? createAnalysisRunId();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(runId)) {
    throw new Error("Invalid analysis run id");
  }
  if (
    (options.analysis === undefined) !==
    (options.validationSummary === undefined)
  ) {
    throw new Error("Analysis and validation summary must be persisted together");
  }
  if (
    options.validationSummary !== undefined &&
    options.validationSummary.runId !== runId
  ) {
    throw new Error("Validation summary run id does not match the analysis run");
  }
  if (
    (options.reportMarkdown !== undefined || options.reportHtml !== undefined) &&
    (options.analysis === undefined || options.validationSummary === undefined)
  ) {
    throw new Error("Rendered reports require validated analysis artifacts");
  }

  const directory = join(projectRoot, ".codex-observer", "analysis-runs", runId);
  if (existsSync(directory)) {
    throw new Error(`Analysis run already exists: ${runId}`);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const bundlePath = join(directory, "bundle.json");
  writeJsonAtomically(bundlePath, bundle);
  let analysisPath: string | null = null;
  let validationSummaryPath: string | null = null;
  let candidateAnalysisPath: string | null = null;
  let providerResponsePath: string | null = null;
  let providerErrorPath: string | null = null;
  let metadataPath: string | null = null;
  let reportPath: string | null = null;
  let htmlReportPath: string | null = null;

  if (options.candidateAnalysis !== undefined) {
    candidateAnalysisPath = join(directory, "candidate-analysis.json");
    writeJsonAtomically(candidateAnalysisPath, options.candidateAnalysis);
  }
  if (options.providerResponse !== undefined) {
    providerResponsePath = join(directory, "provider-response.json");
    writeJsonAtomically(providerResponsePath, options.providerResponse);
  }
  if (options.providerError !== undefined) {
    providerErrorPath = join(directory, "provider-error.json");
    writeJsonAtomically(providerErrorPath, options.providerError);
  }
  if (options.metadata !== undefined) {
    metadataPath = join(directory, "metadata.json");
    writeJsonAtomically(metadataPath, { ...options.metadata, runId });
  }
  if (options.analysis !== undefined && options.validationSummary !== undefined) {
    analysisPath = join(directory, "analysis.json");
    validationSummaryPath = join(directory, "validation-summary.json");
    writeJsonAtomically(analysisPath, options.analysis);
    writeJsonAtomically(validationSummaryPath, options.validationSummary);
  }
  if (options.reportMarkdown !== undefined) {
    reportPath = join(directory, "report.md");
    writeTextAtomically(reportPath, options.reportMarkdown);
  }
  if (options.reportHtml !== undefined) {
    try {
      htmlReportPath = writeHtmlReport(directory, options.reportHtml);
    } catch (error) {
      throw new AnalysisRunStageError(
        "html_rendering_or_persistence",
        `HTML report persistence failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  return {
    runId,
    directory,
    bundlePath,
    analysisPath,
    validationSummaryPath,
    candidateAnalysisPath,
    providerResponsePath,
    providerErrorPath,
    metadataPath,
    reportPath,
    htmlReportPath
  };
}

export function validateAndPersistAnalysisRun(
  projectRoot: string,
  bundle: EvidenceBundle,
  candidate: unknown,
  now: Date = new Date(),
  options: {
    candidateAnalysis?: unknown;
    providerResponse?: unknown;
    metadata?: Record<string, unknown>;
    renderMarkdown?: (
      analysis: Analysis,
      summary: ValidationSummary,
      runId: string
    ) => string;
    renderHtml?: (
      analysis: Analysis,
      summary: ValidationSummary,
      runId: string
    ) => string;
  } = {}
): PersistedValidationResult {
  const runId = createAnalysisRunId(now);
  const result = validateAnalysis(candidate, bundle, runId, now);
  const reportMarkdown = options.renderMarkdown?.(
    result.analysis,
    result.summary,
    runId
  );
  let reportHtml: string | undefined;
  try {
    reportHtml = options.renderHtml?.(
      result.analysis,
      result.summary,
      runId
    );
  } catch (error) {
    throw new AnalysisRunStageError(
      "html_rendering_or_persistence",
      `HTML report rendering failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  let artifacts: AnalysisRunArtifacts;
  try {
    artifacts = persistAnalysisRun(projectRoot, bundle, {
      runId,
      analysis: result.analysis,
      validationSummary: result.summary,
      candidateAnalysis: options.candidateAnalysis,
      providerResponse: options.providerResponse,
      metadata: options.metadata,
      reportMarkdown,
      reportHtml
    });
  } catch (error) {
    if (error instanceof AnalysisRunStageError) throw error;
    throw new AnalysisRunStageError(
      "validated_artifact_persistence",
      `Validated analysis artifact persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  return { ...result, artifacts };
}

export function regenerateStoredAnalysisHtmlReport(
  projectRoot: string,
  runIdInput: string
): { runId: string; htmlReportPath: string; html: string } {
  const root = realpathSync(projectRoot);
  const runId = SafeAnalysisRunIdSchema.parse(runIdInput);
  const directory = join(root, ".codex-observer", "analysis-runs", runId);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Analysis run directory does not exist: ${runId}`);
  }

  const bundle = EvidenceBundleSchema.parse(
    readStoredJson(join(directory, "bundle.json"), "Sanitized evidence bundle")
  );
  const analysis = AnalysisSchema.parse(
    readStoredJson(join(directory, "analysis.json"), "Validated analysis")
  );
  const summary = ValidationSummarySchema.parse(
    readStoredJson(
      join(directory, "validation-summary.json"),
      "Validation summary"
    )
  );
  if (summary.runId !== runId) {
    throw new Error("Validation summary run id does not match the analysis run");
  }

  const html = renderAnalysisHtmlReport(bundle, analysis, summary, runId);
  const htmlReportPath = writeHtmlReport(directory, html);
  return { runId, htmlReportPath, html };
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJsonAtomically(path: string, value: unknown): void {
  writeTextAtomically(path, serializeJson(value));
}

function writeHtmlReport(directory: string, html: string): string {
  const htmlReportPath = join(directory, "report.html");
  writeTextAtomically(htmlReportPath, html);
  return htmlReportPath;
}

function readStoredJson(path: string, label: string): unknown {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function writeTextAtomically(path: string, value: string): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, value, {
      encoding: "utf8",
      mode: 0o600
    });
    renameSync(temporaryPath, path);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the original error.
      }
    }
    throw error;
  }
}
