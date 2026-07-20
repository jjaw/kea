import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { AnalysisSchema } from "./analysis-definitions.ts";
import { serializeJson } from "./analysis-run-store.ts";
import { ValidationSummarySchema } from "./analysis-validator.ts";
import {
  FinalSessionDispositionSchema,
  StructuralSessionReceiptSchema,
  type FinalSessionDisposition,
  type StructuralSessionReceipt
} from "./session-disposition.ts";

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type PersistedSessionDisposition = {
  disposition: FinalSessionDisposition;
  storageKey: string;
  path: string;
};

export function persistLatestSessionDisposition(
  projectRoot: string,
  dispositionInput: FinalSessionDisposition
): PersistedSessionDisposition {
  const root = realpathSync(projectRoot);
  const disposition = FinalSessionDispositionSchema.parse(dispositionInput);
  validateReferencedArtifacts(root, disposition);
  const storageKey = sessionDispositionStorageKey(disposition.receipt);
  const path = join(
    root,
    ".codex-observer",
    "session-dispositions",
    storageKey,
    "latest.json"
  );

  writeJsonAtomically(path, disposition);
  return { disposition, storageKey, path };
}

export function readLatestSessionDisposition(
  projectRoot: string,
  identityInput: Pick<
    StructuralSessionReceipt,
    "sessionId" | "evidenceStateHash"
  >
): PersistedSessionDisposition | null {
  const root = realpathSync(projectRoot);
  const identity = StructuralSessionReceiptSchema.pick({
    sessionId: true,
    evidenceStateHash: true
  }).parse({
    sessionId: identityInput.sessionId,
    evidenceStateHash: identityInput.evidenceStateHash
  });
  const storageKey = sessionDispositionStorageKey(identity);
  const path = join(
    root,
    ".codex-observer",
    "session-dispositions",
    storageKey,
    "latest.json"
  );
  if (!existsSync(path)) return null;
  const disposition = FinalSessionDispositionSchema.parse(
    JSON.parse(readFileSync(path, "utf8"))
  );
  return { disposition, storageKey, path };
}

export function sessionDispositionStorageKey(
  identityInput: Pick<
    StructuralSessionReceipt,
    "sessionId" | "evidenceStateHash"
  >
): string {
  const identity = StructuralSessionReceiptSchema.pick({
    sessionId: true,
    evidenceStateHash: true
  }).parse({
    sessionId: identityInput.sessionId,
    evidenceStateHash: identityInput.evidenceStateHash
  });
  if (identity.sessionId === null) {
    return `ungrouped-${identity.evidenceStateHash}`;
  }
  if (SAFE_SESSION_ID.test(identity.sessionId)) {
    return identity.sessionId;
  }
  return `session-${createHash("sha256")
    .update(identity.sessionId, "utf8")
    .digest("hex")}`;
}

function validateReferencedArtifacts(
  root: string,
  disposition: FinalSessionDisposition
): void {
  if (disposition.kind === "full_report") {
    const runDirectory = analysisRunDirectory(
      root,
      disposition.validatedRun.runId
    );
    requireDirectory(runDirectory, "Validated analysis run directory");
    const analysisPath = join(
      runDirectory,
      disposition.validatedRun.analysisArtifact
    );
    const validationSummaryPath = join(
      runDirectory,
      disposition.validatedRun.validationSummaryArtifact
    );
    const analysis = readJsonFile(analysisPath, "Validated analysis artifact");
    AnalysisSchema.parse(analysis);
    const validationSummary = ValidationSummarySchema.parse(
      readJsonFile(validationSummaryPath, "Validation summary artifact")
    );
    if (validationSummary.runId !== disposition.validatedRun.runId) {
      throw new Error(
        "Validation summary run id does not match the disposition run id"
      );
    }
    const rendered = disposition.validatedRun.renderedArtifacts;
    if (rendered?.markdown !== undefined) {
      requireFile(join(runDirectory, rendered.markdown), "Markdown report artifact");
    }
    if (rendered?.html !== undefined) {
      requireFile(join(runDirectory, rendered.html), "HTML report artifact");
    }
    return;
  }

  if (
    disposition.kind === "analysis_failed" &&
    disposition.analysisRun !== undefined
  ) {
    requireDirectory(
      analysisRunDirectory(root, disposition.analysisRun.runId),
      "Analysis run directory"
    );
  }
}

function analysisRunDirectory(root: string, runId: string): string {
  return join(root, ".codex-observer", "analysis-runs", runId);
}

function readJsonFile(path: string, label: string): unknown {
  requireFile(path, label);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function requireFile(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function requireDirectory(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, serializeJson(value), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    renameSync(temporaryPath, path);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the original persistence error.
      }
    }
    throw error;
  }
}
