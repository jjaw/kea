import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendCapturedRecord,
  buildCapturedRecord,
  parseHookPayload,
  sessionDirectoryName,
  shouldCaptureGit
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

test("appends one JSON line under the session directory", () => {
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
});
