import { z } from "zod";
import {
  ACTIVITY_SOURCE_CLASSES,
  AnalysisSchema,
  CandidateAnalysisSchema,
  CODEX_CONTRIBUTION_SOURCE_CLASSES,
  EXPLICIT_SOURCE_CLASSES,
  formatSourceClasses,
  HUMAN_INTERVENTION_SOURCE_CLASSES,
  OBSERVED_SOURCE_CLASSES,
  REPORTED_OUTCOME_SOURCE_CLASSES,
  RESULT_BEARING_OUTCOME_SOURCE_CLASSES,
  TOOL_ATTEMPT_SOURCE_CLASSES,
  unknownFinding,
  type Analysis,
  type CandidateAnalysis,
  type CandidateFinding,
  type EvidenceBasis,
  type SourceClass
} from "./analysis-definitions.ts";
import type { EvidenceBundle, EvidenceItem } from "./evidence-bundle.ts";

export const VALIDATION_ACTION_CODES = [
  "outcome_support_attempt_only_to_reported_only",
  "outcome_support_attempt_only_to_unknown"
] as const;

export type ValidationActionCode = (typeof VALIDATION_ACTION_CODES)[number];

export const ValidationActionSchema = z
  .object({
    action: z.enum(["rejected", "downgraded"]),
    code: z.enum(VALIDATION_ACTION_CODES).optional(),
    target: z.string().min(1),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string())
  })
  .strict();

export const ValidationSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    validatedAt: z.string().min(1),
    rejectedCount: z.number().int().nonnegative(),
    downgradedCount: z.number().int().nonnegative(),
    actions: z.array(ValidationActionSchema)
  })
  .strict();

export type ValidationSummary = z.infer<typeof ValidationSummarySchema>;
export type ValidationResult = {
  analysis: Analysis;
  summary: ValidationSummary;
};

type FindingOptions = {
  allowedSourceClasses?: ReadonlySet<SourceClass>;
  requiredBasis?: EvidenceBasis;
  requiresEvidence?: boolean;
  requiresKnownValue?: boolean;
};

export const VALIDATOR_SOURCE_CLASS_POLICIES = {
  observedBasis: OBSERVED_SOURCE_CLASSES,
  explicitBasis: EXPLICIT_SOURCE_CLASSES,
  activityOutcome: ACTIVITY_SOURCE_CLASSES,
  resultBearingOutcome: RESULT_BEARING_OUTCOME_SOURCE_CLASSES,
  codexContribution: CODEX_CONTRIBUTION_SOURCE_CLASSES,
  humanIntervention: HUMAN_INTERVENTION_SOURCE_CLASSES,
  reportedOutcome: REPORTED_OUTCOME_SOURCE_CLASSES
} as const;

const OBSERVED_SOURCES = new Set<SourceClass>(
  VALIDATOR_SOURCE_CLASS_POLICIES.observedBasis
);
const EXPLICIT_SOURCES = new Set<SourceClass>(
  VALIDATOR_SOURCE_CLASS_POLICIES.explicitBasis
);
const ACTIVITY_SOURCES = new Set<SourceClass>(
  VALIDATOR_SOURCE_CLASS_POLICIES.activityOutcome
);
const RESULT_BEARING_OUTCOME_SOURCES = new Set<SourceClass>(
  VALIDATOR_SOURCE_CLASS_POLICIES.resultBearingOutcome
);
const CODEX_CONTRIBUTION_SOURCES = new Set<SourceClass>(
  VALIDATOR_SOURCE_CLASS_POLICIES.codexContribution
);
const HUMAN_INTERVENTION_SOURCES = new Set<SourceClass>(
  VALIDATOR_SOURCE_CLASS_POLICIES.humanIntervention
);
const REPORTED_OUTCOME_SOURCES = new Set<SourceClass>(
  VALIDATOR_SOURCE_CLASS_POLICIES.reportedOutcome
);

export function validateAnalysis(
  candidate: unknown,
  bundle: EvidenceBundle,
  runId: string,
  now: Date = new Date()
): ValidationResult {
  const actions: ValidationSummary["actions"] = [];
  const evidenceById = new Map(bundle.evidence.map((item) => [item.id, item]));
  const evidenceOrder = new Map(
    bundle.evidence.map((item, index) => [item.id, index])
  );
  const parsed = CandidateAnalysisSchema.safeParse(candidate);
  let working: CandidateAnalysis;

  if (!parsed.success) {
    actions.push({
      action: "rejected",
      target: "analysis",
      reason: `Analysis failed structural schema validation: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "analysis"}: ${issue.message}`)
        .join("; ")}`,
      evidenceIds: []
    });
    working = emptyAnalysis();
  } else {
    working = structuredClone(parsed.data);
  }

  const validateFinding = <T extends CandidateFinding>(
    finding: T,
    target: string,
    options: FindingOptions = {}
  ): T | null => {
    const invalidEvidenceIds = finding.evidenceIds.filter(
      (id) => !evidenceById.has(id)
    );
    if (invalidEvidenceIds.length > 0) {
      reject(
        actions,
        target,
        `Finding cites nonexistent evidence: ${invalidEvidenceIds.join(", ")}.`,
        finding.evidenceIds
      );
      return null;
    }

    if (finding.basis !== "unknown" && finding.evidenceIds.length === 0) {
      reject(actions, target, "Non-unknown finding has no evidence citations.", []);
      return null;
    }
    if (options.requiresEvidence && finding.evidenceIds.length === 0) {
      reject(actions, target, "This category requires evidence citations.", []);
      return null;
    }
    if (
      options.requiresKnownValue &&
      (finding.basis === "unknown" || finding.value === null)
    ) {
      reject(
        actions,
        target,
        "This category requires a non-unknown finding value.",
        finding.evidenceIds
      );
      return null;
    }

    const citedItems = finding.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is EvidenceItem => item !== undefined);

    if (
      options.allowedSourceClasses &&
      citedItems.some((item) => !options.allowedSourceClasses?.has(item.sourceClass))
    ) {
      reject(
        actions,
        target,
        `Finding cites a source class forbidden for this category; allowed classes are ${[
          ...options.allowedSourceClasses
        ].join(", ")}.`,
        finding.evidenceIds
      );
      return null;
    }

    let validated = { ...finding };
    if (options.requiredBasis && validated.basis !== options.requiredBasis) {
      if (options.requiredBasis === "inference" && validated.evidenceIds.length > 0) {
        validated = downgradeToInference(
          validated,
          target,
          `This category requires basis ${options.requiredBasis}.`,
          actions
        );
      } else {
        reject(
          actions,
          target,
          `This category requires basis ${options.requiredBasis}.`,
          validated.evidenceIds
        );
        return null;
      }
    }

    if (validated.basis === "observed" && !allSourcesAllowed(citedItems, OBSERVED_SOURCES)) {
      validated = downgradeToInference(
        validated,
        target,
        "Observed basis was not supported exclusively by activity or state evidence.",
        actions
      );
    } else if (
      validated.basis === "explicit" &&
      !allSourcesAllowed(citedItems, EXPLICIT_SOURCES)
    ) {
      validated = downgradeToInference(
        validated,
        target,
        "Explicit basis was not supported exclusively by human or assistant messages.",
        actions
      );
    }

    if (validated.basis === "inference") {
      if (
        validated.confidence === undefined ||
        validated.confidenceReason === undefined
      ) {
        validated = {
          ...validated,
          confidence: validated.confidence ?? "low",
          confidenceReason:
            validated.confidenceReason ??
            "Validator supplied low confidence because the candidate omitted inference confidence metadata."
        };
        downgrade(
          actions,
          target,
          "Inference finding omitted confidence or its reason; supplied deterministic low-confidence metadata.",
          validated.evidenceIds
        );
      }
    } else if (
      validated.confidence !== undefined ||
      validated.confidenceReason !== undefined
    ) {
      const { confidence: _confidence, confidenceReason: _reason, ...withoutConfidence } =
        validated;
      validated = withoutConfidence as T;
      downgrade(
        actions,
        target,
        "Removed confidence metadata from a non-inference finding.",
        validated.evidenceIds
      );
    }

    return validated as T;
  };

  const objective = validateFinding(working.objective, "objective") ?? unknownFinding();
  const approaches = working.approaches.flatMap((finding, index) => {
    const validated = validateFinding(finding, `approaches[${index}]`);
    return validated ? [validated] : [];
  });
  const humanInterventions = working.humanInterventions.flatMap(
    (finding, index) => {
      const validated = validateFinding(finding, `humanInterventions[${index}]`, {
        allowedSourceClasses: HUMAN_INTERVENTION_SOURCES,
        requiresEvidence: true
      });
      return validated ? [validated] : [];
    }
  );
  const turningPoints = working.turningPoints.flatMap((finding, index) => {
    const target = `turningPoints[${index}]`;
    const validated = validateFinding(finding, target);
    if (!validated) {
      return [];
    }
    if (!validTurningPoint(validated, evidenceById, evidenceOrder)) {
      reject(
        actions,
        target,
        "Turning point requires cited, ordered before-and-after evidence and activity evidence on the after side.",
        validated.evidenceIds
      );
      return [];
    }
    return [validated];
  });
  const codexContributions = working.codexContributions.flatMap(
    (finding, index) => {
      const validated = validateFinding(finding, `codexContributions[${index}]`, {
        allowedSourceClasses: CODEX_CONTRIBUTION_SOURCES,
        requiresEvidence: true
      });
      return validated ? [validated] : [];
    }
  );
  const reportedOutcome = working.reportedOutcome
    ? validateFinding(working.reportedOutcome, "reportedOutcome", {
        allowedSourceClasses: REPORTED_OUTCOME_SOURCES,
        requiresEvidence: true,
        requiresKnownValue: true
      })
    : null;
  const candidateHasResultBearingOutcomeEvidence =
    working.independentlySupportedOutcome !== null &&
    hasResultBearingOutcomeEvidence(
      working.independentlySupportedOutcome,
      evidenceById
    );
  let independentlySupportedOutcome = working.independentlySupportedOutcome
    ? validateFinding(
        working.independentlySupportedOutcome,
        "independentlySupportedOutcome",
        {
          allowedSourceClasses: ACTIVITY_SOURCES,
          requiresEvidence: true,
          requiresKnownValue: candidateHasResultBearingOutcomeEvidence
        }
      )
    : null;
  const evidenceGaps = working.evidenceGaps.flatMap((finding, index) => {
    const validated = validateFinding(finding, `evidenceGaps[${index}]`);
    return validated ? [validated] : [];
  });

  const leadershipInsights = working.leadershipInsights.flatMap((finding, index) => {
    if (index >= 2) {
      reject(
        actions,
        `leadershipInsights[${index}]`,
        "At most two leadership insights are allowed.",
        finding.evidenceIds
      );
      return [];
    }
    const validated = validateFinding(finding, `leadershipInsights[${index}]`, {
      requiredBasis: "inference"
    });
    return validated ? [validated] : [];
  });

  let outcomeSupport = working.outcomeSupport;
  let attemptOnlyOutcomeSupportCorrected = false;
  if (
    (outcomeSupport === "independently_supported" ||
      outcomeSupport === "contradicted") &&
    independentlySupportedOutcome !== null &&
    !hasResultBearingOutcomeEvidence(
      independentlySupportedOutcome,
      evidenceById
    )
  ) {
    const originalOutcomeSupport = outcomeSupport;
    const finalOutcomeSupport =
      reportedOutcome === null ? "unknown" : "reported_only";
    const evidenceIds = independentlySupportedOutcome.evidenceIds;
    const basisWasDowngraded = independentlySupportedOutcome.basis !== "unknown";
    independentlySupportedOutcome = asUnknownFinding(
      independentlySupportedOutcome
    );
    downgrade(
      actions,
      "outcomeSupport",
      `Outcome support changed from ${originalOutcomeSupport} to ${finalOutcomeSupport}. Cited evidence ${evidenceIds.join(", ")} contains no ${formatSourceClasses(RESULT_BEARING_OUTCOME_SOURCE_CLASSES)} evidence. A ${formatSourceClasses(TOOL_ATTEMPT_SOURCE_CLASSES)} proves an action was initiated but not what result occurred. The independently supported outcome finding was preserved${basisWasDowngraded ? " and its basis was downgraded to unknown" : " with its unknown basis"}.`,
      evidenceIds,
      finalOutcomeSupport === "reported_only"
        ? "outcome_support_attempt_only_to_reported_only"
        : "outcome_support_attempt_only_to_unknown"
    );
    outcomeSupport = finalOutcomeSupport;
    attemptOnlyOutcomeSupportCorrected = true;
  }

  if (!attemptOnlyOutcomeSupportCorrected) {
    const inconsistentReason = outcomeConsistencyReason(
      outcomeSupport,
      reportedOutcome,
      independentlySupportedOutcome
    );
    if (inconsistentReason !== null) {
      downgrade(actions, "outcomeSupport", inconsistentReason, [
        ...(reportedOutcome?.evidenceIds ?? []),
        ...(independentlySupportedOutcome?.evidenceIds ?? [])
      ]);
      outcomeSupport = "unknown";
    }
  }

  const analysis = AnalysisSchema.parse({
    objective,
    approaches,
    humanInterventions,
    turningPoints,
    codexContributions,
    reportedOutcome,
    independentlySupportedOutcome,
    outcomeSupport,
    evidenceGaps,
    leadershipInsights
  });
  const summary = ValidationSummarySchema.parse({
    schemaVersion: 1,
    runId,
    validatedAt: now.toISOString(),
    rejectedCount: actions.filter((entry) => entry.action === "rejected").length,
    downgradedCount: actions.filter((entry) => entry.action === "downgraded").length,
    actions
  });

  return { analysis, summary };
}

function validTurningPoint(
  finding: CandidateAnalysis["turningPoints"][number],
  evidenceById: Map<string, EvidenceItem>,
  evidenceOrder: Map<string, number>
): boolean {
  if (
    finding.beforeEvidenceIds.length === 0 ||
    finding.afterEvidenceIds.length === 0
  ) {
    return false;
  }

  const cited = new Set(finding.evidenceIds);
  const allTemporalIds = [
    ...finding.beforeEvidenceIds,
    ...finding.afterEvidenceIds
  ];
  if (
    allTemporalIds.some(
      (id) => !cited.has(id) || !evidenceById.has(id) || !evidenceOrder.has(id)
    )
  ) {
    return false;
  }

  const beforeOrder = finding.beforeEvidenceIds.map(
    (id) => evidenceOrder.get(id) as number
  );
  const afterOrder = finding.afterEvidenceIds.map(
    (id) => evidenceOrder.get(id) as number
  );
  const ordered = Math.max(...beforeOrder) < Math.min(...afterOrder);
  const afterIncludesActivity = finding.afterEvidenceIds.some((id) => {
    const item = evidenceById.get(id);
    return item !== undefined && ACTIVITY_SOURCES.has(item.sourceClass);
  });
  return ordered && afterIncludesActivity;
}

function outcomeConsistencyReason(
  support: CandidateAnalysis["outcomeSupport"],
  reported: CandidateFinding | null,
  independent: CandidateFinding | null
): string | null {
  switch (support) {
    case "reported_only":
      return reported !== null && independent === null
        ? null
        : "reported_only requires a reported outcome and no independently supported outcome.";
    case "independently_supported":
      return independent !== null
        ? null
        : "independently_supported requires a valid independently supported outcome.";
    case "contradicted":
      return reported !== null && independent !== null
        ? null
        : "contradicted requires both reported and independently supported outcomes.";
    case "unknown":
      return null;
  }
}

function allSourcesAllowed(
  evidence: EvidenceItem[],
  allowed: ReadonlySet<SourceClass>
): boolean {
  return evidence.every((item) => allowed.has(item.sourceClass));
}

function hasResultBearingOutcomeEvidence(
  finding: CandidateFinding,
  evidenceById: Map<string, EvidenceItem>
): boolean {
  return finding.evidenceIds.some((id) => {
    const item = evidenceById.get(id);
    return (
      item !== undefined &&
      RESULT_BEARING_OUTCOME_SOURCES.has(item.sourceClass)
    );
  });
}

function asUnknownFinding<T extends CandidateFinding>(finding: T): T {
  const {
    confidence: _confidence,
    confidenceReason: _confidenceReason,
    ...withoutConfidence
  } = finding;
  return { ...withoutConfidence, basis: "unknown" } as T;
}

function downgradeToInference<T extends CandidateFinding>(
  finding: T,
  target: string,
  reason: string,
  actions: ValidationSummary["actions"]
): T {
  downgrade(actions, target, reason, finding.evidenceIds);
  return {
    ...finding,
    basis: "inference",
    confidence: finding.confidence ?? "low",
    confidenceReason:
      finding.confidenceReason ??
      "Validator downgraded the claimed basis; confidence is conservatively low."
  } as T;
}

function reject(
  actions: ValidationSummary["actions"],
  target: string,
  reason: string,
  evidenceIds: string[]
): void {
  actions.push({ action: "rejected", target, reason, evidenceIds });
}

function downgrade(
  actions: ValidationSummary["actions"],
  target: string,
  reason: string,
  evidenceIds: string[],
  code?: ValidationActionCode
): void {
  actions.push({
    action: "downgraded",
    ...(code ? { code } : {}),
    target,
    reason,
    evidenceIds
  });
}

function emptyAnalysis(): CandidateAnalysis {
  return {
    objective: unknownFinding(),
    approaches: [],
    humanInterventions: [],
    turningPoints: [],
    codexContributions: [],
    reportedOutcome: null,
    independentlySupportedOutcome: null,
    outcomeSupport: "unknown",
    evidenceGaps: [],
    leadershipInsights: []
  };
}
