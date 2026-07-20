import type {
  Analysis,
  CandidateFinding
} from "./analysis-definitions.ts";
import type { ValidationSummary } from "./analysis-validator.ts";
import type { EvidenceBundle } from "./evidence-bundle.ts";

export function renderAnalysisReport(
  bundle: EvidenceBundle,
  analysis: Analysis,
  summary: ValidationSummary,
  runId: string
): string {
  const lines: string[] = [
    "# Kea Session Analysis",
    "",
    `- **Run:** ${runId}`,
    `- **Session:** ${bundle.session.sessionId ?? "unknown"}`,
    `- **First observed:** ${bundle.session.firstObservedAt ?? "unknown"}`,
    `- **Last observed:** ${bundle.session.lastObservedAt ?? "unknown"}`,
    `- **Working directory:** ${bundle.session.cwd ?? "unknown"}`,
    `- **Session model:** ${bundle.session.model ?? "unknown"}`,
    "",
    "## Objective",
    ""
  ];

  appendFinding(lines, analysis.objective, "The objective is unknown.");
  appendApproaches(lines, analysis);
  appendHumanInterventions(lines, analysis);
  appendTurningPoints(lines, analysis);
  appendFindingList(
    lines,
    "Codex Contributions",
    analysis.codexContributions,
    "No Codex contribution finding was returned."
  );

  lines.push("", "## Reported Outcome", "");
  appendNullableFinding(
    lines,
    analysis.reportedOutcome,
    "No assistant-reported outcome was established."
  );
  lines.push("", "## Independently Supported Outcome", "");
  appendNullableFinding(
    lines,
    analysis.independentlySupportedOutcome,
    "No independently supported outcome was established."
  );
  lines.push(
    "",
    "## Outcome Support",
    "",
    `- **Value:** ${analysis.outcomeSupport}`
  );

  appendFindingList(
    lines,
    "Evidence Gaps",
    analysis.evidenceGaps,
    "No evidence-gap finding was returned."
  );
  appendFindingList(
    lines,
    "Leadership Insights",
    analysis.leadershipInsights,
    "No leadership insight was returned."
  );

  lines.push("", "## Validation Audit", "");
  lines.push(
    `- **Validated at:** ${summary.validatedAt}`,
    `- **Rejected:** ${summary.rejectedCount}`,
    `- **Downgraded:** ${summary.downgradedCount}`,
    `- **Audit entries:** ${summary.actions.length}`,
    ""
  );
  if (summary.actions.length === 0) {
    lines.push("No rejection or downgrade was required.");
  } else {
    summary.actions.forEach((action, index) => {
      lines.push(
        `### ${index + 1}. ${capitalize(action.action)} — ${action.target}`,
        "",
        ...(action.code ? [`- **Code:** \`${action.code}\``] : []),
        `- **Reason:** ${action.reason}`,
        `- **Evidence IDs:** ${formatEvidenceIds(action.evidenceIds)}`,
        ""
      );
    });
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function appendApproaches(lines: string[], analysis: Analysis): void {
  lines.push("", "## Approaches", "");
  if (analysis.approaches.length === 0) {
    lines.push("No approach finding was returned.");
    return;
  }
  analysis.approaches.forEach((approach, index) => {
    lines.push(`### ${index + 1}. ${approach.status}`, "");
    appendFinding(lines, approach, "This approach is unknown.");
    lines.push("");
  });
}

function appendHumanInterventions(lines: string[], analysis: Analysis): void {
  lines.push("", "## Human Interventions", "");
  if (analysis.humanInterventions.length === 0) {
    lines.push("No human-intervention finding was returned.");
    return;
  }
  analysis.humanInterventions.forEach((intervention, index) => {
    lines.push(
      `### ${index + 1}. ${intervention.category}`,
      "",
      `- **Category justification:** ${intervention.justification}`,
      ""
    );
    appendFinding(lines, intervention, "This human intervention is unknown.");
    lines.push("");
  });
}

function appendTurningPoints(lines: string[], analysis: Analysis): void {
  lines.push("", "## Turning Points", "");
  if (analysis.turningPoints.length === 0) {
    lines.push("No turning-point finding survived validation.");
    return;
  }
  analysis.turningPoints.forEach((turningPoint, index) => {
    lines.push(
      `### ${index + 1}`,
      "",
      `- **Before evidence IDs:** ${formatEvidenceIds(turningPoint.beforeEvidenceIds)}`,
      `- **After evidence IDs:** ${formatEvidenceIds(turningPoint.afterEvidenceIds)}`,
      ""
    );
    appendFinding(lines, turningPoint, "This turning point is unknown.");
    lines.push("");
  });
}

function appendFindingList(
  lines: string[],
  heading: string,
  findings: CandidateFinding[],
  emptyText: string
): void {
  lines.push("", `## ${heading}`, "");
  if (findings.length === 0) {
    lines.push(emptyText);
    return;
  }
  findings.forEach((finding, index) => {
    lines.push(`### ${index + 1}`, "");
    appendFinding(lines, finding, `This ${heading.toLowerCase()} finding is unknown.`);
    lines.push("");
  });
}

function appendNullableFinding(
  lines: string[],
  finding: CandidateFinding | null,
  unknownText: string
): void {
  if (finding === null) {
    lines.push(
      `**Unknown:** ${unknownText}`,
      "",
      "- **Basis:** unknown",
      "- **Evidence IDs:** none"
    );
    return;
  }
  appendFinding(lines, finding, unknownText);
}

function appendFinding(
  lines: string[],
  finding: CandidateFinding,
  unknownText: string
): void {
  if (finding.value === null || finding.basis === "unknown") {
    lines.push(`**Unknown:** ${finding.value ?? unknownText}`);
  } else {
    lines.push(...finding.value.split("\n").map((line) => `> ${line}`));
  }
  lines.push(
    "",
    `- **Basis:** ${finding.basis}`,
    `- **Evidence IDs:** ${formatEvidenceIds(finding.evidenceIds)}`
  );
  if (finding.confidence !== undefined) {
    lines.push(`- **Confidence:** ${finding.confidence}`);
  }
  if (finding.confidenceReason !== undefined) {
    lines.push(`- **Confidence reason:** ${finding.confidenceReason}`);
  }
}

function formatEvidenceIds(evidenceIds: string[]): string {
  return evidenceIds.length === 0
    ? "none"
    : evidenceIds.map((id) => `\`${id}\``).join(", ");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
