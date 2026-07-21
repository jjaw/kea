# Kea

Kea is a passive, project-local companion for Codex CLI. It turns observable
development-session evidence into an evidence-backed leadership report while
keeping a clear line between what Codex reported and what the retained evidence
actually supports.

Kea is for technical leaders, business leaders who need to understand delivery
risk and progress, and developers who need an auditable account of an
AI-assisted coding session. It is not employee surveillance, a productivity
ranking system, an ROI calculator, or a hosted monitoring service.

## The problem

A completed Codex session can leave behind code but little durable explanation
of why the work succeeded, failed, changed direction, or required human
correction. A transcript alone is too detailed for leadership and can also blur
the difference between a completion claim and a verified result.

Kea records the observable session activity available through Codex project
hooks, sanitizes it before analysis, and produces a concise account of:

- the session objective;
- approaches attempted, including failed or abandoned approaches;
- human constraints, decisions, and corrections;
- meaningful Codex contributions;
- the outcome Codex reported;
- the outcome independently supported by command output, Git state, or other
  observable results;
- unresolved evidence gaps; and
- up to two evidence-backed leadership insights.

## What Kea produces

The main leadership experience is a local static report inbox. Each captured
session appears with its latest status. A full report leads with the objective,
independently supported outcome, human judgment, and uncertainty; expandable
details expose the sanitized evidence and validation audit behind each finding.

Developers keep using the normal `codex` command. After one-time project setup
and explicit consent, a short-lived local worker settles a session after a
quiet interval and updates the inbox. There is no permanent daemon and no Kea
command to run after each ordinary Codex session.

## Credential-free judge demo

The fastest way to see the complete report experience is the deterministic
reference demo:

```bash
git clone https://github.com/jjaw/kea.git
cd kea
npm ci
npm run demo
```

`npm ci` normally needs network access to download dependencies. Once those
dependencies are installed, `npm run demo` requires no OpenAI API key and makes
no network request.

The demo uses a committed, manually reviewed, sanitized recording of a real
Codex session and deterministic local mocked analysis. It still exercises the
real Kea adapter, evidence builder, schema validation, deterministic validator,
persistence, Markdown and HTML rendering, disposition, and static-inbox
pipeline.

The reference run:

- verifies and loads all 101 committed session records;
- prepares all 105 sanitized evidence items, totaling 111,102 serialized
  bytes;
- applies deterministic reference analysis and validation;
- generates a leadership report and updates the static inbox; and
- verifies the generated analysis, validation audit, disposition, renderers,
  and fixture hashes against committed expectations.

The demo writes only beneath `.kea-demo-output/`. It does not read or modify
the project's real `.codex-observer/` data. Its progress output includes:

```text
Kea reference demo

✓ Loaded the approved 101-record Codex session
✓ Prepared 105 sanitized evidence items (111,102 bytes)
✓ Ran deterministic reference analysis
✓ Applied validation safeguards
  1 rejected · 1 downgraded · 1 amended
✓ Generated the leadership report
✓ Updated the report inbox
```

The committed candidate analysis deliberately contains three problems so the
demo shows that Kea does not blindly trust model-shaped output:

- **Rejected:** one finding cited nonexistent evidence and was removed.
- **Downgraded:** one finding claimed stronger evidentiary support than its
  citations justified, so its basis was weakened.
- **Amended:** one valid turning point omitted a required canonical citation,
  so the validator added that citation in evidence order and recorded the
  repair.

Those counts are properties of this reference fixture, not expected counts for
every live session.

### Opening the demo result

In an eligible interactive local run, `npm run demo` normally opens the
generated inbox automatically. It uses `open` on macOS. On Linux it uses
`xdg-open` only when a graphical session and executable are available. It does
not launch a browser in CI or noninteractive execution, and an unsupported
platform or browser-launch failure does not make a successful demo fail. A
launch failure prints a concise warning.

The command always prints repository-relative report and inbox paths plus a
manual open command. The inbox is:

```text
.kea-demo-output/.codex-observer/reports/index.html
```

To generate and verify everything without launching a browser:

```bash
npm run demo -- --no-open
```

Use that form for CI, scripts, or whenever automatic opening is unwanted.

## Live automatic Codex workflow

The reference demo is local and deterministic. Live automatic use is a
separate, explicitly enabled workflow:

1. Project-local Codex hooks record observable activity as local JSONL.
2. A `Stop` event marks the session pending and launches a detached one-shot
   worker; the hook itself does no network or model work and fails open.
3. The worker waits for the quiet interval. Newer activity supersedes the old
   pending state.
4. Kea builds the complete sanitized evidence corpus, checks structural
   eligibility, and measures it against the request budget.
5. Eligible sessions require both explicit consent and the user's own API key
   before the complete sanitized payload may be sent to the OpenAI API.
6. Kea schema-parses and deterministically validates the candidate analysis,
   persists the canonical result locally, and updates the local static inbox.

Kea does not host or proxy this analysis. The user supplies the API key and is
responsible for their own OpenAI model usage.

## Evidence integrity

Every finding has one plain-language evidence basis:

- `observed`: supported by captured activity or state, such as a tool result or
  Git snapshot;
- `explicit`: directly stated by the developer or Codex;
- `inference`: reasoned from cited evidence, with a confidence and short
  confidence reason; or
- `unknown`: the available evidence is insufficient.

A **reported outcome** is what Codex said occurred. An **independently
supported outcome** is what result-bearing evidence—such as command output,
file or Git state, or another observable tool result—supports. A tool attempt
shows only that an action started; it does not prove the result.

Provider output is a candidate, not an authority. Kea's deterministic validator
checks that citations exist, evidence classes support the claimed basis,
category-specific rules hold, causal before-and-after evidence is ordered, and
outcome claims have result-bearing support. It can reject a finding, downgrade
its basis or outcome relationship, or make a narrowly defined citation
amendment. Every action is persisted in the validation audit, and unknowns stay
visible.

## Prerequisites and platform support

- Node.js 22.6 or newer, with built-in TypeScript type stripping;
- npm;
- Git; and
- Codex CLI with compatible project-hook support for live capture.

The current runtime acceptance environment is macOS on arm64. Hook behavior was
validated with `codex-cli 0.144.6`. The implementation assumes a POSIX-style
shell and filesystem symlinks. Linux is plausible and has deterministic
browser-opening coverage, but the complete live workflow has not been
acceptance-tested there. Native Windows is unverified. Do not infer broader
platform support from the demo.

The checked-in hooks resolve the recorder through `$PWD`, so launch `codex`
from the repository root.

## Installation and project-local setup

This repository is currently a project-local prototype, not a published npm
package or an arbitrary-project installer.

```bash
git clone https://github.com/jjaw/kea.git
cd kea
npm ci
```

For live capture, inspect `.codex/hooks.json`, review the command when Codex
asks you to trust project hooks, and start Codex from this directory:

```bash
codex
```

The hook command invokes the checked-in recorder. Capture is passive and local;
installing dependencies or trusting the capture hook does not enable provider
transmission.

## Configuration and explicit consent

Export both values in the shell that launches `codex`:

```bash
export OPENAI_API_KEY="your-key"
export KEA_AUTOMATIC_ANALYSIS_ENABLED=true
codex
```

Automatic provider analysis is enabled only when
`KEA_AUTOMATIC_ANALYSIS_ENABLED` has the exact value `true`. The detached
worker inherits the launching shell's environment. This repository does not
load `.env` files, so a value placed only in `.env` is not loaded by Kea.
Never commit an API key or any credential.

The default quiet interval is 60,000 milliseconds (60 seconds) after the latest
captured `Stop` activity. For a live automatic-workflow rehearsal, shorten it
before starting Codex:

```bash
export KEA_AUTOMATIC_QUIET_INTERVAL_MS=2000
```

That override is not needed by `npm run demo`.

## Local files and reports

Principal paths in the project-local workflow are:

```text
.codex-observer/sessions/<session-id>/events.jsonl
.codex-observer/latest/events.jsonl
.codex-observer/analysis-runs/<run-id>/
.codex-observer/session-dispositions/<session-key>/latest.json
.codex-observer/reports/index.html
.codex-observer/reports/<session-id>.md
.kea-demo-output/.codex-observer/
```

The session-scoped JSONL is the raw local recording. `latest` is a best-effort
symlink to the most recently recorded session. Analysis-run directories retain
the sanitized bundle and the available provider, candidate, validated,
validation, metadata, and rendered artifacts. The session Markdown path is the
manual deterministic fallback; validated live Markdown and HTML reports are
stored with their analysis run. The static inbox links to each available local
HTML report.

On macOS, open the live inbox with:

```bash
open ".codex-observer/reports/index.html"
```

## Session dispositions

Every session settled by the automatic worker receives one latest disposition:

- `full_report`: structural evidence was sufficient, live analysis succeeded,
  and a validated report was generated;
- `activity_only`: there was not enough structural evidence for a useful
  session-level narrative, so Kea made no provider call and retained a neutral
  deterministic receipt;
- `blocked`: automatic analysis could not proceed because consent was not
  enabled, the API key was missing, or the complete sanitized corpus exceeded
  the current request budget; or
- `analysis_failed`: an eligible provider or pipeline attempt began but did not
  produce a validated report, so the inbox shows a diagnostic state instead of
  a misleading report.

An `activity_only` receipt is not a judgment that the session was productive,
unproductive, valuable, or wasteful. Environmental `blocked` states can be
reconsidered after later `Stop` activity.

## Privacy and sanitization

Raw recordings include prompts, tool inputs and outputs, file paths, and Git
state. Treat the entire `.codex-observer/` directory as sensitive. It is ignored
by Git, and the raw recording remains local. Only the complete sanitized
evidence payload may leave the machine, and only when an eligible live analysis
has explicit consent and an API key. Kea never automatically hosts, publishes,
or uploads reports.

Before a live provider call, Kea:

1. applies best-effort, high-precision redaction for common private keys, AWS
   access-key IDs, well-known token prefixes, bearer tokens, secret-like
   environment assignments, and connection-string passwords;
2. applies visibly marked per-item truncation—2 KiB for prompts and assistant
   messages, 1 KiB for tool input, 700-byte head plus 300-byte tail for tool
   output, 2 KiB for Git status, and 3 KiB head plus 1 KiB tail for Git diffs;
3. measures the complete serialized sanitized evidence corpus; and
4. enforces a fixed 512 KiB single-request budget.

Per-item truncation never authorizes silently dropping chronological evidence.
If the complete sanitized corpus is oversized, Kea persists a
`bundle_too_large` diagnostic, makes no provider call, and generates no partial
leadership report. Leadership-facing HTML reports and the inbox contain
sanitized evidence, validated analysis, the validation audit, and deterministic
receipts—not raw recordings or unvalidated candidate output. The manual
deterministic fallback Markdown is derived directly from the local recording
and should be treated as sensitive. The current OpenAI request configuration
sets provider storage to false.

Redaction is best effort and does not claim to catch every possible secret or
context-sensitive disclosure. Use the dry-run command to inspect exactly what
would leave the machine. Do not assume an arbitrary recording or generated
artifact is safe to publish.

## Architecture

```text
Codex hooks
→ local JSONL recording
→ Codex adapter and evidence builder
→ sanitization and request-budget check
→ analysis provider
→ schema parsing
→ deterministic validator
→ canonical persisted analysis
→ Markdown and HTML report
→ disposition
→ static report inbox
```

Codex-specific event shapes stay behind the capture and adapter boundary. No
model or network call runs inside a hook.

## Commands

Run the full typecheck and deterministic test suite:

```bash
npm run check
```

Check Node support, hook resolution, recent recording health, and optional API
key availability:

```bash
npm run doctor
```

`npm run doctor` requires recent locally captured activity. A synthetic doctor
smoke test checks the recorder/doctor path; it is not proof of a real Codex
session.

Generate the credential-free reference demo, with or without browser opening:

```bash
npm run demo
npm run demo -- --no-open
```

Manual debugging, forced analysis, and rerun commands remain available:

```bash
npm run report
npm run report -- SESSION_ID
npm run analyze -- --dry-run
npm run analyze -- --dry-run SESSION_ID
npm run analyze
npm run analyze -- SESSION_ID
```

`npm run report` creates the deterministic fallback report. Dry-run prints and
persists the exact complete sanitized corpus, its size, and single-request
eligibility without an API key or provider call. Manual live analysis uses the
latest or selected session; without `OPENAI_API_KEY`, it exits cleanly and
shows the deterministic fallback instead.

## Current limitations

- Kea is a project-local prototype, is not published to npm, and has not been
  tested as an arbitrary-project installation.
- Capture supports Codex only; there are no adapters for other agents.
- Reports are local static files. There is no hosted report service,
  authentication, automatic publication, organization-wide dashboard, or
  cross-session dashboard.
- Automatic processing uses one-shot workers after turn-scoped `Stop` events,
  not a permanent daemon. `Stop` is not a guaranteed session-end event.
- Oversized evidence cannot yet be segmented across multiple requests; it is
  blocked rather than partially analyzed.
- Consent or key-related blocks are reconsidered after later `Stop` activity,
  not by a watcher. Locking is intentionally simple and has no complete
  stale-lock lease or automatic crash-recovery system.
- Some hosted or specialized tools may not emit the expected capture hooks.
- Secret redaction is best effort, and `npm run doctor` requires recent local
  activity.
- Kea does not produce employee rankings, productivity scores, developer
  comparisons, ROI measurements, or claimed hours saved.

## Hackathon scope

Kea is an OpenAI Build Week hackathon MVP focused on one evidence-complete
Codex session at a time. Codex was used to build and verify the project, and
the deterministic judge demo is based on one manually sanitized real
development session. Package publication, arbitrary-project installation,
cross-session aggregation, hosted delivery, authentication, and support for
other agents remain outside the implemented scope.

## License

Kea is available under the [MIT License](LICENSE).
