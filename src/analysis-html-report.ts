import {
  AnalysisSchema,
  OUTCOME_SUPPORT_VALUES,
  type Analysis,
  type CandidateFinding,
  type OutcomeSupport
} from "./analysis-definitions.ts";
import {
  ValidationSummarySchema,
  type ValidationSummary
} from "./analysis-validator.ts";
import {
  EvidenceBundleSchema,
  type EvidenceBundle,
  type EvidenceItem
} from "./evidence-bundle.ts";
import { escapeHtml, formatHtmlText } from "./html.ts";
import { SafeAnalysisRunIdSchema } from "./session-disposition.ts";

const OUTCOME_SUPPORT_EXPLANATIONS = {
  reported_only:
    "A reported outcome is present, but independent support was not established.",
  independently_supported:
    "Captured result-bearing evidence supports the validated outcome finding.",
  contradicted: "Captured evidence conflicts with the reported outcome.",
  unknown: "The relationship cannot be established from the supplied evidence."
} as const satisfies Record<OutcomeSupport, string>;

type EvidenceResolver = (evidenceIds: readonly string[]) => ResolvedEvidence[];
type ResolvedEvidence =
  | { kind: "available"; item: EvidenceItem }
  | { kind: "unavailable"; evidenceId: string };

export function renderAnalysisHtmlReport(
  bundleInput: EvidenceBundle,
  analysisInput: Analysis,
  summaryInput: ValidationSummary,
  runIdInput: string
): string {
  const bundle = EvidenceBundleSchema.parse(bundleInput);
  const analysis = AnalysisSchema.parse(analysisInput);
  const summary = ValidationSummarySchema.parse(summaryInput);
  const runId = SafeAnalysisRunIdSchema.parse(runIdInput);
  if (summary.runId !== runId) {
    throw new Error("Validation summary run id does not match the report run id");
  }

  const resolveEvidence = createEvidenceResolver(bundle);
  const humanSummary = renderSummaryFindings(
    analysis.humanInterventions,
    "No validated human intervention was identified."
  );
  const uncertaintySummary = renderSummaryFindings(
    analysis.evidenceGaps,
    "No explicit evidence gap was recorded."
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kea session analysis</title>
  <style>
    :root { color-scheme: light; --ink:#18211d; --muted:#5d6963; --paper:#f6f4ed; --card:#fffdf7; --line:#d9d6c9; --accent:#19644a; --soft:#e7f0ea; --warn:#8a5317; --danger:#8c3131; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main, header { width:min(1120px,calc(100% - 32px)); margin-inline:auto; }
    header { padding:48px 0 20px; }
    h1,h2,h3 { line-height:1.18; margin:0 0 .65rem; }
    h1 { font-size:clamp(2rem,6vw,3.6rem); letter-spacing:-.045em; }
    h2 { margin-top:2.6rem; font-size:clamp(1.35rem,3vw,2rem); }
    h3 { font-size:1.03rem; }
    p { margin:.45rem 0; }
    .eyebrow { color:var(--accent); font-size:.78rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
    .lede { color:var(--muted); max-width:70ch; font-size:1.08rem; }
    .leadership-scan { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin:18px 0 34px; }
    .card,.finding,.audit-action { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; }
    .card.wide { grid-column:1/-1; }
    .question { color:var(--muted); font-size:.79rem; font-weight:800; letter-spacing:.055em; text-transform:uppercase; }
    .finding-list { display:grid; gap:12px; }
    .finding-value { font-size:1.02rem; white-space:pre-wrap; overflow-wrap:anywhere; }
    .unknown { color:var(--warn); font-weight:700; }
    .badge { display:inline-block; margin:0 .4rem .45rem 0; border-radius:999px; padding:.18rem .55rem; background:var(--soft); color:var(--accent); font-size:.74rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
    .status { background:#eee9db; color:#5f5334; }
    .meta { color:var(--muted); font-size:.9rem; }
    .outcome-verdict { border-left:5px solid var(--accent); }
    details { margin-top:12px; border-top:1px solid var(--line); padding-top:9px; }
    summary { cursor:pointer; color:var(--accent); font-weight:750; }
    .evidence-list { display:grid; gap:10px; margin-top:10px; }
    .evidence { border-left:3px solid var(--line); padding:8px 10px; background:#faf8f1; }
    .evidence.unavailable { border-color:var(--danger); color:var(--danger); }
    pre { margin:.55rem 0 0; white-space:pre-wrap; overflow-wrap:anywhere; font:13px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace; }
    .turning-groups { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
    .turning-groups details { border:1px solid var(--line); border-radius:10px; padding:10px; }
    .audit { margin:40px 0 0; padding-top:20px; border-top:2px solid var(--line); }
    .audit > details { background:#efede5; border:1px solid var(--line); border-radius:14px; padding:16px; }
    .audit-actions { display:grid; gap:10px; margin-top:12px; }
    .compact-meta { margin:28px 0 56px; color:var(--muted); font-size:.86rem; }
    dl { display:grid; grid-template-columns:max-content 1fr; gap:.25rem .8rem; }
    dt { font-weight:750; } dd { margin:0; overflow-wrap:anywhere; }
    @media (max-width:760px) { .leadership-scan,.turning-groups { grid-template-columns:1fr; } .card.wide { grid-column:auto; } header { padding-top:28px; } main,header { width:min(100% - 20px,1120px); } dl { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <p class="eyebrow">Kea leadership report</p>
    <h1>Session analysis</h1>
    <p class="lede">A validated, evidence-backed account of the attempted work, supported outcome, human judgment, and remaining uncertainty.</p>
  </header>
  <main>
    <section class="leadership-scan" aria-labelledby="leadership-summary">
      <h2 id="leadership-summary" class="card wide">Leadership summary</h2>
      <article class="card wide">
        <p class="question">What was attempted?</p>
        ${renderFinding("Objective", analysis.objective, resolveEvidence)}
      </article>
      <article class="card wide outcome-verdict">
        <p class="question">What outcome is independently supported?</p>
        ${renderOutcomeSupport(analysis.outcomeSupport)}
        ${renderNullableFinding("What Codex reported", analysis.reportedOutcome, resolveEvidence)}
        ${renderNullableFinding("What captured evidence independently supports", analysis.independentlySupportedOutcome, resolveEvidence)}
      </article>
      <article class="card">
        <p class="question">Where did human judgment matter?</p>
        ${humanSummary}
      </article>
      <article class="card">
        <p class="question">What remains uncertain?</p>
        ${uncertaintySummary}
      </article>
    </section>

    ${renderFindingSection("Approaches and statuses", analysis.approaches, resolveEvidence, (finding) => `<span class="badge status">${escapeHtml(finding.status)}</span>`)}
    ${renderFindingSection("Human interventions", analysis.humanInterventions, resolveEvidence, (finding) => `<p class="meta"><strong>Category:</strong> ${escapeHtml(finding.category)} · <strong>Why:</strong> ${escapeHtml(finding.justification)}</p>`)}
    ${renderTurningPoints(analysis.turningPoints, resolveEvidence)}
    ${renderFindingSection("Codex contributions", analysis.codexContributions, resolveEvidence)}
    ${renderFindingSection("Leadership insights", analysis.leadershipInsights, resolveEvidence)}
    ${renderFindingSection("Evidence gaps and unknowns", analysis.evidenceGaps, resolveEvidence)}
    ${renderValidationAudit(summary, resolveEvidence)}
    ${renderMetadata(bundle, runId)}
  </main>
</body>
</html>
`;
}

function createEvidenceResolver(bundle: EvidenceBundle): EvidenceResolver {
  const evidenceById = new Map(bundle.evidence.map((item) => [item.id, item]));
  return (evidenceIds) =>
    evidenceIds.map((evidenceId) => {
      const item = evidenceById.get(evidenceId);
      return item === undefined
        ? { kind: "unavailable", evidenceId }
        : { kind: "available", item };
    });
}

function renderFinding(
  label: string,
  finding: CandidateFinding,
  resolveEvidence: EvidenceResolver,
  extra = "",
  includeEvidence = true
): string {
  const value =
    finding.value === null
      ? '<span class="unknown">Unknown — the supplied evidence was insufficient.</span>'
      : `<span class="finding-value">${escapeHtml(finding.value)}</span>`;
  const confidence =
    finding.basis === "inference" && finding.confidence !== undefined
      ? `<p class="meta"><strong>Confidence:</strong> ${escapeHtml(finding.confidence)}${finding.confidenceReason ? ` — ${escapeHtml(finding.confidenceReason)}` : ""}</p>`
      : "";
  return `<div class="finding">
    <h3>${escapeHtml(label)}</h3>
    <span class="badge">${escapeHtml(finding.basis)}</span>${extra}
    <p>${value}</p>
    ${confidence}
    ${includeEvidence ? renderEvidenceDisclosure("Evidence", finding.evidenceIds, resolveEvidence) : ""}
  </div>`;
}

function renderNullableFinding(
  label: string,
  finding: CandidateFinding | null,
  resolveEvidence: EvidenceResolver
): string {
  return finding === null
    ? `<div class="finding"><h3>${escapeHtml(label)}</h3><p class="meta">No validated finding was present.</p></div>`
    : renderFinding(label, finding, resolveEvidence);
}

function renderSummaryFindings(
  findings: readonly CandidateFinding[],
  emptyMessage: string
): string {
  if (findings.length === 0) return `<p class="meta">${escapeHtml(emptyMessage)}</p>`;
  return `<div class="finding-list">${findings
    .map(
      (finding) =>
        `<div><span class="badge">${escapeHtml(finding.basis)}</span><span>${finding.value === null ? '<span class="unknown">Unknown</span>' : escapeHtml(finding.value)}</span></div>`
    )
    .join("")}</div>`;
}

function renderOutcomeSupport(outcomeSupport: OutcomeSupport): string {
  if (!OUTCOME_SUPPORT_VALUES.includes(outcomeSupport)) {
    throw new Error("Unsupported outcome-support value");
  }
  return `<div class="finding"><h3>Outcome-support verdict</h3><span class="badge status">${escapeHtml(outcomeSupport)}</span><p>${escapeHtml(OUTCOME_SUPPORT_EXPLANATIONS[outcomeSupport])}</p></div>`;
}

function renderFindingSection<T extends CandidateFinding>(
  title: string,
  findings: readonly T[],
  resolveEvidence: EvidenceResolver,
  extra?: (finding: T) => string
): string {
  const content =
    findings.length === 0
      ? '<p class="meta">No validated findings in this section.</p>'
      : `<div class="finding-list">${findings
          .map((finding, index) =>
            renderFinding(
              `${title.replace(/ and statuses$/u, "")} ${index + 1}`,
              finding,
              resolveEvidence,
              extra?.(finding) ?? ""
            )
          )
          .join("")}</div>`;
  return `<section><h2>${escapeHtml(title)}</h2>${content}</section>`;
}

function renderTurningPoints(
  findings: Analysis["turningPoints"],
  resolveEvidence: EvidenceResolver
): string {
  const content =
    findings.length === 0
      ? '<p class="meta">No validated turning points.</p>'
      : `<div class="finding-list">${findings
          .map(
            (finding, index) => `<article class="finding">
              ${renderFinding(`Turning point ${index + 1}`, finding, resolveEvidence, "", false)}
              <div class="turning-groups">
                ${renderEvidenceDisclosure("Before evidence", finding.beforeEvidenceIds, resolveEvidence)}
                ${renderEvidenceDisclosure("After evidence", finding.afterEvidenceIds, resolveEvidence)}
                ${renderEvidenceDisclosure("Canonical citations", finding.evidenceIds, resolveEvidence)}
              </div>
            </article>`
          )
          .join("")}</div>`;
  return `<section><h2>Turning points</h2>${content}</section>`;
}

function renderEvidenceDisclosure(
  label: string,
  evidenceIds: readonly string[],
  resolveEvidence: EvidenceResolver
): string {
  const resolved = resolveEvidence(evidenceIds);
  const content =
    resolved.length === 0
      ? '<p class="meta">No evidence IDs supplied.</p>'
      : `<div class="evidence-list">${resolved.map(renderResolvedEvidence).join("")}</div>`;
  return `<details><summary>${escapeHtml(label)} (${evidenceIds.length})</summary>${content}</details>`;
}

function renderResolvedEvidence(evidence: ResolvedEvidence): string {
  if (evidence.kind === "unavailable") {
    return `<article class="evidence unavailable"><strong>${escapeHtml(evidence.evidenceId)}</strong><p>Evidence unavailable in supplied sanitized bundle</p></article>`;
  }
  const { item } = evidence;
  return `<article class="evidence">
    <strong>${escapeHtml(item.id)}</strong>
    <p class="meta">${escapeHtml(item.sourceClass)}${item.timestamp ? ` · ${escapeHtml(item.timestamp)}` : ""}</p>
    <pre>${escapeHtml(formatHtmlText(item.content))}</pre>
  </article>`;
}

function renderValidationAudit(
  summary: ValidationSummary,
  resolveEvidence: EvidenceResolver
): string {
  const actions =
    summary.actions.length === 0
      ? '<p class="meta">The deterministic validator recorded no corrections.</p>'
      : `<div class="audit-actions">${summary.actions
          .map(
            (action) => `<article class="audit-action">
              <h3>${escapeHtml(action.action)}</h3>
              <p><strong>Target:</strong> ${escapeHtml(action.target)}</p>
              ${action.code ? `<p><strong>Code:</strong> ${escapeHtml(action.code)}</p>` : ""}
              <p><strong>Reason:</strong> ${escapeHtml(action.reason)}</p>
              ${renderEvidenceDisclosure("Relevant evidence", action.evidenceIds, resolveEvidence)}
            </article>`
          )
          .join("")}</div>`;
  return `<section class="audit"><h2>Validation audit</h2><p class="meta">Deterministic validator corrections are separate from the validated findings above.</p><details><summary>${summary.rejectedCount} rejected · ${summary.downgradedCount} downgraded · ${summary.amendedCount} amended</summary>${actions}</details></section>`;
}

function renderMetadata(bundle: EvidenceBundle, runId: string): string {
  const sessionId = bundle.session.sessionId ?? "Session identity unavailable";
  return `<section class="compact-meta"><h2>Session and run metadata</h2><dl>
    <dt>Session</dt><dd>${escapeHtml(sessionId)}</dd>
    <dt>Run</dt><dd>${escapeHtml(runId)}</dd>
    <dt>First observed</dt><dd>${escapeHtml(bundle.session.firstObservedAt ?? "Unavailable")}</dd>
    <dt>Last observed</dt><dd>${escapeHtml(bundle.session.lastObservedAt ?? "Unavailable")}</dd>
    <dt>Evidence items</dt><dd>${escapeHtml(bundle.evidence.length)}</dd>
  </dl></section>`;
}
