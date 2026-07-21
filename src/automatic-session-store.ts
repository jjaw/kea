import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export const SAFE_SESSION_STORAGE_KEY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const AUTOMATIC_WORKER_DIAGNOSTIC_MAX_BYTES = 2 * 1024;

export const SafeSessionStorageKeySchema = z
  .string()
  .regex(SAFE_SESSION_STORAGE_KEY_PATTERN, "Invalid session storage key");

export const PendingSessionMarkerSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionStorageKey: SafeSessionStorageKeySchema,
    sessionId: z.string().min(1).max(512).nullable(),
    pendingToken: z.string().uuid(),
    stoppedAt: z.string().datetime({ offset: true })
  })
  .strict();

export const AUTOMATIC_WORKER_STAGES = [
  "worker_startup",
  "pending_verification",
  "lock_acquisition",
  "bundle_loading",
  "session_assessment",
  "provider_analysis",
  "disposition_persistence",
  "report_index_rebuild",
  "pending_cleanup",
  "lock_release"
] as const;

export const AUTOMATIC_WORKER_ERROR_CODES = [
  "worker_failed_before_disposition",
  "analysis_failure_persistence_failed",
  "disposition_persistence_failed",
  "report_index_rebuild_failed",
  "pending_cleanup_failed",
  "lock_release_failed"
] as const;

export const AutomaticWorkerDiagnosticSchema = z
  .object({
    schemaVersion: z.literal(1),
    timestamp: z.string().datetime({ offset: true }),
    stage: z.enum(AUTOMATIC_WORKER_STAGES),
    errorCode: z.enum(AUTOMATIC_WORKER_ERROR_CODES),
    sessionStorageKey: SafeSessionStorageKeySchema,
    pendingToken: z.string().uuid().optional(),
    runId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/)
      .optional()
  })
  .strict();

export type PendingSessionMarker = z.infer<
  typeof PendingSessionMarkerSchema
>;
export type AutomaticWorkerDiagnostic = z.infer<
  typeof AutomaticWorkerDiagnosticSchema
>;

export function pendingSessionMarkerPath(
  projectRoot: string,
  sessionStorageKeyInput: string
): string {
  const sessionStorageKey = SafeSessionStorageKeySchema.parse(
    sessionStorageKeyInput
  );
  return join(
    projectRoot,
    ".codex-observer",
    "pending-sessions",
    sessionStorageKey,
    "pending.json"
  );
}

export function refreshPendingSessionMarker(
  projectRoot: string,
  input: {
    sessionStorageKey: string;
    sessionId: string | null;
    stoppedAt: string;
    pendingToken?: string;
  }
): { marker: PendingSessionMarker; path: string } {
  const marker = PendingSessionMarkerSchema.parse({
    schemaVersion: 1,
    sessionStorageKey: input.sessionStorageKey,
    sessionId:
      input.sessionId !== null && input.sessionId.length <= 512
        ? input.sessionId
        : null,
    pendingToken: input.pendingToken ?? randomUUID(),
    stoppedAt: input.stoppedAt
  });
  const path = pendingSessionMarkerPath(
    projectRoot,
    marker.sessionStorageKey
  );
  const markerDirectory = dirname(path);
  const tokensDirectory = join(markerDirectory, "tokens");
  mkdirSync(tokensDirectory, { recursive: true, mode: 0o700 });

  const tokenFileName = `${marker.pendingToken}.json`;
  const tokenPath = join(tokensDirectory, tokenFileName);
  const temporaryLinkPath = join(
    markerDirectory,
    `.pending-${process.pid}-${randomUUID()}.tmp`
  );
  try {
    writeFileSync(tokenPath, serializeJson(marker), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    symlinkSync(join("tokens", tokenFileName), temporaryLinkPath, "file");
    renameSync(temporaryLinkPath, path);
  } catch (error) {
    removeIfPresent(temporaryLinkPath);
    removeIfPresent(tokenPath);
    throw error;
  }
  return { marker, path };
}

export function readPendingSessionMarker(
  projectRoot: string,
  sessionStorageKeyInput: string
): PendingSessionMarker | null {
  const path = pendingSessionMarkerPath(projectRoot, sessionStorageKeyInput);
  try {
    return PendingSessionMarkerSchema.parse(
      JSON.parse(readFileSync(path, "utf8"))
    );
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

export function pendingSessionTokenIsCurrent(
  projectRoot: string,
  sessionStorageKey: string,
  pendingToken: string
): boolean {
  const marker = readPendingSessionMarker(projectRoot, sessionStorageKey);
  return marker?.pendingToken === pendingToken;
}

export function clearPendingSessionMarkerIfCurrent(
  projectRoot: string,
  sessionStorageKeyInput: string,
  pendingTokenInput: string
): boolean {
  const sessionStorageKey = SafeSessionStorageKeySchema.parse(
    sessionStorageKeyInput
  );
  const pendingToken = z.string().uuid().parse(pendingTokenInput);
  const tokenPath = join(
    dirname(pendingSessionMarkerPath(projectRoot, sessionStorageKey)),
    "tokens",
    `${pendingToken}.json`
  );
  if (!existsSync(tokenPath)) return false;

  const marker = PendingSessionMarkerSchema.parse(
    JSON.parse(readFileSync(tokenPath, "utf8"))
  );
  if (
    marker.sessionStorageKey !== sessionStorageKey ||
    marker.pendingToken !== pendingToken
  ) {
    return false;
  }
  unlinkSync(tokenPath);
  return true;
}

export function acquireAutomaticSessionLock(
  projectRoot: string,
  sessionStorageKeyInput: string
): string | null {
  const sessionStorageKey = SafeSessionStorageKeySchema.parse(
    sessionStorageKeyInput
  );
  const locksRoot = join(
    projectRoot,
    ".codex-observer",
    "automatic-locks"
  );
  mkdirSync(locksRoot, { recursive: true, mode: 0o700 });
  const path = join(locksRoot, `${sessionStorageKey}.lock`);
  try {
    mkdirSync(path, { mode: 0o700 });
    return path;
  } catch (error) {
    if (isAlreadyExistsError(error)) return null;
    throw error;
  }
}

export function releaseAutomaticSessionLock(path: string): void {
  rmdirSync(path);
}

export function automaticWorkerDiagnosticPath(
  projectRoot: string,
  sessionStorageKeyInput: string
): string {
  const sessionStorageKey = SafeSessionStorageKeySchema.parse(
    sessionStorageKeyInput
  );
  return join(
    projectRoot,
    ".codex-observer",
    "automatic-worker-errors",
    sessionStorageKey,
    "latest.json"
  );
}

export function persistAutomaticWorkerDiagnostic(
  projectRoot: string,
  diagnosticInput: AutomaticWorkerDiagnostic
): string {
  const diagnostic = AutomaticWorkerDiagnosticSchema.parse(diagnosticInput);
  const serialized = serializeJson(diagnostic);
  if (Buffer.byteLength(serialized, "utf8") > AUTOMATIC_WORKER_DIAGNOSTIC_MAX_BYTES) {
    throw new Error("Automatic worker diagnostic exceeds its size bound");
  }
  const path = automaticWorkerDiagnosticPath(
    projectRoot,
    diagnostic.sessionStorageKey
  );
  writeTextAtomically(path, serialized);
  return path;
}

export function clearAutomaticWorkerDiagnostic(
  projectRoot: string,
  sessionStorageKey: string
): void {
  removeIfPresent(
    automaticWorkerDiagnosticPath(projectRoot, sessionStorageKey)
  );
}

function writeTextAtomically(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, value, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    renameSync(temporaryPath, path);
  } catch (error) {
    removeIfPresent(temporaryPath);
    throw error;
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function removeIfPresent(path: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // Preserve the originating failure.
  }
}

function isMissingPathError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
