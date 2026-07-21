import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { AnalysisSchema } from "../src/analysis-definitions.ts";
import { ValidationSummarySchema } from "../src/analysis-validator.ts";
import {
  rebuildStaticReportIndex,
  renderStaticReportIndex
} from "../src/report-index.ts";
import {
  FinalSessionDispositionSchema,
  createFullReportDisposition,
  type FinalSessionDisposition,
  type StructuralSessionReceipt
} from "../src/session-disposition.ts";
import {
  listLatestSessionDispositions,
  persistLatestSessionDisposition,
  sessionDispositionStorageKey
} from "../src/session-disposition-store.ts";

test("static index renders all dispositions safely without judgment or external resources", () => {
  const dispositions = allDispositionVariants('<script>alert("session")</script>');
  const persisted = dispositions.map((disposition, index) => ({
    disposition,
    storageKey: `entry-${index}`,
    path: `/ignored/${index}`
  }));
  const html = renderStaticReportIndex(
    persisted,
    new Set(["run-full"]),
    "2026-07-20T22:00:00.000Z"
  );

  for (const kind of ["full_report", "activity_only", "blocked", "analysis_failed"]) {
    assert.match(html, new RegExp(kind));
  }
  assert.match(html, /&lt;script&gt;alert\(&quot;session&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script\b|<link\b|https?:\/\/|file:\/\/|<img\b/i);
  assert.doesNotMatch(html, /valuable|wasteful|productive|unproductive/i);
  assert.match(html, /not a permanent fact about the session/i);
  assert.match(html, /did not produce a validated report/i);
});

test("full-report links are fixed portable relative URLs and missing HTML is explicit", () => {
  const fullReport = allDispositionVariants("session")[0]!;
  const persisted = [{ disposition: fullReport, storageKey: "session", path: "/ignored" }];
  const available = renderStaticReportIndex(
    persisted,
    new Set(["run-full"]),
    "2026-07-20T22:00:00.000Z"
  );
  const unavailable = renderStaticReportIndex(
    persisted,
    new Set(),
    "2026-07-20T22:00:00.000Z"
  );

  assert.match(available, /href="\.\.\/analysis-runs\/run-full\/report\.html"/);
  assert.doesNotMatch(available, /href="\//);
  assert.doesNotMatch(available, /\\/);
  assert.match(unavailable, /HTML report unavailable/);
  assert.doesNotMatch(unavailable, /Open leadership report/);
});

test("latest-disposition discovery strictly parses one latest entry per storage key", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-index-list-"));
  const first = blockedDisposition("session-latest", "missing_api_key");
  const second = blockedDisposition(
    "session-latest",
    "automatic_analysis_not_enabled",
    "2026-07-20T23:00:00.000Z"
  );
  persistLatestSessionDisposition(root, first);
  persistLatestSessionDisposition(root, second);

  const latest = listLatestSessionDispositions(root);
  assert.equal(latest.length, 1);
  assert.equal(latest[0]?.disposition.reason, "automatic_analysis_not_enabled");
});

test("index rebuilding checks the trusted fixed HTML path and writes atomically", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-index-build-"));
  createValidatedRun(root, "run-index", true);
  persistLatestSessionDisposition(
    root,
    createFullReportDisposition(receipt("session-index"), {
      runId: "run-index",
      analysisArtifact: "analysis.json",
      validationSummaryArtifact: "validation-summary.json",
      renderedArtifacts: { html: "report.html" }
    })
  );

  const result = rebuildStaticReportIndex(
    root,
    new Date("2026-07-20T23:00:00.000Z")
  );
  assert.equal(readFileSync(result.path, "utf8"), result.html);
  assert.equal(statSync(result.path).mode & 0o777, 0o600);
  assert.match(result.html, /\.\.\/analysis-runs\/run-index\/report\.html/);

  unlinkSync(
    join(root, ".codex-observer", "analysis-runs", "run-index", "report.html")
  );
  const rebuilt = rebuildStaticReportIndex(root);
  assert.match(rebuilt.html, /HTML report unavailable/);
});

test("malformed disposition discovery fails clearly and preserves the prior index", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-index-malformed-"));
  persistLatestSessionDisposition(root, blockedDisposition("valid-session", "missing_api_key"));
  const first = rebuildStaticReportIndex(root);
  const prior = readFileSync(first.path, "utf8");
  const malformedDirectory = join(
    root,
    ".codex-observer",
    "session-dispositions",
    "malformed"
  );
  mkdirSync(malformedDirectory, { recursive: true });
  writeFileSync(join(malformedDirectory, "latest.json"), '{"kind":"blocked"}', "utf8");

  assert.throws(() => rebuildStaticReportIndex(root), /malformed/);
  assert.equal(readFileSync(first.path, "utf8"), prior);
});

test("a failed atomic index replacement preserves the prior valid index", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-index-atomic-"));
  persistLatestSessionDisposition(root, blockedDisposition("atomic-session", "missing_api_key"));
  const first = rebuildStaticReportIndex(root);
  const prior = readFileSync(first.path, "utf8");
  const reportsDirectory = dirname(first.path);

  chmodSync(reportsDirectory, 0o500);
  try {
    assert.throws(() => rebuildStaticReportIndex(root));
    assert.equal(readFileSync(first.path, "utf8"), prior);
  } finally {
    chmodSync(reportsDirectory, 0o700);
  }
});

function allDispositionVariants(sessionId: string): FinalSessionDisposition[] {
  const structuralReceipt = receipt(sessionId);
  return [
    FinalSessionDispositionSchema.parse({
      schemaVersion: 1,
      kind: "full_report",
      reason: "validated_analysis_available",
      receipt: structuralReceipt,
      validatedRun: {
        runId: "run-full",
        analysisArtifact: "analysis.json",
        validationSummaryArtifact: "validation-summary.json",
        renderedArtifacts: { html: "report.html" }
      }
    }),
    FinalSessionDispositionSchema.parse({
      schemaVersion: 1,
      kind: "activity_only",
      reason: "insufficient_structural_evidence",
      receipt: structuralReceipt
    }),
    FinalSessionDispositionSchema.parse({
      schemaVersion: 1,
      kind: "blocked",
      reason: "missing_api_key",
      receipt: structuralReceipt
    }),
    FinalSessionDispositionSchema.parse({
      schemaVersion: 1,
      kind: "analysis_failed",
      reason: "request_failed",
      receipt: structuralReceipt,
      analysisRun: { runId: "run-failed" }
    })
  ];
}

function blockedDisposition(
  sessionId: string,
  reason: "missing_api_key" | "automatic_analysis_not_enabled",
  evaluatedAt = "2026-07-20T22:00:00.000Z"
): FinalSessionDisposition {
  return FinalSessionDispositionSchema.parse({
    schemaVersion: 1,
    kind: "blocked",
    reason,
    receipt: { ...receipt(sessionId), evaluatedAt }
  });
}

function receipt(sessionId: string): StructuralSessionReceipt {
  return {
    sessionId,
    evidenceStateHash: "a".repeat(64),
    evaluatedAt: "2026-07-20T22:00:00.000Z",
    lastObservedActivityAt: "2026-07-20T21:59:00.000Z",
    corpus: {
      serializedCorpusBytes: 100,
      requestBudgetBytes: 524288,
      totalEvidenceCount: 4,
      retainedEvidenceCount: 4,
      omittedEvidenceCount: 0,
      eligibleForSingleRequest: true
    },
    counts: {
      humanMessages: 1,
      assistantMessages: 1,
      toolAttempts: 1,
      toolResults: 1,
      gitSnapshots: 0,
      matchedToolResults: 1,
      observableStructuredErrorResults: 1,
      distinctTurns: 1
    },
    gitStateChangedBetweenSnapshots: false,
    matchedResultsBetweenChangedSnapshots: 0,
    hasMatchedResultsBetweenChangedSnapshots: false
  };
}

function createValidatedRun(root: string, runId: string, withHtml: boolean): void {
  const directory = join(root, ".codex-observer", "analysis-runs", runId);
  mkdirSync(directory, { recursive: true });
  writeJson(join(directory, "analysis.json"), emptyAnalysis());
  writeJson(join(directory, "validation-summary.json"), {
    schemaVersion: 1,
    runId,
    validatedAt: "2026-07-20T22:00:00.000Z",
    rejectedCount: 0,
    downgradedCount: 0,
    amendedCount: 0,
    actions: []
  });
  if (withHtml) writeFileSync(join(directory, "report.html"), "<!doctype html>", "utf8");
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

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
