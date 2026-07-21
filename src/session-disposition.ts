import { createHash } from "node:crypto";
import { z } from "zod";
import {
  EvidenceBundleSchema,
  measureEvidenceCorpus,
  type EvidenceBundle,
  type EvidenceCorpusStatus,
  type EvidenceItem
} from "./evidence-bundle.ts";
import { SESSION_ELIGIBILITY_THRESHOLDS } from "./session-disposition-config.ts";

export const AUTOMATIC_ANALYZE_REASONS = [
  "git_change_with_result_activity",
  "substantial_structural_investigation"
] as const;
export const ACTIVITY_ONLY_REASONS = [
  "insufficient_structural_evidence"
] as const;
export const BLOCKED_REASONS = [
  "bundle_too_large",
  "automatic_analysis_not_enabled",
  "missing_api_key"
] as const;
export const FULL_REPORT_REASONS = ["validated_analysis_available"] as const;
export const ANALYSIS_FAILURE_REASONS = [
  "request_failed",
  "refusal",
  "incomplete",
  "missing_parsed_output",
  "schema_invalid",
  "validation_failed",
  "report_generation_failed",
  "analysis_artifact_persistence_failed"
] as const;

export const AutomaticAnalyzeReasonSchema = z.enum(AUTOMATIC_ANALYZE_REASONS);
export const ActivityOnlyReasonSchema = z.enum(ACTIVITY_ONLY_REASONS);
export const BlockedReasonSchema = z.enum(BLOCKED_REASONS);
export const FullReportReasonSchema = z.enum(FULL_REPORT_REASONS);
export const AnalysisFailureReasonSchema = z.enum(ANALYSIS_FAILURE_REASONS);

export const SafeAnalysisRunIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/, "Invalid analysis run id");

export const EvidenceCorpusStatusSchema = z
  .object({
    serializedCorpusBytes: z.number().int().nonnegative(),
    requestBudgetBytes: z.number().int().nonnegative(),
    totalEvidenceCount: z.number().int().nonnegative(),
    retainedEvidenceCount: z.number().int().nonnegative(),
    omittedEvidenceCount: z.number().int().nonnegative(),
    eligibleForSingleRequest: z.boolean()
  })
  .strict();

const ReceiptCountsSchema = z
  .object({
    humanMessages: z.number().int().nonnegative(),
    assistantMessages: z.number().int().nonnegative(),
    toolAttempts: z.number().int().nonnegative(),
    toolResults: z.number().int().nonnegative(),
    gitSnapshots: z.number().int().nonnegative(),
    matchedToolResults: z.number().int().nonnegative(),
    observableStructuredErrorResults: z.number().int().nonnegative(),
    distinctTurns: z.number().int().nonnegative()
  })
  .strict();

const CHANGED_SNAPSHOT_RESULT_DESCRIPTION =
  "Counts matched tool results occurring between consecutive Git snapshots whose observable Git state differs. This demonstrates result activity during the observed change window; it does not prove verification or that the result occurred after the repository change.";

export const StructuralSessionReceiptSchema = z
  .object({
    sessionId: z.string().nullable(),
    evidenceStateHash: z.string().regex(/^[a-f0-9]{64}$/),
    evaluatedAt: z.string().datetime({ offset: true }),
    lastObservedActivityAt: z.string().min(1).nullable(),
    corpus: EvidenceCorpusStatusSchema,
    counts: ReceiptCountsSchema,
    gitStateChangedBetweenSnapshots: z.boolean(),
    matchedResultsBetweenChangedSnapshots: z
      .number()
      .int()
      .nonnegative()
      .describe(CHANGED_SNAPSHOT_RESULT_DESCRIPTION),
    hasMatchedResultsBetweenChangedSnapshots: z
      .boolean()
      .describe(CHANGED_SNAPSHOT_RESULT_DESCRIPTION)
  })
  .strict();

const RenderedArtifactsSchema = z
  .object({
    markdown: z.literal("report.md").optional(),
    html: z.literal("report.html").optional()
  })
  .strict()
  .refine((value) => value.markdown !== undefined || value.html !== undefined, {
    message: "At least one rendered artifact must be referenced"
  });

export const ValidatedRunReferenceSchema = z
  .object({
    runId: SafeAnalysisRunIdSchema,
    analysisArtifact: z.literal("analysis.json"),
    validationSummaryArtifact: z.literal("validation-summary.json"),
    renderedArtifacts: RenderedArtifactsSchema.optional()
  })
  .strict();

export const AnalysisRunReferenceSchema = z
  .object({ runId: SafeAnalysisRunIdSchema })
  .strict();

const DispositionSchemaVersion = z
  .literal(1)
  .describe(
    "Schema version for the complete persisted disposition document, including its nested structural receipt."
  );

export const ActivityOnlyDispositionSchema = z
  .object({
    schemaVersion: DispositionSchemaVersion,
    kind: z.literal("activity_only"),
    reason: ActivityOnlyReasonSchema,
    receipt: StructuralSessionReceiptSchema
  })
  .strict();

export const BlockedDispositionSchema = z
  .object({
    schemaVersion: DispositionSchemaVersion,
    kind: z.literal("blocked"),
    reason: BlockedReasonSchema,
    receipt: StructuralSessionReceiptSchema
  })
  .strict();

export const FullReportDispositionSchema = z
  .object({
    schemaVersion: DispositionSchemaVersion,
    kind: z.literal("full_report"),
    reason: FullReportReasonSchema,
    receipt: StructuralSessionReceiptSchema,
    validatedRun: ValidatedRunReferenceSchema
  })
  .strict();

export const AnalysisFailedDispositionSchema = z
  .object({
    schemaVersion: DispositionSchemaVersion,
    kind: z.literal("analysis_failed"),
    reason: AnalysisFailureReasonSchema,
    receipt: StructuralSessionReceiptSchema,
    analysisRun: AnalysisRunReferenceSchema.optional()
  })
  .strict();

export const FinalSessionDispositionSchema = z
  .discriminatedUnion("kind", [
    FullReportDispositionSchema,
    ActivityOnlyDispositionSchema,
    BlockedDispositionSchema,
    AnalysisFailedDispositionSchema
  ])
  .describe(
    "Latest final session disposition. Its outer schemaVersion governs the entire document, including the nested receipt."
  );

export const AutomaticAnalysisEnvironmentSchema = z
  .object({
    automaticAnalysisEnabled: z.boolean(),
    apiKeyAvailable: z.boolean()
  })
  .strict();

export const AutomaticAnalysisDecisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("analyze"),
      reason: AutomaticAnalyzeReasonSchema,
      receipt: StructuralSessionReceiptSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("activity_only"),
      reason: ActivityOnlyReasonSchema,
      receipt: StructuralSessionReceiptSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("blocked"),
      reason: BlockedReasonSchema,
      receipt: StructuralSessionReceiptSchema
    })
    .strict()
]);

export type StructuralSessionReceipt = z.infer<
  typeof StructuralSessionReceiptSchema
>;
export type AutomaticAnalysisEnvironment = z.infer<
  typeof AutomaticAnalysisEnvironmentSchema
>;
export type AutomaticAnalysisDecision = z.infer<
  typeof AutomaticAnalysisDecisionSchema
>;
export type FinalSessionDisposition = z.infer<
  typeof FinalSessionDispositionSchema
>;
export type ActivityOnlyDisposition = z.infer<
  typeof ActivityOnlyDispositionSchema
>;
export type BlockedDisposition = z.infer<typeof BlockedDispositionSchema>;
export type FullReportDisposition = z.infer<
  typeof FullReportDispositionSchema
>;
export type AnalysisFailedDisposition = z.infer<
  typeof AnalysisFailedDispositionSchema
>;
export type ValidatedRunReference = z.infer<
  typeof ValidatedRunReferenceSchema
>;
export type AnalysisFailureReason = z.infer<typeof AnalysisFailureReasonSchema>;
export type StructuralAutomaticAnalysisDecision =
  | Extract<AutomaticAnalysisDecision, { kind: "activity_only" | "blocked" }>
  | {
      kind: "eligible";
      reason: z.infer<typeof AutomaticAnalyzeReasonSchema>;
      receipt: StructuralSessionReceipt;
    };

export function assessAutomaticAnalysis(options: {
  bundle: EvidenceBundle;
  corpusStatus: EvidenceCorpusStatus;
  environment: AutomaticAnalysisEnvironment;
  evaluatedAt: string;
}): AutomaticAnalysisDecision {
  const structuralDecision = assessAutomaticAnalysisStructure(options);
  if (structuralDecision.kind !== "eligible") {
    return AutomaticAnalysisDecisionSchema.parse(structuralDecision);
  }
  const environment = AutomaticAnalysisEnvironmentSchema.parse(
    options.environment
  );
  if (!environment.automaticAnalysisEnabled) {
    return AutomaticAnalysisDecisionSchema.parse({
      kind: "blocked",
      reason: "automatic_analysis_not_enabled",
      receipt: structuralDecision.receipt
    });
  }
  if (!environment.apiKeyAvailable) {
    return AutomaticAnalysisDecisionSchema.parse({
      kind: "blocked",
      reason: "missing_api_key",
      receipt: structuralDecision.receipt
    });
  }
  return AutomaticAnalysisDecisionSchema.parse({
    kind: "analyze",
    reason: structuralDecision.reason,
    receipt: structuralDecision.receipt
  });
}

export function assessAutomaticAnalysisStructure(options: {
  bundle: EvidenceBundle;
  corpusStatus: EvidenceCorpusStatus;
  evaluatedAt: string;
}): StructuralAutomaticAnalysisDecision {
  const bundle = EvidenceBundleSchema.parse(options.bundle);
  const corpusStatus = validateCorpusStatus(bundle, options.corpusStatus);
  const receipt = buildStructuralSessionReceipt(
    bundle,
    corpusStatus,
    options.evaluatedAt
  );
  const eligibilityReason = structuralEligibilityReason(receipt);

  if (eligibilityReason === null) {
    const decision = AutomaticAnalysisDecisionSchema.parse({
      kind: "activity_only",
      reason: "insufficient_structural_evidence",
      receipt
    });
    if (decision.kind !== "activity_only") {
      throw new Error("Structural activity decision parsed inconsistently");
    }
    return decision;
  }
  if (!corpusStatus.eligibleForSingleRequest) {
    const decision = AutomaticAnalysisDecisionSchema.parse({
      kind: "blocked",
      reason: "bundle_too_large",
      receipt
    });
    if (decision.kind !== "blocked") {
      throw new Error("Structural blocked decision parsed inconsistently");
    }
    return decision;
  }
  return {
    kind: "eligible",
    reason: eligibilityReason,
    receipt
  };
}

export function buildStructuralSessionReceipt(
  bundleInput: EvidenceBundle,
  corpusStatusInput: EvidenceCorpusStatus,
  evaluatedAt: string
): StructuralSessionReceipt {
  const bundle = EvidenceBundleSchema.parse(bundleInput);
  const corpusStatus = validateCorpusStatus(bundle, corpusStatusInput);
  const sourceCounts = countSourceClasses(bundle.evidence);
  const matchedResultIds = matchedToolResultIds(bundle.evidence);
  const intervalFacts = changedSnapshotIntervalFacts(
    bundle.evidence,
    matchedResultIds
  );

  return StructuralSessionReceiptSchema.parse({
    sessionId: bundle.session.sessionId,
    evidenceStateHash: computeEvidenceStateHash(bundle),
    evaluatedAt,
    lastObservedActivityAt: bundle.session.lastObservedAt,
    corpus: corpusStatus,
    counts: {
      humanMessages: sourceCounts.human_message,
      assistantMessages: sourceCounts.assistant_message,
      toolAttempts: sourceCounts.tool_attempt,
      toolResults: sourceCounts.tool_result,
      gitSnapshots: sourceCounts.git_snapshot,
      matchedToolResults: matchedResultIds.size,
      observableStructuredErrorResults: bundle.evidence.filter(
        (item) =>
          item.sourceClass === "tool_result" &&
          (item.structuralFacts.errorIndicators?.length ?? 0) > 0
      ).length,
      distinctTurns: new Set(
        bundle.evidence.flatMap((item) =>
          item.turnId === null ? [] : [item.turnId]
        )
      ).size
    },
    ...intervalFacts
  });
}

export function computeEvidenceStateHash(bundleInput: EvidenceBundle): string {
  const bundle = EvidenceBundleSchema.parse(bundleInput);
  const projection = {
    schemaVersion: bundle.schemaVersion,
    session: {
      sessionId: bundle.session.sessionId,
      firstObservedAt: bundle.session.firstObservedAt,
      lastObservedAt: bundle.session.lastObservedAt,
      cwd: bundle.session.cwd,
      model: bundle.session.model
    },
    evidence: bundle.evidence.map((item) => ({
      id: item.id,
      sourceClass: item.sourceClass,
      timestamp: item.timestamp,
      turnId: item.turnId,
      content: item.content,
      structuralFacts: projectStructuralFacts(item)
    }))
  };

  // EvidenceBundle diagnostics are currently display strings, not structured
  // stable diagnostic fields. They are deliberately excluded until the bundle
  // exposes a structured captured-evidence diagnostic schema.
  return createHash("sha256")
    .update(canonicalJson(projection), "utf8")
    .digest("hex");
}

export function finalDispositionFromDecision(
  decisionInput: Exclude<AutomaticAnalysisDecision, { kind: "analyze" }>
): ActivityOnlyDisposition | BlockedDisposition {
  const decision = AutomaticAnalysisDecisionSchema.parse(decisionInput);
  if (decision.kind === "analyze") {
    throw new Error("An analyze decision is not a final session disposition");
  }
  if (decision.kind === "activity_only") {
    return ActivityOnlyDispositionSchema.parse({
      schemaVersion: 1,
      kind: decision.kind,
      reason: decision.reason,
      receipt: decision.receipt
    });
  }
  return BlockedDispositionSchema.parse({
    schemaVersion: 1,
    kind: decision.kind,
    reason: decision.reason,
    receipt: decision.receipt
  });
}

export function createFullReportDisposition(
  receipt: StructuralSessionReceipt,
  validatedRun: ValidatedRunReference
): FullReportDisposition {
  return FullReportDispositionSchema.parse({
    schemaVersion: 1,
    kind: "full_report",
    reason: "validated_analysis_available",
    receipt,
    validatedRun
  });
}

export function createAnalysisFailedDisposition(
  receipt: StructuralSessionReceipt,
  reason: AnalysisFailureReason,
  analysisRun?: z.input<typeof AnalysisRunReferenceSchema>
): AnalysisFailedDisposition {
  return AnalysisFailedDispositionSchema.parse({
    schemaVersion: 1,
    kind: "analysis_failed",
    reason,
    receipt,
    ...(analysisRun === undefined ? {} : { analysisRun })
  });
}

function validateCorpusStatus(
  bundle: EvidenceBundle,
  statusInput: EvidenceCorpusStatus
): EvidenceCorpusStatus {
  const status = EvidenceCorpusStatusSchema.parse(statusInput);
  const measured = measureEvidenceCorpus(bundle, status.requestBudgetBytes);
  if (JSON.stringify(status) !== JSON.stringify(measured)) {
    throw new Error("Evidence corpus status does not match the sanitized bundle");
  }
  return status;
}

function structuralEligibilityReason(
  receipt: StructuralSessionReceipt
): z.infer<typeof AutomaticAnalyzeReasonSchema> | null {
  const thresholds = SESSION_ELIGIBILITY_THRESHOLDS;
  if (
    receipt.matchedResultsBetweenChangedSnapshots >=
    thresholds.minimumMatchedResultsBetweenChangedSnapshots
  ) {
    return "git_change_with_result_activity";
  }
  if (
    receipt.counts.humanMessages >=
      thresholds.minimumHumanMessagesForInvestigation &&
    receipt.counts.distinctTurns >=
      thresholds.minimumDistinctTurnsForInvestigation &&
    receipt.counts.matchedToolResults >=
      thresholds.minimumMatchedToolResultsForInvestigation &&
    receipt.counts.observableStructuredErrorResults >=
      thresholds.minimumObservableErrorResultsForInvestigation
  ) {
    return "substantial_structural_investigation";
  }
  return null;
}

function countSourceClasses(evidence: EvidenceBundle["evidence"]): Record<
  EvidenceItem["sourceClass"],
  number
> {
  const counts: Record<EvidenceItem["sourceClass"], number> = {
    session_event: 0,
    human_message: 0,
    assistant_message: 0,
    tool_attempt: 0,
    tool_result: 0,
    git_snapshot: 0
  };
  for (const item of evidence) {
    counts[item.sourceClass] += 1;
  }
  return counts;
}

function matchedToolResultIds(
  evidence: EvidenceBundle["evidence"]
): Set<string> {
  const attempts = new Map(
    evidence
      .filter((item) => item.sourceClass === "tool_attempt")
      .map((item) => [item.id, item.structuralFacts.sequence])
  );
  return new Set(
    evidence.flatMap((item) => {
      if (item.sourceClass !== "tool_result") return [];
      const matchedId = item.structuralFacts.matchedEvidenceId;
      const attemptSequence = matchedId ? attempts.get(matchedId) : undefined;
      return attemptSequence !== undefined &&
        attemptSequence < item.structuralFacts.sequence
        ? [item.id]
        : [];
    })
  );
}

const GitSnapshotContentSchema = z
  .object({
    head: z.string().nullable(),
    branch: z.string().nullable(),
    status: z.string().nullable(),
    diff: z.string().nullable(),
    errors: z.array(z.string())
  })
  .strict();

type ParsedGitSnapshot = {
  sequence: number;
  state: {
    head: string | null;
    branch: string | null;
    status: string | null;
    diff: string | null;
  } | null;
};

function changedSnapshotIntervalFacts(
  evidence: EvidenceBundle["evidence"],
  matchedResultIds: ReadonlySet<string>
): Pick<
  StructuralSessionReceipt,
  | "gitStateChangedBetweenSnapshots"
  | "matchedResultsBetweenChangedSnapshots"
  | "hasMatchedResultsBetweenChangedSnapshots"
> {
  const snapshots: ParsedGitSnapshot[] = evidence
    .filter((item) => item.sourceClass === "git_snapshot")
    .map((item) => {
      const parsed = GitSnapshotContentSchema.safeParse(item.content);
      return {
        sequence: item.structuralFacts.sequence,
        state: parsed.success
          ? {
              head: parsed.data.head,
              branch: parsed.data.branch,
              status: parsed.data.status,
              diff: parsed.data.diff
            }
          : null
      };
    });
  const resultsInChangedIntervals = new Set<string>();
  let gitStateChangedBetweenSnapshots = false;

  // Counts matched tool results occurring between consecutive Git snapshots
  // whose observable Git state differs. This demonstrates result activity
  // during the observed change window; it does not prove verification or that
  // the result occurred after the repository change.
  for (let index = 1; index < snapshots.length; index += 1) {
    const before = snapshots[index - 1];
    const after = snapshots[index];
    if (
      before === undefined ||
      after === undefined ||
      before.state === null ||
      after.state === null ||
      canonicalJson(before.state) === canonicalJson(after.state)
    ) {
      continue;
    }
    gitStateChangedBetweenSnapshots = true;
    for (const item of evidence) {
      if (
        matchedResultIds.has(item.id) &&
        item.structuralFacts.sequence > before.sequence &&
        item.structuralFacts.sequence <= after.sequence
      ) {
        resultsInChangedIntervals.add(item.id);
      }
    }
  }

  const matchedResultsBetweenChangedSnapshots =
    resultsInChangedIntervals.size;
  return {
    gitStateChangedBetweenSnapshots,
    matchedResultsBetweenChangedSnapshots,
    hasMatchedResultsBetweenChangedSnapshots:
      matchedResultsBetweenChangedSnapshots > 0
  };
}

function projectStructuralFacts(item: EvidenceItem): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    sequence: item.structuralFacts.sequence
  };
  for (const field of [
    "toolUseId",
    "matchedEvidenceId",
    "errorIndicators",
    "promptOrdinal",
    "assistantMessageOrdinal"
  ] as const) {
    const value = item.structuralFacts[field];
    if (value !== undefined) projected[field] = value;
  }
  return projected;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error(`Canonical JSON cannot represent ${typeof value}`);
}
