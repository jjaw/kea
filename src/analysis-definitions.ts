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
export const HUMAN_INTERVENTION_SOURCE_CLASSES = [
  "human_message"
] as const satisfies ReadonlyArray<(typeof SOURCE_CLASSES)[number]>;
export const REPORTED_OUTCOME_SOURCE_CLASSES = [
  "assistant_message"
] as const satisfies ReadonlyArray<(typeof SOURCE_CLASSES)[number]>;
export const RESULT_BEARING_OUTCOME_SOURCE_CLASSES = [
  "tool_result",
  "git_snapshot"
] as const satisfies ReadonlyArray<(typeof SOURCE_CLASSES)[number]>;
export const TOOL_ATTEMPT_SOURCE_CLASSES = [
  "tool_attempt"
] as const satisfies ReadonlyArray<(typeof SOURCE_CLASSES)[number]>;

export const SOURCE_CLASS_SEMANTICS = {
  session_event: "a captured Codex lifecycle event, such as session start",
  human_message: "a prompt or message submitted by the developer",
  assistant_message: "a statement produced by Codex",
  tool_attempt: "a captured tool invocation that was initiated",
  tool_result: "a captured response or result from a tool invocation",
  git_snapshot: "captured repository state at a point in the session"
} as const satisfies Record<(typeof SOURCE_CLASSES)[number], string>;

export const HUMAN_INTERVENTION_CATEGORY_SEMANTICS = {
  correction: "identifies something wrong or unsuitable and redirects the work",
  constraint: "imposes a boundary or requirement the work must obey",
  decision: "selects or settles among alternatives",
  clarification:
    "explains or narrows existing intent without rejecting the current direction",
  approval: "accepts or authorizes an approach, result, or next action",
  "follow-up task":
    "introduces additional related work beyond the preceding objective",
  question:
    "requests information or explanation and is not primarily asking for progress",
  "status request": "asks for progress, completion state, or current condition",
  other: "does not fit another category based on the available evidence"
} as const satisfies Record<
  (typeof HUMAN_INTERVENTION_CATEGORIES)[number],
  string
>;

export function formatSourceClasses(
  sourceClasses: ReadonlyArray<(typeof SOURCE_CLASSES)[number]>
): string {
  return sourceClasses.map((sourceClass) => `\`${sourceClass}\``).join(", ");
}

export function formatSemanticDefinitions<T extends string>(
  values: readonly T[],
  definitions: Readonly<Record<T, string>>
): string {
  return values.map((value) => `${value}: ${definitions[value]}`).join("; ");
}

export const SOURCE_CLASS_SEMANTICS_TEXT = formatSemanticDefinitions(
  SOURCE_CLASSES,
  SOURCE_CLASS_SEMANTICS
);

export const HUMAN_INTERVENTION_CATEGORY_SEMANTICS_TEXT =
  formatSemanticDefinitions(
    HUMAN_INTERVENTION_CATEGORIES,
    HUMAN_INTERVENTION_CATEGORY_SEMANTICS
  );

export const EVIDENCE_BASIS_SEMANTICS =
  `observed: supported by ${formatSourceClasses(OBSERVED_SOURCE_CLASSES)} evidence; explicit: directly stated in ${formatSourceClasses(EXPLICIT_SOURCE_CLASSES)} evidence; inference: reasoned from multiple cited evidence items; unknown: the available evidence is insufficient.`;

export const APPROACH_STATUS_SEMANTICS =
  "ongoing: activity observed but the session ended mid-approach; failed: observed evidence shows the approach did not achieve its aim; abandoned: work stopped and shifted without observed failure; completed: the approach ran to its conclusion — success is NOT implied; unknown: insufficient evidence.";

export const OUTCOME_SUPPORT_SEMANTICS =
  "Mutually exclusive: reported_only: claimed by the assistant, no corroborating activity or state evidence; independently_supported: activity or state evidence supports the outcome (an explicit claim is not required); contradicted: activity or state evidence cuts against the claimed outcome; unknown: insufficient evidence.";

export const CITATION_SEMANTICS =
  "Every non-unknown finding cites one or more supplied evidence IDs. Unknown findings may have no citations. Never cite an ID that is not present in the supplied evidence bundle.";

export const CONFIDENCE_SEMANTICS =
  "Confidence and a short confidence reason are required only for inference findings and forbidden for observed, explicit, and unknown findings.";

export const HUMAN_INTERVENTION_SEMANTICS =
  `A human intervention cites only ${formatSourceClasses(HUMAN_INTERVENTION_SOURCE_CLASSES)} evidence and includes a one-line justification for its category.`;

export const TURNING_POINT_SEMANTICS =
  `A turning point is a causal claim with temporally ordered before-and-after evidence; its after side includes ${formatSourceClasses(ACTIVITY_SOURCE_CLASSES)} activity evidence, not merely a later message.`;

export const CODEX_CONTRIBUTION_SEMANTICS =
  `A Codex contribution cites only ${formatSourceClasses(CODEX_CONTRIBUTION_SOURCE_CLASSES)} evidence.`;

export const OUTCOME_FINDING_SEMANTICS =
  `reportedOutcome records what the assistant claimed and cites only ${formatSourceClasses(REPORTED_OUTCOME_SOURCE_CLASSES)} evidence. independentlySupportedOutcome records only what activity or state evidence establishes and cites only ${formatSourceClasses(ACTIVITY_SOURCE_CLASSES)} evidence. Establishing or contradicting an outcome requires at least one cited ${formatSourceClasses(RESULT_BEARING_OUTCOME_SOURCE_CLASSES)} evidence item; ${formatSourceClasses(TOOL_ATTEMPT_SOURCE_CLASSES)} proves an action was initiated but not what result occurred.`;

export const LEADERSHIP_INSIGHT_SEMANTICS =
  "Leadership insights use an inference basis, cite supplied evidence, and number at most two. Each insight must add a decision-relevant implication rather than repeat another finding. It may identify necessary follow-up, unresolved risk, a reusable constraint, requirement ambiguity, process improvement, resource implication, readiness decision, or a point where human judgment materially changed the work. Translate technical facts into practical significance for technical or nontechnical leadership when the evidence supports that translation. Omit leadership insights when the evidence supports no useful implication. Never infer developer competence, motivation, personal performance, productivity, financial return, hours saved, or budget efficiency without sufficient direct evidence.";

export const OBJECTIVE_SEMANTICS =
  "The objective is the overarching session-level task or intended outcome sought by the human. For a long session with multiple related requests, summarize their common goal and represent meaningful local goals as approaches. Combining multiple messages generally makes the objective an inference. Do not force genuinely unrelated work into one objective.";

export const APPROACH_SEMANTICS =
  "An approach is a meaningful technical strategy, implementation phase, or local goal that groups related activity. Use approaches for substantial sub-objectives, alternative strategies, or distinct phases of work. Do not create one approach per prompt, tool call, file inspection, routine test run, or minor edit.";

export const EVIDENCE_GAP_SEMANTICS =
  "An evidence gap is something the recording cannot establish; use unknown rather than filling in the missing fact.";

export const SourceClassSchema = z
  .enum(SOURCE_CLASSES)
  .describe(SOURCE_CLASS_SEMANTICS_TEXT);
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
).describe(HUMAN_INTERVENTION_CATEGORY_SEMANTICS_TEXT);

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

const StructuredOutputFindingSchema = z
  .object({
    value: z.string().nullable(),
    basis: EvidenceBasisSchema,
    evidenceIds: z.array(z.string()),
    confidence: ConfidenceSchema.nullable(),
    confidenceReason: z.string().min(1).max(500).nullable()
  })
  .strict();

const StructuredOutputApproachSchema = StructuredOutputFindingSchema.extend({
  status: ApproachStatusSchema
}).strict();

const StructuredOutputHumanInterventionSchema =
  StructuredOutputFindingSchema.extend({
    category: HumanInterventionCategorySchema,
    justification: z.string().min(1).max(500)
  }).strict();

const StructuredOutputTurningPointSchema = StructuredOutputFindingSchema.extend({
  beforeEvidenceIds: z.array(z.string()),
  afterEvidenceIds: z.array(z.string())
}).strict();

export const StructuredOutputAnalysisSchema = z
  .object({
    objective: StructuredOutputFindingSchema.describe(OBJECTIVE_SEMANTICS),
    approaches: z
      .array(StructuredOutputApproachSchema)
      .describe(APPROACH_SEMANTICS),
    humanInterventions: z.array(StructuredOutputHumanInterventionSchema),
    turningPoints: z.array(StructuredOutputTurningPointSchema),
    codexContributions: z.array(StructuredOutputFindingSchema),
    reportedOutcome: StructuredOutputFindingSchema.nullable(),
    independentlySupportedOutcome: StructuredOutputFindingSchema.nullable(),
    outcomeSupport: OutcomeSupportSchema,
    evidenceGaps: z
      .array(StructuredOutputFindingSchema)
      .describe(EVIDENCE_GAP_SEMANTICS),
    leadershipInsights: z.array(StructuredOutputFindingSchema)
  })
  .strict()
  .superRefine((analysis, context) => {
    const findings = [
      analysis.objective,
      ...analysis.approaches,
      ...analysis.humanInterventions,
      ...analysis.turningPoints,
      ...analysis.codexContributions,
      ...(analysis.reportedOutcome ? [analysis.reportedOutcome] : []),
      ...(analysis.independentlySupportedOutcome
        ? [analysis.independentlySupportedOutcome]
        : []),
      ...analysis.evidenceGaps,
      ...analysis.leadershipInsights
    ];

    for (const [index, finding] of findings.entries()) {
      const hasCompleteConfidence =
        finding.confidence !== null && finding.confidenceReason !== null;
      const hasAnyConfidence =
        finding.confidence !== null || finding.confidenceReason !== null;
      if (finding.basis === "inference" && !hasCompleteConfidence) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Inference findings require confidence and a confidence reason"
        });
      } else if (finding.basis !== "inference" && hasAnyConfidence) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Confidence is allowed only on inference findings"
        });
      }
    }
  });

export const CandidateAnalysisSchema = z
  .object({
    objective: CandidateFindingSchema.describe(OBJECTIVE_SEMANTICS),
    approaches: z.array(CandidateApproachSchema).describe(APPROACH_SEMANTICS),
    humanInterventions: z.array(CandidateHumanInterventionSchema),
    turningPoints: z.array(CandidateTurningPointSchema),
    codexContributions: z.array(CandidateFindingSchema),
    reportedOutcome: CandidateFindingSchema.nullable(),
    independentlySupportedOutcome: CandidateFindingSchema.nullable(),
    outcomeSupport: OutcomeSupportSchema,
    evidenceGaps: z
      .array(CandidateFindingSchema)
      .describe(EVIDENCE_GAP_SEMANTICS),
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
export type StructuredOutputAnalysis = z.infer<
  typeof StructuredOutputAnalysisSchema
>;

export function normalizeStructuredOutputAnalysis(
  analysis: StructuredOutputAnalysis
): unknown {
  const normalizeFinding = <T extends Record<string, unknown>>(finding: T): T => {
    const normalized = { ...finding };
    if (normalized.confidence === null) {
      delete normalized.confidence;
    }
    if (normalized.confidenceReason === null) {
      delete normalized.confidenceReason;
    }
    return normalized;
  };

  return {
    ...analysis,
    objective: normalizeFinding(analysis.objective),
    approaches: analysis.approaches.map(normalizeFinding),
    humanInterventions: analysis.humanInterventions.map(normalizeFinding),
    turningPoints: analysis.turningPoints.map(normalizeFinding),
    codexContributions: analysis.codexContributions.map(normalizeFinding),
    reportedOutcome:
      analysis.reportedOutcome === null
        ? null
        : normalizeFinding(analysis.reportedOutcome),
    independentlySupportedOutcome:
      analysis.independentlySupportedOutcome === null
        ? null
        : normalizeFinding(analysis.independentlySupportedOutcome),
    evidenceGaps: analysis.evidenceGaps.map(normalizeFinding),
    leadershipInsights: analysis.leadershipInsights.map(normalizeFinding)
  };
}

export function unknownFinding(): CandidateFinding {
  return { value: null, basis: "unknown", evidenceIds: [] };
}
