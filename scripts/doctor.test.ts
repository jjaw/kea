import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDoctor } from "./doctor.ts";

test("doctor passes supported Node, resolvable hooks, and a recent parsed recording", () => {
  const root = doctorFixture();
  const now = new Date("2026-07-19T20:00:00.000Z");
  utimesSync(
    join(root, ".codex-observer", "latest", "events.jsonl"),
    now,
    now
  );

  const result = runDoctor({
    projectRoot: root,
    launchDirectory: root,
    now,
    nodeVersion: "22.6.0",
    typeStripping: true,
    apiKey: null
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.checks.map((check) => [check.name, check.ok]),
    [
      ["node", true],
      ["hook", true],
      ["recording", true],
      ["api_key", false]
    ]
  );
  assert.equal(result.checks.find((check) => check.name === "api_key")?.required, false);
});

test("doctor reports API-key presence without making it an offline readiness requirement", () => {
  const root = doctorFixture();
  const now = new Date("2026-07-19T20:00:00.000Z");
  utimesSync(join(root, ".codex-observer", "latest", "events.jsonl"), now, now);

  const missing = runDoctor({
    projectRoot: root,
    launchDirectory: root,
    now,
    nodeVersion: "22.6.0",
    typeStripping: true,
    apiKey: ""
  });
  assert.equal(missing.ok, true);
  assert.equal(missing.checks.at(-1)?.ok, false);
  assert.match(missing.checks.at(-1)?.message ?? "", /live analysis is unavailable/);

  const configured = runDoctor({
    projectRoot: root,
    launchDirectory: root,
    now,
    nodeVersion: "22.6.0",
    typeStripping: true,
    apiKey: "test-key"
  });
  assert.equal(configured.ok, true);
  assert.equal(configured.checks.at(-1)?.ok, true);
  assert.match(configured.checks.at(-1)?.message ?? "", /live analysis is available/);
});

test("doctor reports old or malformed recordings without throwing", () => {
  const root = doctorFixture("not-json\n");
  const old = new Date("2026-07-17T00:00:00.000Z");
  utimesSync(
    join(root, ".codex-observer", "latest", "events.jsonl"),
    old,
    old
  );

  const oldResult = runDoctor({
    projectRoot: root,
    launchDirectory: root,
    now: new Date("2026-07-19T00:00:00.001Z"),
    nodeVersion: "22.6.0",
    typeStripping: true
  });
  assert.equal(oldResult.ok, false);
  assert.match(
    oldResult.checks.find((check) => check.name === "recording")?.message ?? "",
    /not recent/
  );

  const malformedResult = runDoctor({
    projectRoot: root,
    launchDirectory: root,
    now: old,
    nodeVersion: "22.6.0",
    typeStripping: true
  });
  assert.equal(malformedResult.ok, false);
  assert.match(
    malformedResult.checks.find((check) => check.name === "recording")?.message ?? "",
    /no valid events/
  );
});

function doctorFixture(recording = validRecord()): string {
  const root = mkdtempSync(join(tmpdir(), "kea-doctor-"));
  mkdirSync(join(root, ".codex"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "record-codex-event.ts"), "", "utf8");
  writeFileSync(
    join(root, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command:
                  '/usr/bin/env node "$PWD/scripts/record-codex-event.ts" >/dev/null 2>&1 || true'
              }
            ]
          }
        ]
      }
    }),
    "utf8"
  );
  const sessionDirectory = join(root, ".codex-observer", "sessions", "session-1");
  mkdirSync(sessionDirectory, { recursive: true });
  writeFileSync(join(sessionDirectory, "events.jsonl"), recording, "utf8");
  symlinkSync(join("sessions", "session-1"), join(root, ".codex-observer", "latest"));
  return root;
}

function validRecord(): string {
  return `${JSON.stringify({
    capture: {
      schemaVersion: 1,
      capturedAt: "2026-07-19T20:00:00.000Z",
      sessionId: "session-1",
      eventName: "UserPromptSubmit"
    },
    payload: {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "Test doctor"
    }
  })}\n`;
}
