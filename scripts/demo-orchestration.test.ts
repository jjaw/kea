import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";
import type { CandidateAnalysis } from "../src/analysis-definitions.ts";
import type {
  AnalysisProvider,
  ProviderRunMetadata
} from "../src/analysis-provider.ts";
import type { EvidenceBundle } from "../src/evidence-bundle.ts";
import {
  resolveDemoOutputRoot,
  runDemo
} from "../src/demo-orchestration.ts";

test("demo orchestration isolates the real observer and runs the canonical pipeline without credentials or network", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-demo-project-"));
  const fixtureRoot = mkdtempSync(join(tmpdir(), "kea-demo-fixture-"));
  const outputRoot = mkdtempSync(
    join(tmpdir(), "kea-demo-output-test-")
  );
  const fixturePath = join(fixtureRoot, "events.jsonl");
  writeFileSync(fixturePath, fixtureJsonl(), { encoding: "utf8", mode: 0o600 });
  const fixtureHashBefore = sha256(fixturePath);
  const fixtureModeBefore = statSync(fixturePath).mode;

  const realObserver = join(projectRoot, ".codex-observer");
  const realLatest = join(realObserver, "latest");
  mkdirSync(realLatest, { recursive: true });
  const realSentinel = join(realObserver, "sentinel.txt");
  const realLatestRecording = join(realLatest, "events.jsonl");
  writeFileSync(realSentinel, "real observer must remain untouched\n", "utf8");
  writeFileSync(realLatestRecording, "not valid fixture JSONL\n", "utf8");
  chmodSync(realObserver, 0o000);

  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "must-be-ignored";
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Network access is forbidden in the demo test");
  }) as typeof fetch;

  const firstProvider = localProvider();
  const secondProvider = localProvider();
  let firstResult;
  let secondResult;
  try {
    firstResult = await runDemo({
      projectRoot,
      fixtureRecordingPath: fixturePath,
      outputRoot,
      provider: firstProvider.provider,
      now: new Date("2026-07-20T23:30:00.000Z")
    });
    writeFileSync(join(outputRoot, "stale-output.txt"), "remove me", "utf8");
    secondResult = await runDemo({
      projectRoot,
      fixtureRecordingPath: fixturePath,
      outputRoot,
      provider: secondProvider.provider,
      now: new Date("2026-07-20T23:30:00.000Z")
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    chmodSync(realObserver, 0o700);
  }

  assert.equal(fetchCalls, 0);
  assert.equal(firstProvider.calls(), 1);
  assert.equal(secondProvider.calls(), 1);
  assert.equal(firstProvider.bundle()?.session.sessionId, "reference-session");
  assert.equal(firstProvider.bundle()?.evidence.length, 7);
  assert.equal(
    firstProvider.bundle()?.evidence.find((item) => item.id === "E4")
      ?.structuralFacts.matchedEvidenceId,
    "E3"
  );
  assert.doesNotMatch(
    JSON.stringify(firstProvider.bundle()),
    /fixture-secret-value/
  );

  assert.equal(firstResult.summary.disposition, "full_report");
  assert.equal(firstResult.summary.rejectedCount, 1);
  assert.ok(firstResult.summary.downgradedCount >= 1);
  assert.equal(firstResult.summary.amendedCount, 1);
  assert.equal(secondResult.summary.disposition, "full_report");
  assert.equal(secondResult.outputRoot, realpathSync(outputRoot));
  assert.equal(existsSync(join(outputRoot, "stale-output.txt")), false);
  assert.equal(
    readdirSync(join(outputRoot, ".codex-observer", "analysis-runs")).length,
    1
  );
  assert.equal(
    existsSync(join(outputRoot, ".codex-observer", "latest")),
    false
  );

  for (const path of [
    secondResult.stagedRecordingPath,
    secondResult.artifacts.bundlePath,
    secondResult.artifacts.candidateAnalysisPath,
    secondResult.artifacts.analysisPath,
    secondResult.artifacts.validationSummaryPath,
    secondResult.artifacts.reportPath,
    secondResult.artifacts.htmlReportPath,
    secondResult.dispositionPath,
    secondResult.indexPath
  ]) {
    assert.ok(path && existsSync(path));
  }
  const validationSummary = JSON.parse(
    readFileSync(secondResult.artifacts.validationSummaryPath ?? "", "utf8")
  );
  assert.ok(
    validationSummary.actions.some(
      (action: { action: string; code?: string }) =>
        action.action === "amended" &&
        action.code === "turning_point_citations_completed"
    )
  );
  assert.ok(
    validationSummary.actions.some(
      (action: { action: string; target: string }) =>
        action.action === "downgraded" && action.target === "objective"
    )
  );
  const disposition = JSON.parse(
    readFileSync(secondResult.dispositionPath, "utf8")
  );
  assert.equal(disposition.kind, "full_report");
  assert.equal(disposition.validatedRun.runId, secondResult.artifacts.runId);
  const index = readFileSync(secondResult.indexPath, "utf8");
  assert.match(
    index,
    new RegExp(
      `href="\\.\\.\/analysis-runs\/${secondResult.artifacts.runId}\/report\\.html"`
    )
  );
  assert.doesNotMatch(index, /href="\//);

  assert.equal(sha256(fixturePath), fixtureHashBefore);
  assert.equal(statSync(fixturePath).mode, fixtureModeBefore);
  assert.equal(sha256(secondResult.stagedRecordingPath), fixtureHashBefore);
  assert.equal(
    readFileSync(realSentinel, "utf8"),
    "real observer must remain untouched\n"
  );
  assert.equal(readFileSync(realLatestRecording, "utf8"), "not valid fixture JSONL\n");
});

test("demo output-root validation permits only the fixed production root or an explicit temporary test root", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-demo-path-project-"));
  const fixtureRoot = mkdtempSync(join(tmpdir(), "kea-demo-path-fixture-"));
  const fixturePath = join(fixtureRoot, "events.jsonl");
  writeFileSync(fixturePath, fixtureJsonl(), "utf8");
  const canonicalProjectRoot = realpathSync(projectRoot);
  const fixedOutput = join(canonicalProjectRoot, ".kea-demo-output");
  assert.equal(
    resolveDemoOutputRoot({ projectRoot, fixtureRecordingPath: fixturePath }),
    fixedOutput
  );

  const temporaryOutput = mkdtempSync(
    join(tmpdir(), "kea-demo-output-test-")
  );
  assert.equal(
    resolveDemoOutputRoot({
      projectRoot,
      fixtureRecordingPath: fixturePath,
      outputRoot: temporaryOutput
    }),
    realpathSync(temporaryOutput)
  );

  const rejected = [
    { outputRoot: "", pattern: /must not be empty/ },
    { outputRoot: ".kea-demo-output", pattern: /absolute, unambiguous/ },
    { outputRoot: canonicalProjectRoot, pattern: /repository root/ },
    {
      outputRoot: join(canonicalProjectRoot, ".codex-observer"),
      pattern: /real \.codex-observer/
    },
    {
      outputRoot: join(
        canonicalProjectRoot,
        "fixtures",
        "demo",
        "reference-session"
      ),
      pattern: /committed fixture directory/
    },
    { outputRoot: parse(canonicalProjectRoot).root, pattern: /filesystem root/ },
    {
      outputRoot: join(canonicalProjectRoot, "unapproved-output"),
      pattern: /must be exactly/
    }
  ];
  for (const testCase of rejected) {
    assert.throws(
      () =>
        resolveDemoOutputRoot({
          projectRoot,
          fixtureRecordingPath: fixturePath,
          outputRoot: testCase.outputRoot
        }),
      testCase.pattern
    );
  }
});

test("demo rejects a fixture inside its output before deletion", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-demo-contained-project-"));
  const outputRoot = mkdtempSync(
    join(tmpdir(), "kea-demo-output-test-")
  );
  const fixturePath = join(outputRoot, "events.jsonl");
  writeFileSync(fixturePath, fixtureJsonl(), "utf8");
  const before = sha256(fixturePath);
  let providerCalls = 0;

  await assert.rejects(
    runDemo({
      projectRoot,
      fixtureRecordingPath: fixturePath,
      outputRoot,
      provider: {
        analyze: async () => {
          providerCalls += 1;
          throw new Error("must not run");
        }
      }
    }),
    /fixture recording must not be inside the output root/
  );
  assert.equal(providerCalls, 0);
  assert.equal(sha256(fixturePath), before);
});

test("missing injected fixture fails honestly without inspecting real recordings", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-demo-missing-project-"));
  const realObserver = join(projectRoot, ".codex-observer");
  mkdirSync(join(realObserver, "latest"), { recursive: true });
  const sentinel = join(realObserver, "latest", "events.jsonl");
  writeFileSync(sentinel, "real recording sentinel\n", "utf8");
  const outputRoot = join(projectRoot, ".kea-demo-output");
  let providerCalls = 0;

  await assert.rejects(
    runDemo({
      projectRoot,
      fixtureRecordingPath: join(projectRoot, "missing-fixture.jsonl"),
      provider: {
        analyze: async () => {
          providerCalls += 1;
          throw new Error("must not run");
        }
      }
    }),
    /Incomplete demo fixture: approved sanitized recording is missing.*Refusing to inspect real project recordings/
  );
  assert.equal(providerCalls, 0);
  assert.equal(existsSync(outputRoot), false);
  assert.equal(readFileSync(sentinel, "utf8"), "real recording sentinel\n");
});

test("demo modules have no OpenAI-provider, API-key, or network dependency", () => {
  for (const path of [
    join(process.cwd(), "src", "demo-orchestration.ts"),
    join(process.cwd(), "src", "recording-analysis-run.ts")
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /openai-analysis-provider|OpenAIAnalysisProvider/);
    assert.doesNotMatch(source, /OPENAI_API_KEY/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
  }
});

function localProvider(): {
  provider: AnalysisProvider;
  calls: () => number;
  bundle: () => EvidenceBundle | undefined;
} {
  let callCount = 0;
  let receivedBundle: EvidenceBundle | undefined;
  return {
    provider: {
      analyze: async (bundle) => {
        callCount += 1;
        receivedBundle = bundle;
        return {
          kind: "success",
          candidate: candidateAnalysis(),
          rawResponse: { kind: "deterministic_local_test_result" },
          metadata: providerMetadata()
        };
      }
    },
    calls: () => callCount,
    bundle: () => receivedBundle
  };
}

function providerMetadata(): ProviderRunMetadata {
  return {
    provider: "deterministic-local-test",
    model: "fixture-independent",
    reasoningEffort: "none",
    store: false,
    requestedAt: "2026-07-20T23:30:00.000Z",
    completedAt: "2026-07-20T23:30:00.000Z"
  };
}

function candidateAnalysis(): CandidateAnalysis {
  return {
    objective: {
      value: "Implement the requested change",
      basis: "observed",
      evidenceIds: ["E2"]
    },
    approaches: [
      {
        value: "Run the focused check",
        basis: "observed",
        evidenceIds: ["E3", "E4"],
        status: "completed"
      },
      {
        value: "Unsupported extra approach",
        basis: "observed",
        evidenceIds: ["E999"],
        status: "unknown"
      }
    ],
    humanInterventions: [
      {
        value: "Keep the change bounded",
        basis: "explicit",
        evidenceIds: ["E2"],
        category: "constraint",
        justification: "The human explicitly constrained the task."
      }
    ],
    turningPoints: [
      {
        value: "The request led to a focused check",
        basis: "inference",
        evidenceIds: ["E2"],
        beforeEvidenceIds: ["E2"],
        afterEvidenceIds: ["E3"],
        confidence: "high",
        confidenceReason: "The ordered request and tool activity are adjacent."
      }
    ],
    codexContributions: [
      {
        value: "Ran the focused check",
        basis: "observed",
        evidenceIds: ["E3", "E4"]
      }
    ],
    reportedOutcome: {
      value: "The focused check passed.",
      basis: "explicit",
      evidenceIds: ["E5"]
    },
    independentlySupportedOutcome: {
      value: "The captured focused check exited successfully.",
      basis: "observed",
      evidenceIds: ["E4"]
    },
    outcomeSupport: "independently_supported",
    evidenceGaps: [
      {
        value: "Broader verification was not captured.",
        basis: "unknown",
        evidenceIds: []
      }
    ],
    leadershipInsights: [
      {
        value: "The bounded request was followed by captured verification activity.",
        basis: "inference",
        evidenceIds: ["E2", "E4"],
        confidence: "medium",
        confidenceReason: "The prompt and successful result are directly captured."
      }
    ]
  };
}

function fixtureJsonl(): string {
  const sessionId = "reference-session";
  const records = [
    record(
      sessionId,
      "SessionStart",
      {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        turn_id: "turn-1",
        source: "startup"
      },
      gitSnapshot("")
    ),
    record(sessionId, "UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      turn_id: "turn-1",
      prompt:
        "Implement the requested change and keep it bounded. API_KEY=fixture-secret-value"
    }),
    record(sessionId, "PreToolUse", {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "npm test -- --focused" }
    }),
    record(sessionId, "PostToolUse", {
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "npm test -- --focused" },
      tool_response: { exit_code: 0, output: "focused check passed" }
    }),
    record(
      sessionId,
      "Stop",
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        turn_id: "turn-1",
        last_assistant_message: "The focused check passed."
      },
      gitSnapshot("M src/example.ts\n")
    )
  ];
  return `${records.join("\n")}\n`;
}

function record(
  sessionId: string,
  eventName: string,
  payload: Record<string, unknown>,
  git?: ReturnType<typeof gitSnapshot>
): string {
  return JSON.stringify({
    capture: {
      schemaVersion: 1,
      capturedAt: "2026-07-20T23:00:00.000Z",
      sessionId,
      eventName,
      ...(git === undefined ? {} : { git })
    },
    payload
  });
}

function gitSnapshot(status: string) {
  return {
    head: "0123456789abcdef",
    branch: "main",
    status,
    diff: status === "" ? "" : "+fixture-independent change\n",
    errors: []
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
