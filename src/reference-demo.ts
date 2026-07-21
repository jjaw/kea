import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  AnalysisSchema,
  type Analysis
} from "./analysis-definitions.ts";
import type {
  AnalysisProvider,
  ProviderRunMetadata
} from "./analysis-provider.ts";
import {
  ValidationActionSchema,
  ValidationSummarySchema,
  type ValidationSummary
} from "./analysis-validator.ts";
import {
  runDemo,
  type DemoRunResult
} from "./demo-orchestration.ts";
import {
  EvidenceBundleSchema,
  measureEvidenceCorpus
} from "./evidence-bundle.ts";
import { escapeHtml } from "./html.ts";
import {
  FinalSessionDispositionSchema,
  StructuralSessionReceiptSchema
} from "./session-disposition.ts";

export const REFERENCE_DEMO_NOW = new Date("2026-07-21T05:00:00.000Z");

const GENERATED_RUN_ID = "<generated-run-id>";
const FIXTURE_RECORDING = "events.jsonl";
const MOCK_ANALYSIS = "mock-analysis.json";
const EXPECTED_ANALYSIS = "expected-analysis.json";
const EXPECTED_VALIDATION_AUDIT = "expected-validation-audit.json";
const EXPECTED_DISPOSITION = "expected-disposition.json";
const EXPECTED_RENDERER_ASSERTIONS = "expected-renderer-assertions.json";

const NormalizedValidationAuditSchema = z
  .object({
    rejectedCount: z.number().int().nonnegative(),
    downgradedCount: z.number().int().nonnegative(),
    amendedCount: z.number().int().nonnegative(),
    actions: z.array(ValidationActionSchema)
  })
  .strict();

const ExpectedDispositionSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("full_report"),
    reason: z.literal("validated_analysis_available"),
    fixture: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        lineCount: z.number().int().positive()
      })
      .strict(),
    receipt: StructuralSessionReceiptSchema.omit({ evaluatedAt: true }),
    validatedRun: z
      .object({
        runId: z.literal(GENERATED_RUN_ID),
        analysisArtifact: z.literal("analysis.json"),
        validationSummaryArtifact: z.literal("validation-summary.json"),
        renderedArtifacts: z
          .object({
            markdown: z.literal("report.md"),
            html: z.literal("report.html")
          })
          .strict()
      })
      .strict(),
    validation: z
      .object({
        successful: z.literal(true),
        rejectedCount: z.number().int().nonnegative(),
        downgradedCount: z.number().int().nonnegative(),
        amendedCount: z.number().int().nonnegative()
      })
      .strict(),
    outputs: z
      .object({
        reportFilename: z.literal("report.html"),
        inboxFilename: z.literal("index.html"),
        inboxEntryCount: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

const RendererSectionSchema = z
  .object({
    containsText: z.array(z.string()),
    doesNotContainText: z.array(z.string()),
    forbiddenMarkup: z.array(z.string())
  })
  .strict();

const RendererAssertionsSchema = z
  .object({
    report: RendererSectionSchema,
    index: RendererSectionSchema.extend({
      relativeReportHref: z.string().min(1),
      entryCount: z.number().int().nonnegative()
    }).strict()
  })
  .strict();

type NormalizedValidationAudit = z.infer<
  typeof NormalizedValidationAuditSchema
>;
type ExpectedDisposition = z.infer<typeof ExpectedDispositionSchema>;
type RendererAssertions = z.infer<typeof RendererAssertionsSchema>;

export type ReferenceDemoResult = {
  demo: DemoRunResult;
  providerCallCount: number;
  evidenceCount: number;
  serializedCorpusBytes: number;
  validationAudit: NormalizedValidationAudit;
  reportPath: string;
  indexPath: string;
};

export async function runReferenceDemo(options: {
  projectRoot: string;
  fixtureDirectory: string;
  outputRoot?: string;
  now?: Date;
}): Promise<ReferenceDemoResult> {
  const fixtureDirectory = realpathSync(options.fixtureDirectory);
  const recordingPath = join(fixtureDirectory, FIXTURE_RECORDING);
  requireFile(recordingPath, "Approved reference recording");

  const expectedDisposition = readJson(
    join(fixtureDirectory, EXPECTED_DISPOSITION),
    "Expected disposition",
    ExpectedDispositionSchema
  );
  const fixtureHashBefore = sha256(recordingPath);
  const fixtureLineCount = lineCount(recordingPath);
  assertExact(
    { sha256: fixtureHashBefore, lineCount: fixtureLineCount },
    expectedDisposition.fixture,
    "Approved fixture integrity"
  );

  const candidate = readJson(
    join(fixtureDirectory, MOCK_ANALYSIS),
    "Mock candidate analysis",
    AnalysisSchema
  );
  const providerState = localReferenceProvider(candidate, options.now ?? REFERENCE_DEMO_NOW);
  const demo = await runDemo({
    projectRoot: options.projectRoot,
    fixtureRecordingPath: recordingPath,
    ...(options.outputRoot === undefined ? {} : { outputRoot: options.outputRoot }),
    provider: providerState.provider,
    now: options.now ?? REFERENCE_DEMO_NOW
  });

  if (providerState.calls() !== 1) {
    throw new Error(
      `Reference provider call count mismatch: expected 1, received ${providerState.calls()}`
    );
  }
  if (sha256(recordingPath) !== fixtureHashBefore) {
    throw new Error("Approved reference fixture changed during demo execution");
  }
  if (sha256(demo.stagedRecordingPath) !== fixtureHashBefore) {
    throw new Error("Staged demo recording differs from the approved fixture");
  }

  const artifacts = requireSuccessfulArtifacts(demo);
  const persistedCandidate = readJson(
    artifacts.candidateAnalysisPath,
    "Persisted candidate analysis",
    AnalysisSchema
  );
  assertExact(persistedCandidate, candidate, "Persisted candidate analysis");

  const analysis = readJson(
    artifacts.analysisPath,
    "Validated analysis",
    AnalysisSchema
  );
  const expectedAnalysis = readJson(
    join(fixtureDirectory, EXPECTED_ANALYSIS),
    "Expected validated analysis",
    AnalysisSchema
  );
  assertExact(analysis, expectedAnalysis, "Validated analysis");

  const validationSummary = readJson(
    artifacts.validationSummaryPath,
    "Validation summary",
    ValidationSummarySchema
  );
  const validationAudit = normalizeValidationAudit(validationSummary);
  const expectedAudit = readJson(
    join(fixtureDirectory, EXPECTED_VALIDATION_AUDIT),
    "Expected normalized validation audit",
    NormalizedValidationAuditSchema
  );
  assertExact(validationAudit, expectedAudit, "Normalized validation audit");

  const bundle = readJson(
    artifacts.bundlePath,
    "Persisted evidence bundle",
    EvidenceBundleSchema
  );
  const corpus = measureEvidenceCorpus(bundle);
  const disposition = readJson(
    demo.dispositionPath,
    "Final full-report disposition",
    FinalSessionDispositionSchema
  );
  const reportHtml = readFileSync(artifacts.htmlReportPath, "utf8");
  const indexHtml = readFileSync(demo.indexPath, "utf8");
  const normalizedDisposition = normalizeDisposition({
    disposition,
    validationSummary,
    reportPath: artifacts.htmlReportPath,
    indexPath: demo.indexPath,
    indexHtml,
    fixture: expectedDisposition.fixture
  });
  assertExact(
    normalizedDisposition,
    expectedDisposition,
    "Normalized full-report disposition"
  );

  const rendererAssertions = readJson(
    join(fixtureDirectory, EXPECTED_RENDERER_ASSERTIONS),
    "Expected renderer assertions",
    RendererAssertionsSchema
  );
  validateRendererAssertions(
    reportHtml,
    indexHtml,
    demo.artifacts.runId,
    rendererAssertions
  );

  return {
    demo,
    providerCallCount: providerState.calls(),
    evidenceCount: bundle.evidence.length,
    serializedCorpusBytes: corpus.serializedCorpusBytes,
    validationAudit,
    reportPath: artifacts.htmlReportPath,
    indexPath: demo.indexPath
  };
}

function localReferenceProvider(candidate: Analysis, now: Date): {
  provider: AnalysisProvider;
  calls(): number;
} {
  let callCount = 0;
  const metadata: ProviderRunMetadata = {
    provider: "deterministic-reference-fixture",
    model: "committed-mock-analysis",
    reasoningEffort: "none",
    store: false,
    requestedAt: now.toISOString(),
    completedAt: now.toISOString()
  };
  return {
    provider: {
      analyze: async () => {
        callCount += 1;
        return {
          kind: "success",
          candidate,
          rawResponse: { kind: "deterministic_reference_fixture" },
          metadata
        };
      }
    },
    calls: () => callCount
  };
}

function normalizeValidationAudit(
  summary: ValidationSummary
): NormalizedValidationAudit {
  return NormalizedValidationAuditSchema.parse({
    rejectedCount: summary.rejectedCount,
    downgradedCount: summary.downgradedCount,
    amendedCount: summary.amendedCount,
    actions: summary.actions
  });
}

function normalizeDisposition(options: {
  disposition: z.infer<typeof FinalSessionDispositionSchema>;
  validationSummary: ValidationSummary;
  reportPath: string;
  indexPath: string;
  indexHtml: string;
  fixture: ExpectedDisposition["fixture"];
}): ExpectedDisposition {
  if (options.disposition.kind !== "full_report") {
    throw new Error(
      `Expected full_report disposition, received ${options.disposition.kind}`
    );
  }
  const { evaluatedAt: _evaluatedAt, ...receipt } = options.disposition.receipt;
  return ExpectedDispositionSchema.parse({
    schemaVersion: options.disposition.schemaVersion,
    kind: options.disposition.kind,
    reason: options.disposition.reason,
    fixture: options.fixture,
    receipt,
    validatedRun: {
      ...options.disposition.validatedRun,
      runId: GENERATED_RUN_ID
    },
    validation: {
      successful: true,
      rejectedCount: options.validationSummary.rejectedCount,
      downgradedCount: options.validationSummary.downgradedCount,
      amendedCount: options.validationSummary.amendedCount
    },
    outputs: {
      reportFilename: basename(options.reportPath),
      inboxFilename: basename(options.indexPath),
      inboxEntryCount: countOccurrences(
        options.indexHtml,
        '<article class="entry '
      )
    }
  });
}

function validateRendererAssertions(
  reportHtml: string,
  indexHtml: string,
  runId: string,
  assertions: RendererAssertions
): void {
  validateRendererSection("report", reportHtml, assertions.report);
  validateRendererSection("index", indexHtml, assertions.index);

  const expectedHref = assertions.index.relativeReportHref.replace(
    GENERATED_RUN_ID,
    runId
  );
  requireContains(
    indexHtml,
    `href="${expectedHref}"`,
    "index relative report link"
  );
  const entryCount = countOccurrences(indexHtml, '<article class="entry ');
  if (entryCount !== assertions.index.entryCount) {
    throw new Error(
      `Index entry count mismatch: expected ${assertions.index.entryCount}, received ${entryCount}`
    );
  }
}

function validateRendererSection(
  label: string,
  html: string,
  assertions: z.infer<typeof RendererSectionSchema>
): void {
  for (const text of assertions.containsText) {
    requireContains(html, escapeHtml(text), `${label} text`);
  }
  for (const text of assertions.doesNotContainText) {
    if (html.includes(escapeHtml(text))) {
      throw new Error(`${label} unexpectedly contains rejected text: ${text}`);
    }
  }
  for (const markup of assertions.forbiddenMarkup) {
    if (html.toLowerCase().includes(markup.toLowerCase())) {
      throw new Error(`${label} contains forbidden markup: ${markup}`);
    }
  }
}

function requireSuccessfulArtifacts(demo: DemoRunResult): {
  bundlePath: string;
  candidateAnalysisPath: string;
  analysisPath: string;
  validationSummaryPath: string;
  reportPath: string;
  htmlReportPath: string;
} {
  const required = {
    bundlePath: demo.artifacts.bundlePath,
    candidateAnalysisPath: demo.artifacts.candidateAnalysisPath,
    analysisPath: demo.artifacts.analysisPath,
    validationSummaryPath: demo.artifacts.validationSummaryPath,
    reportPath: demo.artifacts.reportPath,
    htmlReportPath: demo.artifacts.htmlReportPath
  };
  for (const [label, path] of Object.entries(required)) {
    if (path === null || !existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Reference demo ${label} was not persisted`);
    }
  }
  return required as Record<keyof typeof required, string>;
}

function readJson<T>(path: string, label: string, schema: z.ZodType<T>): T {
  requireFile(path, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return schema.parse(parsed);
}

function requireFile(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} is missing: ${path}`);
  }
}

function assertExact(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${label} does not match committed expectation\nExpected: ${JSON.stringify(expected, null, 2)}\nActual: ${JSON.stringify(actual, null, 2)}`
    );
  }
}

function requireContains(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} is missing expected content: ${expected}`);
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function lineCount(path: string): number {
  const value = readFileSync(path, "utf8");
  return value === "" ? 0 : value.trimEnd().split("\n").length;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
