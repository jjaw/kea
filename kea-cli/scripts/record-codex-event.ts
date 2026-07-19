import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const HookPayloadSchema = z
  .object({
    session_id: z.string().min(1).optional(),
    hook_event_name: z.string().min(1).optional(),
    cwd: z.string().min(1).optional()
  })
  .loose();

type HookPayload = z.infer<typeof HookPayloadSchema>;

export type GitSnapshot = {
  head: string | null;
  branch: string | null;
  status: string | null;
  diff: string | null;
  errors: string[];
};

type CaptureMetadata = {
  schemaVersion: 1;
  capturedAt: string;
  sessionId: string | null;
  eventName: string | null;
  validationErrors?: string[];
  git?: GitSnapshot;
};

export type CapturedRecord = {
  capture: CaptureMetadata;
  payload: unknown;
};

type ParsedPayload = {
  payload: unknown;
  validated: HookPayload | null;
  validationErrors: string[];
};

const GIT_TIMEOUT_MS = 1_000;
const GIT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export function parseHookPayload(raw: string): ParsedPayload {
  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch (error) {
    return {
      payload: raw,
      validated: null,
      validationErrors: [`Invalid JSON: ${errorMessage(error)}`]
    };
  }

  const result = HookPayloadSchema.safeParse(payload);
  if (!result.success) {
    return {
      payload,
      validated: null,
      validationErrors: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`
      )
    };
  }

  return { payload, validated: result.data, validationErrors: [] };
}

export function sessionDirectoryName(sessionId: string | undefined): string {
  if (!sessionId) {
    return "ungrouped";
  }

  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId)) {
    return sessionId;
  }

  return `session-${createHash("sha256").update(sessionId).digest("hex")}`;
}

export function shouldCaptureGit(eventName: string | undefined): boolean {
  return eventName === "SessionStart" || eventName === "Stop";
}

export function captureGitState(cwd: string): GitSnapshot {
  const errors: string[] = [];
  const head = runGit(
    cwd,
    ["rev-parse", "--verify", "HEAD"],
    errors,
    "head",
    false
  );
  const branch = runGit(
    cwd,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    errors,
    "branch",
    false
  );
  const status = runGit(
    cwd,
    ["status", "--short", "--branch", "--untracked-files=all"],
    errors,
    "status"
  );
  const diffArgs = head
    ? ["diff", "--no-ext-diff", "--binary", "HEAD"]
    : ["diff", "--cached", "--no-ext-diff", "--binary"];
  const diff = runGit(cwd, diffArgs, errors, "diff");

  return { head, branch, status, diff, errors };
}

export function buildCapturedRecord(
  raw: string,
  cwd: string,
  now: Date = new Date()
): CapturedRecord {
  const parsed = parseHookPayload(raw);
  const sessionId = parsed.validated?.session_id ?? null;
  const eventName = parsed.validated?.hook_event_name ?? null;
  const capture: CaptureMetadata = {
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    sessionId,
    eventName
  };

  if (parsed.validationErrors.length > 0) {
    capture.validationErrors = parsed.validationErrors;
  }

  if (shouldCaptureGit(parsed.validated?.hook_event_name)) {
    capture.git = captureGitState(cwd);
  }

  return { capture, payload: parsed.payload };
}

export function appendCapturedRecord(
  rootDirectory: string,
  record: CapturedRecord
): string {
  const sessionDirectory = sessionDirectoryName(record.capture.sessionId ?? undefined);
  const outputPath = join(
    rootDirectory,
    ".codex-observer",
    "sessions",
    sessionDirectory,
    "events.jsonl"
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    flag: "a",
    mode: 0o600
  });

  return outputPath;
}

function runGit(
  cwd: string,
  args: string[],
  errors: string[],
  field: string,
  recordFailure = true
): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS
    }).replace(/\n$/, "");
  } catch (error) {
    if (recordFailure) {
      errors.push(`${field}: ${errorMessage(error)}`);
    }
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function main(): void {
  try {
    const raw = readFileSync(0, "utf8");
    const cwd = process.cwd();
    const record = buildCapturedRecord(raw, cwd);
    appendCapturedRecord(PROJECT_ROOT, record);
  } catch (error) {
    // Recording is observational and must never affect the Codex session.
    if (process.env.CODEX_OBSERVER_DEBUG === "1") {
      console.error(error);
    }
  }
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  main();
}
