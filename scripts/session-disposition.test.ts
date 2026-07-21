import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { SourceClass } from "../src/analysis-definitions.ts";
import { AnalysisSchema } from "../src/analysis-definitions.ts";
import { ValidationSummarySchema } from "../src/analysis-validator.ts";
import {
  EvidenceBundleSchema,
  measureEvidenceCorpus,
  type EvidenceBundle,
  type EvidenceItem
} from "../src/evidence-bundle.ts";
import { SESSION_ELIGIBILITY_THRESHOLDS } from "../src/session-disposition-config.ts";
import {
  ACTIVITY_ONLY_REASONS,
  ANALYSIS_FAILURE_REASONS,
  AUTOMATIC_ANALYZE_REASONS,
  BLOCKED_REASONS,
  FULL_REPORT_REASONS,
  FinalSessionDispositionSchema,
  assessAutomaticAnalysis,
  buildStructuralSessionReceipt,
  computeEvidenceStateHash,
  createAnalysisFailedDisposition,
  createFullReportDisposition,
  finalDispositionFromDecision,
  type AutomaticAnalysisDecision,
  type FinalSessionDisposition,
  type StructuralSessionReceipt
} from "../src/session-disposition.ts";
import {
  persistLatestSessionDisposition,
  readLatestSessionDisposition,
  sessionDispositionStorageKey
} from "../src/session-disposition-store.ts";

const EVALUATED_AT = "2026-07-20T20:00:00.000Z";
const AVAILABLE_ENVIRONMENT = {
  automaticAnalysisEnabled: true,
  apiKeyAvailable: true
};

test("evidence-state hashing uses a stable explicit projection", () => {
  const original = questionBundle();
  const identical = structuredClone(original);
  assert.equal(computeEvidenceStateHash(original), computeEvidenceStateHash(identical));

  const changed = structuredClone(original);
  changed.evidence[0]!.content = "A different sanitized question";
  assert.notEqual(computeEvidenceStateHash(original), computeEvidenceStateHash(changed));

  const reordered = bundle([
    human("E2", "turn-2", "Second"),
    human("E1", "turn-1", "First")
  ]);
  const forward = bundle([
    human("E1", "turn-1", "First"),
    human("E2", "turn-2", "Second")
  ]);
  assert.notEqual(computeEvidenceStateHash(forward), computeEvidenceStateHash(reordered));

  const withDifferentDisplayDiagnostics = structuredClone(original);
  withDifferentDisplayDiagnostics.diagnostics = ["Display-only diagnostic changed"];
  assert.equal(
    computeEvidenceStateHash(original),
    computeEvidenceStateHash(withDifferentDisplayDiagnostics)
  );
});

test("environment, evaluation time, and corpus measurements do not affect the evidence hash", () => {
  const evidence = questionBundle();
  const first = assess(evidence, {
    environment: {
      automaticAnalysisEnabled: false,
      apiKeyAvailable: false
    },
    evaluatedAt: "2026-07-20T20:00:00.000Z",
    requestBudgetBytes: 524_288
  });
  const second = assess(evidence, {
    environment: AVAILABLE_ENVIRONMENT,
    evaluatedAt: "2026-07-21T20:00:00.000Z",
    requestBudgetBytes: 1_048_576
  });

  assert.equal(first.receipt.evidenceStateHash, second.receipt.evidenceStateHash);
  assert.notEqual(first.receipt.evaluatedAt, second.receipt.evaluatedAt);
  assert.notEqual(
    first.receipt.corpus.requestBudgetBytes,
    second.receipt.corpus.requestBudgetBytes
  );
});

test("one question is activity_only before transport or environmental checks", () => {
  const evidence = questionBundle();
  const decision = assess(evidence, {
    environment: {
      automaticAnalysisEnabled: false,
      apiKeyAvailable: false
    },
    requestBudgetBytes: 0
  });

  assert.equal(decision.kind, "activity_only");
  assert.equal(decision.reason, "insufficient_structural_evidence");
  assert.equal(decision.receipt.corpus.eligibleForSingleRequest, false);
  assert.equal(decision.receipt.counts.humanMessages, 1);
  assert.equal(decision.receipt.counts.toolResults, 0);
});

test("structurally insufficient activity does not evaluate the automatic environment", () => {
  const evidence = questionBundle();
  const decision = assessAutomaticAnalysis({
    bundle: evidence,
    corpusStatus: measureEvidenceCorpus(evidence),
    environment: {
      automaticAnalysisEnabled: "not-a-boolean",
      apiKeyAvailable: "not-a-boolean"
    } as unknown as typeof AVAILABLE_ENVIRONMENT,
    evaluatedAt: EVALUATED_AT
  });

  assert.equal(decision.kind, "activity_only");
  assert.equal(decision.reason, "insufficient_structural_evidence");
});

test("matched result activity inside a changed snapshot interval is counted", () => {
  const evidence = changedIntervalBundle();
  const decision = assess(evidence);

  assert.equal(decision.kind, "analyze");
  assert.equal(decision.reason, "git_change_with_result_activity");
  assert.equal(decision.receipt.gitStateChangedBetweenSnapshots, true);
  assert.equal(decision.receipt.matchedResultsBetweenChangedSnapshots, 1);
  assert.equal(decision.receipt.hasMatchedResultsBetweenChangedSnapshots, true);
});

test("interval counting does not require a result after the later snapshot", () => {
  const evidence = changedIntervalBundle();
  const laterSnapshotSequence = evidence.evidence.at(-1)?.structuralFacts.sequence;
  const resultSequence = evidence.evidence.find(
    (item) => item.sourceClass === "tool_result"
  )?.structuralFacts.sequence;

  assert.ok(resultSequence !== undefined && laterSnapshotSequence !== undefined);
  assert.ok(resultSequence < laterSnapshotSequence);
  assert.equal(
    buildReceipt(evidence).matchedResultsBetweenChangedSnapshots,
    1
  );
});

test("results outside a changed snapshot interval are not counted", () => {
  const before = bundle([
    attempt("E1", "turn-1", "tool-before"),
    result("E2", "turn-1", "E1"),
    gitSnapshot("E3.git", gitState("before")),
    gitSnapshot("E4.git", gitState("after"))
  ]);
  const after = bundle([
    gitSnapshot("E1.git", gitState("before")),
    gitSnapshot("E2.git", gitState("after")),
    attempt("E3", "turn-1", "tool-after"),
    result("E4", "turn-1", "E3")
  ]);

  assert.equal(buildReceipt(before).matchedResultsBetweenChangedSnapshots, 0);
  assert.equal(buildReceipt(after).matchedResultsBetweenChangedSnapshots, 0);
});

test("multiple changed snapshot intervals are handled deterministically", () => {
  const evidence = bundle([
    gitSnapshot("E1.git", gitState("one")),
    attempt("E2", "turn-1", "tool-1"),
    result("E3", "turn-1", "E2"),
    gitSnapshot("E4.git", gitState("two")),
    attempt("E5", "turn-2", "tool-2"),
    result("E6", "turn-2", "E5"),
    gitSnapshot("E7.git", gitState("three"))
  ]);
  const first = buildReceipt(evidence);
  const second = buildReceipt(structuredClone(evidence));

  assert.equal(first.matchedResultsBetweenChangedSnapshots, 2);
  assert.deepEqual(first, second);
});

test("malformed Git snapshots establish no interval and are not skipped", () => {
  const evidence = bundle([
    gitSnapshot("E1.git", gitState("one")),
    {
      id: "E2.git",
      sourceClass: "git_snapshot",
      content: { display: "head: two" }
    },
    attempt("E3", "turn-1", "tool-1"),
    result("E4", "turn-1", "E3"),
    gitSnapshot("E5.git", gitState("three"))
  ]);
  const receipt = buildReceipt(evidence);

  assert.equal(receipt.gitStateChangedBetweenSnapshots, false);
  assert.equal(receipt.matchedResultsBetweenChangedSnapshots, 0);
});

test("substantial structured investigation is eligible without Git changes", () => {
  const decision = assess(investigationBundle());

  assert.equal(decision.kind, "analyze");
  assert.equal(decision.reason, "substantial_structural_investigation");
  assert.equal(decision.receipt.gitStateChangedBetweenSnapshots, false);
  assert.deepEqual(decision.receipt.counts, {
    humanMessages: 2,
    assistantMessages: 0,
    toolAttempts: 4,
    toolResults: 4,
    gitSnapshots: 0,
    matchedToolResults: 4,
    observableStructuredErrorResults: 1,
    distinctTurns: 2
  });
});

test("structured errors ignore commands, tool names, output text, and assistant claims", () => {
  const evidence = bundle([
    attempt("E1", "turn-1", "semantic-words", {
      toolName: "verify-error-build",
      command: "test verify error failed build"
    }),
    result("E2", "turn-1", "E1", [], {
      output: "test verify error failed build"
    }),
    attempt("E3", "turn-1", "neutral", { command: "neutral" }),
    result(
      "E4",
      "turn-1",
      "E3",
      [{ field: "exit_code", value: 2 }],
      { output: "neutral" }
    ),
    assistant("E5", "turn-1", "Everything failed")
  ]);
  const receipt = buildReceipt(evidence);

  assert.equal(receipt.counts.matchedToolResults, 2);
  assert.equal(receipt.counts.observableStructuredErrorResults, 1);
});

test("eligible decisions apply budget, consent, and key precedence", () => {
  const evidence = investigationBundle();
  assert.deepEqual(
    decisionKindAndReason(
      assess(evidence, { requestBudgetBytes: 0 })
    ),
    ["blocked", "bundle_too_large"]
  );
  assert.deepEqual(
    decisionKindAndReason(
      assess(evidence, {
        environment: {
          automaticAnalysisEnabled: false,
          apiKeyAvailable: false
        }
      })
    ),
    ["blocked", "automatic_analysis_not_enabled"]
  );
  assert.deepEqual(
    decisionKindAndReason(
      assess(evidence, {
        environment: {
          automaticAnalysisEnabled: true,
          apiKeyAvailable: false
        }
      })
    ),
    ["blocked", "missing_api_key"]
  );
});

test("receipt preserves missing captured identity and contains no performance labels", () => {
  const evidence = questionBundle({ sessionId: null, lastObservedAt: null });
  const decision = assess(evidence);
  const disposition = finalDispositionFromDecision(
    decision as Exclude<AutomaticAnalysisDecision, { kind: "analyze" }>
  );

  assert.equal(decision.receipt.sessionId, null);
  assert.equal(decision.receipt.lastObservedActivityAt, null);
  assert.equal(decision.receipt.evaluatedAt, EVALUATED_AT);
  assert.doesNotMatch(
    JSON.stringify(disposition),
    /valuable|wasteful|productive|unproductive/i
  );
});

test("final disposition schemas reject inconsistent variants and validation booleans", () => {
  const receipt = buildReceipt(questionBundle());
  const activity = FinalSessionDispositionSchema.parse({
    schemaVersion: 1,
    kind: "activity_only",
    reason: "insufficient_structural_evidence",
    receipt
  });
  const blocked = FinalSessionDispositionSchema.parse({
    schemaVersion: 1,
    kind: "blocked",
    reason: "missing_api_key",
    receipt
  });
  const failure = createAnalysisFailedDisposition(
    receipt,
    "analysis_artifact_persistence_failed"
  );

  assert.equal(
    FinalSessionDispositionSchema.safeParse({ ...activity, validated: false }).success,
    false
  );
  assert.equal(
    FinalSessionDispositionSchema.safeParse({ ...failure, validated: false }).success,
    false
  );
  assert.equal(
    FinalSessionDispositionSchema.safeParse({
      ...blocked,
      analysisRun: { runId: "unexpected" }
    }).success,
    false
  );
  assert.equal(
    FinalSessionDispositionSchema.safeParse({
      schemaVersion: 1,
      kind: "full_report",
      reason: "validated_analysis_available",
      receipt
    }).success,
    false
  );
});

test("full_report persistence requires valid analysis and validation artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-disposition-full-"));
  const receipt = buildReceipt(questionBundle());
  const runId = "validated-run";
  const runDirectory = join(root, ".codex-observer", "analysis-runs", runId);
  mkdirSync(runDirectory, { recursive: true });
  const disposition = createFullReportDisposition(receipt, {
    runId,
    analysisArtifact: "analysis.json",
    validationSummaryArtifact: "validation-summary.json"
  });

  assert.throws(() => persistLatestSessionDisposition(root, disposition));
  writeJson(join(runDirectory, "analysis.json"), emptyAnalysis());
  writeJson(
    join(runDirectory, "validation-summary.json"),
    validationSummary("another-run")
  );
  assert.throws(
    () => persistLatestSessionDisposition(root, disposition),
    /does not match/
  );
  writeJson(
    join(runDirectory, "validation-summary.json"),
    validationSummary(runId)
  );

  const persisted = persistLatestSessionDisposition(root, disposition);
  assert.equal(persisted.disposition.kind, "full_report");
  assert.equal(statSync(persisted.path).mode & 0o777, 0o600);
});

test("rendered artifacts are optional but referenced artifacts must exist", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-disposition-rendered-"));
  const receipt = buildReceipt(questionBundle());
  const runId = "rendered-run";
  createValidatedRun(root, runId);
  const withoutRendered = createFullReportDisposition(receipt, {
    runId,
    analysisArtifact: "analysis.json",
    validationSummaryArtifact: "validation-summary.json"
  });
  persistLatestSessionDisposition(root, withoutRendered);

  const withMarkdown = createFullReportDisposition(receipt, {
    runId,
    analysisArtifact: "analysis.json",
    validationSummaryArtifact: "validation-summary.json",
    renderedArtifacts: { markdown: "report.md" }
  });
  assert.throws(
    () => persistLatestSessionDisposition(root, withMarkdown),
    /Markdown report artifact/
  );
  writeFileSync(
    join(root, ".codex-observer", "analysis-runs", runId, "report.md"),
    "# Report\n",
    "utf8"
  );
  assert.equal(
    persistLatestSessionDisposition(root, withMarkdown).disposition.kind,
    "full_report"
  );
});

test("latest disposition replacement is atomic and invalid input preserves the prior value", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-disposition-atomic-"));
  const receipt = buildReceipt(investigationBundle());
  const first = FinalSessionDispositionSchema.parse({
    schemaVersion: 1,
    kind: "blocked",
    reason: "missing_api_key",
    receipt
  });
  const second = FinalSessionDispositionSchema.parse({
    schemaVersion: 1,
    kind: "blocked",
    reason: "automatic_analysis_not_enabled",
    receipt: { ...receipt, evaluatedAt: "2026-07-20T21:00:00.000Z" }
  });
  const firstPersisted = persistLatestSessionDisposition(root, first);
  persistLatestSessionDisposition(root, second);
  assert.equal(
    readLatestSessionDisposition(root, receipt)?.disposition.reason,
    "automatic_analysis_not_enabled"
  );

  const invalid = { ...second, validated: false } as unknown as FinalSessionDisposition;
  assert.throws(() => persistLatestSessionDisposition(root, invalid));
  assert.equal(
    readLatestSessionDisposition(root, receipt)?.disposition.reason,
    "automatic_analysis_not_enabled"
  );
  assert.equal(
    readdirSync(dirname(firstPersisted.path)).some((name) => name.endsWith(".tmp")),
    false
  );
});

test("environmental blocks are recomputed and atomically replaced", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-disposition-refresh-"));
  const evidence = investigationBundle();
  const blockedDecision = assess(evidence, {
    environment: {
      automaticAnalysisEnabled: true,
      apiKeyAvailable: false
    }
  });
  assert.equal(blockedDecision.kind, "blocked");
  const blocked = finalDispositionFromDecision(
    blockedDecision as Exclude<AutomaticAnalysisDecision, { kind: "analyze" }>
  );
  persistLatestSessionDisposition(root, blocked);

  const refreshed = assess(evidence, {
    environment: AVAILABLE_ENVIRONMENT,
    evaluatedAt: "2026-07-20T21:00:00.000Z"
  });
  assert.equal(refreshed.kind, "analyze");
  assert.equal(
    refreshed.receipt.evidenceStateHash,
    blocked.receipt.evidenceStateHash
  );
  const runId = "refresh-run";
  createValidatedRun(root, runId);
  const completed = createFullReportDisposition(refreshed.receipt, {
    runId,
    analysisArtifact: "analysis.json",
    validationSummaryArtifact: "validation-summary.json"
  });
  persistLatestSessionDisposition(root, completed);

  assert.equal(
    readLatestSessionDisposition(root, refreshed.receipt)?.disposition.kind,
    "full_report"
  );
});

test("storage identity is safe and separates missing-ID evidence states", () => {
  const firstReceipt = buildReceipt(
    questionBundle({ sessionId: null, question: "First missing identity" })
  );
  const secondReceipt = buildReceipt(
    questionBundle({ sessionId: null, question: "Second missing identity" })
  );
  const firstKey = sessionDispositionStorageKey(firstReceipt);
  const secondKey = sessionDispositionStorageKey(secondReceipt);
  assert.match(firstKey, /^ungrouped-[a-f0-9]{64}$/);
  assert.notEqual(firstKey, secondKey);

  const unsafeReceipt = {
    ...firstReceipt,
    sessionId: "../../outside"
  };
  const unsafeKey = sessionDispositionStorageKey(unsafeReceipt);
  assert.match(unsafeKey, /^session-[a-f0-9]{64}$/);
  assert.equal(unsafeKey.includes(".."), false);

  const root = mkdtempSync(join(tmpdir(), "kea-disposition-identity-"));
  for (const receipt of [firstReceipt, secondReceipt]) {
    persistLatestSessionDisposition(
      root,
      FinalSessionDispositionSchema.parse({
        schemaVersion: 1,
        kind: "activity_only",
        reason: "insufficient_structural_evidence",
        receipt
      })
    );
  }
  const dispositionRoot = join(root, ".codex-observer", "session-dispositions");
  assert.deepEqual(readdirSync(dispositionRoot).sort(), [firstKey, secondKey].sort());
});

test("analysis failure run references must exist and disposition-store errors surface", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-disposition-failure-"));
  const receipt = buildReceipt(questionBundle());
  const missingRun = createAnalysisFailedDisposition(
    receipt,
    "request_failed",
    { runId: "missing-run" }
  );
  assert.throws(
    () => persistLatestSessionDisposition(root, missingRun),
    /Analysis run directory/
  );

  const artifactFailure = createAnalysisFailedDisposition(
    receipt,
    "analysis_artifact_persistence_failed"
  );
  assert.equal(
    persistLatestSessionDisposition(root, artifactFailure).disposition.reason,
    "analysis_artifact_persistence_failed"
  );

  const blockedRoot = mkdtempSync(join(tmpdir(), "kea-disposition-store-error-"));
  writeFileSync(join(blockedRoot, ".codex-observer"), "not a directory", "utf8");
  assert.throws(() =>
    persistLatestSessionDisposition(blockedRoot, artifactFailure)
  );
  assert.equal(
    existsSync(join(blockedRoot, ".codex-observer", "session-dispositions")),
    false
  );
});

test("thresholds and reason-code enums remain centralized and exact", () => {
  assert.deepEqual(SESSION_ELIGIBILITY_THRESHOLDS, {
    minimumMatchedResultsBetweenChangedSnapshots: 1,
    minimumHumanMessagesForInvestigation: 2,
    minimumDistinctTurnsForInvestigation: 2,
    minimumMatchedToolResultsForInvestigation: 4,
    minimumObservableErrorResultsForInvestigation: 1
  });
  assert.deepEqual(AUTOMATIC_ANALYZE_REASONS, [
    "git_change_with_result_activity",
    "substantial_structural_investigation"
  ]);
  assert.deepEqual(ACTIVITY_ONLY_REASONS, ["insufficient_structural_evidence"]);
  assert.deepEqual(BLOCKED_REASONS, [
    "bundle_too_large",
    "automatic_analysis_not_enabled",
    "missing_api_key"
  ]);
  assert.deepEqual(FULL_REPORT_REASONS, ["validated_analysis_available"]);
  assert.ok(
    ANALYSIS_FAILURE_REASONS.includes("analysis_artifact_persistence_failed")
  );
});

function assess(
  evidence: EvidenceBundle,
  options: {
    environment?: typeof AVAILABLE_ENVIRONMENT;
    evaluatedAt?: string;
    requestBudgetBytes?: number;
  } = {}
): AutomaticAnalysisDecision {
  return assessAutomaticAnalysis({
    bundle: evidence,
    corpusStatus: measureEvidenceCorpus(
      evidence,
      options.requestBudgetBytes ?? 524_288
    ),
    environment: options.environment ?? AVAILABLE_ENVIRONMENT,
    evaluatedAt: options.evaluatedAt ?? EVALUATED_AT
  });
}

function buildReceipt(evidence: EvidenceBundle): StructuralSessionReceipt {
  return buildStructuralSessionReceipt(
    evidence,
    measureEvidenceCorpus(evidence),
    EVALUATED_AT
  );
}

function decisionKindAndReason(
  decision: AutomaticAnalysisDecision
): [AutomaticAnalysisDecision["kind"], string] {
  return [decision.kind, decision.reason];
}

type ItemInput = {
  id: string;
  sourceClass: SourceClass;
  turnId?: string | null;
  content?: unknown;
  facts?: Omit<EvidenceItem["structuralFacts"], "sequence">;
};

function bundle(
  items: ItemInput[],
  options: {
    sessionId?: string | null;
    lastObservedAt?: string | null;
    diagnostics?: string[];
  } = {}
): EvidenceBundle {
  return EvidenceBundleSchema.parse({
    schemaVersion: 1,
    session: {
      sessionId: options.sessionId === undefined ? "session-123" : options.sessionId,
      firstObservedAt:
        items.length === 0 ? null : "2026-07-20T19:00:00.000Z",
      lastObservedAt:
        options.lastObservedAt === undefined
          ? items.length === 0
            ? null
            : "2026-07-20T19:59:00.000Z"
          : options.lastObservedAt,
      cwd: "/workspace",
      model: "codex-test"
    },
    evidence: items.map((item, index) => ({
      id: item.id,
      sourceClass: item.sourceClass,
      timestamp: `2026-07-20T19:${String(index).padStart(2, "0")}:00.000Z`,
      turnId: item.turnId ?? null,
      content: item.content ?? null,
      structuralFacts: { sequence: index + 1, ...item.facts }
    })),
    diagnostics: options.diagnostics ?? []
  });
}

function questionBundle(
  options: {
    sessionId?: string | null;
    lastObservedAt?: string | null;
    question?: string;
  } = {}
): EvidenceBundle {
  return bundle(
    [human("E1", "turn-1", options.question ?? "What is the current state?")],
    options
  );
}

function changedIntervalBundle(): EvidenceBundle {
  return bundle([
    gitSnapshot("E1.git", gitState("before")),
    attempt("E2", "turn-1", "tool-1"),
    result("E3", "turn-1", "E2"),
    gitSnapshot("E4.git", gitState("after"))
  ]);
}

function investigationBundle(): EvidenceBundle {
  return bundle([
    human("E1", "turn-1", "Investigate the behavior"),
    attempt("E2", "turn-1", "tool-1"),
    result("E3", "turn-1", "E2", [{ field: "exit_code", value: 1 }]),
    attempt("E4", "turn-1", "tool-2"),
    result("E5", "turn-1", "E4"),
    human("E6", "turn-2", "Continue the investigation"),
    attempt("E7", "turn-2", "tool-3"),
    result("E8", "turn-2", "E7"),
    attempt("E9", "turn-2", "tool-4"),
    result("E10", "turn-2", "E9")
  ]);
}

function human(id: string, turnId: string, content: string): ItemInput {
  return { id, sourceClass: "human_message", turnId, content };
}

function assistant(id: string, turnId: string, content: string): ItemInput {
  return { id, sourceClass: "assistant_message", turnId, content };
}

function attempt(
  id: string,
  turnId: string,
  toolUseId: string,
  content: unknown = { input: "neutral" }
): ItemInput {
  return {
    id,
    sourceClass: "tool_attempt",
    turnId,
    content,
    facts: { toolUseId }
  };
}

function result(
  id: string,
  turnId: string,
  matchedEvidenceId: string,
  errorIndicators: Array<{
    field: string;
    value: string | number | boolean;
  }> = [],
  content: unknown = { output: "neutral" }
): ItemInput {
  return {
    id,
    sourceClass: "tool_result",
    turnId,
    content,
    facts: { matchedEvidenceId, errorIndicators }
  };
}

function gitSnapshot(
  id: string,
  content: ReturnType<typeof gitState>
): ItemInput {
  return { id, sourceClass: "git_snapshot", content };
}

function gitState(marker: string) {
  return {
    head: `head-${marker}`,
    branch: "main",
    status: ` M ${marker}.ts`,
    diff: `diff-${marker}`,
    errors: [] as string[]
  };
}

function emptyAnalysis() {
  return AnalysisSchema.parse({
    objective: { value: null, basis: "unknown", evidenceIds: [] },
    approaches: [],
    humanInterventions: [],
    turningPoints: [],
    codexContributions: [],
    reportedOutcome: null,
    independentlySupportedOutcome: null,
    outcomeSupport: "unknown",
    evidenceGaps: [],
    leadershipInsights: []
  });
}

function validationSummary(runId: string) {
  return ValidationSummarySchema.parse({
    schemaVersion: 1,
    runId,
    validatedAt: EVALUATED_AT,
    rejectedCount: 0,
    downgradedCount: 0,
    amendedCount: 0,
    actions: []
  });
}

function createValidatedRun(root: string, runId: string): void {
  const runDirectory = join(root, ".codex-observer", "analysis-runs", runId);
  mkdirSync(runDirectory, { recursive: true });
  writeJson(join(runDirectory, "analysis.json"), emptyAnalysis());
  writeJson(
    join(runDirectory, "validation-summary.json"),
    validationSummary(runId)
  );
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
