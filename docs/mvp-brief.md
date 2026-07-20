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

## Active milestone: GPT-5.6 single-session analysis

Build in this order. Steps 1–5 are fully offline and testable with mocked
analyses; the live provider lands only in step 6.

1. **Minimal doctor.** `npm run doctor` verifies: Node >= 22.6 with type
   stripping, the hook command resolvable from the launch directory, and a
   recent `.codex-observer/latest/events.jsonl` that exists and parses.
   (API-key and provider checks are added in step 6.)
2. **Rough development recording.** Record a real Codex session early and
   keep it local as the development dataset. The polished golden session is
   recorded and sanitized later (step 8).
3. **Evidence bundle builder.** From a normalized session, produce a compact
   bundle: session metadata plus an ordered list of evidence items, each
   with a stable ID (`E<line>` from the JSONL line number, unique within one
   analyzed session), type, timestamp, turn ID, and content. Apply redaction
   then truncation (spec below). Include deterministic *structural facts*
   only: event ordering, attempt/result pairs matched by tool-use ID,
   structured error indicators, prompt/assistant-message ordering, Git
   snapshots. Never include the deterministic analyzer's semantic labels.
4. **Analysis schema (Zod).** Findings carry value, basis, evidence IDs, and
   — for `inference` only — confidence (`high` / `medium` / `low`) plus a
   short confidence reason. Categories: objective; approaches; human
   interventions (correction / constraint / decision / clarification /
   approval / follow-up task / question / status request / other, each
   citing its prompt evidence ID with a one-line justification); turning
   points; Codex contributions; reported outcome; outcome support; evidence
   gaps; at most two leadership insights.

   Enum semantics (shared verbatim by schema descriptions, the analysis
   prompt, and the validator):

   - Approach status — `ongoing`: activity observed but the session ended
     mid-approach; `failed`: observed evidence shows the approach did not
     achieve its aim; `abandoned`: work stopped and shifted without observed
     failure; `completed`: the approach ran to its conclusion — success is
     NOT implied; `unknown`: insufficient evidence.
   - Outcome support (mutually exclusive) — `reported_only`: claimed by the
     assistant, no system-captured corroboration; `independently_supported`:
     system-captured evidence supports the outcome (an explicit claim is not
     required); `contradicted`: system-captured evidence cuts against the
     claimed outcome; `unknown`: insufficient evidence.

5. **Deterministic post-validator.** Enforces, rejecting or downgrading and
   recording every action in a validation summary persisted alongside the
   analysis, keyed to the analysis run (timestamp or run counter in the
   filename):

   - every cited evidence ID exists in the bundle;
   - basis consistency: `observed` requires system-captured items (hook,
     tool, Git); `explicit` requires prompt or assistant-message items;
   - `independently_supported` and `contradicted` outcomes cite only
     system-captured evidence, never assistant statements;
   - turning points cite temporally ordered evidence whose "after" side
     includes activity evidence (tool call or Git change), not merely a
     later message;
   - Codex-contribution findings cite tool or assistant evidence, not
     prompts;
   - human-intervention findings cite the specific prompt event;
   - insights have basis `inference`, cite at least one evidence item or
     other finding, and number at most two;
   - confidence appears only on `inference` findings.

6. **Provider interface + GPT-5.6 implementation.** Small `AnalysisProvider`
   interface; GPT-5.6 via strict structured output; model name and settings
   in one config module; Zod re-validation of everything returned. Extend
   doctor with API-key presence.
7. **CLI:** `npm run analyze` (latest), `-- SESSION_ID`, and `-- --dry-run`
   printing the exact bundle with no network call. Missing API key → print
   the deterministic report with a notice, exit code 0. Render the validated
   analysis as Markdown (extend the existing report style), including all
   `unknown` findings and the validation summary.
8. **Golden demo session.** Deliberately record a session with a legible
   arc: failing attempt → human correction → changed approach → verifiable
   Git result. Sanitize a copy, add its provenance note (recorded when, what
   was redacted, reviewed by whom), and commit it as the golden fixture.
   Point the mocked-provider pipeline tests at it.
9. **HTML report.** Single self-contained file, no server or framework,
   centered on five elements: (1) reported outcome versus supported outcome
   side by side with the outcome-support value; (2) the session/turn
   timeline with approaches as labeled spans and failures marked; (3) an
   evidence-basis badge (four consistent colors) on every finding — no
   unbadged text; (4) evidence chips that expand inline to the raw captured
   excerpt; (5) the validator's rejection and downgrade audit box.

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
  reported-vs-supported verdict, one click from finding to raw evidence,
  the validator audit box).
- Rename remaining spike-era identifiers (package name, hook description);
  do not migrate the `.codex-observer/` storage path.

## Out of scope for the hackathon

Cross-session aggregation (one sentence of future work in the demo, nothing
more), transcript_path enrichment, other agent adapters, authentication,
Jira/Linear/GitHub org integration, live coaching, dashboards, billing
ingestion, storage renames, entropy-based secret scanning.