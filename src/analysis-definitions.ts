import { z } from "zod";

export const SOURCE_CLASSES = [
  "session_event",
  "human_message",
  "assistant_message",
  "tool_attempt",
  "tool_result",
  "git_snapshot"
] as const;

export const EVIDENCE_BASES = ["observed", "explicit", "inference", "unknown"] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const APPROACH_STATUSES = [
  "ongoing",
  "failed",
  "abandoned",
  "completed",
  "unknown"
] as const;
export const OUTCOME_SUPPORT_VALUES = [
  "reported_only",
  "independently_supported",
  "contradicted",
  "unknown"
] as const;
export const HUMAN_INTERVENTION_CATEGORIES = [
  "correction",
  "constraint",
  "decision",
  "clarification",
  "approval",
  "follow-up task",
  "question",
  "status request",
  "other"
] as const;

export const ACTIVITY_SOURCE_CLASSES = [
  "tool_attempt",
  "tool_result",
  "git_snapshot"
] as const satisfies ReadonlyArray<(typeof SOURCE_CLASSES)[number]>;
export const OBSERVED_SOURCE_CLASSES = [
  "session_event",
  ...ACTIVITY_SOURCE_CLASSES
] as const satisfies ReadonlyArray<(typeof SOURCE_CLASSES)[number]>;
export const EXPLICIT_SOURCE_CLASSES = [
  "human_message",
  "assistant_message"
] as const satisfies ReadonlyArray<(typeof SOURCE_CLASSES)[number]>;
export const CODEX_CONTRIBUTION_SOURCE_CLASSES = [
  "tool_attempt",
  "tool_result",
  "assistant_message"
] as const satisfies ReadonlyArray<(typeof SOURCE_CLASSES)[number]>;

export const EVIDENCE_BASIS_SEMANTICS =
  "observed: supported by activity or state evidence; explicit: directly stated in a human or assistant message; inference: reasoned from multiple cited evidence items; unknown: the available evidence is insufficient.";

export const APPROACH_STATUS_SEMANTICS =
  "ongoing: activity observed but the session ended mid-approach; failed: observed evidence shows the approach did not achieve its aim; abandoned: work stopped and shifted without observed failure; completed: the approach ran to its conclusion — success is NOT implied; unknown: insufficient evidence.";

export const OUTCOME_SUPPORT_SEMANTICS =
  "Mutually exclusive: reported_only: claimed by the assistant, no corroborating activity or state evidence; independently_supported: activity or state evidence supports the outcome (an explicit claim is not required); contradicted: activity or state evidence cuts against the claimed outcome; unknown: insufficient evidence.";

export const SourceClassSchema = z.enum(SOURCE_CLASSES);
export const EvidenceBasisSchema = z
  .enum(EVIDENCE_BASES)
  .describe(EVIDENCE_BASIS_SEMANTICS);
export const ConfidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const ApproachStatusSchema = z.enum(APPROACH_STATUSES).describe(
  APPROACH_STATUS_SEMANTICS
);
export const OutcomeSupportSchema = z.enum(OUTCOME_SUPPORT_VALUES).describe(
  OUTCOME_SUPPORT_SEMANTICS
);
export const HumanInterventionCategorySchema = z.enum(
  HUMAN_INTERVENTION_CATEGORIES
);

export type SourceClass = z.infer<typeof SourceClassSchema>;
export type EvidenceBasis = z.infer<typeof EvidenceBasisSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type ApproachStatus = z.infer<typeof ApproachStatusSchema>;
export type OutcomeSupport = z.infer<typeof OutcomeSupportSchema>;
export type HumanInterventionCategory = z.infer<
  typeof HumanInterventionCategorySchema
>;

const CandidateFindingSchema = z
  .object({
    value: z.string().nullable(),
    basis: EvidenceBasisSchema,
    evidenceIds: z.array(z.string()),
    confidence: ConfidenceSchema.optional(),
    confidenceReason: z.string().min(1).max(500).optional()
  })
  .strict();

const CandidateApproachSchema = CandidateFindingSchema.extend({
  status: ApproachStatusSchema
}).strict();

const CandidateHumanInterventionSchema = CandidateFindingSchema.extend({
  category: HumanInterventionCategorySchema,
  justification: z.string().min(1).max(500)
}).strict();

const CandidateTurningPointSchema = CandidateFindingSchema.extend({
  beforeEvidenceIds: z.array(z.string()),
  afterEvidenceIds: z.array(z.string())
}).strict();

export const CandidateAnalysisSchema = z
  .object({
    objective: CandidateFindingSchema,
    approaches: z.array(CandidateApproachSchema),
    humanInterventions: z.array(CandidateHumanInterventionSchema),
    turningPoints: z.array(CandidateTurningPointSchema),
    codexContributions: z.array(CandidateFindingSchema),
    reportedOutcome: CandidateFindingSchema.nullable(),
    independentlySupportedOutcome: CandidateFindingSchema.nullable(),
    outcomeSupport: OutcomeSupportSchema,
    evidenceGaps: z.array(CandidateFindingSchema),
    leadershipInsights: z.array(CandidateFindingSchema)
  })
  .strict();

export const AnalysisSchema = CandidateAnalysisSchema.superRefine((analysis, context) => {
  const findings: Array<{ path: Array<string | number>; finding: CandidateFinding }> = [
    { path: ["objective"], finding: analysis.objective },
    ...analysis.approaches.map((finding, index) => ({
      path: ["approaches", index],
      finding
    })),
    ...analysis.humanInterventions.map((finding, index) => ({
      path: ["humanInterventions", index],
      finding
    })),
    ...analysis.turningPoints.map((finding, index) => ({
      path: ["turningPoints", index],
      finding
    })),
    ...analysis.codexContributions.map((finding, index) => ({
      path: ["codexContributions", index],
      finding
    })),
    ...(analysis.reportedOutcome
      ? [{ path: ["reportedOutcome"], finding: analysis.reportedOutcome }]
      : []),
    ...(analysis.independentlySupportedOutcome
      ? [
          {
            path: ["independentlySupportedOutcome"],
            finding: analysis.independentlySupportedOutcome
          }
        ]
      : []),
    ...analysis.evidenceGaps.map((finding, index) => ({
      path: ["evidenceGaps", index],
      finding
    })),
    ...analysis.leadershipInsights.map((finding, index) => ({
      path: ["leadershipInsights", index],
      finding
    }))
  ];

  for (const { path, finding } of findings) {
    if (finding.basis !== "unknown" && finding.evidenceIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: [...path, "evidenceIds"],
        message: "Every non-unknown finding must cite evidence"
      });
    }

    if (finding.basis === "inference") {
      if (finding.confidence === undefined || finding.confidenceReason === undefined) {
        context.addIssue({
          code: "custom",
          path,
          message: "Inference findings require confidence and a confidence reason"
        });
      }
    } else if (
      finding.confidence !== undefined ||
      finding.confidenceReason !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path,
        message: "Confidence is allowed only on inference findings"
      });
    }
  }

  if (analysis.leadershipInsights.length > 2) {
    context.addIssue({
      code: "custom",
      path: ["leadershipInsights"],
      message: "At most two leadership insights are allowed"
    });
  }
});

export type CandidateFinding = z.infer<typeof CandidateFindingSchema>;
export type CandidateAnalysis = z.infer<typeof CandidateAnalysisSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

export function unknownFinding(): CandidateFinding {
  return { value: null, basis: "unknown", evidenceIds: [] };
}
