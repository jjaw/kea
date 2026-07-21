import assert from "node:assert/strict";
import {
  chmodSync,
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
  assert.equal(result.corpusStatus.totalEvidenceCount, 1);
  assert.equal(result.corpusStatus.retainedEvidenceCount, 1);
  assert.equal(result.corpusStatus.omittedEvidenceCount, 0);
  assert.equal(result.corpusStatus.eligibleForSingleRequest, true);
  assert.equal(result.artifacts.analysisPath, null);
  assert.equal(result.artifacts.validationSummaryPath, null);
  assert.equal(result.artifacts.reportPath, null);
  assert.equal(result.artifacts.htmlReportPath, null);
  assert.ok(result.artifacts.metadataPath);
  assert.equal(
    existsSync(join(root, ".codex-observer", "session-dispositions")),
    false
  );
  assert.equal(
    existsSync(join(root, ".codex-observer", "reports", "index.html")),
    false
  );
});

test("live pipeline persists validated Markdown and HTML, a full_report disposition, and the static inbox", async () => {
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
  assert.equal(result.summary.amendedCount, 0);
  for (const path of [
    result.artifacts.bundlePath,
    result.artifacts.candidateAnalysisPath,
    result.artifacts.providerResponsePath,
    result.artifacts.analysisPath,
    result.artifacts.validationSummaryPath,
    result.artifacts.metadataPath,
    result.artifacts.reportPath,
    result.artifacts.htmlReportPath,
    result.dispositionPath,
    result.indexPath
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

  const html = readFileSync(result.artifacts.htmlReportPath ?? "", "utf8");
  assert.match(html, /Kea for Codex — validated session brief/);
  assert.match(html, /Executive snapshot/);
  assert.match(html, /What outcome is independently supported/);
  assert.match(html, /Validation audit/);
  const disposition = JSON.parse(readFileSync(result.dispositionPath, "utf8"));
  assert.equal(disposition.kind, "full_report");
  assert.equal(disposition.validatedRun.runId, result.artifacts.runId);
  assert.deepEqual(disposition.validatedRun.renderedArtifacts, {
    markdown: "report.md",
    html: "report.html"
  });
  const index = readFileSync(result.indexPath, "utf8");
  assert.match(
    index,
    new RegExp(`\\.\\.\\/analysis-runs\\/${result.artifacts.runId}\\/report\\.html`)
  );
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
      assert.equal(result.artifacts.htmlReportPath, null);
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
  assert.equal(existsSync(join(root, ".codex-observer", "session-dispositions")), false);
  assert.equal(
    existsSync(join(root, ".codex-observer", "reports", "index.html")),
    false
  );
});

test("oversized live run preserves the corpus, skips the provider, and persists bundle_too_large", async () => {
  const root = oversizedSessionFixture("session-oversized");
  let providerCalls = 0;
  const result = await runLiveAnalysis({
    projectRoot: root,
    selector: "session-oversized",
    provider: {
      analyze: async () => {
        providerCalls += 1;
        return {
          kind: "request_failed",
          error: { name: "Error", message: "must not run" },
          metadata: providerMetadata()
        };
      }
    }
  });

  assert.equal(result.kind, "failure");
  if (result.kind !== "failure") return;
  assert.equal(result.failureKind, "bundle_too_large");
  assert.equal(providerCalls, 0);
  assert.match(result.message, /Complete sanitized session evidence/);
  assert.match(result.message, /Chronological segmentation with complete coverage/);
  assert.equal(result.artifacts.analysisPath, null);
  assert.equal(result.artifacts.validationSummaryPath, null);
  assert.equal(result.artifacts.reportPath, null);
  assert.equal(result.artifacts.htmlReportPath, null);

  const bundle = JSON.parse(readFileSync(result.artifacts.bundlePath, "utf8"));
  const metadata = JSON.parse(
    readFileSync(result.artifacts.metadataPath ?? "", "utf8")
  );
  const diagnostic = JSON.parse(
    readFileSync(result.artifacts.providerErrorPath ?? "", "utf8")
  );
  assert.equal(bundle.evidence.length, 300);
  assert.equal(bundle.evidence[0]?.id, "E1");
  assert.equal(bundle.evidence.at(-1)?.id, "E300");
  assert.equal(metadata.resultKind, "bundle_too_large");
  assert.equal(metadata.corpus.totalEvidenceCount, 300);
  assert.equal(metadata.corpus.retainedEvidenceCount, 300);
  assert.equal(metadata.corpus.omittedEvidenceCount, 0);
  assert.equal(metadata.corpus.eligibleForSingleRequest, false);
  assert.equal(metadata.diagnostic.code, "bundle_too_large");
  assert.equal(diagnostic.kind, "bundle_too_large");
  assert.equal(
    diagnostic.requiredCapability,
    "complete_coverage_chronological_segmentation"
  );
});

test("oversized analyze command explains the handled refusal", async () => {
  const root = oversizedSessionFixture("session-oversized-command");
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  let providerCalls = 0;
  const exitCode = await runAnalyzeCommand({
    projectRoot: root,
    args: ["session-oversized-command"],
    env: { OPENAI_API_KEY: "test-api-key" },
    stdout,
    stderr,
    providerFactory: () => ({
      analyze: async () => {
        providerCalls += 1;
        return {
          kind: "request_failed",
          error: { name: "Error", message: "must not run" },
          metadata: providerMetadata()
        };
      }
    })
  });

  assert.equal(exitCode, 1);
  assert.equal(providerCalls, 0);
  assert.equal(stdout.value, "");
  assert.match(stderr.value, /Live analysis failed \(bundle_too_large\)/);
  assert.match(stderr.value, /Complete sanitized session evidence/);
  assert.match(stderr.value, /No evidence was omitted/);
  assert.match(
    stderr.value,
    /Chronological segmentation with complete coverage is required/
  );
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
  assert.match(stdout.value, /HTML report saved to .*report\.html/);
  assert.match(stdout.value, /Report inbox saved to .*index\.html/);
  assert.match(
    stdout.value,
    /Validation: 1 rejected, \d+ downgraded, 0 amended\./
  );
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
  assert.ok(
    first.artifacts.htmlReportPath && existsSync(first.artifacts.htmlReportPath)
  );
  assert.ok(
    second.artifacts.htmlReportPath && existsSync(second.artifacts.htmlReportPath)
  );
  if (second.kind !== "success") return;
  const index = readFileSync(second.indexPath, "utf8");
  assert.match(index, new RegExp(second.artifacts.runId));
  if (first.kind === "success") {
    assert.doesNotMatch(index, new RegExp(first.artifacts.runId));
  }
});

test("manual index failure reports the existing HTML and disposition without claiming inbox success", async () => {
  const root = sessionFixture("session-index-failure");
  const reportsDirectory = join(root, ".codex-observer", "reports");
  const indexPath = join(reportsDirectory, "index.html");
  mkdirSync(reportsDirectory, { recursive: true });
  writeFileSync(indexPath, "prior-valid-index", "utf8");
  chmodSync(reportsDirectory, 0o500);
  const stdout = bufferOutput();
  const stderr = bufferOutput();

  try {
    const exitCode = await runAnalyzeCommand({
      projectRoot: root,
      args: ["session-index-failure"],
      env: { OPENAI_API_KEY: "test-api-key" },
      stdout,
      stderr,
      providerFactory: () =>
        providerResult({
          kind: "success",
          candidate: candidateAnalysis(),
          rawResponse: { id: "resp_index_failure" },
          metadata: providerMetadata()
        }),
      now: new Date("2026-07-20T04:00:00.000Z")
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.value, "");
    assert.match(stderr.value, /Static report inbox rebuilding failed/);
    assert.match(stderr.value, /HTML report exists at .*report\.html/);
    assert.match(stderr.value, /Full-report disposition exists at .*latest\.json/);
    assert.match(stderr.value, /not successfully added to the report inbox/);
    assert.equal(readFileSync(indexPath, "utf8"), "prior-valid-index");
  } finally {
    chmodSync(reportsDirectory, 0o700);
  }
});

test("manual final-disposition failure reports the existing HTML and creates no inbox", async () => {
  const root = sessionFixture("session-disposition-failure");
  writeFileSync(
    join(root, ".codex-observer", "session-dispositions"),
    "not a directory",
    "utf8"
  );
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  const exitCode = await runAnalyzeCommand({
    projectRoot: root,
    args: ["session-disposition-failure"],
    env: { OPENAI_API_KEY: "test-api-key" },
    stdout,
    stderr,
    providerFactory: () =>
      providerResult({
        kind: "success",
        candidate: candidateAnalysis(),
        rawResponse: { id: "resp_disposition_failure" },
        metadata: providerMetadata()
      })
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.value, "");
  assert.match(stderr.value, /Final full-report disposition persistence failed/);
  assert.match(stderr.value, /HTML report exists at .*report\.html/);
  assert.doesNotMatch(stderr.value, /Full-report disposition exists/);
  assert.equal(existsSync(join(root, ".codex-observer", "reports")), false);
});

test("manual validated-artifact failure is stage-labeled and creates no full_report", async () => {
  const root = sessionFixture("session-artifact-failure");
  writeFileSync(
    join(root, ".codex-observer", "analysis-runs"),
    "not a directory",
    "utf8"
  );
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  const exitCode = await runAnalyzeCommand({
    projectRoot: root,
    args: ["session-artifact-failure"],
    env: { OPENAI_API_KEY: "test-api-key" },
    stdout,
    stderr,
    providerFactory: () =>
      providerResult({
        kind: "success",
        candidate: candidateAnalysis(),
        rawResponse: { id: "resp_artifact_failure" },
        metadata: providerMetadata()
      })
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.value, /validated_artifact_persistence/);
  assert.match(stderr.value, /No report was successfully added/);
  assert.equal(existsSync(join(root, ".codex-observer", "session-dispositions")), false);
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

function oversizedSessionFixture(sessionId: string): string {
  const root = mkdtempSync(join(tmpdir(), "kea-oversized-live-"));
  const sessionDirectory = join(root, ".codex-observer", "sessions", sessionId);
  mkdirSync(sessionDirectory, { recursive: true });
  const records = Array.from({ length: 300 }, (_, index) =>
    record(sessionId, "UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      turn_id: `turn-${index}`,
      prompt: "x".repeat(2500)
    })
  );
  writeFileSync(
    join(sessionDirectory, "events.jsonl"),
    `${records.join("\n")}\n`,
    "utf8"
  );
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
