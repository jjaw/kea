import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeCodexSession } from "../src/codex-session-adapter.ts";
import { analyzeSession } from "../src/session-report.ts";
import { generateSessionReport, resolveSessionFile } from "./report-session.ts";

const sessionId = "session-123";

test("normalizes known Codex events and preserves evidence line numbers", () => {
  const jsonl = [
    "not-json",
    record("UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      cwd: "/workspace",
      model: "codex-test",
      turn_id: "turn-1",
      prompt: "Fix the failing parser"
    })
  ].join("\n");

  const session = normalizeCodexSession(jsonl, "/recordings/events.jsonl");

  assert.equal(session.events.length, 1);
  assert.equal(session.events[0]?.type, "user_prompt");
  assert.equal(session.events[0]?.evidence.line, 2);
  assert.equal(session.sessionId, sessionId);
  assert.equal(session.diagnostics.length, 1);
  assert.equal(session.diagnostics[0]?.line, 1);
});

test("analyzes objective, attempts, explicit failure, correction, and outcome", () => {
  const session = normalizeCodexSession(fixtureJsonl(), "/recordings/events.jsonl");
  const analysis = analyzeSession(session);

  assert.equal(analysis.objective.value, "Fix the failing parser");
  assert.equal(analysis.objective.basis, "explicit");
  assert.equal(analysis.attempts.length, 1);
  assert.equal(analysis.attempts[0]?.completion, "completed");
  assert.equal(
    analysis.attempts[0]?.failure.value,
    "Tool response reported exit code 2."
  );
  assert.equal(analysis.humanDirections[0]?.value, "Use the existing adapter instead");
  assert.equal(analysis.outcome.value, "Updated the adapter and tests.");
  assert.equal(analysis.gitStart.basis, "observed");
  assert.equal(analysis.gitEnd.basis, "observed");
});

test("keeps missing lifecycle data and unstructured tool outcomes unknown", () => {
  const jsonl = [
    record("PreToolUse", {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "pwd" }
    }),
    record("PostToolUse", {
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "pwd" },
      tool_response: "/workspace\n"
    }),
    record("PreToolUse", {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      tool_name: "Bash",
      tool_use_id: "tool-2",
      tool_input: { command: "npm test" }
    })
  ].join("\n");

  const analysis = analyzeSession(
    normalizeCodexSession(jsonl, "/recordings/events.jsonl")
  );

  assert.equal(analysis.objective.basis, "unknown");
  assert.equal(analysis.outcome.basis, "unknown");
  assert.equal(analysis.gitStart.basis, "unknown");
  assert.equal(analysis.gitEnd.basis, "unknown");
  assert.equal(analysis.attempts[0]?.completion, "completed");
  assert.equal(analysis.attempts[0]?.failure.basis, "unknown");
  assert.equal(analysis.attempts[1]?.completion, "incomplete");
});

test("generates a private report with canonical line-level evidence links", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-observer-report-"));
  const sessionDirectory = join(root, ".codex-observer", "sessions", sessionId);
  mkdirSync(sessionDirectory, { recursive: true });
  writeFileSync(join(sessionDirectory, "events.jsonl"), fixtureJsonl(), "utf8");

  const result = generateSessionReport(root, sessionId);

  assert.equal(readFileSync(result.reportPath, "utf8"), result.markdown);
  assert.equal(statSync(result.reportPath).mode & 0o777, 0o600);
  assert.match(result.markdown, /Fix the failing parser/);
  assert.match(result.markdown, /Tool response reported exit code 2/);
  assert.match(
    result.markdown,
    /\.\.\/sessions\/session-123\/events\.jsonl#L2/
  );
});

test("resolves latest and rejects unsafe session selectors", () => {
  assert.equal(
    resolveSessionFile("/workspace", "latest"),
    join("/workspace", ".codex-observer", "latest", "events.jsonl")
  );
  assert.throws(() => resolveSessionFile("/workspace", "../../outside"));
});

function fixtureJsonl(): string {
  const startGit = gitSnapshot("start-head", " M before.ts", "before-diff");
  const endGit = gitSnapshot("end-head", " M after.ts", "after-diff");

  return [
    record(
      "SessionStart",
      {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        cwd: "/workspace",
        model: "codex-test",
        source: "startup"
      },
      startGit
    ),
    record("UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      cwd: "/workspace",
      model: "codex-test",
      turn_id: "turn-1",
      prompt: "Fix the failing parser"
    }),
    record("PreToolUse", {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      cwd: "/workspace",
      model: "codex-test",
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "npm test" }
    }),
    record("PostToolUse", {
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      cwd: "/workspace",
      model: "codex-test",
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "npm test" },
      tool_response: { exit_code: 2, error: "tests failed" }
    }),
    record("UserPromptSubmit", {
      hook_event_name: "UserPromptSubmit",
      session_id: sessionId,
      cwd: "/workspace",
      model: "codex-test",
      turn_id: "turn-2",
      prompt: "Use the existing adapter instead"
    }),
    record(
      "Stop",
      {
        hook_event_name: "Stop",
        session_id: sessionId,
        cwd: "/workspace",
        model: "codex-test",
        turn_id: "turn-2",
        stop_hook_active: false,
        last_assistant_message: "Updated the adapter and tests."
      },
      endGit
    )
  ].join("\n");
}

function record(
  eventName: string,
  payload: Record<string, unknown>,
  git?: ReturnType<typeof gitSnapshot>
): string {
  return JSON.stringify({
    capture: {
      schemaVersion: 1,
      capturedAt: "2026-07-19T18:00:00.000Z",
      sessionId,
      eventName,
      ...(git ? { git } : {})
    },
    payload
  });
}

function gitSnapshot(head: string, status: string, diff: string) {
  return {
    head,
    branch: "main",
    status,
    diff,
    errors: [] as string[]
  };
}
