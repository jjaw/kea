import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { escapeHtml } from "./html.ts";
import {
  FinalSessionDispositionSchema,
  type FinalSessionDisposition
} from "./session-disposition.ts";
import {
  listLatestSessionDispositions,
  type PersistedSessionDisposition
} from "./session-disposition-store.ts";

export type RebuiltStaticReportIndex = {
  path: string;
  html: string;
  dispositionCount: number;
};

export function renderStaticReportIndex(
  persistedInputs: readonly PersistedSessionDisposition[],
  availableHtmlRunIds: ReadonlySet<string>,
  generatedAt: string
): string {
  const entries = persistedInputs
    .map((persisted) => ({
      storageKey: persisted.storageKey,
      disposition: FinalSessionDispositionSchema.parse(persisted.disposition)
    }))
    .sort(
      (left, right) =>
        right.disposition.receipt.evaluatedAt.localeCompare(
          left.disposition.receipt.evaluatedAt
        ) || left.storageKey.localeCompare(right.storageKey)
    );

  const cards =
    entries.length === 0
      ? '<p class="empty">No latest session dispositions are available yet.</p>'
      : entries
          .map(({ disposition }) =>
            renderDisposition(disposition, availableHtmlRunIds)
          )
          .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kea report inbox</title>
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
      --support-soft:#e7f0f3;
      --uncertain:#805d19;
      --uncertain-soft:#f6edd9;
      --danger:#8a373c;
      --danger-soft:#f5e5e5;
      --shadow:0 18px 44px rgba(54,38,39,.08);
    }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.58 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    body::before { content:""; display:block; height:5px; background:var(--brand); }
    main,.masthead-inner { width:min(1160px,calc(100% - 40px)); margin-inline:auto; }
    .masthead { background:var(--surface); border-bottom:1px solid var(--line); }
    .masthead-inner { padding:26px 0 34px; }
    .brand-row { display:flex; align-items:baseline; justify-content:space-between; gap:24px; }
    .brand-lockup { display:flex; align-items:baseline; gap:14px; min-width:0; }
    .wordmark { color:var(--brand-dark); font:800 clamp(1.65rem,4vw,2.2rem)/1 Georgia,"Times New Roman",serif; letter-spacing:-.045em; }
    .brand-line,.generated,.lede,.explanation,.session-reference,.evaluated { color:var(--muted); }
    .brand-line { font-size:.9rem; }
    .generated { margin:0; font-size:.78rem; text-align:right; }
    .inbox-label { margin:30px 0 8px; color:var(--brand); font-size:.73rem; font-weight:850; letter-spacing:.14em; text-transform:uppercase; }
    h1,h2,h3 { color:var(--ink); line-height:1.16; margin:0; }
    h1 { font:700 clamp(2.15rem,6vw,4.25rem)/1.02 Georgia,"Times New Roman",serif; letter-spacing:-.045em; }
    h2 { margin-top:.5rem; font-size:1.32rem; letter-spacing:-.015em; }
    .lede { max-width:62ch; margin:14px 0 0; font-size:1rem; }
    .inbox { display:grid; gap:18px; padding:40px 0 72px; }
    .empty { padding:28px; border:1px dashed var(--line); border-radius:14px; background:var(--surface); color:var(--muted); }
    .entry { position:relative; overflow:hidden; background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:24px 26px; box-shadow:0 10px 28px rgba(54,38,39,.04); }
    .entry::before { content:""; position:absolute; inset:0 auto 0 0; width:5px; background:var(--brand); }
    .entry.activity_only::before { background:var(--support); }
    .entry.blocked::before { background:var(--uncertain); }
    .entry.analysis_failed::before { background:var(--danger); }
    .entry-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; }
    .entry-meta { flex:0 0 auto; text-align:right; }
    .badge { display:inline-flex; align-items:center; border:1px solid #d8c9ce; border-radius:999px; padding:.2rem .62rem; background:var(--brand-soft); color:var(--brand-dark); font-size:.7rem; font-weight:850; letter-spacing:.07em; text-transform:uppercase; }
    .activity_only .badge { background:var(--support-soft); border-color:#b8ced7; color:#244858; }
    .blocked .badge { background:var(--uncertain-soft); border-color:#deca9f; color:var(--uncertain); }
    .analysis_failed .badge { background:var(--danger-soft); border-color:#dfbfc1; color:var(--danger); }
    .session-reference,.evaluated { margin:0; font-size:.84rem; }
    .explanation { max-width:66ch; margin:20px 0 0; }
    .action-row { margin:20px 0 4px; }
    .primary-action { display:inline-block; border-radius:8px; padding:.7rem 1rem; background:var(--brand); color:#fff; font-weight:800; text-decoration:none; box-shadow:0 8px 18px rgba(111,38,61,.15); }
    .primary-action:hover { background:var(--brand-dark); }
    .primary-action:focus-visible,summary:focus-visible { outline:3px solid var(--support); outline-offset:3px; }
    dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:.3rem 1rem; margin:16px 0 0; }
    dt { font-weight:780; }
    dd { margin:0; overflow-wrap:anywhere; }
    .unavailable { color:var(--danger); font-weight:780; }
    .technical-details { border-top:1px solid var(--line); margin-top:22px; padding-top:11px; }
    .technical-details h3 { font-size:1rem; margin:1rem 0 .35rem; }
    summary { cursor:pointer; color:var(--brand); font-weight:780; }
    @media (max-width:700px) {
      main,.masthead-inner { width:min(100% - 24px,1160px); }
      .masthead-inner { padding-top:20px; }
      .brand-row,.entry-heading { align-items:flex-start; flex-direction:column; gap:12px; }
      .brand-lockup { align-items:flex-start; flex-direction:column; gap:4px; }
      .generated,.entry-meta { text-align:left; }
      .inbox-label { margin-top:24px; }
      .inbox { padding-top:28px; }
      .entry { padding:20px; }
      dl { grid-template-columns:1fr; gap:.15rem; }
      dd + dt { margin-top:.55rem; }
    }
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
        <p class="generated">Generated ${escapeHtml(formatUtcTimestamp(generatedAt))} · ${entries.length} recorded session${entries.length === 1 ? "" : "s"}</p>
      </div>
      <p class="inbox-label">Local session reporting</p>
      <h1>Report inbox</h1>
      <p class="lede">The latest validated brief or deterministic status for each recorded development session.</p>
    </div>
  </header>
  <main class="inbox" aria-label="Recorded session reports">${cards}</main>
</body>
</html>
`;
}

export function rebuildStaticReportIndex(
  projectRoot: string,
  now: Date = new Date()
): RebuiltStaticReportIndex {
  const root = realpathSync(projectRoot);
  const dispositions = listLatestSessionDispositions(root);
  const availableHtmlRunIds = new Set<string>();

  for (const { disposition } of dispositions) {
    if (
      disposition.kind === "full_report" &&
      disposition.validatedRun.renderedArtifacts?.html === "report.html"
    ) {
      const reportPath = join(
        root,
        ".codex-observer",
        "analysis-runs",
        disposition.validatedRun.runId,
        "report.html"
      );
      if (existsSync(reportPath) && statSync(reportPath).isFile()) {
        availableHtmlRunIds.add(disposition.validatedRun.runId);
      }
    }
  }

  const html = renderStaticReportIndex(
    dispositions,
    availableHtmlRunIds,
    now.toISOString()
  );
  const path = join(root, ".codex-observer", "reports", "index.html");
  writeTextAtomically(path, html);
  return { path, html, dispositionCount: dispositions.length };
}

function renderDisposition(
  disposition: FinalSessionDisposition,
  availableHtmlRunIds: ReadonlySet<string>
): string {
  const common = (label: string, explanation: string) => `<div class="entry-heading">
      <div><span class="badge">${escapeHtml(label)}</span><h2>Development session</h2></div>
      <div class="entry-meta"><p class="session-reference">${renderSessionReference(disposition.receipt.sessionId)}</p>
      <p class="evaluated">Evaluated ${escapeHtml(formatUtcTimestamp(disposition.receipt.evaluatedAt))}</p></div>
    </div>
    <p class="explanation">${escapeHtml(explanation)}</p>`;

  switch (disposition.kind) {
    case "full_report": {
      const htmlReferenced =
        disposition.validatedRun.renderedArtifacts?.html === "report.html";
      const htmlExists = availableHtmlRunIds.has(
        disposition.validatedRun.runId
      );
      const report =
        htmlReferenced && htmlExists
          ? `<p class="action-row"><a class="primary-action" href="${reportHref(disposition.validatedRun.runId)}">Open leadership report</a></p>`
          : '<p class="unavailable">HTML report unavailable</p>';
      return `<article class="entry full_report">${common("Full report ready", "A validated, evidence-backed analysis is ready.")}${report}${renderTechnicalDetails(disposition)}</article>`;
    }
    case "activity_only":
      return `<article class="entry activity_only">${common("Activity receipt", "A deterministic activity receipt is available. No full provider-generated narrative was produced.")}${renderTechnicalDetails(disposition)}</article>`;
    case "blocked":
      return `<article class="entry blocked">${common("Analysis blocked", "Full analysis could not proceed under the conditions evaluated at that time. The session can be evaluated again if conditions change.")}${renderTechnicalDetails(disposition)}</article>`;
    case "analysis_failed":
      return `<article class="entry analysis_failed">${common("Analysis failed", "An analysis attempt did not produce a validated report. This is a diagnostic state; technical details are available below.")}${renderTechnicalDetails(disposition)}</article>`;
  }
}

function renderTechnicalDetails(disposition: FinalSessionDisposition): string {
  const receipt = disposition.receipt;
  const runId =
    disposition.kind === "full_report"
      ? disposition.validatedRun.runId
      : disposition.kind === "analysis_failed"
        ? disposition.analysisRun?.runId
        : undefined;
  return `<details class="technical-details"><summary>Technical details</summary><dl>
    <dt>Session identity</dt><dd>${escapeHtml(receipt.sessionId ?? "Unavailable")}</dd>
    <dt>Disposition</dt><dd>${escapeHtml(disposition.kind)}</dd>
    <dt>Reason</dt><dd>${escapeHtml(disposition.reason)}</dd>
    <dt>Evaluation timestamp</dt><dd>${escapeHtml(receipt.evaluatedAt)}</dd>
    ${runId === undefined ? "" : `<dt>Analysis run</dt><dd>${escapeHtml(runId)}</dd>`}
  </dl><h3>Structural receipt</h3><dl>
    <dt>Evidence state</dt><dd>${escapeHtml(receipt.evidenceStateHash)}</dd>
    <dt>Last activity</dt><dd>${escapeHtml(receipt.lastObservedActivityAt ?? "Unavailable")}</dd>
    <dt>Evidence items</dt><dd>${escapeHtml(receipt.corpus.totalEvidenceCount)}</dd>
    <dt>Human messages</dt><dd>${escapeHtml(receipt.counts.humanMessages)}</dd>
    <dt>Assistant messages</dt><dd>${escapeHtml(receipt.counts.assistantMessages)}</dd>
    <dt>Tool attempts/results</dt><dd>${escapeHtml(`${receipt.counts.toolAttempts}/${receipt.counts.toolResults}`)}</dd>
    <dt>Git snapshots</dt><dd>${escapeHtml(receipt.counts.gitSnapshots)}</dd>
    <dt>Structured-error results</dt><dd>${escapeHtml(receipt.counts.observableStructuredErrorResults)}</dd>
  </dl></details>`;
}

function renderSessionReference(sessionId: string | null): string {
  if (sessionId === null) return "Session identity unavailable";
  const characters = [...sessionId];
  const shortId = characters.slice(0, 8).join("");
  return `Session ${escapeHtml(shortId)}${characters.length > 8 ? "…" : ""}`;
}

function formatUtcTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const month = months[parsed.getUTCMonth()];
  if (month === undefined) return value;
  const hour = parsed.getUTCHours();
  const displayHour = hour % 12 || 12;
  const minute = String(parsed.getUTCMinutes()).padStart(2, "0");
  const period = hour < 12 ? "AM" : "PM";
  return `${month} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()} at ${displayHour}:${minute} ${period} UTC`;
}

function reportHref(runId: string): string {
  return `../analysis-runs/${encodeURIComponent(runId)}/report.html`;
}

function writeTextAtomically(path: string, html: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, html, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    renameSync(temporaryPath, path);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the original persistence error.
      }
    }
    throw error;
  }
}
