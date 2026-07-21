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

export const ANALYSIS_BRIEF = `Audience and purpose:

The report may be read by a technical leader, a business or organizational leader who controls priorities, staffing, or budget but may not understand the implementation details, or the developer who needs to verify the explanation or complete follow-up work.

Explain the session in plain language so these readers can understand it without reading the transcript. Use technical terminology only when necessary, and explain its practical significance rather than assuming the reader understands programming tools, repository structure, or model behavior.

Produce a concise, evidence-backed explanation of:

- what project, product, or organizational outcome the work was intended to support;
- what was actually attempted;
- how the work divided into a small number of meaningful approaches or local goals;
- what Codex materially contributed;
- where human judgment corrected, constrained, selected, approved, or clarified the direction;
- what Codex reported as completed;
- what captured activity, tool results, tests, or repository state independently support;
- what remains incomplete, contradicted, uncertain, or unverified;
- what decision, follow-up, risk, resource implication, or reusable lesson the evidence reasonably suggests.

Translate technical activity into practical significance when the evidence supports that translation. Explain whether a decision:

- reduced implementation, delivery, security, portability, or operational risk;
- prevented an incorrect or materially weaker design;
- clarified scope or requirements;
- avoided unnecessary work;
- exposed missing verification;
- created a reusable capability;
- left substantial follow-up work;
- affected readiness for review, demonstration, release, or further investment.

Synthesize rather than narrate. Do not restate every prompt, tool call, file inspection, routine edit, or test command.

For a long session with multiple related objectives:

- identify the overarching session-level goal;
- group related work into a small number of meaningful approaches or local goals;
- explain how those local goals contributed to the larger outcome;
- preserve important changes of direction as turning points;
- do not create one objective, approach, intervention, or Codex contribution per prompt or tool call.

When the session contains genuinely unrelated work, do not force it into one causal narrative. State the best-supported primary objective and represent other substantial work conservatively through approaches, evidence gaps, or unknowns as the existing schema permits.

Clearly distinguish:

- what a message explicitly reported;
- what observable evidence established;
- what Kea inferred;
- what remains unknown.

Business and resource relevance:

Help leadership understand whether the observable work advanced the intended outcome and what may affect future resource decisions.

Where supported by evidence, identify:

- completed scope versus remaining scope;
- meaningful rework or abandoned approaches;
- requirement ambiguity that caused additional work;
- verification still needed before accepting the result;
- risks that may create future cost or delay;
- dependencies or follow-up work that may require additional resources;
- decisions where human judgment prevented a materially weaker, riskier, or more costly direction;
- evidence relevant to continuing, reviewing, revising, or pausing the work.

Do not claim that budget was used efficiently or inefficiently unless the supplied evidence contains sufficient information about cost, time, intended scope, and achieved outcome.

Do not estimate:

- money saved;
- hours saved;
- return on investment;
- comparative efficiency;
- developer productivity.

When those facts are unavailable, state the narrower supported conclusion. For example, the analysis may state that independently supported progress occurred, that scope remains incomplete, or that requirement clarification caused rework. It must not assign a financial effect that the evidence does not establish.

Actionability must come from evidence. A leadership insight may identify:

- verification or review that remains necessary;
- an unresolved contradiction or evidence gap;
- a requirement that should have been specified earlier;
- a reusable technical constraint or engineering standard;
- an implementation, operational, or delivery risk;
- a process or tooling improvement supported by the session;
- a point where human judgment materially changed the subsequent work;
- a resource implication leadership should consider;
- whether the evidence supports advancing to the next stage.

Do not manufacture an action item merely because the report is expected to be useful. Produce no leadership insight when the evidence supports no decision-relevant implication.

Do not assess an individual developer's competence, motivation, diligence, effort, or personal performance. Do not rank people or label activity as productive, unproductive, valuable, useless, or wasteful.`;

export function buildAnalysisInstructions(): string {
  return [
    "Analyze one Kea session using only the supplied evidence bundle.",
    ANALYSIS_BRIEF,
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
