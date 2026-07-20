import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import type { Analysis } from "./analysis-definitions.ts";
import {
  validateAnalysis,
  type ValidationResult,
  type ValidationSummary
} from "./analysis-validator.ts";
import type { EvidenceBundle } from "./evidence-bundle.ts";

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
};

export type PersistedValidationResult = ValidationResult & {
  artifacts: AnalysisRunArtifacts;
};

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
    options.reportMarkdown !== undefined &&
    (options.analysis === undefined || options.validationSummary === undefined)
  ) {
    throw new Error("A Markdown report requires validated analysis artifacts");
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
    reportPath
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
  } = {}
): PersistedValidationResult {
  const runId = createAnalysisRunId(now);
  const result = validateAnalysis(candidate, bundle, runId, now);
  const reportMarkdown = options.renderMarkdown?.(
    result.analysis,
    result.summary,
    runId
  );
  const artifacts = persistAnalysisRun(projectRoot, bundle, {
    runId,
    analysis: result.analysis,
    validationSummary: result.summary,
    candidateAnalysis: options.candidateAnalysis,
    providerResponse: options.providerResponse,
    metadata: options.metadata,
    reportMarkdown
  });
  return { ...result, artifacts };
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJsonAtomically(path: string, value: unknown): void {
  writeTextAtomically(path, serializeJson(value));
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
