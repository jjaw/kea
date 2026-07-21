import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  refreshPendingSessionMarker,
  type PendingSessionMarker
} from "../src/automatic-session-store.ts";

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
const AUTOMATIC_WORKER_PATH = join(
  dirname(SCRIPT_PATH),
  "automatic-session-worker.ts"
);

export type DetachedWorkerChild = {
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
};

export type AutomaticWorkerSpawner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    detached: true;
    stdio: "ignore";
    env: NodeJS.ProcessEnv;
  }
) => DetachedWorkerChild;

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
  updateLatestSessionPointer(rootDirectory, sessionDirectory);

  return outputPath;
}

export function launchAutomaticSessionWorker(
  projectRoot: string,
  marker: PendingSessionMarker,
  spawnWorker: AutomaticWorkerSpawner = defaultWorkerSpawner
): boolean {
  try {
    const child = spawnWorker(
      process.execPath,
      [
        AUTOMATIC_WORKER_PATH,
        marker.sessionStorageKey,
        marker.pendingToken
      ],
      {
        cwd: projectRoot,
        detached: true,
        stdio: "ignore",
        env: process.env
      }
    );
    child.once("error", () => {
      // Session recording is already durable. Detached launch errors are
      // observational and must never affect Codex.
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function recordCodexEvent(options: {
  raw: string;
  cwd: string;
  projectRoot: string;
  now?: Date;
  refreshPending?: typeof refreshPendingSessionMarker;
  launchWorker?: typeof launchAutomaticSessionWorker;
}): {
  outputPath: string;
  pendingMarker: PendingSessionMarker | null;
  workerLaunched: boolean;
} {
  const record = buildCapturedRecord(
    options.raw,
    options.cwd,
    options.now ?? new Date()
  );
  const outputPath = appendCapturedRecord(options.projectRoot, record);
  let pendingMarker: PendingSessionMarker | null = null;
  let workerLaunched = false;

  if (record.capture.eventName === "Stop") {
    try {
      const refreshed = (
        options.refreshPending ?? refreshPendingSessionMarker
      )(options.projectRoot, {
        sessionStorageKey: sessionDirectoryName(
          record.capture.sessionId ?? undefined
        ),
        sessionId: record.capture.sessionId,
        stoppedAt: record.capture.capturedAt
      });
      pendingMarker = refreshed.marker;
      try {
        workerLaunched = (
          options.launchWorker ?? launchAutomaticSessionWorker
        )(options.projectRoot, refreshed.marker);
      } catch {
        workerLaunched = false;
      }
    } catch {
      // The captured Stop remains durable even if automatic handoff cannot be
      // scheduled. A later Stop may refresh the pending state successfully.
    }
  }

  return { outputPath, pendingMarker, workerLaunched };
}

function updateLatestSessionPointer(
  rootDirectory: string,
  sessionDirectory: string
): void {
  const observerDirectory = join(rootDirectory, ".codex-observer");
  const latestPath = join(observerDirectory, "latest");
  const temporaryPath = join(
    observerDirectory,
    `.latest-${process.pid}-${Date.now()}`
  );

  try {
    symlinkSync(join("sessions", sessionDirectory), temporaryPath, "dir");
    renameSync(temporaryPath, latestPath);
  } catch {
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The event is already durable; pointer cleanup is best-effort.
      }
    }
  }
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

const defaultWorkerSpawner: AutomaticWorkerSpawner = (
  command,
  args,
  options
) => spawn(command, args, options);

function main(): void {
  try {
    const raw = readFileSync(0, "utf8");
    const cwd = process.cwd();
    recordCodexEvent({ raw, cwd, projectRoot: PROJECT_ROOT });
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
