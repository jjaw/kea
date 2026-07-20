# Kea MVP brief (OpenAI Build Week)

Perishable planning document. Durable rules live in `AGENTS.md`; if this file
conflicts with `AGENTS.md`, `AGENTS.md` wins.

## Positioning

"Kea explains the why behind Codex usage — and refuses to claim what the
evidence doesn't support."

## Current status

Implemented and tested:

- passive project-level Codex hooks (SessionStart, UserPromptSubmit,
  PreToolUse, PostToolUse, Stop) writing JSONL to `.codex-observer/`;
- latest-session pointer; Git snapshots at session start and each turn stop;
- Codex adapter producing the normalized Kea session with line-level
  evidence references;
- deterministic analyzer and Markdown report (`npm run report`);
- recorder, normalization, and reporting tests (`npm run check`).

The deterministic analyzer is the fallback and evaluation baseline, not the
product experience.

## Active milestone: GPT-5.6 single-session analysis

Build, in order:

1. **Evidence bundle builder.** From a normalized session, produce a compact
   bundle: session metadata plus an ordered list of evidence items, each with
   a stable ID (`E<line>` derived from the JSONL line number), type,
   timestamp, turn ID, and truncated content. Apply size caps and secret
   redaction here. Include the deterministic analysis summary as structural
   hints.
2. **Analysis schema.** Zod schema for the structured analysis: objective;
   approaches (grouped tool activity with status attempted / failed /
   abandoned / succeeded-per-evidence); human interventions classified as
   correction / constraint / decision / clarification / approval /
   follow-up task / question / status request / other, each with a cited
   prompt evidence ID and one-line justification; turning points with
   before/after evidence; Codex contributions; reported outcome vs.
   independently supported outcome; evidence gaps; at most two leadership
   insights. Every finding: value, basis, evidence IDs, confidence note.
3. **Provider interface + OpenAI implementation.** Small
   `AnalysisProvider` interface; GPT-5.6 implementation using strict
   structured output; model name and settings centralized in one config
   module.
4. **Deterministic post-validation.** Reject or downgrade per the rules in
   `AGENTS.md` (ID existence, basis authority, turning-point ordering,
   count/length caps). Emit a validation summary listing every downgrade.
5. **CLI:** `npm run analyze` (latest session), `-- SESSION_ID`, and
   `-- --dry-run` printing the bundle without an API call. Missing API key
   → print deterministic report with a notice.
6. **Renderer:** Markdown first, then a single self-contained HTML report
   (turn timeline, intervention chips, basis badges, expandable evidence
   excerpts). No server, no framework.

Definition of validated: the pipeline runs end-to-end on at least one real
recorded session with zero evidence-validation rejections after downgrades.

## Hackathon deliverables

- README with the problem, the evidence model, a screenshot of the HTML
  report, and quickstart.
- A deliberately recorded demo session with a legible arc (failing attempt →
  human correction → changed approach → verifiable Git result), plus a
  sanitized copy committed as the golden test fixture.
- `npm run doctor`: verifies Node >= 22.6, hook registration, a recent
  parseable recording, and API key presence.
- Three-minute demo script.

## Out of scope for the hackathon

Cross-session aggregation (mention as future work only), transcript_path
enrichment, other agent adapters, authentication, Jira/Linear/GitHub org
integration, live coaching, dashboards, billing ingestion, storage renames.
