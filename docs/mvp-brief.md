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

The deterministic analyzer is the fallback, evaluation baseline, and source
of structural facts — not the product experience.

## Evidence IDs and source classes

Evidence IDs are `E<line>`, derived from the JSONL line number, stable and
unique within one analyzed session. When one JSONL line yields evidence items
of more than one source class, each additional item gets a dotted suffix so
every item has exactly one source class:

- a `Stop` line yields `E<line>` (`assistant_message`) and, when a Git
  snapshot is present, `E<line>.git` (`git_snapshot`);
- a `SessionStart` line yields `E<line>` (`session_event`) and, when a Git
  snapshot is present, `E<line>.git` (`git_snapshot`).

Source classes (each evidence item has exactly one): `session_event`,
`human_message`, `assistant_message`, `tool_attempt`, `tool_result`,
`git_snapshot`.

Activity evidence means `tool_attempt`, `tool_result`, or `git_snapshot` —
something happened, not something was said.

## Active milestone: GPT-5.6 single-session analysis

Build in this order. Steps 1–6 are fully offline — no provider, no network,
no API key; the live provider lands only in step 7.

1. **Minimal doctor.** `npm run doctor` verifies: Node >= 22.6 with type
   stripping, the hook command resolvable from the launch directory, and a
   recent `.codex-observer/latest/events.jsonl` that exists and parses.
   (API-key and provider checks are added in step 7.)
2. **Rough development recording.** Record a real Codex session early and
   keep it local as the development dataset. The polished golden session is
   recorded and sanitized later (step 9).
3. **Evidence bundle builder.** From a normalized session, produce a compact
   bundle: session metadata plus an ordered list of evidence items, each
   with an ID and suffix per the convention above, exactly one source class,
   timestamp, turn ID, and content. Apply redaction then truncation (spec
   below). Include deterministic *structural facts* only: event ordering,
   attempt/result pairs matched by tool-use ID, structured error indicators,
   prompt/assistant-message ordering, Git snapshots. Never include the
   deterministic analyzer's semantic labels.
4. **Analysis schema (Zod).** Findings carry value, basis, evidence IDs, and
   — for `inference` only — confidence (`high` / `medium` / `low`) plus a
   short confidence reason. Categories: objective; approaches; human
   interventions (correction / constraint / decision / clarification /
   approval / follow-up task / question / status request / other, each
   citing its `human_message` evidence ID with a one-line justification);
   turning points; Codex contributions; reported outcome; independently
   supported outcome; outcome support; evidence gaps; at most two
   leadership insights.

   Outcome structure:

   - `reportedOutcome` (Finding | null): what Codex claimed;
   - `independentlySupportedOutcome` (Finding | null): what activity and
     state evidence establishes — which may differ from the claim;
   - `outcomeSupport`: the relationship between them (enum below).

   Enum semantics (shared verbatim by schema descriptions, the analysis
   prompt, and the validator):

   - Approach status — `ongoing`: activity observed but the session ended
     mid-approach; `failed`: observed evidence shows the approach did not
     achieve its aim; `abandoned`: work stopped and shifted without observed
     failure; `completed`: the approach ran to its conclusion — success is
     NOT implied; `unknown`: insufficient evidence.
   - Outcome support (mutually exclusive) — `reported_only`: claimed by the
     assistant, no corroborating activity or state evidence;
     `independently_supported`: activity or state evidence supports the
     outcome (an explicit claim is not required); `contradicted`: activity
     or state evidence cuts against the claimed outcome; `unknown`:
     insufficient evidence.

5. **Deterministic post-validator.** Enforces, rejecting or downgrading and
   recording every action with a reason in a validation summary persisted
   alongside the analysis, keyed to the analysis run (timestamp or run
   counter in the filename):

   - every cited evidence ID exists in the bundle;
   - basis consistency by source class: `observed` requires activity or
     state evidence (`session_event`, `tool_attempt`, `tool_result`,
     `git_snapshot`); `explicit` requires `human_message` or
     `assistant_message`;
   - the `independentlySupportedOutcome` finding and any `contradicted`
     determination cite only activity or state evidence, never
     `assistant_message`;
   - outcome cross-field consistency: `reported_only` requires a non-null
     `reportedOutcome` and a null `independentlySupportedOutcome`;
     `independently_supported` requires a non-null
     `independentlySupportedOutcome` with valid activity/state citations;
     `contradicted` requires both findings non-null;
     `unknown` permits nulls;
   - turning points cite temporally ordered evidence whose after side
     includes activity evidence, not merely a later message;
   - Codex-contribution findings cite `tool_attempt`, `tool_result`, or
     `assistant_message` evidence, not `human_message`;
   - human-intervention findings cite the specific `human_message` event;
   - insights have basis `inference`, cite one or more valid evidence IDs,
     and number at most two;
   - confidence appears only on `inference` findings.

6. **Offline dry-run CLI.** `npm run analyze -- --dry-run` builds and prints
   the exact evidence bundle with no provider, no network call, and no API
   key required. Prove the full offline trust machinery here: run the
   validator against mocked model analyses over the rough recording,
   including the rejection and downgrade cases from the engineering rules.
7. **Provider interface + GPT-5.6 implementation.** Small `AnalysisProvider`
   interface; GPT-5.6 via strict structured output; model name and settings
   in one config module; Zod re-validation of everything returned. Extend
   doctor with API-key presence.
8. **Live CLI + Markdown rendering.** `npm run analyze` (latest) and
   `-- SESSION_ID` run the live provider, validate, and render the validated
   analysis as Markdown (extend the existing report style), including all
   `unknown` findings and the validation summary. Missing API key → print
   the deterministic report with a notice, exit code 0.
9. **Golden demo session.** Deliberately record a session with a legible
   arc: failing attempt → human correction → changed approach → verifiable
   Git result. Sanitize a copy, add its provenance note (recorded when, what
   was redacted, reviewed by whom), and commit it as the golden fixture.
   Point the mocked-provider pipeline tests at it.
10. **HTML report.** Single self-contained file, no server or framework,
    centered on five elements: (1) reported outcome versus independently
    supported outcome side by side with the outcome-support value; (2) the
    session/turn timeline with approaches as labeled spans and failures
    marked; (3) an evidence-basis badge (four consistent colors) on every
    finding — no unbadged text; (4) evidence chips that expand inline to the
    raw captured excerpt; (5) the validator's rejection and downgrade audit
    box.

Definition of validated: the pipeline completes on at least one real
session; the final output contains no nonexistent citations; unsupported
bases and causal claims are rejected or downgraded; every downgrade and
rejection appears in the validation summary; no unhandled errors occur.
GPT output is not required to be perfect — the pipeline is required to
handle imperfection correctly.

## Redaction patterns and size caps

Redaction runs before truncation. Replace matches with typed markers, e.g.
`[REDACTED:aws-key]`. Patterns (best-effort, high-precision by design):

- PEM blocks: `-----BEGIN ... PRIVATE KEY-----` through the matching END;
- AWS access key IDs: `AKIA` followed by 16 uppercase/digit characters;
- token prefixes: `sk-`, `ghp_`, `gho_`, `github_pat_`, `xox[a-z]-`;
- `Authorization: Bearer <token>`;
- env-style assignments where the key matches
  `TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY` (case-insensitive);
- credentials in connection strings: `scheme://user:password@host`.

No entropy-based detection; false positives are worse than a documented
best-effort list plus dry-run inspection.

Size caps (truncation explicitly marked in-text, e.g.
`…[truncated 12,340 bytes]`):

- prompt / assistant message: 2 KB each;
- tool input: 1 KB;
- tool output: head 700 bytes + tail 300 bytes;
- Git status: 2 KB; Git diff: 4 KB head+tail;
- whole bundle: ~128 KB ceiling, with a diagnostic when hit.

## Hackathon deliverables

- README: the problem, the evidence model, a screenshot of the HTML report,
  quickstart, and how Codex was used to build Kea.
- The golden fixture with provenance note.
- `npm run doctor`.
- Three-minute demo script (dry-run "what leaves your machine" beat, the
  reported-versus-supported verdict, one click from finding to raw
  evidence, the validator audit box).
- Rename remaining spike-era identifiers (package name, hook description);
  do not migrate the `.codex-observer/` storage path.

## Out of scope for the hackathon

Cross-session aggregation (one sentence of future work in the demo, nothing
more), transcript_path enrichment, other agent adapters, authentication,
Jira/Linear/GitHub org integration, live coaching, dashboards, billing
ingestion, storage renames, entropy-based secret scanning, finding-to-finding
reference IDs.