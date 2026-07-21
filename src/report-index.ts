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
    :root { color-scheme:light; --ink:#18211d; --muted:#5d6963; --paper:#f6f4ed; --card:#fffdf7; --line:#d9d6c9; --accent:#19644a; --soft:#e7f0ea; --warn:#8a5317; --danger:#8c3131; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main,header { width:min(1040px,calc(100% - 32px)); margin-inline:auto; }
    header { padding:44px 0 20px; }
    h1,h2 { line-height:1.2; margin:.2rem 0 .7rem; }
    h1 { font-size:clamp(2rem,6vw,3.4rem); letter-spacing:-.04em; }
    .lede,.meta,.explanation,.session-reference,.evaluated { color:var(--muted); }
    .inbox { display:grid; gap:14px; padding:10px 0 54px; }
    .entry { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; }
    .entry.full_report { border-left:5px solid var(--accent); }
    .entry.blocked { border-left:5px solid var(--warn); }
    .entry.analysis_failed { border-left:5px solid var(--danger); }
    .badge { display:inline-block; border-radius:999px; padding:.2rem .6rem; background:var(--soft); color:var(--accent); font-size:.74rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
    .session-reference,.evaluated { margin:.2rem 0; }
    .primary-action { display:inline-block; margin:.35rem 0 .7rem; }
    a { color:var(--accent); font-weight:800; text-underline-offset:.2em; }
    dl { display:grid; grid-template-columns:max-content 1fr; gap:.25rem .8rem; margin:.8rem 0; }
    dt { font-weight:750; } dd { margin:0; overflow-wrap:anywhere; }
    .unavailable { color:var(--danger); font-weight:750; }
    .technical-details { border-top:1px solid var(--line); margin-top:12px; padding-top:8px; }
    .technical-details h3 { font-size:1rem; margin:1rem 0 .35rem; }
    summary { cursor:pointer; color:var(--accent); font-weight:750; }
    @media (max-width:640px) { main,header { width:min(100% - 20px,1040px); } header { padding-top:28px; } dl { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <p class="badge">Kea</p>
    <h1>Report inbox</h1>
    <p class="lede">Recorded development sessions and their latest report status.</p>
    <p class="meta">Generated ${escapeHtml(formatUtcTimestamp(generatedAt))} · ${entries.length} recorded session${entries.length === 1 ? "" : "s"}</p>
  </header>
  <main class="inbox">${cards}</main>
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
  const common = (label: string, explanation: string) => `<span class="badge">${escapeHtml(label)}</span>
    <h2>Development session</h2>
    <p class="session-reference">${renderSessionReference(disposition.receipt.sessionId)}</p>
    <p class="evaluated">Evaluated ${escapeHtml(formatUtcTimestamp(disposition.receipt.evaluatedAt))}</p>
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
          ? `<p><a class="primary-action" href="${reportHref(disposition.validatedRun.runId)}">Open leadership report</a></p>`
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
