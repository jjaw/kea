import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AnalysisProvider } from "../src/analysis-provider.ts";
import { AnalysisRunStageError } from "../src/analysis-run-store.ts";
import {
  acquireAutomaticSessionLock,
  AUTOMATIC_WORKER_ERROR_CODES,
  AUTOMATIC_WORKER_STAGES,
  clearAutomaticWorkerDiagnostic,
  clearPendingSessionMarkerIfCurrent,
  pendingSessionTokenIsCurrent,
  persistAutomaticWorkerDiagnostic,
  releaseAutomaticSessionLock,
  SafeSessionStorageKeySchema,
  type AutomaticWorkerDiagnostic
} from "../src/automatic-session-store.ts";
import { readCodexSessionFile } from "../src/codex-session-adapter.ts";
import {
  buildEvidenceBundle,
  measureEvidenceCorpus,
  type EvidenceBundle
} from "../src/evidence-bundle.ts";
import { OpenAIAnalysisProvider } from "../src/openai-analysis-provider.ts";
import {
  persistOversizedAnalysisRun,
  runProviderAnalysisForBundle,
  type ProviderAnalysisRunResult
} from "../src/provider-analysis-run.ts";
import { rebuildStaticReportIndex } from "../src/report-index.ts";
import {
  automaticAnalysisEnabled,
  automaticQuietIntervalMs
} from "../src/session-disposition-config.ts";
import {
  assessAutomaticAnalysis,
  assessAutomaticAnalysisStructure,
  buildStructuralSessionReceipt,
  createAnalysisFailedDisposition,
  createFullReportDisposition,
  finalDispositionFromDecision,
  type AnalysisFailureReason,
  type FinalSessionDisposition,
  type StructuralSessionReceipt
} from "../src/session-disposition.ts";
import {
  persistLatestSessionDisposition,
  readLatestSessionDisposition
} from "../src/session-disposition-store.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

type WorkerStage = (typeof AUTOMATIC_WORKER_STAGES)[number];
type WorkerErrorCode = (typeof AUTOMATIC_WORKER_ERROR_CODES)[number];

export type AutomaticSessionWorkerResult =
  | {
      kind: "settled";
      dispositionKind: FinalSessionDisposition["kind"];
      indexPath: string;
    }
  | { kind: "superseded" }
  | { kind: "lock_unavailable" }
  | { kind: "deduplicated"; dispositionKind: FinalSessionDisposition["kind"] }
  | { kind: "worker_failed"; stage: WorkerStage };

export type WorkerDependencies = {
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  providerFactory?: (apiKey: string) => AnalysisProvider;
  runProviderAnalysis?: typeof runProviderAnalysisForBundle;
  persistDisposition?: typeof persistLatestSessionDisposition;
  rebuildIndex?: typeof rebuildStaticReportIndex;
};

export async function runAutomaticSessionWorker(options: {
  projectRoot: string;
  sessionStorageKey: string;
  pendingToken: string;
  environment?: NodeJS.ProcessEnv;
  requestBudgetBytes?: number;
  dependencies?: WorkerDependencies;
}): Promise<AutomaticSessionWorkerResult> {
  const sessionStorageKey = SafeSessionStorageKeySchema.parse(
    options.sessionStorageKey
  );
  const pendingToken = z.string().uuid().parse(options.pendingToken);
  const projectRoot = realpathSync(options.projectRoot);
  const environment = options.environment ?? process.env;
  const dependencies = options.dependencies ?? {};
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const persistDisposition =
    dependencies.persistDisposition ?? persistLatestSessionDisposition;
  const rebuildIndex = dependencies.rebuildIndex ?? rebuildStaticReportIndex;
  let stage: WorkerStage = "worker_startup";
  let lockPath: string | null = null;
  let shouldClearPending = false;
  let finalDispositionPersisted = false;
  let analysisAttemptStarted = false;
  let providerConstructed = false;
  let receipt: StructuralSessionReceipt | null = null;
  let diagnosticWritten = false;

  const writeDiagnostic = (
    diagnosticStage: WorkerStage,
    errorCode: WorkerErrorCode,
    runId?: string
  ): void => {
    const diagnostic: AutomaticWorkerDiagnostic = {
      schemaVersion: 1,
      timestamp: now().toISOString(),
      stage: diagnosticStage,
      errorCode,
      sessionStorageKey,
      pendingToken,
      ...(runId === undefined ? {} : { runId })
    };
    try {
      persistAutomaticWorkerDiagnostic(projectRoot, diagnostic);
      diagnosticWritten = true;
    } catch {
      // There is deliberately no secondary logging system.
    }
  };

  const tokenIsCurrent = (): boolean =>
    pendingSessionTokenIsCurrent(
      projectRoot,
      sessionStorageKey,
      pendingToken
    );

  const settleDisposition = (
    disposition: FinalSessionDisposition
  ): AutomaticSessionWorkerResult => {
    stage = "disposition_persistence";
    persistDisposition(projectRoot, disposition);
    finalDispositionPersisted = true;
    stage = "report_index_rebuild";
    const rebuilt = rebuildIndex(projectRoot, now());
    shouldClearPending = true;
    if (!diagnosticWritten) {
      try {
        clearAutomaticWorkerDiagnostic(projectRoot, sessionStorageKey);
      } catch {
        // A stale diagnostic is preferable to compromising settlement.
      }
    }
    return {
      kind: "settled",
      dispositionKind: disposition.kind,
      indexPath: rebuilt.path
    };
  };

  try {
    await sleep(automaticQuietIntervalMs(environment));
    stage = "pending_verification";
    if (!tokenIsCurrent()) return { kind: "superseded" };

    stage = "lock_acquisition";
    lockPath = acquireAutomaticSessionLock(projectRoot, sessionStorageKey);
    if (lockPath === null) return { kind: "lock_unavailable" };
    stage = "pending_verification";
    if (!tokenIsCurrent()) return { kind: "superseded" };

    stage = "bundle_loading";
    const bundle = loadEvidenceBundle(projectRoot, sessionStorageKey);
    const corpusStatus = measureEvidenceCorpus(
      bundle,
      options.requestBudgetBytes
    );
    const evaluatedAt = now().toISOString();
    receipt = buildStructuralSessionReceipt(
      bundle,
      corpusStatus,
      evaluatedAt
    );

    const latest = readLatestSessionDisposition(projectRoot, receipt);
    if (isSameEvidenceAlreadySettled(latest?.disposition ?? null, receipt)) {
      shouldClearPending = true;
      return {
        kind: "deduplicated",
        dispositionKind: latest!.disposition.kind
      };
    }

    stage = "session_assessment";
    const structuralDecision = assessAutomaticAnalysisStructure({
      bundle,
      corpusStatus,
      evaluatedAt
    });

    if (structuralDecision.kind !== "eligible") {
      if (
        structuralDecision.kind === "blocked" &&
        structuralDecision.reason === "bundle_too_large"
      ) {
        try {
          persistOversizedAnalysisRun(
            projectRoot,
            bundle,
            sessionStorageKey,
            corpusStatus
          );
        } catch {
          writeDiagnostic(
            "session_assessment",
            "worker_failed_before_disposition"
          );
        }
      }
      stage = "pending_verification";
      if (!tokenIsCurrent()) return { kind: "superseded" };
      return settleDisposition(
        finalDispositionFromDecision(structuralDecision)
      );
    }

    const apiKey = environment.OPENAI_API_KEY?.trim() ?? "";
    const decision = assessAutomaticAnalysis({
      bundle,
      corpusStatus,
      environment: {
        automaticAnalysisEnabled: automaticAnalysisEnabled(environment),
        apiKeyAvailable: apiKey !== ""
      },
      evaluatedAt
    });
    if (decision.kind !== "analyze") {
      stage = "pending_verification";
      if (!tokenIsCurrent()) return { kind: "superseded" };
      return settleDisposition(finalDispositionFromDecision(decision));
    }

    stage = "pending_verification";
    if (!tokenIsCurrent()) return { kind: "superseded" };
    analysisAttemptStarted = true;
    stage = "provider_analysis";
    const provider = dependencies.providerFactory
      ? dependencies.providerFactory(apiKey)
      : new OpenAIAnalysisProvider({ apiKey });
    providerConstructed = true;
    const providerRun = await (
      dependencies.runProviderAnalysis ?? runProviderAnalysisForBundle
    )({
      projectRoot,
      bundle,
      selector: sessionStorageKey,
      provider,
      now: new Date(evaluatedAt),
      corpusStatus
    });

    stage = "pending_verification";
    if (!tokenIsCurrent()) return { kind: "superseded" };
    if (providerRun.kind === "failure") {
      const failureDisposition = createAnalysisFailedDisposition(
        decision.receipt,
        providerFailureReason(providerRun),
        { runId: providerRun.artifacts.runId }
      );
      return settleDisposition(failureDisposition);
    }

    return settleDisposition(
      createFullReportDisposition(decision.receipt, {
        runId: providerRun.artifacts.runId,
        analysisArtifact: "analysis.json",
        validationSummaryArtifact: "validation-summary.json",
        renderedArtifacts: {
          markdown: "report.md",
          html: "report.html"
        }
      })
    );
  } catch (error) {
    const failedStage: WorkerStage = stage;
    const errorCode = workerErrorCodeForStage(failedStage);
    writeDiagnostic(failedStage, errorCode);
    shouldClearPending = true;

    if (
      analysisAttemptStarted &&
      receipt !== null &&
      !finalDispositionPersisted
    ) {
      try {
        if (tokenIsCurrent()) {
          const failureDisposition = createAnalysisFailedDisposition(
            receipt,
            exceptionFailureReason(error, providerConstructed)
          );
          stage = "disposition_persistence";
          persistDisposition(projectRoot, failureDisposition);
          finalDispositionPersisted = true;
          stage = "report_index_rebuild";
          rebuildIndex(projectRoot, now());
        }
      } catch {
        writeDiagnostic(
          stage,
          stage === "report_index_rebuild"
            ? "report_index_rebuild_failed"
            : "analysis_failure_persistence_failed"
        );
      }
    }

    return { kind: "worker_failed", stage: failedStage };
  } finally {
    if (shouldClearPending) {
      stage = "pending_cleanup";
      try {
        clearPendingSessionMarkerIfCurrent(
          projectRoot,
          sessionStorageKey,
          pendingToken
        );
      } catch {
        writeDiagnostic("pending_cleanup", "pending_cleanup_failed");
      }
    }
    if (lockPath !== null) {
      stage = "lock_release";
      try {
        releaseAutomaticSessionLock(lockPath);
      } catch {
        writeDiagnostic("lock_release", "lock_release_failed");
      }
    }
  }
}

function loadEvidenceBundle(
  projectRoot: string,
  sessionStorageKey: string
): EvidenceBundle {
  const sessionFile = join(
    projectRoot,
    ".codex-observer",
    "sessions",
    sessionStorageKey,
    "events.jsonl"
  );
  if (!existsSync(sessionFile)) {
    throw new Error(`No recording found for automatic session ${sessionStorageKey}`);
  }
  const session = readCodexSessionFile(sessionFile);
  if (session.events.length === 0) {
    throw new Error(`No valid hook events found for automatic session ${sessionStorageKey}`);
  }
  return buildEvidenceBundle(session);
}

function isSameEvidenceAlreadySettled(
  disposition: FinalSessionDisposition | null,
  receipt: StructuralSessionReceipt
): boolean {
  if (
    disposition === null ||
    disposition.receipt.evidenceStateHash !== receipt.evidenceStateHash
  ) {
    return false;
  }
  return !(
    disposition.kind === "blocked" &&
    (disposition.reason === "automatic_analysis_not_enabled" ||
      disposition.reason === "missing_api_key")
  );
}

function providerFailureReason(
  result: Extract<ProviderAnalysisRunResult, { kind: "failure" }>
): AnalysisFailureReason {
  if (result.failureKind === "bundle_too_large") {
    throw new Error("An assessed eligible bundle became oversized unexpectedly");
  }
  return result.failureKind;
}

function exceptionFailureReason(
  error: unknown,
  providerConstructed: boolean
): AnalysisFailureReason {
  if (!providerConstructed) return "request_failed";
  if (error instanceof AnalysisRunStageError) {
    return error.stage === "validated_artifact_persistence"
      ? "analysis_artifact_persistence_failed"
      : "report_generation_failed";
  }
  return "validation_failed";
}

function workerErrorCodeForStage(stage: WorkerStage): WorkerErrorCode {
  if (stage === "report_index_rebuild") {
    return "report_index_rebuild_failed";
  }
  if (stage === "disposition_persistence") {
    return "disposition_persistence_failed";
  }
  return "worker_failed_before_disposition";
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function main(): Promise<void> {
  const [sessionStorageKey, pendingToken, ...extra] = process.argv.slice(2);
  if (
    sessionStorageKey === undefined ||
    pendingToken === undefined ||
    extra.length > 0
  ) {
    return;
  }
  await runAutomaticSessionWorker({
    projectRoot: PROJECT_ROOT,
    sessionStorageKey,
    pendingToken,
    environment: process.env
  });
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  void main();
}
