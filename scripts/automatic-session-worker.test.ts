import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AnalysisProvider,
  AnalysisProviderResult
} from "../src/analysis-provider.ts";
import {
  acquireAutomaticSessionLock,
  AUTOMATIC_WORKER_DIAGNOSTIC_MAX_BYTES,
  AutomaticWorkerDiagnosticSchema,
  automaticWorkerDiagnosticPath,
  pendingSessionMarkerPath,
  persistAutomaticWorkerDiagnostic,
  readPendingSessionMarker,
  refreshPendingSessionMarker,
  releaseAutomaticSessionLock
} from "../src/automatic-session-store.ts";
import {
  AUTOMATIC_ANALYSIS_ENABLED_ENV,
  AUTOMATIC_QUIET_INTERVAL_ENV,
  DEFAULT_AUTOMATIC_QUIET_INTERVAL_MS,
  automaticAnalysisEnabled,
  automaticQuietIntervalMs
} from "../src/session-disposition-config.ts";
import {
  listLatestSessionDispositions,
  persistLatestSessionDisposition
} from "../src/session-disposition-store.ts";
import { rebuildStaticReportIndex } from "../src/report-index.ts";
import {
  runAutomaticSessionWorker,
  type WorkerDependencies
} from "./automatic-session-worker.ts";

const TOKEN_ONE = "3a160460-e6de-4f9d-9101-45f92b16b54f";
const TOKEN_TWO = "79236365-d958-44b7-94b2-43f05fb45151";
const TOKEN_THREE = "b23c2fb7-e111-4e1e-9c60-6a634690fc1c";
const NOW = new Date("2026-07-20T23:00:00.000Z");

test("quiet interval and automatic consent use exact explicit environment values", () => {
  assert.equal(automaticQuietIntervalMs({}), DEFAULT_AUTOMATIC_QUIET_INTERVAL_MS);
  assert.equal(
    automaticQuietIntervalMs({ [AUTOMATIC_QUIET_INTERVAL_ENV]: "2000" }),
    2_000
  );
  assert.equal(
    automaticQuietIntervalMs({ [AUTOMATIC_QUIET_INTERVAL_ENV]: "2s" }),
    DEFAULT_AUTOMATIC_QUIET_INTERVAL_MS
  );
  assert.equal(automaticAnalysisEnabled({}), false);
  assert.equal(
    automaticAnalysisEnabled({ [AUTOMATIC_ANALYSIS_ENABLED_ENV]: "1" }),
    false
  );
  assert.equal(
    automaticAnalysisEnabled({ [AUTOMATIC_ANALYSIS_ENABLED_ENV]: "true" }),
    true
  );
});

test("pending markers and bounded worker diagnostics are strict, atomic, and private", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-automatic-store-"));
  const refreshed = refreshPendingSessionMarker(root, {
    sessionStorageKey: "session-store",
    sessionId: "session-store",
    pendingToken: TOKEN_ONE,
    stoppedAt: NOW.toISOString()
  });
  assert.equal(refreshed.path, pendingSessionMarkerPath(root, "session-store"));
  assert.equal(readPendingSessionMarker(root, "session-store")?.pendingToken, TOKEN_ONE);
  assert.equal(statSync(refreshed.path).mode & 0o777, 0o600);

  const diagnostic = AutomaticWorkerDiagnosticSchema.parse({
    schemaVersion: 1,
    timestamp: NOW.toISOString(),
    stage: "bundle_loading",
    errorCode: "worker_failed_before_disposition",
    sessionStorageKey: "session-store",
    pendingToken: TOKEN_ONE
  });
  const diagnosticPath = persistAutomaticWorkerDiagnostic(root, diagnostic);
  const serialized = readFileSync(diagnosticPath, "utf8");
  assert.equal(
    diagnosticPath,
    automaticWorkerDiagnosticPath(root, "session-store")
  );
  assert.ok(Buffer.byteLength(serialized) <= AUTOMATIC_WORKER_DIAGNOSTIC_MAX_BYTES);
  assert.equal(statSync(diagnosticPath).mode & 0o777, 0o600);
  assert.equal(
    AutomaticWorkerDiagnosticSchema.safeParse({
      ...diagnostic,
      message: "raw output must not be stored"
    }).success,
    false
  );
  assert.doesNotMatch(
    serialized,
    /evidence|provider|candidate|api.?key|stack|command/i
  );
});

test("an old worker exits after token replacement and never deletes the newer marker", async () => {
  const root = sessionFixture("session-superseded", true);
  refreshMarker(root, "session-superseded", TOKEN_ONE);
  let providerCalls = 0;
  const result = await runAutomaticSessionWorker({
    projectRoot: root,
    sessionStorageKey: "session-superseded",
    pendingToken: TOKEN_ONE,
    environment: enabledEnvironment(),
    dependencies: {
      now: () => NOW,
      sleep: async () => {
        refreshMarker(root, "session-superseded", TOKEN_TWO);
      },
      providerFactory: () => {
        providerCalls += 1;
        return successProvider();
      }
    }
  });

  assert.equal(result.kind, "superseded");
  assert.equal(providerCalls, 0);
  assert.equal(
    readPendingSessionMarker(root, "session-superseded")?.pendingToken,
    TOKEN_TWO
  );

  const latest = await runWorker(
    root,
    "session-superseded",
    TOKEN_TWO,
    enabledEnvironment(),
    {
      providerFactory: () => {
        providerCalls += 1;
        return successProvider();
      }
    }
  );
  assert.equal(latest.kind, "settled");
  assert.equal(providerCalls, 1);
  assert.equal(latestDisposition(root).kind, "full_report");
});

test("structurally insufficient sessions are activity_only before consent or key checks", async () => {
  const root = sessionFixture("session-activity", false);
  refreshMarker(root, "session-activity", TOKEN_ONE);
  let providerCalls = 0;
  const result = await runWorker(root, "session-activity", TOKEN_ONE, {}, {
    providerFactory: () => {
      providerCalls += 1;
      return successProvider();
    }
  });

  assert.equal(result.kind, "settled");
  if (result.kind === "settled") {
    assert.equal(result.dispositionKind, "activity_only");
  }
  assert.equal(providerCalls, 0);
  assert.equal(latestDisposition(root).kind, "activity_only");
});

test("eligible sessions block without consent or without an API key and never call a provider", async (t) => {
  for (const testCase of [
    {
      name: "missing consent",
      environment: { OPENAI_API_KEY: "test-key" },
      reason: "automatic_analysis_not_enabled"
    },
    {
      name: "missing key",
      environment: { [AUTOMATIC_ANALYSIS_ENABLED_ENV]: "true" },
      reason: "missing_api_key"
    }
  ] as const) {
    await t.test(testCase.name, async () => {
      const sessionId = `session-${testCase.name.replace(" ", "-")}`;
      const root = sessionFixture(sessionId, true);
      refreshMarker(root, sessionId, TOKEN_ONE);
      let providerCalls = 0;
      const result = await runWorker(
        root,
        sessionId,
        TOKEN_ONE,
        testCase.environment,
        {
          providerFactory: () => {
            providerCalls += 1;
            return successProvider();
          }
        }
      );
      assert.equal(result.kind, "settled");
      assert.equal(providerCalls, 0);
      const disposition = latestDisposition(root);
      assert.equal(disposition.kind, "blocked");
      assert.equal(disposition.reason, testCase.reason);
    });
  }
});

test("an oversized eligible session is blocked and persists no provider call", async () => {
  const root = sessionFixture("session-oversized-auto", true);
  refreshMarker(root, "session-oversized-auto", TOKEN_ONE);
  let providerCalls = 0;
  const result = await runAutomaticSessionWorker({
    projectRoot: root,
    sessionStorageKey: "session-oversized-auto",
    pendingToken: TOKEN_ONE,
    environment: enabledEnvironment(),
    requestBudgetBytes: 0,
    dependencies: baseDependencies({
      providerFactory: () => {
        providerCalls += 1;
        return successProvider();
      }
    })
  });

  assert.equal(result.kind, "settled");
  assert.equal(providerCalls, 0);
  const disposition = latestDisposition(root);
  assert.equal(disposition.kind, "blocked");
  assert.equal(disposition.reason, "bundle_too_large");
  assert.equal(
    existsSync(join(root, ".codex-observer", "analysis-runs")),
    true
  );
});

test("same settled evidence is deduplicated while environmental blocks can be reevaluated", async () => {
  const root = sessionFixture("session-deduplicate", false);
  refreshMarker(root, "session-deduplicate", TOKEN_ONE);
  await runWorker(root, "session-deduplicate", TOKEN_ONE, {});
  refreshMarker(root, "session-deduplicate", TOKEN_TWO);
  const duplicate = await runWorker(root, "session-deduplicate", TOKEN_TWO, {});
  assert.equal(duplicate.kind, "deduplicated");

  const eligibleRoot = sessionFixture("session-reevaluate", true);
  refreshMarker(eligibleRoot, "session-reevaluate", TOKEN_ONE);
  await runWorker(
    eligibleRoot,
    "session-reevaluate",
    TOKEN_ONE,
    { OPENAI_API_KEY: "test-key" }
  );
  assert.equal(latestDisposition(eligibleRoot).reason, "automatic_analysis_not_enabled");
  refreshMarker(eligibleRoot, "session-reevaluate", TOKEN_TWO);
  let providerCalls = 0;
  const unchanged = await runWorker(
    eligibleRoot,
    "session-reevaluate",
    TOKEN_TWO,
    { OPENAI_API_KEY: "test-key" },
    {
      providerFactory: () => {
        providerCalls += 1;
        return successProvider();
      }
    }
  );
  assert.equal(unchanged.kind, "settled");
  assert.equal(providerCalls, 0);
  assert.equal(latestDisposition(eligibleRoot).reason, "automatic_analysis_not_enabled");

  refreshMarker(eligibleRoot, "session-reevaluate", TOKEN_THREE);
  const reevaluated = await runWorker(
    eligibleRoot,
    "session-reevaluate",
    TOKEN_THREE,
    enabledEnvironment(),
    {
      providerFactory: () => {
        providerCalls += 1;
        return successProvider();
      }
    }
  );
  assert.equal(reevaluated.kind, "settled");
  assert.equal(providerCalls, 1);
  assert.equal(latestDisposition(eligibleRoot).kind, "full_report");
});

test("two concurrent workers cannot both call the provider and the lock is released", async () => {
  const root = sessionFixture("session-concurrent", true);
  refreshMarker(root, "session-concurrent", TOKEN_ONE);
  let providerCalls = 0;
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>((resolveGate) => {
    releaseProvider = resolveGate;
  });
  const provider: AnalysisProvider = {
    analyze: async () => {
      providerCalls += 1;
      await providerGate;
      return successResult();
    }
  };
  const dependencies = baseDependencies({ providerFactory: () => provider });

  const first = runAutomaticSessionWorker({
    projectRoot: root,
    sessionStorageKey: "session-concurrent",
    pendingToken: TOKEN_ONE,
    environment: enabledEnvironment(),
    dependencies
  });
  const second = runAutomaticSessionWorker({
    projectRoot: root,
    sessionStorageKey: "session-concurrent",
    pendingToken: TOKEN_ONE,
    environment: enabledEnvironment(),
    dependencies
  });
  await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
  assert.equal(providerCalls, 1);
  releaseProvider();
  const results = await Promise.all([first, second]);

  assert.equal(results.filter((result) => result.kind === "settled").length, 1);
  assert.equal(
    results.filter((result) => result.kind === "lock_unavailable").length,
    1
  );
  assert.equal(providerCalls, 1);
  const lock = acquireAutomaticSessionLock(root, "session-concurrent");
  assert.ok(lock);
  releaseAutomaticSessionLock(lock);
});

test("automatic success uses canonical artifacts before full_report and then rebuilds the inbox", async () => {
  const root = sessionFixture("session-success", true);
  refreshMarker(root, "session-success", TOKEN_ONE);
  let providerCalls = 0;
  let dispositionObserved = false;
  const dependencies = baseDependencies({
    providerFactory: () => {
      providerCalls += 1;
      return successProvider();
    },
    persistDisposition: (projectRoot, disposition) => {
      if (disposition.kind === "full_report") {
        const runDirectory = join(
          projectRoot,
          ".codex-observer",
          "analysis-runs",
          disposition.validatedRun.runId
        );
        for (const artifact of [
          "analysis.json",
          "validation-summary.json",
          "report.md",
          "report.html"
        ]) {
          assert.equal(existsSync(join(runDirectory, artifact)), true);
        }
        dispositionObserved = true;
      }
      return persistLatestSessionDisposition(projectRoot, disposition);
    },
    rebuildIndex: (projectRoot, now) => {
      assert.equal(dispositionObserved, true);
      assert.equal(latestDisposition(projectRoot).kind, "full_report");
      return rebuildStaticReportIndex(projectRoot, now);
    }
  });
  const result = await runAutomaticSessionWorker({
    projectRoot: root,
    sessionStorageKey: "session-success",
    pendingToken: TOKEN_ONE,
    environment: enabledEnvironment(),
    dependencies
  });

  assert.equal(result.kind, "settled");
  assert.equal(providerCalls, 1);
  assert.equal(dispositionObserved, true);
  const disposition = latestDisposition(root);
  assert.equal(disposition.kind, "full_report");
  assert.equal(
    existsSync(join(root, ".codex-observer", "reports", "index.html")),
    true
  );
  assert.equal(readPendingSessionMarker(root, "session-success"), null);
});

test("provider request failure and invalid output persist honest analysis_failed dispositions", async (t) => {
  for (const testCase of [
    {
      name: "request failure",
      provider: providerResult({
        kind: "request_failed",
        error: { name: "Error", message: "offline test failure" },
        metadata: providerMetadata()
      }),
      reason: "request_failed"
    },
    {
      name: "invalid output",
      provider: providerResult({
        kind: "success",
        candidate: { invalid: true },
        metadata: providerMetadata()
      }),
      reason: "schema_invalid"
    }
  ] as const) {
    await t.test(testCase.name, async () => {
      const sessionId = `session-${testCase.name.replace(" ", "-")}`;
      const root = sessionFixture(sessionId, true);
      refreshMarker(root, sessionId, TOKEN_ONE);
      const result = await runWorker(
        root,
        sessionId,
        TOKEN_ONE,
        enabledEnvironment(),
        { providerFactory: () => testCase.provider }
      );
      assert.equal(result.kind, "settled");
      const disposition = latestDisposition(root);
      assert.equal(disposition.kind, "analysis_failed");
      assert.equal(disposition.reason, testCase.reason);
    });
  }
});

test("artifact persistence failure records analysis_failed, a bounded diagnostic, and releases the lock", async () => {
  const root = sessionFixture("session-artifact-auto", true);
  writeFileSync(join(root, ".codex-observer", "analysis-runs"), "blocked", "utf8");
  refreshMarker(root, "session-artifact-auto", TOKEN_ONE);
  const result = await runWorker(
    root,
    "session-artifact-auto",
    TOKEN_ONE,
    enabledEnvironment(),
    { providerFactory: () => successProvider() }
  );

  assert.equal(result.kind, "worker_failed");
  const disposition = latestDisposition(root);
  assert.equal(disposition.kind, "analysis_failed");
  assert.equal(disposition.reason, "analysis_artifact_persistence_failed");
  const diagnosticPath = automaticWorkerDiagnosticPath(
    root,
    "session-artifact-auto"
  );
  assert.equal(existsSync(diagnosticPath), true);
  assert.ok(
    Buffer.byteLength(readFileSync(diagnosticPath)) <=
      AUTOMATIC_WORKER_DIAGNOSTIC_MAX_BYTES
  );
  const lock = acquireAutomaticSessionLock(root, "session-artifact-auto");
  assert.ok(lock);
  releaseAutomaticSessionLock(lock);
});

test("index failure preserves the canonical full_report and prior inbox", async () => {
  const root = sessionFixture("session-index-auto", true);
  const reportsDirectory = join(root, ".codex-observer", "reports");
  mkdirSync(reportsDirectory, { recursive: true });
  const indexPath = join(reportsDirectory, "index.html");
  writeFileSync(indexPath, "prior-valid-index", "utf8");
  refreshMarker(root, "session-index-auto", TOKEN_ONE);
  const result = await runWorker(
    root,
    "session-index-auto",
    TOKEN_ONE,
    enabledEnvironment(),
    {
      providerFactory: () => successProvider(),
      rebuildIndex: () => {
        throw new Error("injected index failure");
      }
    }
  );

  assert.equal(result.kind, "worker_failed");
  assert.equal(latestDisposition(root).kind, "full_report");
  assert.equal(readFileSync(indexPath, "utf8"), "prior-valid-index");
  const diagnostic = AutomaticWorkerDiagnosticSchema.parse(
    JSON.parse(
      readFileSync(
        automaticWorkerDiagnosticPath(root, "session-index-auto"),
        "utf8"
      )
    )
  );
  assert.equal(diagnostic.stage, "report_index_rebuild");
  assert.equal(diagnostic.errorCode, "report_index_rebuild_failed");
});

function runWorker(
  root: string,
  sessionStorageKey: string,
  pendingToken: string,
  environment: NodeJS.ProcessEnv,
  dependencies: WorkerDependencies = {}
) {
  return runAutomaticSessionWorker({
    projectRoot: root,
    sessionStorageKey,
    pendingToken,
    environment,
    dependencies: baseDependencies(dependencies)
  });
}

function baseDependencies(
  overrides: WorkerDependencies = {}
): WorkerDependencies {
  return {
    now: () => NOW,
    sleep: async () => {},
    ...overrides
  };
}

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    [AUTOMATIC_ANALYSIS_ENABLED_ENV]: "true",
    OPENAI_API_KEY: "test-api-key",
    [AUTOMATIC_QUIET_INTERVAL_ENV]: "2000"
  };
}

function refreshMarker(root: string, sessionId: string, pendingToken: string): void {
  refreshPendingSessionMarker(root, {
    sessionStorageKey: sessionId,
    sessionId,
    pendingToken,
    stoppedAt: NOW.toISOString()
  });
}

function latestDisposition(root: string) {
  const dispositions = listLatestSessionDispositions(root);
  assert.equal(dispositions.length, 1);
  return dispositions[0]!.disposition;
}

function sessionFixture(sessionId: string, eligible: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "kea-automatic-worker-"));
  const sessionDirectory = join(root, ".codex-observer", "sessions", sessionId);
  mkdirSync(sessionDirectory, { recursive: true });
  const records = eligible
    ? [
        record(sessionId, "SessionStart", {
          hook_event_name: "SessionStart",
          session_id: sessionId,
          turn_id: "turn-1"
        }, gitState("before")),
        record(sessionId, "UserPromptSubmit", {
          hook_event_name: "UserPromptSubmit",
          session_id: sessionId,
          turn_id: "turn-1",
          prompt: "Implement and verify the change"
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
          tool_response: { exit_code: 0 }
        }),
        record(sessionId, "Stop", {
          hook_event_name: "Stop",
          session_id: sessionId,
          turn_id: "turn-1",
          last_assistant_message: "Implemented and tested."
        }, gitState("after"))
      ]
    : [
        record(sessionId, "UserPromptSubmit", {
          hook_event_name: "UserPromptSubmit",
          session_id: sessionId,
          turn_id: "turn-1",
          prompt: "What is this?"
        }),
        record(sessionId, "Stop", {
          hook_event_name: "Stop",
          session_id: sessionId,
          turn_id: "turn-1",
          last_assistant_message: "A short answer."
        })
      ];
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
  payload: Record<string, unknown>,
  git?: ReturnType<typeof gitState>
): string {
  return JSON.stringify({
    capture: {
      schemaVersion: 1,
      capturedAt: "2026-07-20T22:00:00.000Z",
      sessionId,
      eventName,
      ...(git === undefined ? {} : { git })
    },
    payload
  });
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

function successProvider(): AnalysisProvider {
  return providerResult(successResult());
}

function successResult(): AnalysisProviderResult {
  return {
    kind: "success",
    candidate: {
      objective: {
        value: "Implement and verify the change",
        basis: "explicit",
        evidenceIds: ["E2"]
      },
      approaches: [],
      humanInterventions: [],
      turningPoints: [],
      codexContributions: [],
      reportedOutcome: {
        value: "Implemented and tested.",
        basis: "explicit",
        evidenceIds: ["E5"]
      },
      independentlySupportedOutcome: {
        value: "A command completed without a structured error.",
        basis: "observed",
        evidenceIds: ["E4"]
      },
      outcomeSupport: "independently_supported",
      evidenceGaps: [],
      leadershipInsights: []
    },
    rawResponse: { id: "mock-response", status: "completed" },
    metadata: providerMetadata()
  };
}

function providerResult(result: AnalysisProviderResult): AnalysisProvider {
  return { analyze: async () => result };
}

function providerMetadata() {
  return {
    provider: "mock",
    model: "mock-model",
    reasoningEffort: "medium",
    store: false as const,
    requestedAt: "2026-07-20T22:00:00.000Z",
    completedAt: "2026-07-20T22:00:01.000Z"
  };
}
