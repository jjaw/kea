# Kea

Kea is a lightweight companion for Codex CLI. It passively records observable
session activity and turns it into evidence-backed explanations of why an
AI-assisted coding session succeeded, failed, changed direction, or required
human correction. The primary reader is a technical leader; the developer must
be able to inspect the evidence and basis behind every non-unknown finding.

Kea's differentiator is evidence integrity and epistemic honesty: every
finding carries an evidence basis, machine-checked citations, and a clear line
between what an agent *claimed* and what the evidence *supports*.

Kea must never become an employee surveillance, ranking, or
productivity-scoring system.

**Before working on milestone or feature tasks, read `docs/mvp-brief.md`.**
It contains current status, the active milestone, exact schema and validator
definitions, redaction patterns, size caps, and the demo plan. This file
contains only durable rules. If the two ever conflict, this file wins.

## Evidence model

Every analytical finding must use one of these bases:

- `observed`: directly captured hook, tool, test, or Git evidence;
- `explicit`: directly stated by a human or by Codex;
- `inference`: a conclusion reasoned from multiple evidence records;
- `unknown`: the available evidence is insufficient.

Rules:

- Every non-unknown finding must cite one or more valid evidence IDs.
- A model may only cite evidence IDs supplied in its input. Kea must reject
  findings citing nonexistent IDs.
- The deterministic validator, not the model, has final authority over a
  finding's basis. A finding claiming a basis its cited evidence types do not
  support is downgraded, not trusted. Category-specific evidence-type rules
  are defined in `docs/mvp-brief.md` and enforced by the validator.
- Confidence ratings apply only to `inference` findings. Observed and
  explicit findings do not carry model-assigned confidence.
- Causal claims (turning points) require temporally ordered before-and-after
  evidence, where the "after" includes activity evidence, not merely a
  subsequent message.
- The reported outcome and the independently supported outcome are separate
  findings. Never treat an assistant success statement as verified success.
  Independent support and contradiction may only cite system-captured
  evidence, never assistant statements.
- Use `unknown` rather than inventing intent, causality, success, failure,
  or motivation. `unknown` findings remain visible in reports; honesty about
  insufficient evidence is a feature, not a gap to hide.
- Every rejection and downgrade appears in a validation summary that is
  persisted alongside the analysis output, keyed to the analysis run.
- Never request, infer, expose, or claim access to hidden chain-of-thought.

## Architecture

Keep agent-specific formats behind adapters:

    raw agent events
        -> agent-specific adapter
        -> stable Kea normalized session
        -> compact evidence bundle (deliberately lossy: truncated + redacted)
        -> analysis provider interface
        -> validated structured analysis (+ validation summary)
        -> report renderer

- Only the adapter layer may know Codex payload shapes.
- Only the provider layer may know OpenAI APIs. Keep model names and provider
  configuration centralized in one config module.
- The evidence bundle may include deterministic *structural facts*: event
  ordering, matched tool attempts and results, structured error indicators,
  prompt and assistant-message ordering, and Git snapshots. It must not pass
  the deterministic analyzer's semantic classifications (objective, human
  direction, turning point, outcome) as authoritative hints; the model
  derives those from the evidence.
- The evidence bundle is intentionally lossy. Redaction runs before
  truncation, truncation is explicitly marked in the text, and both take
  precedence over field preservation.
- Preserve unknown external fields at the *capture* boundary; recordings are
  the source of truth, bundles are derived.
- Enum values, schema field semantics, the analysis prompt, and the validator
  must draw on one shared set of definitions. Do not let the prompt and the
  validator define the same term differently.
- Do not add adapters for other agents (Claude Code, Cursor, Kimi, etc.)
  unless explicitly requested.

## Recorder principles

- Developers keep using the normal `codex` command; hooks are passive.
- The recorder must fail open, add negligible overhead, and never prevent a
  Codex session from continuing.
- No network or model calls inside hooks. Model analysis runs only via an
  explicit user command.

## Privacy and safety

- Raw recordings and unsanitized analyses remain local and must never be
  committed. A deliberately sanitized recording or report may be committed
  as an explicit test fixture or demo asset after manual review; every such
  fixture carries a provenance note stating when it was recorded, what was
  redacted, and who reviewed it.
- Never commit API keys or `.env` files.
- Treat prompts, tool outputs, file paths, and Git diffs as sensitive.
- Before any model call: apply the size caps and redact the secret patterns
  defined in `docs/mvp-brief.md`, replacing matches with typed markers.
- Provide a dry-run mode that prints the exact evidence bundle without
  calling any API.
- If no API key is configured, degrade gracefully to the deterministic
  report; never crash and never prompt for credentials inside hooks.
- Do not produce employee rankings, individual performance scores, developer
  comparisons, or exact ROI / hours-saved claims.

## Engineering rules

- TypeScript, strict mode. Validate all external data and all model output
  with Zod.
- Request strict structured output from providers and re-validate with Zod
  regardless; never trust provider-side validation alone.
- Build and test deterministic machinery (schema, bundle builder, validator)
  against recorded sessions and mocked analyses before wiring live provider
  calls.
- Add focused tests for parsing, normalization, evidence mapping, redaction,
  validation, and rendering. Mock providers in tests; tests must never call
  a real API.
- Maintain at least one sanitized real recorded session as a committed test
  fixture (with its provenance note), and test the full pipeline against it
  with a mocked provider — including at least one case where the mock cites
  a nonexistent evidence ID and one where it inflates a basis, asserting the
  validator rejects and downgrades respectively.
- Keep the deterministic analyzer working as a fallback, debugging baseline,
  and source of structural facts. Do not remove it.
- Prefer small, reviewable changes. Do not commit unless explicitly asked;
  when asked, use small commits with descriptive messages.
- Existing internal paths such as `.codex-observer/` may remain; do not
  perform storage migrations solely to rename directories unless requested.

## Commands

    npm run check      # typecheck + tests
    npm run report     # deterministic report for the latest session
    npm run report -- SESSION_ID

Additional commands (`doctor`, `analyze`, dry-run) are specified in
`docs/mvp-brief.md` as they land.