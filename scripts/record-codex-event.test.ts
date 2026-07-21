import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readPendingSessionMarker } from "../src/automatic-session-store.ts";
import {
  appendCapturedRecord,
  buildCapturedRecord,
  launchAutomaticSessionWorker,
  parseHookPayload,
  recordCodexEvent,
  sessionDirectoryName,
  shouldCaptureGit,
  type DetachedWorkerChild
} from "./record-codex-event.ts";

test("preserves a valid hook payload without transforming it", () => {
  const raw = JSON.stringify({
    session_id: "session-123",
    hook_event_name: "UserPromptSubmit",
    prompt: "Why did this fail?",
    extra: { unstable: true }
  });

  const result = parseHookPayload(raw);

  assert.deepEqual(result.payload, JSON.parse(raw));
  assert.equal(result.validated?.session_id, "session-123");
  assert.deepEqual(result.validationErrors, []);
});

test("retains malformed input and reports validation errors", () => {
  const result = parseHookPayload("not-json");

  assert.equal(result.payload, "not-json");
  assert.equal(result.validated, null);
  assert.match(result.validationErrors[0] ?? "", /^Invalid JSON:/);
});

test("uses stable, traversal-safe session directory names", () => {
  assert.equal(sessionDirectoryName("session-123"), "session-123");
  assert.equal(sessionDirectoryName(undefined), "ungrouped");
  assert.match(sessionDirectoryName("../../outside"), /^session-[a-f0-9]{64}$/);
});

test("captures Git only for session start and stop events", () => {
  assert.equal(shouldCaptureGit("SessionStart"), true);
  assert.equal(shouldCaptureGit("Stop"), true);
  assert.equal(shouldCaptureGit("PostToolUse"), false);
});

test("appends one JSON line and points latest at its session", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-observer-"));
  const raw = JSON.stringify({
    session_id: "session-123",
    hook_event_name: "UserPromptSubmit",
    prompt: "Keep this verbatim"
  });
  const record = buildCapturedRecord(raw, root, new Date("2026-07-18T12:00:00Z"));

  const outputPath = appendCapturedRecord(root, record);
  const lines = readFileSync(outputPath, "utf8").trimEnd().split("\n");

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0] ?? ""), record);
  assert.equal(
    readlinkSync(join(root, ".codex-observer", "latest")),
    join("sessions", "session-123")
  );
});

test("non-Stop events record without refreshing pending state or launching a worker", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-hook-non-stop-"));
  let refreshed = false;
  let launched = false;

  const result = recordCodexEvent({
    raw: JSON.stringify({
      session_id: "session-non-stop",
      hook_event_name: "UserPromptSubmit",
      prompt: "Keep recording"
    }),
    cwd: root,
    projectRoot: root,
    refreshPending: () => {
      refreshed = true;
      throw new Error("must not refresh");
    },
    launchWorker: () => {
      launched = true;
      return true;
    }
  });

  assert.equal(existsSync(result.outputPath), true);
  assert.equal(refreshed, false);
  assert.equal(launched, false);
  assert.equal(result.pendingMarker, null);
});

test("Stop records first, refreshes its marker, launches once, and returns without worker work", () => {
  const root = mkdtempSync(join(tmpdir(), "kea-hook-stop-"));
  let launches = 0;
  const launchWorker = (
    projectRoot: string,
    marker: Parameters<typeof launchAutomaticSessionWorker>[1]
  ): boolean => {
    launches += 1;
    const eventsPath = join(
      projectRoot,
      ".codex-observer",
      "sessions",
      "session-stop",
      "events.jsonl"
    );
    assert.equal(readFileSync(eventsPath, "utf8").trimEnd().split("\n").length, launches);
    assert.equal(
      readPendingSessionMarker(projectRoot, "session-stop")?.pendingToken,
      marker.pendingToken
    );
    return true;
  };
  const raw = JSON.stringify({
    session_id: "session-stop",
    hook_event_name: "Stop",
    last_assistant_message: "Done"
  });

  const first = recordCodexEvent({
    raw,
    cwd: root,
    projectRoot: root,
    now: new Date("2026-07-20T20:00:00.000Z"),
    launchWorker
  });
  const second = recordCodexEvent({
    raw,
    cwd: root,
    projectRoot: root,
    now: new Date("2026-07-20T20:00:01.000Z"),
    launchWorker
  });

  assert.equal(first.workerLaunched, true);
  assert.equal(second.workerLaunched, true);
  assert.equal(launches, 2);
  assert.notEqual(
    first.pendingMarker?.pendingToken,
    second.pendingMarker?.pendingToken
  );
  assert.equal(
    readPendingSessionMarker(root, "session-stop")?.pendingToken,
    second.pendingMarker?.pendingToken
  );
  assert.equal(
    existsSync(join(root, ".codex-observer", "analysis-runs")),
    false
  );
  assert.equal(
    existsSync(join(root, ".codex-observer", "reports", "index.html")),
    false
  );
});

test("detached launch ignores both synchronous spawn failure and an emitted child error", () => {
  const marker = {
    schemaVersion: 1 as const,
    sessionStorageKey: "session-launch",
    sessionId: "session-launch",
    pendingToken: "00000000-0000-4000-8000-000000000004",
    stoppedAt: "2026-07-20T20:00:00.000Z"
  };
  assert.equal(
    launchAutomaticSessionWorker("/project", marker, () => {
      throw new Error("synchronous spawn failure");
    }),
    false
  );

  class FakeChild extends EventEmitter {
    unreferenced = false;
    unref(): void {
      this.unreferenced = true;
    }
  }
  const child = new FakeChild();
  let capturedOptions: unknown;
  const launched = launchAutomaticSessionWorker(
    "/project",
    marker,
    (_command, _args, options) => {
      capturedOptions = options;
      return child as DetachedWorkerChild;
    }
  );

  assert.equal(launched, true);
  assert.deepEqual(capturedOptions, {
    cwd: "/project",
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  assert.equal(child.unreferenced, true);
  assert.doesNotThrow(() => child.emit("error", new Error("async spawn error")));
});

test("pending-marker or launch failure never rolls back a recorded Stop", () => {
  const markerFailureRoot = mkdtempSync(join(tmpdir(), "kea-hook-marker-failure-"));
  const raw = JSON.stringify({
    session_id: "session-fail-open",
    hook_event_name: "Stop"
  });
  const markerFailure = recordCodexEvent({
    raw,
    cwd: markerFailureRoot,
    projectRoot: markerFailureRoot,
    refreshPending: () => {
      throw new Error("marker failed");
    }
  });
  assert.equal(existsSync(markerFailure.outputPath), true);
  assert.equal(markerFailure.workerLaunched, false);

  const launchFailureRoot = mkdtempSync(join(tmpdir(), "kea-hook-launch-failure-"));
  const launchFailure = recordCodexEvent({
    raw,
    cwd: launchFailureRoot,
    projectRoot: launchFailureRoot,
    launchWorker: () => {
      throw new Error("launch failed");
    }
  });
  assert.equal(existsSync(launchFailure.outputPath), true);
  assert.ok(launchFailure.pendingMarker);
  assert.equal(launchFailure.workerLaunched, false);
});
