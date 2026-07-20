import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateDryRun } from "./analyze-session.ts";

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
