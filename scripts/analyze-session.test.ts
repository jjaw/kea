import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CandidateAnalysis } from "../src/analysis-definitions.ts";
import type {
  AnalysisProvider,
  AnalysisProviderResult,
  ProviderRunMetadata
} from "../src/analysis-provider.ts";
import {
  generateDryRun,
  runAnalyzeCommand,
  runLiveAnalysis
} from "./analyze-session.ts";

test("offline dry-run saves exactly the bundle it returns without analysis artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-dry-run-"));
  const sessionDirectory = join(
    root,
    ".codex-observer",
    "sessions",
    "session-dry-run"
  );
  mkdirSync(sessionDirectory, { recursive: true });
  writeFileSync(
    join(sessionDirectory, "events.jsonl"),
    JSON.stringify({
      capture: {
        schemaVersion: 1,
        capturedAt: "2026-07-19T20:00:00.000Z",
        sessionId: "session-dry-run",
        eventName: "UserPromptSubmit"
      },
      payload: {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-dry-run",
        prompt: "Show exactly what leaves the machine"
      }
    }),
    "utf8"
  );

  const result = generateDryRun(root, "session-dry-run");

  assert.equal(readFileSync(result.artifacts.bundlePath, "utf8"), result.serializedBundle);
  assert.deepEqual(JSON.parse(result.serializedBundle), result.bundle);
  assert.equal(result.artifacts.analysisPath, null);
  assert.equal(result.artifacts.validationSummaryPath, null);
});

test("live pipeline re-validates, deterministically validates, persists one run, and renders Markdown", async () => {
  const root = sessionFixture("session-live");
  const candidate = candidateAnalysis();
  const result = await runLiveAnalysis({
    projectRoot: root,
    selector: "session-live",
    provider: providerResult({
      kind: "success",
      candidate,
      rawResponse: { id: "resp_live", status: "completed" },
      metadata: providerMetadata()
    }),
    now: new Date("2026-07-20T02:00:00.000Z")
  });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.summary.rejectedCount, 1);
  assert.ok(result.summary.downgradedCount >= 1);
  for (const path of [
    result.artifacts.bundlePath,
    result.artifacts.candidateAnalysisPath,
    result.artifacts.providerResponsePath,
    result.artifacts.analysisPath,
    result.artifacts.validationSummaryPath,
    result.artifacts.metadataPath,
    result.artifacts.reportPath
  ]) {
    assert.ok(path && existsSync(path));
  }

  assert.deepEqual(
    JSON.parse(readFileSync(result.artifacts.candidateAnalysisPath ?? "", "utf8")),
    candidate
  );
  const validated = JSON.parse(
    readFileSync(result.artifacts.analysisPath ?? "", "utf8")
  );
  assert.equal(validated.objective.basis, "inference");
  assert.equal(validated.approaches.length, 1);

  const report = readFileSync(result.artifacts.reportPath ?? "", "utf8");
  for (const heading of [
    "Objective",
    "Approaches",
    "Human Interventions",
    "Turning Points",
    "Codex Contributions",
    "Reported Outcome",
    "Independently Supported Outcome",
    "Outcome Support",
    "Evidence Gaps",
    "Leadership Insights",
    "Validation Audit"
  ]) {
    assert.match(report, new RegExp(`## ${heading}`));
  }
  assert.match(report, /\*\*Unknown:\*\* Final verification remains unknown/);
  assert.match(report, /Finding cites nonexistent evidence: E999/);
  assert.match(report, /Observed basis was not supported/);
  assert.match(report, /`E1`/);
  assert.match(report, /`E999`/);
});

test("refusal, incomplete response, schema-invalid output, and API failure persist diagnostics without validation", async (t) => {
  const cases: Array<{
    name: string;
    result: AnalysisProviderResult;
    expectedKind: string;
    expectsCandidate?: boolean;
  }> = [
    {
      name: "refusal",
      result: {
        kind: "refusal",
        refusal: "Request refused",
        rawResponse: { id: "resp_refusal" },
        metadata: providerMetadata()
      },
      expectedKind: "refusal"
    },
    {
      name: "incomplete response",
      result: {
        kind: "incomplete",
        reason: "max_output_tokens",
        rawResponse: { id: "resp_incomplete" },
        metadata: providerMetadata()
      },
      expectedKind: "incomplete"
    },
    {
      name: "API request failure",
      result: {
        kind: "request_failed",
        error: { name: "Error", message: "network down" },
        metadata: providerMetadata()
      },
      expectedKind: "request_failed"
    },
    {
      name: "missing parsed output",
      result: {
        kind: "missing_parsed_output",
        message: "No parsed output",
        rawResponse: { id: "resp_missing" },
        metadata: providerMetadata()
      },
      expectedKind: "missing_parsed_output"
    }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const root = sessionFixture(`session-${testCase.expectedKind}`);
      const result = await runLiveAnalysis({
        projectRoot: root,
        selector: `session-${testCase.expectedKind}`,
        provider: providerResult(testCase.result)
      });
      assert.equal(result.kind, "failure");
      if (result.kind !== "failure") return;
      assert.equal(result.failureKind, testCase.expectedKind);
      assert.ok(result.artifacts.providerErrorPath);
      assert.ok(result.artifacts.metadataPath);
      assert.equal(result.artifacts.analysisPath, null);
      assert.equal(result.artifacts.validationSummaryPath, null);
      assert.equal(result.artifacts.reportPath, null);
    });
  }

  await t.test("schema-invalid provider candidate", async () => {
    const root = sessionFixture("session-schema-invalid");
    const result = await runLiveAnalysis({
      projectRoot: root,
      selector: "session-schema-invalid",
      provider: providerResult({
        kind: "success",
        candidate: { invalid: true },
        rawResponse: { id: "resp_invalid" },
        metadata: providerMetadata()
      })
    });
    assert.equal(result.kind, "failure");
    if (result.kind !== "failure") return;
    assert.equal(result.failureKind, "schema_invalid");
    assert.deepEqual(
      JSON.parse(readFileSync(result.artifacts.candidateAnalysisPath ?? "", "utf8")),
      { invalid: true }
    );
    assert.equal(result.artifacts.validationSummaryPath, null);
  });
});

test("missing API key prints deterministic fallback, exits zero, and creates no live run", async () => {
  const root = sessionFixture("session-no-key");
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  let factoryCalled = false;
  const exitCode = await runAnalyzeCommand({
    projectRoot: root,
    args: ["session-no-key"],
    env: {},
    stdout,
    stderr,
    providerFactory: () => {
      factoryCalled = true;
      return providerResult({
        kind: "request_failed",
        error: { name: "Error", message: "must not run" },
        metadata: providerMetadata()
      });
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(factoryCalled, false);
  assert.match(stdout.value, /OPENAI_API_KEY is not configured/);
  assert.match(stdout.value, /# Codex Session Report/);
  assert.equal(stderr.value, "");
  assert.equal(existsSync(join(root, ".codex-observer", "analysis-runs")), false);
});

test("live analyze command uses latest by default and prints report path plus validation summary", async () => {
  const root = sessionFixture("session-latest");
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  let receivedApiKey = "";
  const exitCode = await runAnalyzeCommand({
    projectRoot: root,
    args: [],
    env: { OPENAI_API_KEY: "test-api-key" },
    stdout,
    stderr,
    providerFactory: (apiKey) => {
      receivedApiKey = apiKey;
      return providerResult({
        kind: "success",
        candidate: candidateAnalysis(),
        rawResponse: { id: "resp_latest" },
        metadata: providerMetadata()
      });
    },
    now: new Date("2026-07-20T02:30:00.000Z")
  });

  assert.equal(exitCode, 0);
  assert.equal(receivedApiKey, "test-api-key");
  assert.match(stdout.value, /Report saved to .*report\.md/);
  assert.match(stdout.value, /Validation: 1 rejected, \d+ downgraded\./);
  assert.equal(stderr.value, "");
});

test("repeated live analyses create separate complete run scopes", async () => {
  const root = sessionFixture("session-repeat");
  const provider = providerResult({
    kind: "success",
    candidate: candidateAnalysis(),
    rawResponse: { id: "resp_repeat" },
    metadata: providerMetadata()
  });
  const first = await runLiveAnalysis({
    projectRoot: root,
    selector: "session-repeat",
    provider,
    now: new Date("2026-07-20T03:00:00.000Z")
  });
  const second = await runLiveAnalysis({
    projectRoot: root,
    selector: "session-repeat",
    provider,
    now: new Date("2026-07-20T03:00:00.000Z")
  });
  assert.equal(first.kind, "success");
  assert.equal(second.kind, "success");
  assert.notEqual(first.artifacts.directory, second.artifacts.directory);
  assert.ok(first.artifacts.reportPath && existsSync(first.artifacts.reportPath));
  assert.ok(second.artifacts.reportPath && existsSync(second.artifacts.reportPath));
});

function sessionFixture(sessionId: string): string {
  const root = mkdtempSync(join(tmpdir(), "kea-live-"));
  const sessionDirectory = join(root, ".codex-observer", "sessions", sessionId);
  mkdirSync(sessionDirectory, { recursive: true });
  const records = [
    record(sessionId, "UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      turn_id: "turn-1",
      prompt: "Fix the tests"
    }),
    record(sessionId, "PreToolUse", {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "npm test" }
    }),
    record(sessionId, "PostToolUse", {
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 1, error: "failed" }
    }),
    record(sessionId, "Stop", {
      hook_event_name: "Stop",
      session_id: sessionId,
      turn_id: "turn-1",
      last_assistant_message: "The tests pass."
    })
  ];
  writeFileSync(join(sessionDirectory, "events.jsonl"), `${records.join("\n")}\n`, "utf8");
  symlinkSync(join("sessions", sessionId), join(root, ".codex-observer", "latest"));
  return root;
}

function record(
  sessionId: string,
  eventName: string,
  payload: Record<string, unknown>
): string {
  return JSON.stringify({
    capture: {
      schemaVersion: 1,
      capturedAt: "2026-07-20T01:00:00.000Z",
      sessionId,
      eventName
    },
    payload
  });
}

function candidateAnalysis(): CandidateAnalysis {
  return {
    objective: {
      value: "Fix the tests",
      basis: "observed",
      evidenceIds: ["E1"]
    },
    approaches: [
      {
        value: "Nonexistent approach",
        basis: "observed",
        evidenceIds: ["E999"],
        status: "failed"
      },
      {
        value: "Run the tests",
        basis: "observed",
        evidenceIds: ["E2", "E3"],
        status: "completed"
      }
    ],
    humanInterventions: [
      {
        value: "Asked to fix tests",
        basis: "explicit",
        evidenceIds: ["E1"],
        category: "follow-up task",
        justification: "The human directly assigned the task."
      }
    ],
    turningPoints: [
      {
        value: "The request led to a test run",
        basis: "inference",
        evidenceIds: ["E1", "E2"],
        beforeEvidenceIds: ["E1"],
        afterEvidenceIds: ["E2"],
        confidence: "medium",
        confidenceReason: "The events are adjacent and ordered."
      }
    ],
    codexContributions: [
      {
        value: "Ran the test command",
        basis: "observed",
        evidenceIds: ["E2"]
      }
    ],
    reportedOutcome: {
      value: "The tests pass.",
      basis: "explicit",
      evidenceIds: ["E4"]
    },
    independentlySupportedOutcome: {
      value: "The captured test run failed.",
      basis: "observed",
      evidenceIds: ["E3"]
    },
    outcomeSupport: "contradicted",
    evidenceGaps: [
      {
        value: "Final verification remains unknown",
        basis: "unknown",
        evidenceIds: []
      }
    ],
    leadershipInsights: [
      {
        value: "The reported success was not supported by the captured run.",
        basis: "inference",
        evidenceIds: ["E3", "E4"],
        confidence: "high",
        confidenceReason: "The activity result and later claim conflict directly."
      }
    ]
  };
}

function providerResult(result: AnalysisProviderResult): AnalysisProvider {
  return { analyze: async () => result };
}

function providerMetadata(): ProviderRunMetadata {
  return {
    provider: "mock",
    model: "mock-model",
    reasoningEffort: "medium",
    store: false,
    requestedAt: "2026-07-20T01:00:00.000Z",
    completedAt: "2026-07-20T01:00:01.000Z"
  };
}

function bufferOutput(): { value: string; write(value: string): void } {
  return {
    value: "",
    write(value: string) {
      this.value += value;
    }
  };
}
