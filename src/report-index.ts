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
    .lede,.meta,.explanation { color:var(--muted); }
    .inbox { display:grid; gap:14px; padding:10px 0 54px; }
    .entry { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; }
    .entry.full_report { border-left:5px solid var(--accent); }
    .entry.blocked { border-left:5px solid var(--warn); }
    .entry.analysis_failed { border-left:5px solid var(--danger); }
    .badge { display:inline-block; border-radius:999px; padding:.2rem .6rem; background:var(--soft); color:var(--accent); font-size:.74rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
    a { color:var(--accent); font-weight:800; text-underline-offset:.2em; }
    dl { display:grid; grid-template-columns:max-content 1fr; gap:.25rem .8rem; margin:.8rem 0; }
    dt { font-weight:750; } dd { margin:0; overflow-wrap:anywhere; }
    .unavailable { color:var(--danger); font-weight:750; }
    .receipt { border-top:1px solid var(--line); margin-top:12px; padding-top:8px; }
    summary { cursor:pointer; color:var(--accent); font-weight:750; }
    @media (max-width:640px) { main,header { width:min(100% - 20px,1040px); } header { padding-top:28px; } dl { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <p class="badge">Kea</p>
    <h1>Report inbox</h1>
    <p class="lede">Latest validated reports and deterministic session dispositions.</p>
    <p class="meta">Generated ${escapeHtml(generatedAt)} · ${entries.length} latest disposition${entries.length === 1 ? "" : "s"}</p>
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
  const session = disposition.receipt.sessionId ?? "Session identity unavailable";
  const common = `<span class="badge">${escapeHtml(disposition.kind)}</span>
    <h2>${escapeHtml(session)}</h2>
    <dl><dt>Evaluated</dt><dd>${escapeHtml(disposition.receipt.evaluatedAt)}</dd><dt>Reason</dt><dd>${escapeHtml(disposition.reason)}</dd></dl>`;

  switch (disposition.kind) {
    case "full_report": {
      const htmlReferenced =
        disposition.validatedRun.renderedArtifacts?.html === "report.html";
      const htmlExists = availableHtmlRunIds.has(
        disposition.validatedRun.runId
      );
      const report =
        htmlReferenced && htmlExists
          ? `<p><a href="${reportHref(disposition.validatedRun.runId)}">Open leadership report</a></p>`
          : '<p class="unavailable">HTML report unavailable</p>';
      return `<article class="entry full_report">${common}${report}<p class="explanation">A validated analysis run is available for this evidence state.</p></article>`;
    }
    case "activity_only":
      return `<article class="entry activity_only">${common}<p class="explanation">No provider-generated session narrative was produced because the structural eligibility threshold was not met.</p>${renderReceipt(disposition)}</article>`;
    case "blocked":
      return `<article class="entry blocked">${common}<p class="explanation">Automatic full analysis could not proceed under the conditions evaluated at this time. This is not a permanent fact about the session.</p>${renderReceipt(disposition)}</article>`;
    case "analysis_failed":
      return `<article class="entry analysis_failed">${common}<p class="explanation">Analysis did not produce a validated report. This entry is a diagnostic state.</p>${disposition.analysisRun ? `<p class="meta">Safe run reference: ${escapeHtml(disposition.analysisRun.runId)}</p>` : ""}${renderReceipt(disposition)}</article>`;
  }
}

function renderReceipt(disposition: FinalSessionDisposition): string {
  const receipt = disposition.receipt;
  return `<details class="receipt"><summary>Structural receipt</summary><dl>
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
