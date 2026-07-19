import { dirname, relative, sep } from "node:path";
import type {
  EvidenceRef,
  GitSnapshot,
  NormalizedEvent,
  NormalizedSession
} from "./codex-session-adapter.ts";

export type EvidenceBasis = "observed" | "explicit" | "inference" | "unknown";

export type Finding<T> = {
  value: T | null;
  basis: EvidenceBasis;
  evidence: EvidenceRef[];
};

export type ReportAttempt = {
  toolName: string | null;
  input: unknown;
  response: unknown;
  completion: "completed" | "incomplete";
  failure: Finding<string>;
  evidence: EvidenceRef[];
};

export type SessionAnalysis = {
  sessionId: string | null;
  objective: Finding<string>;
  attempts: ReportAttempt[];
  humanDirections: Finding<string>[];
  outcome: Finding<string>;
  gitStart: Finding<GitSnapshot>;
  gitEnd: Finding<GitSnapshot>;
};

export function analyzeSession(session: NormalizedSession): SessionAnalysis {
  const prompts = session.events.filter(isUserPrompt);
  const stops = session.events.filter(isTurnStop);
  const starts = session.events.filter(isSessionStart);
  const attempts: ReportAttempt[] = [];
  const attemptsById = new Map<string, ReportAttempt>();

  for (const event of session.events) {
    if (event.type === "tool_attempt") {
      const attempt: ReportAttempt = {
        toolName: event.toolName,
        input: event.input,
        response: null,
        completion: "incomplete",
        failure: unknownFailure(),
        evidence: [event.evidence]
      };
      attempts.push(attempt);
      if (event.toolUseId !== null) {
        attemptsById.set(event.toolUseId, attempt);
      }
      continue;
    }

    if (event.type === "tool_result") {
      const existing = event.toolUseId === null ? null : attemptsById.get(event.toolUseId);
      const attempt = existing ?? {
        toolName: event.toolName,
        input: event.input,
        response: null,
        completion: "incomplete" as const,
        failure: unknownFailure(),
        evidence: []
      };

      if (existing === undefined || existing === null) {
        attempts.push(attempt);
      }

      attempt.response = event.response;
      attempt.completion = "completed";
      attempt.evidence.push(event.evidence);
      attempt.failure = detectFailure(event.response, event.evidence);
    }
  }

  const firstPrompt = prompts[0];
  const lastStop = stops.at(-1);
  const firstStart = starts[0];

  return {
    sessionId: session.sessionId,
    objective: firstPrompt
      ? { value: firstPrompt.prompt, basis: "explicit", evidence: [firstPrompt.evidence] }
      : { value: null, basis: "unknown", evidence: [] },
    attempts,
    humanDirections: prompts.slice(1).map((prompt) => ({
      value: prompt.prompt,
      basis: "explicit",
      evidence: [prompt.evidence]
    })),
    outcome: lastStop?.lastAssistantMessage
      ? {
          value: lastStop.lastAssistantMessage,
          basis: "explicit",
          evidence: [lastStop.evidence]
        }
      : { value: null, basis: "unknown", evidence: [] },
    gitStart: firstStart?.git
      ? { value: firstStart.git, basis: "observed", evidence: [firstStart.evidence] }
      : { value: null, basis: "unknown", evidence: [] },
    gitEnd: lastStop?.git
      ? { value: lastStop.git, basis: "observed", evidence: [lastStop.evidence] }
      : { value: null, basis: "unknown", evidence: [] }
  };
}

export function renderSessionReport(
  session: NormalizedSession,
  analysis: SessionAnalysis,
  reportPath: string
): string {
  const lines: string[] = [
    "# Codex Session Report",
    "",
    `- **Session:** ${analysis.sessionId ?? "unknown"}`,
    `- **First observed:** ${session.firstObservedAt ?? "unknown"}`,
    `- **Last observed:** ${session.lastObservedAt ?? "unknown"}`,
    `- **Working directory:** ${session.cwd ?? "unknown"}`,
    `- **Model:** ${session.model ?? "unknown"}`,
    "",
    "## Objective",
    ""
  ];

  appendTextFinding(lines, analysis.objective, reportPath, "No explicit objective was observed.");
  lines.push("", "## Attempts", "");

  if (analysis.attempts.length === 0) {
    lines.push("No tool attempt was observed.");
  } else {
    analysis.attempts.forEach((attempt, index) => {
      lines.push(
        `### ${index + 1}. ${attempt.toolName ?? "Unknown tool"}`,
        "",
        `- **Completion:** ${attempt.completion}`,
        `- **Input:** ${summarize(attempt.input)}`,
        `- **Result:** ${summarize(attempt.response)}`,
        `- **Failure assessment:** ${attempt.failure.value ?? "unknown"}`,
        `- **Evidence:** ${formatEvidence(attempt.evidence, reportPath)}`,
        ""
      );
    });
  }

  lines.push("## Failures", "");
  const failures = analysis.attempts.filter((attempt) => attempt.failure.value !== null);
  if (failures.length === 0) {
    lines.push(
      "**Unknown:** no structured tool response established a failure. A completed tool call is not treated as proof of success."
    );
  } else {
    for (const attempt of failures) {
      lines.push(
        `- ${attempt.toolName ?? "Unknown tool"}: ${attempt.failure.value} (${formatEvidence(attempt.failure.evidence, reportPath)})`
      );
    }
  }

  lines.push("", "## Human Directions And Corrections", "");
  if (analysis.humanDirections.length === 0) {
    lines.push("**Unknown:** no subsequent human direction was observed.");
  } else {
    analysis.humanDirections.forEach((direction, index) => {
      lines.push(`### ${index + 1}`, "");
      appendTextFinding(lines, direction, reportPath, "Unknown");
      lines.push("");
    });
  }

  lines.push("", "## Reported Outcome", "");
  appendTextFinding(
    lines,
    analysis.outcome,
    reportPath,
    "No assistant outcome statement was observed."
  );
  if (analysis.outcome.value !== null) {
    lines.push("", "This is an explicit assistant statement, not independently verified success.");
  }

  lines.push("", "## Git Evidence", "", "### Session Start", "");
  appendGitFinding(lines, analysis.gitStart, reportPath);
  lines.push("", "### Latest Turn Stop", "");
  appendGitFinding(lines, analysis.gitEnd, reportPath);

  lines.push("", "## Evidence Gaps", "");
  lines.push(
    "- Codex exposes turn-level `Stop`, not a reliable process-level `SessionEnd`.",
    "- Unstructured tool responses do not establish success or failure.",
    "- Hosted or specialized tools may not emit local tool hooks."
  );
  for (const diagnostic of session.diagnostics) {
    lines.push(`- Line ${diagnostic.line}: ${diagnostic.message}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function detectFailure(response: unknown, evidence: EvidenceRef): Finding<string> {
  if (!isRecord(response)) {
    return unknownFailure();
  }

  if (response.success === false) {
    return observedFailure("Tool response explicitly reported success=false.", evidence);
  }
  if (response.isError === true || response.is_error === true) {
    return observedFailure("Tool response explicitly reported an error.", evidence);
  }

  const exitCode = response.exitCode ?? response.exit_code;
  if (typeof exitCode === "number" && exitCode !== 0) {
    return observedFailure(`Tool response reported exit code ${exitCode}.`, evidence);
  }
  if (typeof response.error === "string" && response.error.trim() !== "") {
    return observedFailure("Tool response included an explicit error field.", evidence);
  }

  return unknownFailure();
}

function appendTextFinding(
  lines: string[],
  finding: Finding<string>,
  reportPath: string,
  unknownText: string
): void {
  if (finding.value === null) {
    lines.push(`**Unknown:** ${unknownText}`);
    return;
  }

  lines.push(
    ...finding.value.split("\n").map((line) => `> ${line}`),
    "",
    `- **Basis:** ${finding.basis}`,
    `- **Evidence:** ${formatEvidence(finding.evidence, reportPath)}`
  );
}

function appendGitFinding(
  lines: string[],
  finding: Finding<GitSnapshot>,
  reportPath: string
): void {
  if (finding.value === null) {
    lines.push("**Unknown:** no Git snapshot was observed.");
    return;
  }

  const snapshot = finding.value;
  lines.push(
    `- **HEAD:** ${snapshot.head ?? "unknown"}`,
    `- **Branch:** ${snapshot.branch ?? "unknown"}`,
    `- **Working tree status:** ${summarize(snapshot.status)}`,
    `- **Uncommitted diff captured:** ${snapshot.diff === null ? "unknown" : snapshot.diff === "" ? "no" : "yes"}`,
    `- **Capture errors:** ${snapshot.errors.length === 0 ? "none" : snapshot.errors.join("; ")}`,
    `- **Evidence:** ${formatEvidence(finding.evidence, reportPath)}`
  );
}

function formatEvidence(evidence: EvidenceRef[], reportPath: string): string {
  if (evidence.length === 0) {
    return "none";
  }

  return evidence
    .map((ref) => {
      const relativePath = relative(dirname(reportPath), ref.sourcePath).split(sep).join("/");
      const label = `${ref.eventName ?? "event"} line ${ref.line}`;
      return `[${label}](${relativePath}#L${ref.line})`;
    })
    .join(", ");
}

function summarize(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "unknown";
  }

  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (text === undefined || text === "") {
    return "unknown";
  }

  const singleLine = text.replace(/\s+/g, " ");
  return singleLine.length <= 240 ? singleLine : `${singleLine.slice(0, 237)}...`;
}

function observedFailure(value: string, evidence: EvidenceRef): Finding<string> {
  return { value, basis: "observed", evidence: [evidence] };
}

function unknownFailure(): Finding<string> {
  return { value: null, basis: "unknown", evidence: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUserPrompt(
  event: NormalizedEvent
): event is Extract<NormalizedEvent, { type: "user_prompt" }> {
  return event.type === "user_prompt";
}

function isTurnStop(
  event: NormalizedEvent
): event is Extract<NormalizedEvent, { type: "turn_stop" }> {
  return event.type === "turn_stop";
}

function isSessionStart(
  event: NormalizedEvent
): event is Extract<NormalizedEvent, { type: "session_start" }> {
  return event.type === "session_start";
}
