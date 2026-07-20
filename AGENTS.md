# Kea

Kea is a lightweight companion for Codex CLI. It passively records observable
session activity and turns it into evidence-backed explanations of why an
AI-assisted coding session succeeded, failed, changed direction, or required
human correction.

The primary reader is a technical leader. The developer must still be able to
inspect the evidence and basis behind every non-unknown finding.

Kea's differentiator is evidence integrity and epistemic honesty: every finding
carries an evidence basis, machine-checked citations, and a clear line between
what an agent *claimed* and what the evidence *supports*.

Kea must never become an employee-surveillance, ranking, or
productivity-scoring system.

**Before working on milestone or feature tasks, read `docs/mvp-brief.md`.**
It contains current status, the active milestone, schema and validator details,
redaction patterns, request budgets, and the demo plan. This file contains only
durable rules. If the two files conflict, this file wins.

## Evidence model

Every evidence item has exactly one source class:

- `session_event`: a captured lifecycle event such as session start;
- `human_message`: a prompt or message submitted by the developer;
- `assistant_message`: a statement produced by Codex;
- `tool_attempt`: a captured tool invocation that was initiated;
- `tool_result`: a captured response or result from a tool invocation;
- `git_snapshot`: captured repository state at a point in the session.

Every analytical finding uses exactly one evidence basis:

- `observed`: supported by activity or state evidence (`session_event`,
  `tool_attempt`, `tool_result`, `git_snapshot`);
- `explicit`: directly stated in a `human_message` or `assistant_message`;
- `inference`: a conclusion reasoned from multiple cited evidence items;
- `unknown`: the available evidence is insufficient.

Rules:

- Every non-unknown finding cites one or more valid evidence IDs.
- A provider may cite only evidence IDs supplied in its input. Kea rejects
  findings that cite nonexistent IDs.
- The deterministic validator, not the model, has final authority over every
  finding's basis and category-specific validity.
- When a claimed basis is not supported by the cited source classes, Kea
  downgrades or rejects the finding according to the shared validator rules;
  it never trusts the label merely because the provider returned it.
- Confidence and a short confidence reason apply only to `inference`
  findings. They are forbidden on `observed`, `explicit`, and `unknown`
  findings.
- Causal claims such as turning points require nonempty, temporally ordered
  before-and-after evidence. The after side includes activity evidence
  (`tool_attempt`, `tool_result`, or `git_snapshot`), not merely a later
  message.
- `evidenceIds` is the canonical citation set rendered with a finding.
  Turning-point `beforeEvidenceIds` and `afterEvidenceIds` provide temporal
  structure. When valid temporal IDs are missing from the canonical set, the
  validator may add them deterministically in bundle order, but it must record
  the amendment in the validation audit.
- The reported outcome and independently supported outcome are separate
  findings related by an explicit outcome-support value. Never treat an
  assistant success statement as verified success.
- A `tool_attempt` proves only that an action was initiated. Establishing or
  contradicting an outcome requires result-bearing evidence: `tool_result` or
  an appropriate `git_snapshot`.
- Leadership insights use an `inference` basis, cite one or more valid
  evidence IDs, and number at most two. There is no finding-to-finding
  reference system in the MVP.
- Use `unknown` rather than inventing intent, causality, success, failure, or
  motivation. Unknowns remain visible in reports; honesty about insufficient
  evidence is a product feature.
- Every deterministic rejection, downgrade, or amendment appears in a
  validation summary persisted beside the analysis output and keyed to the
  analysis run.
- Never request, infer, expose, or claim access to hidden chain-of-thought.

## Architecture

Keep agent-specific formats behind adapters:

    raw agent events
        -> agent-specific adapter
        -> stable Kea normalized session
        -> complete sanitized evidence corpus
        -> bounded provider payload or payloads
        -> analysis provider interface
        -> validated structured analysis + validation summary
        -> report renderer

- Codex payload knowledge remains inside the Codex capture and adapter
  boundary. Normalized-session, analysis, validation, and rendering code must
  not depend on raw Codex payload shapes. The recorder may recognize only the
  small set of raw routing fields needed to group and store events.
- Raw recordings are the complete local source of truth. Preserve unknown
  external fields at the capture boundary.
- Redaction runs before truncation. Explicitly marked per-item truncation may
  make individual evidence content lossy, but Kea must not silently omit
  chronological portions of a session and then present a session-level report
  as complete.
- A provider request budget is a transport and safety constraint, not a
  session-coverage limit. Kea must do one of the following:
  1. analyze the complete sanitized evidence corpus in one request;
  2. segment it with complete chronological coverage; or
  3. refuse live analysis with an explicit diagnostic.
- Kea must never generate a leadership report from an undisclosed prefix,
  suffix, or partial range of a session. Until complete-coverage segmentation
  exists, an oversized corpus must fail clearly rather than be shortened.
- The evidence corpus may include deterministic *structural facts*: event
  ordering, matched tool attempts and results, structured error indicators,
  prompt and assistant-message ordering, and Git snapshots.
- Do not pass the deterministic analyzer's semantic classifications
  (objective, human direction, approach, turning point, or outcome) as
  authoritative hints. The provider derives those from evidence.
- Only the provider layer may know OpenAI APIs or response shapes. Keep model
  names and provider settings centralized in one configuration module.
- Enum values, source classes, category semantics, schema descriptions,
  provider instructions, and validator policies draw on one shared definitions
  module. Do not maintain parallel hand-written definitions that can drift.
- Do not add adapters for other agents unless explicitly requested.

## Recorder and orchestration principles

- Developers keep using the normal `codex` command; capture hooks are passive.
- Hooks must fail open, add negligible overhead, and never prevent a Codex
  session from continuing.
- No network or model calls may run inside Codex hooks.
- Hooks may record activity or mark a completed session as pending analysis.
- Analysis may be invoked through an explicit command or by a separate local
  post-session orchestrator. Any orchestrator must remain outside the hook
  execution path.
- Preserve `npm run analyze` as the manual, debugging, and rerun interface even
  after automatic handoff is added.

## Privacy and safety

- Raw recordings and unsanitized analyses remain local and must never be
  committed.
- A deliberately sanitized recording or report may be committed as an explicit
  test fixture or demo asset only after manual review. Every such asset carries
  a provenance note stating when it was recorded, what was redacted, and who
  reviewed it.
- Never commit API keys, `.env` files, or credentials.
- Treat prompts, tool outputs, file paths, repository state, and Git diffs as
  sensitive.
- Before any provider call, apply the redaction patterns, per-item truncation,
  and request-budget checks defined in `docs/mvp-brief.md`.
- Dry-run mode prints and persists the exact complete sanitized corpus, its
  serialized size, and whether it is eligible for one-request live analysis.
  It performs no provider call and requires no API key.
- If no API key is configured, degrade gracefully to the deterministic report;
  never crash and never prompt for credentials inside hooks.
- If the sanitized corpus exceeds the current one-request budget, make no
  provider call and generate no partial leadership report. Persist the corpus
  and a machine-readable diagnostic for inspection.
- Do not produce employee rankings, individual performance scores, developer
  comparisons, or exact ROI or hours-saved claims.

## Engineering rules

- Use TypeScript in strict mode.
- Validate all external data and all provider output with Zod.
- Request strict structured output from providers and re-validate it with Zod;
  never trust provider-side validation alone.
- Build and test deterministic machinery against recorded sessions and mocked
  analyses. Tests must never call a real provider API.
- Add focused tests for capture parsing, normalization, evidence mapping,
  redaction, truncation, corpus-size handling, validation, persistence, and
  rendering.
- Corpus-budget tests must prove that eligible corpora retain every evidence
  item and that oversized live analyses make no provider call.
- Validator amendments must be deterministic, narrowly scoped, and visible in
  the persisted audit.
- Maintain at least one sanitized real recorded session as a committed test
  fixture with a provenance note. Test the full pipeline against it with a
  mocked provider, including nonexistent citations, inflated bases, and
  deterministic amendment behavior.
- Keep the deterministic analyzer working as a fallback, debugging baseline,
  and source of structural facts. Do not remove it.
- Prefer small, reviewable changes.
- Do not commit unless explicitly asked. When asked, use small commits with
  descriptive messages.
- Existing internal paths such as `.codex-observer/` may remain. Do not perform
  storage migrations solely to rename directories unless requested.

## Commands

    npm run check
    npm run doctor
    npm run report
    npm run report -- SESSION_ID
    npm run analyze -- --dry-run
    npm run analyze -- --dry-run SESSION_ID
    npm run analyze
    npm run analyze -- SESSION_ID

`npm run check` runs typechecking and tests. `npm run report` is the
deterministic fallback. `npm run analyze -- --dry-run` exposes the exact
sanitized corpus without a provider call. `npm run analyze` performs live
analysis when the API key and request-budget checks pass.