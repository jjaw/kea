import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACTIVITY_SOURCE_CLASSES,
  APPROACH_SEMANTICS,
  APPROACH_STATUS_SEMANTICS,
  CandidateAnalysisSchema,
  CODEX_CONTRIBUTION_SEMANTICS,
  CODEX_CONTRIBUTION_SOURCE_CLASSES,
  EVIDENCE_BASIS_SEMANTICS,
  EVIDENCE_GAP_SEMANTICS,
  EXPLICIT_SOURCE_CLASSES,
  formatSourceClasses,
  HUMAN_INTERVENTION_CATEGORIES,
  HUMAN_INTERVENTION_CATEGORY_SEMANTICS,
  HUMAN_INTERVENTION_CATEGORY_SEMANTICS_TEXT,
  HumanInterventionCategorySchema,
  HUMAN_INTERVENTION_SEMANTICS,
  HUMAN_INTERVENTION_SOURCE_CLASSES,
  LEADERSHIP_INSIGHT_SEMANTICS,
  OBJECTIVE_SEMANTICS,
  OBSERVED_SOURCE_CLASSES,
  OUTCOME_FINDING_SEMANTICS,
  OUTCOME_SUPPORT_SEMANTICS,
  REPORTED_OUTCOME_SOURCE_CLASSES,
  RESULT_BEARING_OUTCOME_SOURCE_CLASSES,
  SOURCE_CLASSES,
  SOURCE_CLASS_SEMANTICS,
  SOURCE_CLASS_SEMANTICS_TEXT,
  SourceClassSchema,
  StructuredOutputAnalysisSchema,
  TOOL_ATTEMPT_SOURCE_CLASSES,
  TURNING_POINT_SEMANTICS
} from "../src/analysis-definitions.ts";
import {
  ANALYSIS_BRIEF,
  buildAnalysisInstructions
} from "../src/analysis-prompt.ts";
import { VALIDATOR_SOURCE_CLASS_POLICIES } from "../src/analysis-validator.ts";

test("source-class formatting is stable and generated semantics contain exact policy values", () => {
  assert.equal(
    formatSourceClasses(ACTIVITY_SOURCE_CLASSES),
    "`tool_attempt`, `tool_result`, `git_snapshot`"
  );
  assert.equal(
    formatSourceClasses(OBSERVED_SOURCE_CLASSES),
    "`session_event`, `tool_attempt`, `tool_result`, `git_snapshot`"
  );
  assert.equal(
    formatSourceClasses(EXPLICIT_SOURCE_CLASSES),
    "`human_message`, `assistant_message`"
  );
  assert.equal(
    formatSourceClasses(CODEX_CONTRIBUTION_SOURCE_CLASSES),
    "`tool_attempt`, `tool_result`, `assistant_message`"
  );

  assert.equal(
    EVIDENCE_BASIS_SEMANTICS,
    `observed: supported by ${formatSourceClasses(OBSERVED_SOURCE_CLASSES)} evidence; explicit: directly stated in ${formatSourceClasses(EXPLICIT_SOURCE_CLASSES)} evidence; inference: reasoned from multiple cited evidence items; unknown: the available evidence is insufficient.`
  );
  assert.equal(
    CODEX_CONTRIBUTION_SEMANTICS,
    `A Codex contribution cites only ${formatSourceClasses(CODEX_CONTRIBUTION_SOURCE_CLASSES)} evidence.`
  );
  assert.equal(
    HUMAN_INTERVENTION_SEMANTICS,
    `A human intervention cites only ${formatSourceClasses(HUMAN_INTERVENTION_SOURCE_CLASSES)} evidence and includes a one-line justification for its category.`
  );
  assert.equal(
    TURNING_POINT_SEMANTICS,
    `A turning point is a causal claim with temporally ordered before-and-after evidence; its after side includes ${formatSourceClasses(ACTIVITY_SOURCE_CLASSES)} activity evidence, not merely a later message.`
  );
});

test("source-class and human-intervention semantic records are exhaustive and drive schema descriptions", () => {
  assert.deepEqual(Object.keys(SOURCE_CLASS_SEMANTICS), [...SOURCE_CLASSES]);
  assert.deepEqual(
    Object.keys(HUMAN_INTERVENTION_CATEGORY_SEMANTICS),
    [...HUMAN_INTERVENTION_CATEGORIES]
  );
  for (const sourceClass of SOURCE_CLASSES) {
    assert.ok(SOURCE_CLASS_SEMANTICS[sourceClass].length > 0);
    assert.match(SOURCE_CLASS_SEMANTICS_TEXT, new RegExp(`(?:^|; )${sourceClass}:`));
  }
  for (const category of HUMAN_INTERVENTION_CATEGORIES) {
    assert.ok(HUMAN_INTERVENTION_CATEGORY_SEMANTICS[category].length > 0);
    assert.match(
      HUMAN_INTERVENTION_CATEGORY_SEMANTICS_TEXT,
      new RegExp(`(?:^|; )${escapeRegex(category)}:`)
    );
  }
  assert.equal(SourceClassSchema.description, SOURCE_CLASS_SEMANTICS_TEXT);
  assert.equal(
    HumanInterventionCategorySchema.description,
    HUMAN_INTERVENTION_CATEGORY_SEMANTICS_TEXT
  );
});

test("outcome corroboration semantics use activity evidence and deliberately exclude session events", () => {
  for (const sourceClass of ACTIVITY_SOURCE_CLASSES) {
    assert.match(OUTCOME_FINDING_SEMANTICS, new RegExp(escapeRegex(sourceClass)));
  }
  assert.equal(
    (ACTIVITY_SOURCE_CLASSES as readonly string[]).includes("session_event"),
    false
  );
  assert.equal(OBSERVED_SOURCE_CLASSES.includes("session_event"), true);
  assert.doesNotMatch(OUTCOME_FINDING_SEMANTICS, /session_event/);
  assert.equal(
    OUTCOME_FINDING_SEMANTICS,
    `reportedOutcome records what the assistant claimed and cites only ${formatSourceClasses(REPORTED_OUTCOME_SOURCE_CLASSES)} evidence. independentlySupportedOutcome records only what activity or state evidence establishes and cites only ${formatSourceClasses(ACTIVITY_SOURCE_CLASSES)} evidence. Establishing or contradicting an outcome requires at least one cited ${formatSourceClasses(RESULT_BEARING_OUTCOME_SOURCE_CLASSES)} evidence item; ${formatSourceClasses(TOOL_ATTEMPT_SOURCE_CLASSES)} proves an action was initiated but not what result occurred.`
  );
});

test("frozen approach and outcome-support semantics remain exact", () => {
  assert.equal(
    APPROACH_STATUS_SEMANTICS,
    "ongoing: activity observed but the session ended mid-approach; failed: observed evidence shows the approach did not achieve its aim; abandoned: work stopped and shifted without observed failure; completed: the approach ran to its conclusion — success is NOT implied; unknown: insufficient evidence."
  );
  assert.equal(
    OUTCOME_SUPPORT_SEMANTICS,
    "Mutually exclusive: reported_only: claimed by the assistant, no corroborating activity or state evidence; independently_supported: activity or state evidence supports the outcome (an explicit claim is not required); contradicted: activity or state evidence cuts against the claimed outcome; unknown: insufficient evidence."
  );
});

test("category-level semantics describe both candidate and structured-output fields", () => {
  assert.equal(CandidateAnalysisSchema.shape.objective.description, OBJECTIVE_SEMANTICS);
  assert.equal(CandidateAnalysisSchema.shape.approaches.description, APPROACH_SEMANTICS);
  assert.equal(
    CandidateAnalysisSchema.shape.evidenceGaps.description,
    EVIDENCE_GAP_SEMANTICS
  );
  assert.equal(
    StructuredOutputAnalysisSchema.shape.objective.description,
    OBJECTIVE_SEMANTICS
  );
  assert.equal(
    StructuredOutputAnalysisSchema.shape.approaches.description,
    APPROACH_SEMANTICS
  );
  assert.equal(
    StructuredOutputAnalysisSchema.shape.evidenceGaps.description,
    EVIDENCE_GAP_SEMANTICS
  );
});

test("provider prompt consumes exported semantics without parallel source-class lists", () => {
  const instructions = buildAnalysisInstructions();
  for (const semantics of [
    SOURCE_CLASS_SEMANTICS_TEXT,
    EVIDENCE_BASIS_SEMANTICS,
    OBJECTIVE_SEMANTICS,
    APPROACH_SEMANTICS,
    APPROACH_STATUS_SEMANTICS,
    HUMAN_INTERVENTION_CATEGORY_SEMANTICS_TEXT,
    HUMAN_INTERVENTION_SEMANTICS,
    TURNING_POINT_SEMANTICS,
    CODEX_CONTRIBUTION_SEMANTICS,
    OUTCOME_FINDING_SEMANTICS,
    OUTCOME_SUPPORT_SEMANTICS,
    EVIDENCE_GAP_SEMANTICS,
    LEADERSHIP_INSIGHT_SEMANTICS
  ]) {
    assert.ok(instructions.includes(semantics));
  }

  const promptSource = readFileSync(
    new URL("../src/analysis-prompt.ts", import.meta.url),
    "utf8"
  );
  for (const sourceClass of SOURCE_CLASSES) {
    assert.doesNotMatch(promptSource, new RegExp(`["']${sourceClass}["']`));
  }
  assert.doesNotMatch(
    promptSource,
    /ACTIVITY_SOURCE_CLASSES|OBSERVED_SOURCE_CLASSES|EXPLICIT_SOURCE_CLASSES|CODEX_CONTRIBUTION_SOURCE_CLASSES/
  );
});

test("authored analysis brief establishes audience, synthesis, and practical significance", () => {
  const instructions = buildAnalysisInstructions();

  assert.ok(instructions.includes(ANALYSIS_BRIEF));
  assert.ok(
    instructions.indexOf("Analyze one Kea session") <
      instructions.indexOf(ANALYSIS_BRIEF)
  );
  assert.ok(
    instructions.indexOf(ANALYSIS_BRIEF) <
      instructions.indexOf("Source classes:")
  );
  assert.match(ANALYSIS_BRIEF, /technical leader/);
  assert.match(
    ANALYSIS_BRIEF,
    /business or organizational leader who controls priorities, staffing, or budget/
  );
  assert.match(ANALYSIS_BRIEF, /developer who needs to verify/);
  assert.match(ANALYSIS_BRIEF, /plain language/);
  assert.match(ANALYSIS_BRIEF, /practical significance/);
  assert.match(ANALYSIS_BRIEF, /Synthesize rather than narrate/);
  assert.match(ANALYSIS_BRIEF, /overarching session-level goal/);
  assert.match(ANALYSIS_BRIEF, /small number of meaningful approaches/);
  assert.match(ANALYSIS_BRIEF, /do not force it into one causal narrative/i);
});

test("authored analysis brief requires evidence-backed business relevance without unsupported performance claims", () => {
  for (const expected of [
    "completed scope versus remaining scope",
    "verification still needed before accepting the result",
    "risks that may create future cost or delay",
    "resource implication leadership should consider",
    "continuing, reviewing, revising, or pausing the work"
  ]) {
    assert.ok(ANALYSIS_BRIEF.includes(expected));
  }
  assert.match(ANALYSIS_BRIEF, /budget was used efficiently or inefficiently/);
  assert.match(ANALYSIS_BRIEF, /return on investment/);
  assert.match(ANALYSIS_BRIEF, /hours saved/);
  assert.match(ANALYSIS_BRIEF, /developer productivity/);
  assert.match(
    ANALYSIS_BRIEF,
    /Produce no leadership insight when the evidence supports no decision-relevant implication/
  );
  assert.match(ANALYSIS_BRIEF, /Do not assess an individual developer's competence/);
});

test("refined category semantics preserve trust rules and improve session-level synthesis", () => {
  const instructions = buildAnalysisInstructions();

  assert.match(OBJECTIVE_SEMANTICS, /overarching session-level task or intended outcome/);
  assert.match(OBJECTIVE_SEMANTICS, /summarize their common goal/);
  assert.match(OBJECTIVE_SEMANTICS, /Do not force genuinely unrelated work/);
  assert.match(APPROACH_SEMANTICS, /implementation phase, or local goal/);
  assert.match(APPROACH_SEMANTICS, /substantial sub-objectives/);
  assert.match(APPROACH_SEMANTICS, /file inspection, routine test run, or minor edit/);
  assert.match(LEADERSHIP_INSIGHT_SEMANTICS, /decision-relevant implication/);
  assert.match(LEADERSHIP_INSIGHT_SEMANTICS, /Omit leadership insights/);
  assert.match(LEADERSHIP_INSIGHT_SEMANTICS, /resource implication/);

  for (const retainedRule of [
    EVIDENCE_BASIS_SEMANTICS,
    OUTCOME_FINDING_SEMANTICS,
    OUTCOME_SUPPORT_SEMANTICS,
    EVIDENCE_GAP_SEMANTICS,
    "Every non-unknown finding cites one or more supplied evidence IDs",
    "Confidence and a short confidence reason",
    "Use unknown findings whenever the supplied evidence is insufficient"
  ]) {
    assert.ok(instructions.includes(retainedRule));
  }
});

test("validator allowed-source policies directly reuse shared source-class constants", () => {
  assert.equal(
    VALIDATOR_SOURCE_CLASS_POLICIES.observedBasis,
    OBSERVED_SOURCE_CLASSES
  );
  assert.equal(
    VALIDATOR_SOURCE_CLASS_POLICIES.explicitBasis,
    EXPLICIT_SOURCE_CLASSES
  );
  assert.equal(
    VALIDATOR_SOURCE_CLASS_POLICIES.activityOutcome,
    ACTIVITY_SOURCE_CLASSES
  );
  assert.equal(
    VALIDATOR_SOURCE_CLASS_POLICIES.resultBearingOutcome,
    RESULT_BEARING_OUTCOME_SOURCE_CLASSES
  );
  assert.equal(
    VALIDATOR_SOURCE_CLASS_POLICIES.codexContribution,
    CODEX_CONTRIBUTION_SOURCE_CLASSES
  );
  assert.equal(
    VALIDATOR_SOURCE_CLASS_POLICIES.humanIntervention,
    HUMAN_INTERVENTION_SOURCE_CLASSES
  );
  assert.equal(
    VALIDATOR_SOURCE_CLASS_POLICIES.reportedOutcome,
    REPORTED_OUTCOME_SOURCE_CLASSES
  );
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
