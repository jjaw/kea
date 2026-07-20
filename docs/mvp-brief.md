# Kea MVP brief (OpenAI Build Week)

Perishable planning document. Durable rules live in `AGENTS.md`; if this file
conflicts with `AGENTS.md`, `AGENTS.md` wins.

## Positioning

"Kea explains the why behind Codex usage — and refuses to claim what the
evidence doesn't support."

Kea is built primarily for technical leaders. Capture happens on the
developer's machine, but the product output should help a leader understand:

- what the developer was trying to accomplish;
- which approaches were attempted and how they ended;
- where human judgment corrected, constrained, or redirected Codex;
- what Codex contributed;
- what Codex reported;
- what captured evidence independently supports;
- what remains unknown;
- what leadership-level lessons are reasonably inferable.

The developer must be able to inspect the evidence behind every non-unknown
finding. The leader-facing report should show the conclusion first and keep
raw technical evidence available on demand rather than making the audit trail
the primary reading experience.

## Current status

Implemented and runtime-tested:

- passive project-level Codex hooks (`SessionStart`, `UserPromptSubmit`,
  `PreToolUse`, `PostToolUse`, `Stop`) writing JSONL to
  `.codex-observer/`;
- latest-session pointer;
- Git snapshots at session start and turn stop;
- Codex adapter producing a normalized Kea session with line-level evidence
  references;
- deterministic analyzer and Markdown report (`npm run report`);
- redaction, per-item truncation, complete evidence-corpus construction, and
  dry-run;
- shared analysis definitions and Zod schemas;
- deterministic post-validation with persisted rejection, downgrade, and
  amendment audit;
- `AnalysisProvider` abstraction and OpenAI Responses API provider;
- centralized GPT-5.6 provider configuration;
- live `npm run analyze` for the latest or selected session;
- run-scoped persistence of bundle, provider response, candidate analysis,
  validated analysis, validation summary, metadata, and Markdown report;
- 512 KiB single-request eligibility measurement with complete-corpus
  preservation and explicit `bundle_too_large` refusal;
- graceful missing-key fallback;
- doctor checks, mocked-provider tests, and live-pipeline tests;
- package and hook branding renamed to Kea while retaining
  `.codex-observer/`.

The deterministic analyzer remains the fallback, evaluation baseline, and
source of structural facts. It is not the primary product experience.

### First live analysis

The first real provider-backed analysis completed without an unhandled error.

- Session:
  `019f805c-ce10-7af0-95e9-555fcbd4d7d2`
- Run:
  `2026-07-20T17-34-52-238Z-faf31e63-6973-476a-8839-56a2d6b2f4c2`
- Validation:
  2 rejected, 0 downgraded
- Successful behavior:
  - objective and approach grouping were useful;
  - the initial specification was classified as a constraint;
  - the later consistency redirect was classified as a correction;
  - reported and independently supported outcomes remained separate;
  - independent support cited result-bearing evidence;
  - missing ending evidence became visible unknowns instead of speculation.

The run exposed two pipeline-quality issues:

1. Two substantively valid turning points were rejected because temporal IDs in
   `beforeEvidenceIds` or `afterEvidenceIds` were not duplicated in the
   canonical `evidenceIds` list. The provider had not been told to perform
   that redundant bookkeeping.
2. The approximately 128 KiB whole-bundle ceiling repeatedly removed evidence
   from the end. It omitted 72 ending evidence items from a normal,
   single-feature development session, preventing the report from seeing the
   final consistency work.

## Completed milestone: first-live-run hardening

This is the final pipeline-quality milestone before the golden fixture and
leader-facing HTML report.

The work is deliberately limited to:

1. preserve the complete sanitized evidence corpus for normal single-request
   analysis;
2. refuse oversized analysis honestly instead of shortening the session;
3. deterministically amend incomplete turning-point canonical citations;
4. rerun the same real session and compare the before/after audit and report.

Do not implement multi-request segmentation, the golden fixture, HTML report,
automatic handoff, a watcher, or a dashboard during this milestone.

### Runtime validation

Milestone 8.2 was successfully runtime-validated against the comparison
session and hardened run:

- Comparison session:
  `019f805c-ce10-7af0-95e9-555fcbd4d7d2`
- Hardened validation run:
  `2026-07-20T21-04-01-208Z-390c0b81-bd53-4d93-9a27-f6f643fd084d`
- Serialized sanitized evidence size: 239,801 bytes
- Request budget: 524,288 bytes
- Total evidence items: 173
- Retained evidence items: 173
- Omitted evidence items: 0
- Eligible for one-request analysis: yes
- Provider response: completed successfully
- Validation: 0 rejected, 0 downgraded, 3 amended
- All generated turning points survived validation.
- Missing temporal citations were added to canonical `evidenceIds`.
- Every citation amendment used the action code
  `turning_point_citations_completed`.
- The ending semantic-consistency and outcome-corroboration work was included.
- The outcome remained `independently_supported`.

The second provider run produced a different candidate analysis. Acceptance
therefore confirms complete evidence coverage, deterministic citation
amendment, and survival of valid turning points; it does not require identical
model output across runs.

### Acceptance criteria

- The same real session retains every evidence item after redaction and
  per-item truncation.
- The opening objective and ending consistency work are both present.
- No attempt/result reference points to omitted evidence.
- The complete sanitized corpus is within the configured one-request budget,
  or live analysis refuses with `bundle_too_large`.
- No evidence item is removed merely to satisfy the request budget.
- The two real turning-point shapes survive when their temporal evidence
  exists, is ordered, and has activity on the after side.
- Any IDs added to canonical turning-point citations appear as an `amended`
  validation action.
- Rejected, downgraded, and amended counts are reported separately.
- `npm run check`, `npm run doctor`, dry-run, and one live rerun complete
  without an unhandled error.

## Evidence IDs and source classes

Evidence IDs are `E<line>`, derived from the JSONL line number, stable and
unique within one analyzed session.

When one JSONL line yields items of more than one source class, each additional
item receives a dotted suffix:

- a `Stop` line yields `E<line>` (`assistant_message`) and, when present,
  `E<line>.git` (`git_snapshot`);
- a `SessionStart` line yields `E<line>` (`session_event`) and, when present,
  `E<line>.git` (`git_snapshot`).

Each evidence item has exactly one source class:

- `session_event`: captured lifecycle activity such as session start;
- `human_message`: a developer prompt or message;
- `assistant_message`: a statement produced by Codex;
- `tool_attempt`: a tool invocation that was initiated;
- `tool_result`: the captured response or result from a tool invocation;
- `git_snapshot`: captured repository state.

Shared groups:

- observed source classes:
  `session_event`, `tool_attempt`, `tool_result`, `git_snapshot`;
- explicit source classes:
  `human_message`, `assistant_message`;
- activity source classes:
  `tool_attempt`, `tool_result`, `git_snapshot`;
- result-bearing outcome source classes:
  `tool_result`, `git_snapshot`.

A `tool_attempt` establishes that an action started. It does not establish the
result of that action.

All source-class groups, enum values, category definitions, schema
descriptions, provider instructions, and validator policies must be generated
from or import the shared definitions module. Do not maintain parallel lists.

## Complete sanitized evidence corpus

A raw recording is the complete local source of truth.

The evidence-corpus builder creates an ordered, deterministic corpus containing
every normalized evidence item after:

1. secret redaction;
2. explicitly marked per-item truncation.

Per-item truncation may shorten one captured prompt, result, or Git diff. It
must never silently remove an evidence item or chronological range.

The corpus includes only deterministic structural facts:

- event ordering;
- prompt and assistant-message ordering;
- tool attempt/result matching by tool-use ID;
- structured error indicators;
- Git snapshots.

It must not include the deterministic analyzer's semantic labels for objective,
approach, intervention, turning point, outcome, or insight.

### One-request budget

The MVP uses a single-provider-request safety budget of:

    512 * 1024 bytes

The budget is measured against the complete serialized sanitized corpus.

For a corpus at or below the budget:

- retain every evidence item;
- allow dry-run;
- allow live provider analysis when an API key is present.

For a corpus above the budget:

- do not delete or sample evidence;
- do not call the provider;
- do not generate a partial session-level leadership report;
- persist the complete sanitized corpus;
- persist metadata and a machine-readable `bundle_too_large` diagnostic;
- report the measured size and configured budget;
- explain that complete-coverage segmentation is required;
- exit without an unhandled exception.

Do not automatically raise the budget when a session exceeds it. Measure and
review first.

Dry-run always prints and persists the exact complete sanitized corpus and
reports:

- serialized corpus size;
- configured request budget;
- total evidence count;
- retained evidence count;
- omitted evidence count;
- one-request eligibility.

For the current non-segmented MVP, `retainedEvidenceCount` equals
`totalEvidenceCount` and `omittedEvidenceCount` is always zero. Eligibility
controls whether a live provider call is allowed.

Chronological multi-request segmentation is future work. When implemented, it
must cover the complete sanitized corpus and preserve original evidence IDs
across segment analysis and final synthesis.

## Analysis schema

Findings carry:

- `value`;
- `basis`;
- `evidenceIds`;
- `confidence` and a short `confidenceReason` only when the basis is
  `inference`.

Finding categories:

- objective;
- approaches;
- human interventions;
- turning points;
- Codex contributions;
- reported outcome;
- independently supported outcome;
- outcome support;
- evidence gaps;
- at most two leadership insights.

### Evidence-basis semantics

- `observed`: supported by observed activity or state evidence;
- `explicit`: directly stated in a human or assistant message;
- `inference`: reasoned from multiple cited evidence items;
- `unknown`: the available evidence is insufficient.

Every non-unknown finding cites at least one supplied evidence ID. Unknown
findings may have no citations. Never cite an ID absent from the supplied
corpus.

### Approach statuses

- `ongoing`: activity was observed but the session ended mid-approach;
- `failed`: observed evidence shows the approach did not achieve its aim;
- `abandoned`: work stopped and shifted without observed failure;
- `completed`: the approach ran to its conclusion; success is not implied;
- `unknown`: insufficient evidence.

An approach is a meaningful technical strategy or local goal grouping related
activity. Do not create one approach per individual tool call.

### Human-intervention categories

Each intervention cites only its specific `human_message` evidence and includes
a one-line category justification.

- `correction`: identifies something wrong or unsuitable and redirects the
  work;
- `constraint`: imposes a boundary or requirement the work must obey;
- `decision`: selects or settles among alternatives;
- `clarification`: explains or narrows existing intent without rejecting the
  current direction;
- `approval`: accepts or authorizes an approach, result, or next action;
- `follow-up task`: introduces additional related work beyond the preceding
  objective;
- `question`: requests information or explanation and is not primarily asking
  for progress;
- `status request`: asks for progress, completion state, or current condition;
- `other`: does not fit another category based on available evidence.

### Turning points

A turning point is a causal claim with:

- a nonempty `beforeEvidenceIds` list;
- a nonempty `afterEvidenceIds` list;
- all before evidence strictly earlier than all after evidence;
- at least one activity item on the after side;
- a canonical `evidenceIds` list displayed in the report.

`beforeEvidenceIds` and `afterEvidenceIds` provide temporal structure.
`evidenceIds` is the complete canonical citation set shown to the reader.

When all temporal IDs exist in the corpus but a temporal ID is absent from
`evidenceIds`, the validator:

1. adds the missing ID to `evidenceIds`;
2. orders canonical citations by corpus chronology;
3. records an `amended` validation action naming the added IDs;
4. continues substantive validation.

This amendment is not a downgrade. It repairs redundant citation bookkeeping
while preserving display completeness.

Reject the turning point when:

- either temporal side is empty;
- any referenced ID does not exist;
- before and after evidence are not strictly ordered;
- the after side contains no activity evidence.

### Codex contributions

A Codex-contribution finding cites only:

- `tool_attempt`;
- `tool_result`;
- `assistant_message`.

A human prompt alone cannot establish a Codex contribution.

### Outcome structure

- `reportedOutcome` (`Finding | null`): what Codex claimed; cites only
  `assistant_message` evidence.
- `independentlySupportedOutcome` (`Finding | null`): what captured activity
  or repository state establishes; cites only activity evidence and requires
  at least one result-bearing item (`tool_result` or `git_snapshot`) to
  establish or contradict an outcome.
- `outcomeSupport`: the mutually exclusive relationship between those
  findings.

Outcome-support values:

- `reported_only`: the assistant made a claim, but no qualifying
  result-bearing evidence corroborates or contradicts it;
- `independently_supported`: result-bearing evidence supports an outcome; an
  assistant claim is optional;
- `contradicted`: a reported outcome exists and result-bearing
  system-captured evidence cuts against it; model skepticism alone is not
  sufficient;
- `unknown`: the relationship cannot be established.

When a candidate claims `independently_supported` or `contradicted` but cites
only `tool_attempt` evidence:

- with a valid reported outcome, change `outcomeSupport` to `reported_only`;
- without a valid reported outcome, change `outcomeSupport` to `unknown`;
- preserve the independent finding where possible, set its unsupported basis
  to `unknown`, and record the correction in the validation summary.

### Evidence gaps and leadership insights

An evidence gap states what the recording cannot establish. Use `unknown`
rather than filling in the missing fact.

Leadership insights:

- use an `inference` basis;
- cite one or more supplied evidence IDs;
- include inference confidence and a short reason;
- number at most two;
- avoid productivity scoring, ranking, and unsupported motivation claims.

## Deterministic post-validator

The validator has final authority and records every action.

It enforces:

- every cited evidence ID exists;
- every non-unknown finding has citations;
- source classes support the claimed basis;
- category-specific source restrictions;
- inference-only confidence;
- human-intervention source and justification rules;
- Codex-contribution source rules;
- turning-point citation amendment, temporal order, and after-side activity;
- reported versus independently supported outcome separation;
- result-bearing outcome corroboration;
- outcome cross-field consistency;
- at most two leadership insights.

Validation actions are:

- `rejected`: the finding cannot survive a substantive rule;
- `downgraded`: the finding survives with a weaker basis, support
  relationship, or corrected metadata;
- `amended`: deterministic bookkeeping was repaired without weakening the
  finding.

Each action contains:

- action type;
- stable optional action code where useful;
- target path;
- human-readable reason;
- relevant evidence IDs.

The validation summary persists:

- schema version;
- run ID;
- validation timestamp;
- rejected count;
- downgraded count;
- amended count;
- full action list.

## Provider and live pipeline

`AnalysisProvider` isolates provider-specific behavior.

Only the OpenAI provider module may depend on OpenAI API request or response
shapes. Model and reasoning settings remain centralized.

Live flow:

    selected recording
        -> normalized session
        -> complete sanitized evidence corpus
        -> request-budget eligibility check
        -> provider structured analysis
        -> Zod re-validation
        -> deterministic post-validation
        -> run-scoped persistence
        -> Markdown report

`npm run analyze` analyzes the latest session.

`npm run analyze -- SESSION_ID` analyzes a selected session.

`npm run analyze -- --dry-run [SESSION_ID]` prints and persists the exact
sanitized corpus with no provider call and no API key requirement.

Missing API key:

- print a clear notice;
- render the deterministic fallback report;
- exit code 0;
- make no provider call.

Provider failures are distinct:

- request failure;
- refusal;
- incomplete response;
- missing parsed output;
- schema-invalid output;
- `bundle_too_large`.

Invalid provider output never reaches deterministic semantic validation.

Successful live runs persist, as applicable:

- `bundle.json`;
- `provider-response.json`;
- `candidate-analysis.json`;
- `analysis.json`;
- `validation-summary.json`;
- `metadata.json`;
- `report.md`.

Failed runs persist the complete available diagnostic artifacts and do not
create a misleading validated report.

## Redaction patterns and per-item truncation

Redaction runs before truncation. Replace matches with typed markers such as
`[REDACTED:aws-key]`.

Best-effort, high-precision patterns:

- PEM private-key blocks;
- AWS access-key IDs beginning with `AKIA`;
- token prefixes: `sk-`, `ghp_`, `gho_`, `github_pat_`, `xox[a-z]-`;
- `Authorization: Bearer <token>`;
- environment-style assignments whose key matches
  `TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_KEY`;
- credentials in connection strings:
  `scheme://user:password@host`.

Do not add entropy-based secret detection for the hackathon. False positives
are worse than a documented best-effort list plus dry-run inspection.

Per-item truncation is explicitly marked in text, for example:
`…[truncated 12,340 bytes]`.

Current per-item limits:

- prompt or assistant message: 2 KiB each;
- tool input: 1 KiB;
- tool output: head 700 bytes plus tail 300 bytes;
- Git status: 2 KiB;
- Git diff: 4 KiB head plus tail.

These limits control one evidence item's content. They do not authorize removal
of evidence items from the session.

## Milestone plan

Completed:

1. Minimal doctor.
2. Rough real development recording.
3. Evidence-corpus builder, redaction, truncation, and dry-run.
4. Shared Zod analysis schema and semantic definitions.
5. Deterministic post-validator and run-scoped audit.
6. Offline mocked-provider trust tests.
7. Provider interface and GPT-5.6 implementation.
8. Live CLI and Markdown rendering.
8.1. First real live analysis.
8.2. First-live-run hardening:
   complete-corpus request-budget behavior, turning-point citation amendment,
   and same-session revalidation. Runtime validation used comparison session
   `019f805c-ce10-7af0-95e9-555fcbd4d7d2` and hardened run
   `2026-07-20T21-04-01-208Z-390c0b81-bd53-4d93-9a27-f6f643fd084d`.

   The sanitized corpus was 239,801 bytes against a 524,288-byte budget. All
   173 evidence items were retained, none were omitted, and the corpus was
   eligible for one-request analysis. The provider response completed
   successfully. Validation reported 0 rejected, 0 downgraded, and 3 amended;
   all generated turning points survived. Missing temporal citations were
   added to canonical `evidenceIds`, and every citation amendment used
   `turning_point_citations_completed`. The ending semantic-consistency and
   outcome-corroboration work was included, and the outcome remained
   `independently_supported`.

   The second provider run produced a different candidate analysis. This
   acceptance confirms complete evidence coverage, deterministic citation
   amendment, and survival of valid turning points, not identical model output.

Active:

9. **Installable CLI and cross-project bootstrap.**

   Package Kea as a scoped public npm package with a `kea` executable.

   Implement:

   - `kea init`;
   - `kea hook`;
   - `kea doctor`;
   - `kea analyze`;
   - `kea demo`.

   `kea init` creates or merges project-local Codex hooks, adds local Kea
   storage to `.gitignore`, writes project configuration, and obtains explicit
   consent for automatic analysis.

   Hooks invoke the installed package rather than requiring Kea source files
   inside the consuming repository.

Next:

10. **Leader-facing HTML report and local report inbox.**

    Generate one self-contained HTML report from validated analysis, validation
    summary, and sanitized evidence.

    Maintain a static local report index that shows the latest validated report
    for each eligible session. Historical runs remain in local audit storage.

11. **Report eligibility and automatic one-shot handoff.**

    Capture all sessions locally, but automatically analyze only sessions that
    satisfy deterministic meaningful-activity rules.

    Codex `Stop` is turn-scoped. It may only record activity and mark a session
    pending.

    A short-lived worker:

    - waits for a quiet interval;
    - exits if newer activity appears;
    - evaluates report eligibility without a provider call;
    - deduplicates by session ID and evidence-state hash;
    - performs analysis only after explicit opt-in;
    - writes the HTML report and updates the report index.

    Do not implement a permanent daemon.

12. **Sanitized reference fixture and credential-free demo.**

    Record a real session through the installed cross-project workflow.

    Commit:

    - a sanitized recording;
    - provenance documentation;
    - mocked provider output;
    - expected validator audit.

    `kea demo` runs the real local pipeline against the fixture without an API
    key and generates the leader-facing HTML report.

13. **Clean-project acceptance, npm publication, and submission package.**

    Install the packed tarball into a clean test repository and verify:

    - initialization;
    - hook trust and capture;
    - eligibility filtering;
    - automatic analysis;
    - report generation;
    - report index;
    - credential-free demo.

    Then complete npm publication, README, supported-platform notes, license,
    screenshot, sample report, video, and Devpost submission.

Stretch / post-hackathon:

- **Minimal automatic handoff.** Preserve `npm run analyze` as the manual and
  debugging interface. Provider calls must never run inside Codex hooks; hooks
  may only record activity or mark a completed session as pending analysis.
  Any future local wrapper or watcher requires explicit consent plus defined
  privacy, API-cost, retry, and duplicate-run policies before implementation.

## Definition of validated

The single-session pipeline is validated when:

- at least one real provider-backed session completes;
- the provider receives the complete sanitized corpus or the run refuses
  explicitly as oversized;
- no session-level report is generated from undisclosed partial coverage;
- the final output contains no nonexistent citations;
- unsupported bases, outcome claims, and causal claims are rejected,
  downgraded, or deterministically amended according to policy;
- every rejection, downgrade, and amendment appears in the persisted
  validation summary;
- all unknowns remain visible;
- no unhandled error occurs.

Provider output is not required to be perfect. The pipeline is required to
handle imperfection honestly and audibly.

## Hackathon deliverables

- README covering the problem, evidence model, privacy model, quickstart, and
  how Codex was used to build Kea.
- Sanitized golden fixture with provenance note.
- `npm run doctor`.
- Dry-run demonstration of exactly what leaves the machine.
- Leader-facing self-contained HTML report.
- Screenshot of the HTML report.
- Three-minute demo script centered on:
  - what leaves the machine;
  - reported versus independently supported outcome;
  - one leadership insight;
  - one click from finding to evidence;
  - the validator audit.

Do not migrate the `.codex-observer/` storage path solely for branding.

## Out of scope for the hackathon

- cross-session aggregation or organizational dashboards;
- employee rankings, performance scores, or developer comparisons;
- exact ROI or hours-saved claims;
- multi-request chronological segmentation and synthesis;
- other agent adapters;
- authentication;
- Jira, Linear, or GitHub organization integration;
- billing ingestion;
- live coaching;
- transcript-path enrichment;
- entropy-based secret scanning;
- finding-to-finding reference IDs;
- storage-path migrations.

Cross-session aggregation and complete-coverage segmented analysis may appear
as brief future work in the demo, but they are not hackathon implementation
tasks.
