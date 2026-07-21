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

const OUTCOME_SUPPORT_LABELS = {
  reported_only: "Reported, not independently verified",
  independently_supported: "Independently supported",
  contradicted: "Contradicted by captured evidence",
  unknown: "Support relationship unknown"
} as const satisfies Record<OutcomeSupport, string>;

const OUTCOME_SUPPORT_CLASSES = {
  reported_only: "verdict-reported",
  independently_supported: "verdict-supported",
  contradicted: "verdict-contradicted",
  unknown: "verdict-unknown"
} as const satisfies Record<OutcomeSupport, string>;

type EvidenceResolver = (evidenceIds: readonly string[]) => ResolvedEvidence[];
type ResolvedEvidence =
  | { kind: "available"; item: EvidenceItem }
  | { kind: "unavailable"; evidenceId: string };
type FindingRenderOptions = {
  className?: string;
  extra?: string;
  includeEvidence?: boolean;
  headingLevel?: 3 | 4;
};

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
  const sessionReference = shortSessionReference(bundle.session.sessionId);
  const humanSummary = renderSummaryFindings(
    analysis.humanInterventions,
    "No validated human intervention was identified.",
    2
  );
  const uncertaintySummary = renderSummaryFindings(
    analysis.evidenceGaps,
    "No explicit evidence gap was recorded.",
    1
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kea for Codex — validated session brief</title>
  <style>
    :root {
      color-scheme:light;
      --ink:#211b1d;
      --muted:#6d6265;
      --paper:#f6f2ec;
      --surface:#fffdfa;
      --surface-subtle:#f1ece6;
      --line:#d9d0ca;
      --brand:#6f263d;
      --brand-dark:#4b1728;
      --brand-soft:#f2e7eb;
      --support:#315e73;
      --support-dark:#244858;
      --support-soft:#e7f0f3;
      --uncertain:#805d19;
      --uncertain-soft:#f6edd9;
      --danger:#8a373c;
      --danger-soft:#f5e5e5;
      --shadow:0 18px 44px rgba(54,38,39,.08);
    }
    * { box-sizing:border-box; }
    html { scroll-behavior:auto; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.58 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    body::before { content:""; display:block; height:5px; background:var(--brand); }
    main,.masthead-inner { width:min(1160px,calc(100% - 40px)); margin-inline:auto; }
    .masthead { background:var(--surface); border-bottom:1px solid var(--line); }
    .masthead-inner { padding:26px 0 30px; }
    .brand-row { display:flex; align-items:baseline; justify-content:space-between; gap:24px; }
    .brand-lockup { display:flex; align-items:baseline; gap:14px; min-width:0; }
    .wordmark { color:var(--brand-dark); font:800 clamp(1.65rem,4vw,2.2rem)/1 Georgia,"Times New Roman",serif; letter-spacing:-.045em; }
    .brand-line { color:var(--muted); font-size:.9rem; }
    .masthead-meta { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px 18px; color:var(--muted); font-size:.78rem; }
    .masthead-meta span { overflow-wrap:anywhere; }
    .report-label { margin:30px 0 8px; color:var(--brand); font-size:.73rem; font-weight:850; letter-spacing:.14em; text-transform:uppercase; }
    h1,h2,h3,h4 { color:var(--ink); line-height:1.16; margin:0; }
    h1 { font:700 clamp(2.15rem,6vw,4.25rem)/1.02 Georgia,"Times New Roman",serif; letter-spacing:-.045em; }
    h2 { font:700 clamp(1.65rem,4vw,2.45rem)/1.08 Georgia,"Times New Roman",serif; letter-spacing:-.025em; }
    h3 { font-size:1.04rem; }
    h4 { font-size:.98rem; }
    p { margin:.5rem 0; }
    main { padding:44px 0 72px; }
    section + section { margin-top:72px; }
    .section-heading { display:grid; grid-template-columns:minmax(0,1fr) minmax(240px,.65fr); gap:32px; align-items:end; margin-bottom:24px; }
    .section-kicker,.card-label { color:var(--brand); font-size:.72rem; font-weight:850; letter-spacing:.12em; text-transform:uppercase; }
    .section-kicker { margin:0 0 8px; }
    .section-intro { color:var(--muted); margin:0; max-width:58ch; }
    .executive-snapshot { margin-top:0; }
    .objective-panel { margin-top:24px; padding:24px 26px; background:var(--surface); border:1px solid var(--line); border-left:5px solid var(--brand); border-radius:12px; }
    .objective-panel .finding { padding:0; border:0; background:transparent; box-shadow:none; }
    .snapshot-grid { display:grid; grid-template-columns:minmax(0,1.55fr) repeat(2,minmax(220px,.72fr)); gap:16px; margin-top:16px; align-items:stretch; }
    .snapshot-card { min-width:0; padding:22px; background:var(--surface); border:1px solid var(--line); border-radius:14px; }
    .supported-card { background:var(--support-soft); border-color:#b8ced7; box-shadow:var(--shadow); }
    .supported-card .card-label { color:var(--support-dark); }
    .supported-card .finding { padding:12px 0 0; border:0; background:transparent; box-shadow:none; }
    .judgment-card { border-top:4px solid var(--brand); }
    .uncertainty-card { background:var(--uncertain-soft); border-color:#deca9f; border-top:4px solid var(--uncertain); }
    .summary-list { display:grid; gap:12px; margin-top:14px; }
    .summary-item { padding-top:12px; border-top:1px solid rgba(77,60,62,.15); }
    .summary-item:first-child { padding-top:0; border-top:0; }
    .summary-more { color:var(--muted); font-size:.86rem; margin-top:14px; }
    .outcome-comparison { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
    .outcome-column { min-width:0; padding:22px; background:var(--surface); border:1px solid var(--line); border-radius:14px; }
    .outcome-column.reported { border-top:4px solid var(--brand); }
    .outcome-column.supported { border-top:4px solid var(--support); }
    .outcome-column > .finding { margin-top:14px; }
    .verdict { display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,.72fr); gap:24px; align-items:center; margin-top:16px; padding:18px 20px; border:1px solid var(--line); border-radius:12px; background:var(--surface-subtle); }
    .verdict-name { display:block; margin-top:3px; font-size:1.12rem; }
    .verdict p { color:var(--muted); margin:0; }
    .verdict-supported { border-left:5px solid var(--support); background:var(--support-soft); }
    .verdict-reported,.verdict-unknown { border-left:5px solid var(--uncertain); background:var(--uncertain-soft); }
    .verdict-contradicted { border-left:5px solid var(--danger); background:var(--danger-soft); }
    .finding-list,.approach-grid,.insight-grid { display:grid; gap:14px; }
    .approach-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .insight-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .finding { min-width:0; padding:18px; background:var(--surface); border:1px solid var(--line); border-radius:12px; }
    .finding-value { font-size:1rem; white-space:pre-wrap; overflow-wrap:anywhere; }
    .finding-supported { border-color:#b8ced7; }
    .finding-insight { border-left:4px solid var(--brand); }
    .finding-gap { border-left:4px solid var(--uncertain); background:#fffcf5; }
    .unknown { color:var(--uncertain); font-weight:780; }
    .badge { display:inline-flex; align-items:center; max-width:100%; margin:.55rem .4rem .25rem 0; border:1px solid #d8c9ce; border-radius:999px; padding:.17rem .52rem; background:var(--brand-soft); color:var(--brand-dark); font-size:.69rem; font-weight:850; letter-spacing:.055em; text-transform:uppercase; overflow-wrap:anywhere; }
    .badge.status { background:var(--surface-subtle); border-color:var(--line); color:#5d5355; }
    .badge.audit-badge { background:var(--surface-subtle); border-color:var(--line); }
    .meta { color:var(--muted); font-size:.86rem; }
    .timeline { position:relative; display:grid; gap:18px; margin:0; padding:0 0 0 30px; list-style:none; counter-reset:turning-point; }
    .timeline::before { content:""; position:absolute; left:8px; top:10px; bottom:10px; width:1px; background:var(--line); }
    .timeline-item { position:relative; counter-increment:turning-point; }
    .timeline-item::before { content:counter(turning-point); position:absolute; left:-30px; top:17px; display:grid; place-items:center; width:18px; height:18px; border:2px solid var(--brand); border-radius:50%; background:var(--paper); color:var(--brand); font-size:.62rem; font-weight:900; }
    .timeline-item > .finding { border-left:4px solid var(--brand); }
    .turning-groups { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:12px; }
    .turning-groups details { margin:0; padding:10px 12px; border:1px solid var(--line); border-radius:9px; background:var(--surface-subtle); }
    .collaboration-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
    .contribution-column { min-width:0; padding:22px; border:1px solid var(--line); border-radius:14px; background:var(--surface); }
    .contribution-column.human { border-top:4px solid var(--brand); }
    .contribution-column.codex { border-top:4px solid var(--support); }
    .contribution-column > .finding-list { margin-top:16px; }
    .takeaway-note { padding:18px 20px; border-left:4px solid var(--brand); background:var(--brand-soft); color:var(--brand-dark); }
    details { margin-top:12px; border-top:1px solid var(--line); padding-top:9px; }
    summary { color:var(--brand); cursor:pointer; font-weight:780; }
    summary:focus-visible,a:focus-visible { outline:3px solid var(--support); outline-offset:3px; }
    .evidence-list { display:grid; gap:10px; margin-top:12px; }
    .evidence { padding:10px 12px; border-left:3px solid var(--support); background:#f7fafb; }
    .evidence.unavailable { border-color:var(--danger); background:var(--danger-soft); color:var(--danger); }
    pre { margin:.55rem 0 0; white-space:pre-wrap; overflow-wrap:anywhere; font:12.5px/1.48 ui-monospace,SFMono-Regular,Consolas,monospace; }
    .trust-section { padding-top:28px; border-top:1px solid var(--line); }
    .trust-stack { display:grid; gap:12px; }
    .trust-panel { margin:0; padding:16px 18px; border:1px solid var(--line); border-radius:12px; background:var(--surface-subtle); }
    .trust-panel > summary { font-size:1rem; }
    .audit-actions { display:grid; gap:10px; margin-top:14px; }
    .audit-action { padding:16px; border:1px solid var(--line); border-radius:10px; background:var(--surface); }
    dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:.35rem 1rem; margin:16px 0 0; }
    dt { font-weight:780; }
    dd { margin:0; overflow-wrap:anywhere; }
    @media (max-width:900px) {
      .snapshot-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .supported-card { grid-column:1/-1; }
      .section-heading { grid-template-columns:1fr; gap:10px; }
      .turning-groups { grid-template-columns:1fr; }
    }
    @media (max-width:700px) {
      main,.masthead-inner { width:min(100% - 24px,1160px); }
      .masthead-inner { padding-top:20px; }
      .brand-row { align-items:flex-start; flex-direction:column; gap:12px; }
      .brand-lockup { align-items:flex-start; flex-direction:column; gap:4px; }
      .masthead-meta { justify-content:flex-start; }
      .report-label { margin-top:24px; }
      main { padding-top:30px; }
      section + section { margin-top:54px; }
      .snapshot-grid,.outcome-comparison,.approach-grid,.insight-grid,.collaboration-grid,.verdict { grid-template-columns:1fr; }
      .supported-card { grid-column:auto; }
      .objective-panel,.snapshot-card,.outcome-column,.contribution-column { padding:18px; }
      .timeline { padding-left:26px; }
      .timeline-item::before { left:-26px; }
      dl { grid-template-columns:1fr; gap:.15rem; }
      dd + dt { margin-top:.55rem; }
    }
    @media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto !important; } }
  </style>
</head>
<body>
  <header class="masthead">
    <div class="masthead-inner">
      <div class="brand-row">
        <div class="brand-lockup">
          <span class="wordmark">Kea</span>
          <span class="brand-line">Evidence for Codex-assisted development</span>
        </div>
        <div class="masthead-meta" aria-label="Session summary metadata">
          <span>${escapeHtml(sessionReference)}</span>
          <span>${escapeHtml(bundle.evidence.length)} evidence items</span>
          <span>Validated ${escapeHtml(summary.validatedAt)}</span>
        </div>
      </div>
      <p class="report-label">Validated session brief</p>
      <h1>Executive session brief</h1>
    </div>
  </header>
  <main>
    <section class="executive-snapshot" aria-labelledby="executive-snapshot-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Leadership summary</p>
          <h2 id="executive-snapshot-title">Executive snapshot</h2>
        </div>
        <p class="section-intro">The attempted work, independently supported result, human direction, and unresolved evidence—shown before the audit detail.</p>
      </div>
      <div class="objective-panel">
        <p class="card-label">What was attempted?</p>
        ${renderFinding("Session objective", analysis.objective, resolveEvidence)}
      </div>
      <div class="snapshot-grid">
        <article class="snapshot-card supported-card">
          <p class="card-label">What outcome is independently supported?</p>
          ${renderNullableFinding(
            "Supported outcome",
            analysis.independentlySupportedOutcome,
            resolveEvidence,
            "Unknown — no independently supported outcome was validated.",
            { className: "finding-supported" }
          )}
        </article>
        <article class="snapshot-card judgment-card">
          <p class="card-label">Where human judgment mattered</p>
          ${humanSummary}
        </article>
        <article class="snapshot-card uncertainty-card">
          <p class="card-label">Remaining uncertainty</p>
          ${uncertaintySummary}
        </article>
      </div>
    </section>

    <section aria-labelledby="outcome-comparison-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Claim versus evidence</p>
          <h2 id="outcome-comparison-title">Outcome comparison</h2>
        </div>
        <p class="section-intro">Kea keeps Codex's account separate from the result-bearing evidence captured during the session.</p>
      </div>
      <div class="outcome-comparison">
        <article class="outcome-column reported">
          <p class="card-label">What Codex reported</p>
          ${renderNullableFinding(
            "Reported outcome",
            analysis.reportedOutcome,
            resolveEvidence,
            "No validated reported outcome was present."
          )}
        </article>
        <article class="outcome-column supported">
          <p class="card-label">What the evidence supports</p>
          ${renderNullableFinding(
            "What captured evidence independently supports",
            analysis.independentlySupportedOutcome,
            resolveEvidence,
            "Unknown — no independently supported outcome was validated.",
            { className: "finding-supported" }
          )}
        </article>
      </div>
      ${renderOutcomeSupport(analysis.outcomeSupport)}
    </section>

    <section aria-labelledby="session-story-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Session story</p>
          <h2 id="session-story-title">How the work unfolded</h2>
        </div>
        <p class="section-intro">Validated turning points retain their ordered before-and-after evidence without creating a new global chronology.</p>
      </div>
      ${renderTurningPoints(analysis.turningPoints, resolveEvidence)}
    </section>

    <section aria-labelledby="approaches-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Technical path</p>
          <h2 id="approaches-title">Approaches and statuses</h2>
        </div>
        <p class="section-intro">Completed means an approach reached its conclusion; it does not by itself mean the approach succeeded.</p>
      </div>
      ${renderFindingGrid(
        "Approach",
        analysis.approaches,
        resolveEvidence,
        "approach-grid",
        (finding) => `<span class="badge status">${escapeHtml(finding.status)}</span>`
      )}
    </section>

    <section aria-labelledby="collaboration-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Collaboration</p>
          <h2 id="collaboration-title">Human and Codex contribution</h2>
        </div>
        <p class="section-intro">The report keeps human direction and observable Codex contributions balanced and separately evidenced.</p>
      </div>
      <div class="collaboration-grid">
        <section class="contribution-column human" aria-labelledby="human-interventions-title">
          <h3 id="human-interventions-title">Human interventions</h3>
          <p class="meta">Constraints, corrections, decisions, and other validated human direction.</p>
          ${renderFindingGrid(
            "Intervention",
            analysis.humanInterventions,
            resolveEvidence,
            "finding-list",
            (finding) => `<p class="meta"><strong>Category:</strong> ${escapeHtml(finding.category)}<br><strong>Why:</strong> ${escapeHtml(finding.justification)}</p>`,
            4
          )}
        </section>
        <section class="contribution-column codex" aria-labelledby="codex-contributions-title">
          <h3 id="codex-contributions-title">Codex contributions</h3>
          <p class="meta">Validated contributions do not imply that every attempted action succeeded.</p>
          ${renderFindingGrid(
            "Contribution",
            analysis.codexContributions,
            resolveEvidence,
            "finding-list",
            undefined,
            4
          )}
        </section>
      </div>
    </section>

    <section aria-labelledby="leadership-takeaways-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Decision context</p>
          <h2 id="leadership-takeaways-title">Leadership takeaways</h2>
        </div>
        <p class="section-intro">Existing validated insights only—no added recommendations, scores, or performance judgments.</p>
      </div>
      ${renderFindingGrid(
        "Takeaway",
        analysis.leadershipInsights,
        resolveEvidence,
        "insight-grid",
        undefined,
        3,
        "finding-insight"
      )}
    </section>

    <section aria-labelledby="verification-gaps-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Remaining uncertainty</p>
          <h2 id="verification-gaps-title">What still needs verification</h2>
        </div>
        <p class="section-intro">Unknowns stay visible when the retained evidence cannot support a stronger conclusion.</p>
      </div>
      ${renderFindingGrid(
        "Evidence gap",
        analysis.evidenceGaps,
        resolveEvidence,
        "finding-list",
        undefined,
        3,
        "finding-gap"
      )}
    </section>

    <section class="trust-section audit" aria-labelledby="trust-title">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Trust and provenance</p>
          <h2 id="trust-title">Validation and report details</h2>
        </div>
        <p class="section-intro">The deterministic validation audit remains part of the report, while staying secondary to the validated session brief.</p>
      </div>
      <div class="trust-stack">
        ${renderValidationAudit(summary, resolveEvidence)}
        ${renderMetadata(bundle, summary, runId)}
      </div>
    </section>
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
  options: FindingRenderOptions = {}
): string {
  const value =
    finding.value === null
      ? '<span class="unknown">Unknown — the supplied evidence was insufficient.</span>'
      : `<span class="finding-value">${escapeHtml(finding.value)}</span>`;
  const confidence =
    finding.basis === "inference" && finding.confidence !== undefined
      ? `<p class="meta"><strong>Confidence:</strong> ${escapeHtml(finding.confidence)}${finding.confidenceReason ? ` — ${escapeHtml(finding.confidenceReason)}` : ""}</p>`
      : "";
  const headingTag = options.headingLevel === 4 ? "h4" : "h3";
  const className = options.className ? ` ${options.className}` : "";
  return `<article class="finding${className}">
    <${headingTag}>${escapeHtml(label)}</${headingTag}>
    <span class="badge">${escapeHtml(finding.basis)}</span>${options.extra ?? ""}
    <p>${value}</p>
    ${confidence}
    ${options.includeEvidence === false ? "" : renderEvidenceDisclosure("Evidence", finding.evidenceIds, resolveEvidence)}
  </article>`;
}

function renderNullableFinding(
  label: string,
  finding: CandidateFinding | null,
  resolveEvidence: EvidenceResolver,
  nullMessage: string,
  options: FindingRenderOptions = {}
): string {
  if (finding !== null) {
    return renderFinding(label, finding, resolveEvidence, options);
  }
  const headingTag = options.headingLevel === 4 ? "h4" : "h3";
  const className = options.className ? ` ${options.className}` : "";
  return `<article class="finding${className}"><${headingTag}>${escapeHtml(label)}</${headingTag}><p class="unknown">${escapeHtml(nullMessage)}</p></article>`;
}

function renderSummaryFindings(
  findings: readonly CandidateFinding[],
  emptyMessage: string,
  visibleLimit: number
): string {
  if (findings.length === 0) return `<p class="meta">${escapeHtml(emptyMessage)}</p>`;
  const visible = findings.slice(0, visibleLimit);
  const remaining = findings.length - visible.length;
  return `<div class="summary-list">${visible
    .map(
      (finding) =>
        `<div class="summary-item"><span class="badge">${escapeHtml(finding.basis)}</span><p>${finding.value === null ? '<span class="unknown">Unknown</span>' : escapeHtml(finding.value)}</p></div>`
    )
    .join("")}</div>${remaining > 0 ? `<p class="summary-more">${escapeHtml(remaining)} more ${remaining === 1 ? "finding is" : "findings are"} detailed below.</p>` : ""}`;
}

function renderOutcomeSupport(outcomeSupport: OutcomeSupport): string {
  if (!OUTCOME_SUPPORT_VALUES.includes(outcomeSupport)) {
    throw new Error("Unsupported outcome-support value");
  }
  return `<aside class="verdict ${OUTCOME_SUPPORT_CLASSES[outcomeSupport]}" aria-label="Outcome-support verdict">
    <div><span class="card-label">Outcome-support verdict</span><strong class="verdict-name">${escapeHtml(OUTCOME_SUPPORT_LABELS[outcomeSupport])}</strong></div>
    <p>${escapeHtml(OUTCOME_SUPPORT_EXPLANATIONS[outcomeSupport])}</p>
  </aside>`;
}

function renderFindingGrid<T extends CandidateFinding>(
  singularLabel: string,
  findings: readonly T[],
  resolveEvidence: EvidenceResolver,
  gridClass: string,
  extra?: (finding: T) => string,
  headingLevel: 3 | 4 = 3,
  findingClassName?: string
): string {
  if (findings.length === 0) {
    return '<p class="meta">No validated findings in this section.</p>';
  }
  return `<div class="${gridClass}">${findings
    .map((finding, index) =>
      renderFinding(`${singularLabel} ${index + 1}`, finding, resolveEvidence, {
        ...(findingClassName === undefined ? {} : { className: findingClassName }),
        ...(extra === undefined ? {} : { extra: extra(finding) }),
        headingLevel
      })
    )
    .join("")}</div>`;
}

function renderTurningPoints(
  findings: Analysis["turningPoints"],
  resolveEvidence: EvidenceResolver
): string {
  if (findings.length === 0) {
    return '<p class="meta">No validated turning points.</p>';
  }
  return `<ol class="timeline">${findings
    .map(
      (finding, index) => `<li class="timeline-item">
        ${renderFinding(`Turning point ${index + 1}`, finding, resolveEvidence, { includeEvidence: false })}
        <div class="turning-groups">
          ${renderEvidenceDisclosure("Before evidence", finding.beforeEvidenceIds, resolveEvidence)}
          ${renderEvidenceDisclosure("After evidence", finding.afterEvidenceIds, resolveEvidence)}
          ${renderEvidenceDisclosure("Canonical citations", finding.evidenceIds, resolveEvidence)}
        </div>
      </li>`
    )
    .join("")}</ol>`;
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
  return `<details><summary>${escapeHtml(label)} (${escapeHtml(evidenceIds.length)})</summary>${content}</details>`;
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
              <span class="badge audit-badge">${escapeHtml(action.action)}</span>
              <h3>${escapeHtml(action.target)}</h3>
              ${action.code ? `<p><strong>Code:</strong> ${escapeHtml(action.code)}</p>` : ""}
              <p><strong>Reason:</strong> ${escapeHtml(action.reason)}</p>
              ${renderEvidenceDisclosure("Relevant evidence", action.evidenceIds, resolveEvidence)}
            </article>`
          )
          .join("")}</div>`;
  return `<details class="trust-panel"><summary>Validation audit — ${escapeHtml(summary.rejectedCount)} rejected · ${escapeHtml(summary.downgradedCount)} downgraded · ${escapeHtml(summary.amendedCount)} amended</summary><p class="meta">Deterministic validator corrections remain separate from the validated findings above.</p>${actions}</details>`;
}

function renderMetadata(
  bundle: EvidenceBundle,
  summary: ValidationSummary,
  runId: string
): string {
  const sessionId = bundle.session.sessionId ?? "Session identity unavailable";
  return `<details class="trust-panel"><summary>Session and run metadata</summary><dl>
    <dt>Session</dt><dd>${escapeHtml(sessionId)}</dd>
    <dt>Run</dt><dd>${escapeHtml(runId)}</dd>
    <dt>Validated</dt><dd>${escapeHtml(summary.validatedAt)}</dd>
    <dt>First observed</dt><dd>${escapeHtml(bundle.session.firstObservedAt ?? "Unavailable")}</dd>
    <dt>Last observed</dt><dd>${escapeHtml(bundle.session.lastObservedAt ?? "Unavailable")}</dd>
    <dt>Evidence items</dt><dd>${escapeHtml(bundle.evidence.length)}</dd>
  </dl></details>`;
}

function shortSessionReference(sessionId: string | null): string {
  if (sessionId === null) return "Session identity unavailable";
  const characters = [...sessionId];
  const shortId = characters.slice(0, 8).join("");
  return `Session ${shortId}${characters.length > 8 ? "…" : ""}`;
}
