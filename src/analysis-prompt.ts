import {
  APPROACH_STATUSES,
  APPROACH_SEMANTICS,
  APPROACH_STATUS_SEMANTICS,
  CITATION_SEMANTICS,
  CODEX_CONTRIBUTION_SEMANTICS,
  CONFIDENCE_LEVELS,
  CONFIDENCE_SEMANTICS,
  EVIDENCE_BASES,
  EVIDENCE_BASIS_SEMANTICS,
  EVIDENCE_GAP_SEMANTICS,
  HUMAN_INTERVENTION_CATEGORY_SEMANTICS_TEXT,
  HUMAN_INTERVENTION_SEMANTICS,
  LEADERSHIP_INSIGHT_SEMANTICS,
  OBJECTIVE_SEMANTICS,
  OUTCOME_FINDING_SEMANTICS,
  OUTCOME_SUPPORT_SEMANTICS,
  OUTCOME_SUPPORT_VALUES,
  SOURCE_CLASS_SEMANTICS_TEXT,
  TURNING_POINT_SEMANTICS
} from "./analysis-definitions.ts";
import type { EvidenceBundle } from "./evidence-bundle.ts";

export function buildAnalysisInstructions(): string {
  return [
    "Analyze one Kea session using only the supplied evidence bundle.",
    "Kea separates what messages claim from what activity and state evidence support.",
    `Source classes: ${SOURCE_CLASS_SEMANTICS_TEXT}.`,
    `Evidence bases: ${EVIDENCE_BASES.join(", ")}. ${EVIDENCE_BASIS_SEMANTICS}`,
    CITATION_SEMANTICS,
    `Confidence values: ${CONFIDENCE_LEVELS.join(", ")}. ${CONFIDENCE_SEMANTICS}`,
    OBJECTIVE_SEMANTICS,
    APPROACH_SEMANTICS,
    `Approach statuses: ${APPROACH_STATUSES.join(", ")}. ${APPROACH_STATUS_SEMANTICS}`,
    `Human intervention categories: ${HUMAN_INTERVENTION_CATEGORY_SEMANTICS_TEXT}. ${HUMAN_INTERVENTION_SEMANTICS}`,
    TURNING_POINT_SEMANTICS,
    CODEX_CONTRIBUTION_SEMANTICS,
    OUTCOME_FINDING_SEMANTICS,
    `Outcome support values: ${OUTCOME_SUPPORT_VALUES.join(", ")}. ${OUTCOME_SUPPORT_SEMANTICS}`,
    EVIDENCE_GAP_SEMANTICS,
    LEADERSHIP_INSIGHT_SEMANTICS,
    "Use unknown findings whenever the supplied evidence is insufficient; do not speculate about intent, causality, success, failure, or motivation.",
    "Return only the requested structured analysis. Do not provide hidden chain-of-thought, extra reasoning text, commentary, or fields outside the structure. Short confidence reasons explain evidentiary uncertainty, not private reasoning."
  ].join("\n\n");
}

export function buildAnalysisInput(bundle: EvidenceBundle): string {
  return [
    "This redacted and truncated JSON object is the complete evidence available for the analysis.",
    "Cite only IDs in its evidence array.",
    JSON.stringify(bundle, null, 2)
  ].join("\n\n");
}
