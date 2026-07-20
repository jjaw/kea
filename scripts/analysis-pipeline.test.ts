import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AnalysisSchema,
  APPROACH_STATUS_SEMANTICS,
  OUTCOME_SUPPORT_SEMANTICS,
  type CandidateAnalysis
} from "../src/analysis-definitions.ts";
import {
  persistAnalysisRun,
  validateAndPersistAnalysisRun
} from "../src/analysis-run-store.ts";
import { validateAnalysis } from "../src/analysis-validator.ts";
import { normalizeCodexSession } from "../src/codex-session-adapter.ts";
import {
  BUNDLE_MAX_BYTES,
  buildEvidenceBundle,
  EvidenceBundleSchema
} from "../src/evidence-bundle.ts";
import { redactText } from "../src/redaction.ts";
import { truncateHead, truncateHeadTail, utf8ByteLength } from "../src/truncation.ts";

test("redacts every specified high-precision secret pattern", () => {
  const input = [
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    "AKIAABCDEFGHIJKLMNOP",
    "sk-abc123 ghp_abc123 gho_abc123 github_pat_abc123 xoxb-abc123",
    "Authorization: Bearer abc.def-123",
    "DATABASE_PASSWORD=hunter2 API_KEY='secret-value'",
    "postgres://user:password@localhost/db"
  ].join("\n");

  const result = redactText(input);

  for (const marker of [
    "[REDACTED:private-key]",
    "[REDACTED:aws-key]",
    "[REDACTED:token]",
    "[REDACTED:bearer-token]",
    "[REDACTED:env-secret]",
    "[REDACTED:connection-password]"
  ]) {
    assert.match(result, new RegExp(marker.replace(/[\[\]]/g, "\\$&")));
  }
  assert.doesNotMatch(result, /hunter2|password@|abc\.def-123|secret\n/);
});

test("truncates by UTF-8 bytes with explicit head and head-tail markers", () => {
  const head = truncateHead("🙂".repeat(100), 80);
  const headTail = truncateHeadTail(`BEGIN-${"x".repeat(200)}-END`, 50, 30);

  assert.ok(utf8ByteLength(head) <= 80);
  assert.match(head, /…\[truncated [\d,]+ bytes\]/);
  assert.ok(utf8ByteLength(headTail) <= 80);
  assert.match(headTail, /^BEGIN-/);
  assert.match(headTail, /-END$/);
  assert.match(headTail, /…\[truncated [\d,]+ bytes\]/);
});

test("builds ordered, single-source evidence with stable IDs and structural facts", () => {
  const bundle = fixtureBundle();

  assert.deepEqual(
    bundle.evidence.map((item) => [item.id, item.sourceClass]),
    [
      ["E1", "session_event"],
      ["E1.git", "git_snapshot"],
      ["E2", "human_message"],
      ["E3", "tool_attempt"],
      ["E4", "tool_result"],
      ["E5", "human_message"],
      ["E6", "assistant_message"],
      ["E6.git", "git_snapshot"]
    ]
  );
  assert.deepEqual(
    bundle.evidence.map((item) => item.structuralFacts.sequence),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
  const toolResult = bundle.evidence.find((item) => item.id === "E4");
  assert.equal(toolResult?.structuralFacts.matchedEvidenceId, "E3");
  assert.deepEqual(toolResult?.structuralFacts.errorIndicators, [
    { field: "exit_code", value: 2 },
    { field: "error", value: "tests failed" }
  ]);
  assert.doesNotMatch(JSON.stringify(bundle), /objective|turning point|human direction/i);

  const duplicateIds = structuredClone(bundle);
  if (duplicateIds.evidence[1]) {
    duplicateIds.evidence[1].id = duplicateIds.evidence[0]?.id ?? "E1";
  }
  assert.equal(EvidenceBundleSchema.safeParse(duplicateIds).success, false);
});

test("redacts before truncating content and enforces the whole-bundle ceiling", () => {
  const secret = "API_KEY=super-secret-value";
  const records = Array.from({ length: 90 }, (_, index) =>
    record("UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: "large-session",
      turn_id: `turn-${index}`,
      prompt: `${secret} ${"x".repeat(2500)}`
    })
  ).join("\n");
  const bundle = buildEvidenceBundle(
    normalizeCodexSession(records, "/recordings/large.jsonl")
  );
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;

  assert.ok(utf8ByteLength(serialized) <= BUNDLE_MAX_BYTES);
  assert.doesNotMatch(serialized, /super-secret-value/);
  assert.match(serialized, /\[REDACTED:env-secret\]/);
  assert.match(serialized, /…\[truncated [\d,]+ bytes\]/);
  assert.match(serialized, /Bundle size ceiling reached/);
});

test("strict analysis schema enforces confidence and shared enum semantics", () => {
  const valid = goodAnalysis();
  assert.equal(AnalysisSchema.safeParse(valid).success, true);
  assert.equal(
    AnalysisSchema.safeParse({
      ...valid,
      objective: { value: "Maybe", basis: "inference", evidenceIds: ["E2"] }
    }).success,
    false
  );
  assert.equal(
    AnalysisSchema.safeParse({
      ...valid,
      objective: {
        value: "Explicit",
        basis: "explicit",
        evidenceIds: ["E2"],
        confidence: "high",
        confidenceReason: "Not allowed"
      }
    }).success,
    false
  );
  assert.match(APPROACH_STATUS_SEMANTICS, /success is NOT implied/);
  assert.match(OUTCOME_SUPPORT_SEMANTICS, /mutually|reported_only|contradicted/);
});

test("validator rejects bad citations and category evidence, downgrades bases, and audits every action", () => {
  const bundle = fixtureBundle();
  const bad: CandidateAnalysis = {
    ...goodAnalysis(),
    objective: { value: "Claimed observation", basis: "observed", evidenceIds: ["E2"] },
    approaches: [
      {
        value: "Missing evidence",
        basis: "observed",
        evidenceIds: ["E999"],
        status: "failed"
      }
    ],
    humanInterventions: [
      {
        value: "Not human evidence",
        basis: "observed",
        evidenceIds: ["E3"],
        category: "correction",
        justification: "Incorrectly cites a tool."
      }
    ],
    turningPoints: [
      {
        value: "Message-only after side",
        basis: "inference",
        evidenceIds: ["E4", "E6"],
        beforeEvidenceIds: ["E4"],
        afterEvidenceIds: ["E6"],
        confidence: "medium",
        confidenceReason: "Ordered, but after is only a message."
      }
    ],
    codexContributions: [
      {
        value: "Mixed human and tool claim",
        basis: "inference",
        evidenceIds: ["E2", "E3"],
        confidence: "medium",
        confidenceReason: "The candidate mixed allowed and forbidden sources."
      }
    ],
    reportedOutcome: {
      value: "Done",
      basis: "explicit",
      evidenceIds: ["E6"],
      confidence: "high",
      confidenceReason: "Invalid on explicit."
    },
    independentlySupportedOutcome: {
      value: "Done",
      basis: "explicit",
      evidenceIds: ["E6"]
    },
    outcomeSupport: "contradicted",
    leadershipInsights: [
      { value: "Insight 1", basis: "explicit", evidenceIds: ["E2"] },
      {
        value: "Insight 2",
        basis: "inference",
        evidenceIds: ["E3"],
        confidence: "medium",
        confidenceReason: "Some activity evidence."
      },
      {
        value: "Insight 3",
        basis: "inference",
        evidenceIds: ["E4"],
        confidence: "low",
        confidenceReason: "Exceeds the cap."
      }
    ]
  };

  const result = validateAnalysis(
    bad,
    bundle,
    "run-bad",
    new Date("2026-07-19T21:00:00.000Z")
  );

  assert.equal(result.analysis.objective.basis, "inference");
  assert.equal(result.analysis.approaches.length, 0);
  assert.equal(result.analysis.humanInterventions.length, 0);
  assert.equal(result.analysis.turningPoints.length, 0);
  assert.equal(result.analysis.codexContributions.length, 0);
  assert.equal(result.analysis.reportedOutcome?.confidence, undefined);
  assert.equal(result.analysis.independentlySupportedOutcome, null);
  assert.equal(result.analysis.outcomeSupport, "unknown");
  assert.equal(result.analysis.leadershipInsights.length, 2);
  assert.equal(result.analysis.leadershipInsights[0]?.basis, "inference");
  assert.ok(result.summary.rejectedCount >= 6);
  assert.ok(result.summary.downgradedCount >= 4);
  assert.ok(
    result.summary.actions.some(
      (action) =>
        action.target === "approaches[0]" && /nonexistent/.test(action.reason)
    )
  );
  assert.ok(
    result.summary.actions.some(
      (action) => action.target === "turningPoints[0]" && action.action === "rejected"
    )
  );
  assert.ok(
    result.summary.actions.some(
      (action) => action.target === "outcomeSupport" && action.action === "downgraded"
    )
  );
  assert.equal(AnalysisSchema.safeParse(result.analysis).success, true);
});

test("validator accepts valid contradiction and enforces all outcome relationships", () => {
  const bundle = fixtureBundle();
  const contradicted = goodAnalysis();
  contradicted.reportedOutcome = {
    value: "Tests pass",
    basis: "explicit",
    evidenceIds: ["E6"]
  };
  contradicted.independentlySupportedOutcome = {
    value: "Tests failed",
    basis: "observed",
    evidenceIds: ["E4"]
  };
  contradicted.outcomeSupport = "contradicted";

  const valid = validateAnalysis(contradicted, bundle, "run-contradiction");
  assert.equal(valid.analysis.outcomeSupport, "contradicted");

  const lifecycleOnly = goodAnalysis();
  lifecycleOnly.independentlySupportedOutcome = {
    value: "The session started",
    basis: "observed",
    evidenceIds: ["E1"]
  };
  lifecycleOnly.outcomeSupport = "independently_supported";
  const lifecycleResult = validateAnalysis(
    lifecycleOnly,
    bundle,
    "run-lifecycle-only"
  );
  assert.equal(lifecycleResult.analysis.independentlySupportedOutcome, null);
  assert.equal(lifecycleResult.analysis.outcomeSupport, "unknown");

  const invalidReportedOnly = {
    ...contradicted,
    outcomeSupport: "reported_only" as const
  };
  assert.equal(
    validateAnalysis(invalidReportedOnly, bundle, "run-reported-only").analysis
      .outcomeSupport,
    "unknown"
  );

  const invalidIndependent = {
    ...goodAnalysis(),
    outcomeSupport: "independently_supported" as const,
    independentlySupportedOutcome: null
  };
  assert.equal(
    validateAnalysis(invalidIndependent, bundle, "run-independent").analysis
      .outcomeSupport,
    "unknown"
  );

  const unknownIndependent = {
    ...goodAnalysis(),
    outcomeSupport: "independently_supported" as const,
    independentlySupportedOutcome: {
      value: null,
      basis: "unknown" as const,
      evidenceIds: []
    }
  };
  const unknownResult = validateAnalysis(
    unknownIndependent,
    bundle,
    "run-unknown-independent"
  );
  assert.equal(unknownResult.analysis.independentlySupportedOutcome, null);
  assert.equal(unknownResult.analysis.outcomeSupport, "unknown");
});

test("attempt-only corroboration with a reported claim becomes reported_only and preserves the weak finding", () => {
  const bundle = fixtureBundle();
  const candidate = goodAnalysis();
  candidate.reportedOutcome = {
    value: "Tests now pass",
    basis: "explicit",
    evidenceIds: ["E6"]
  };
  candidate.independentlySupportedOutcome = {
    value: "The test command was run successfully",
    basis: "observed",
    evidenceIds: ["E3"]
  };
  candidate.outcomeSupport = "independently_supported";

  const result = validateAnalysis(candidate, bundle, "run-attempt-with-report");

  assert.equal(result.analysis.outcomeSupport, "reported_only");
  assert.equal(result.analysis.reportedOutcome?.value, "Tests now pass");
  assert.equal(
    result.analysis.independentlySupportedOutcome?.value,
    "The test command was run successfully"
  );
  assert.equal(result.analysis.independentlySupportedOutcome?.basis, "unknown");
  assert.deepEqual(result.analysis.independentlySupportedOutcome?.evidenceIds, [
    "E3"
  ]);
  const action = result.summary.actions.find(
    (entry) =>
      entry.code === "outcome_support_attempt_only_to_reported_only"
  );
  assert.ok(action);
  assert.equal(action.action, "downgraded");
  assert.equal(action.target, "outcomeSupport");
  assert.deepEqual(action.evidenceIds, ["E3"]);
  assert.match(
    action.reason,
    /changed from independently_supported to reported_only/
  );
  assert.match(action.reason, /action was initiated but not what result occurred/);
  assert.equal(
    result.summary.actions.some(
      (entry) =>
        entry.action === "rejected" &&
        (entry.target === "independentlySupportedOutcome" ||
          entry.target === "outcomeSupport")
    ),
    false
  );
});

test("attempt-only corroboration without a reported claim becomes unknown and preserves the weak finding", () => {
  const bundle = fixtureBundle();
  const candidate = goodAnalysis();
  candidate.independentlySupportedOutcome = {
    value: "The test command completed",
    basis: "observed",
    evidenceIds: ["E3"]
  };
  candidate.outcomeSupport = "contradicted";

  const result = validateAnalysis(candidate, bundle, "run-attempt-without-report");

  assert.equal(result.analysis.outcomeSupport, "unknown");
  assert.equal(result.analysis.reportedOutcome, null);
  assert.equal(
    result.analysis.independentlySupportedOutcome?.value,
    "The test command completed"
  );
  assert.equal(result.analysis.independentlySupportedOutcome?.basis, "unknown");
  assert.deepEqual(result.analysis.independentlySupportedOutcome?.evidenceIds, [
    "E3"
  ]);
  const action = result.summary.actions.find(
    (entry) => entry.code === "outcome_support_attempt_only_to_unknown"
  );
  assert.ok(action);
  assert.equal(action.action, "downgraded");
  assert.deepEqual(action.evidenceIds, ["E3"]);
  assert.match(
    action.reason,
    /changed from contradicted to unknown/
  );
  assert.match(action.reason, /action was initiated but not what result occurred/);
  assert.equal(
    result.summary.actions.some(
      (entry) =>
        entry.action === "rejected" &&
        (entry.target === "independentlySupportedOutcome" ||
          entry.target === "outcomeSupport")
    ),
    false
  );
});

test("result-bearing evidence can corroborate outcomes while messages and lifecycle events cannot", async (t) => {
  const bundle = fixtureBundle();
  const supportedCases = [
    {
      name: "tool attempt plus tool result",
      value: "The captured test run failed",
      evidenceIds: ["E3", "E4"]
    },
    {
      name: "tool result alone",
      value: "The captured test run failed",
      evidenceIds: ["E4"]
    },
    {
      name: "repository-state Git snapshot",
      value: "The repository ended with after.ts modified",
      evidenceIds: ["E6.git"]
    }
  ];

  for (const supportedCase of supportedCases) {
    await t.test(supportedCase.name, () => {
      const candidate = goodAnalysis();
      candidate.independentlySupportedOutcome = {
        value: supportedCase.value,
        basis: "observed",
        evidenceIds: supportedCase.evidenceIds
      };
      candidate.outcomeSupport = "independently_supported";
      const result = validateAnalysis(
        candidate,
        bundle,
        `run-${supportedCase.name.replaceAll(" ", "-")}`
      );
      assert.equal(result.analysis.outcomeSupport, "independently_supported");
      assert.deepEqual(
        result.analysis.independentlySupportedOutcome?.evidenceIds,
        supportedCase.evidenceIds
      );
    });
  }

  const unsupportedCases = [
    { name: "assistant message", evidenceIds: ["E6"] },
    { name: "session event", evidenceIds: ["E1"] }
  ];
  for (const unsupportedCase of unsupportedCases) {
    await t.test(`${unsupportedCase.name} alone`, () => {
      const candidate = goodAnalysis();
      candidate.independentlySupportedOutcome = {
        value: "Outcome established",
        basis: "observed",
        evidenceIds: unsupportedCase.evidenceIds
      };
      candidate.outcomeSupport = "independently_supported";
      const result = validateAnalysis(
        candidate,
        bundle,
        `run-${unsupportedCase.name.replaceAll(" ", "-")}`
      );
      assert.equal(result.analysis.independentlySupportedOutcome, null);
      assert.equal(result.analysis.outcomeSupport, "unknown");
    });
  }
});

test("persists bundle, validated analysis, and summary in unique private run scopes", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-runs-"));
  const bundle = fixtureBundle();
  const firstResult = validateAndPersistAnalysisRun(
    root,
    bundle,
    goodAnalysis(),
    new Date("2026-07-19T21:00:00.000Z")
  );
  const first = firstResult.artifacts;
  const secondResult = validateAndPersistAnalysisRun(
    root,
    bundle,
    goodAnalysis(),
    new Date("2026-07-19T21:00:00.000Z")
  );
  const second = secondResult.artifacts;

  assert.notEqual(first.directory, second.directory);
  assert.equal(
    JSON.parse(readFileSync(first.validationSummaryPath ?? "", "utf8")).runId,
    first.runId
  );
  assert.deepEqual(
    JSON.parse(readFileSync(first.analysisPath ?? "", "utf8")),
    firstResult.analysis
  );
  assert.equal(statSync(first.bundlePath).mode & 0o777, 0o600);
  const fixedResult = validateAnalysis(goodAnalysis(), bundle, "run-one");
  persistAnalysisRun(root, bundle, {
    runId: "run-one",
    analysis: fixedResult.analysis,
    validationSummary: fixedResult.summary
  });
  assert.throws(() =>
    persistAnalysisRun(root, bundle, {
      runId: "run-one",
      analysis: fixedResult.analysis,
      validationSummary: fixedResult.summary
    })
  );
});

function fixtureBundle() {
  return buildEvidenceBundle(
    normalizeCodexSession(fixtureJsonl(), "/recordings/events.jsonl")
  );
}

function goodAnalysis(): CandidateAnalysis {
  return {
    objective: { value: "Fix tests", basis: "explicit", evidenceIds: ["E2"] },
    approaches: [],
    humanInterventions: [],
    turningPoints: [],
    codexContributions: [],
    reportedOutcome: null,
    independentlySupportedOutcome: null,
    outcomeSupport: "unknown",
    evidenceGaps: [
      { value: "Final success is not established", basis: "unknown", evidenceIds: [] }
    ],
    leadershipInsights: []
  };
}

function fixtureJsonl(): string {
  return [
    record(
      "SessionStart",
      {
        hook_event_name: "SessionStart",
        session_id: "session-123",
        cwd: "/workspace",
        model: "codex-test",
        source: "startup"
      },
      git("head-before", " M before.ts", "before diff")
    ),
    record("UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-123",
      turn_id: "turn-1",
      prompt: "Fix tests"
    }),
    record("PreToolUse", {
      hook_event_name: "PreToolUse",
      session_id: "session-123",
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "npm test", token: "sk-secret-value" }
    }),
    record("PostToolUse", {
      hook_event_name: "PostToolUse",
      session_id: "session-123",
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 2, error: "tests failed" }
    }),
    record("UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-123",
      turn_id: "turn-2",
      prompt: "Use the adapter"
    }),
    record(
      "Stop",
      {
        hook_event_name: "Stop",
        session_id: "session-123",
        turn_id: "turn-2",
        last_assistant_message: "Tests now pass"
      },
      git("head-after", " M after.ts", "after diff")
    )
  ].join("\n");
}

function record(
  eventName: string,
  payload: Record<string, unknown>,
  gitSnapshot?: ReturnType<typeof git>
): string {
  return JSON.stringify({
    capture: {
      schemaVersion: 1,
      capturedAt: `2026-07-19T20:00:0${eventName.length % 10}.000Z`,
      sessionId: String(payload.session_id ?? "large-session"),
      eventName,
      ...(gitSnapshot ? { git: gitSnapshot } : {})
    },
    payload
  });
}

function git(head: string, status: string, diff: string) {
  return { head, branch: "main", status, diff, errors: [] as string[] };
}
