# Kea

AI coding tools can produce convincing explanations of what happened during a
development session. The harder question is whether those explanations are
actually supported by evidence.

**Kea does not just summarize a coding session. It checks whether the summary
can be trusted.**

<img width="1600" height="900" alt="Screenshot 2026-07-21 at 3 56 07 PM" src="https://github.com/user-attachments/assets/550b49e1-667e-4ea8-93ef-f60d0708a57a" />

Kea is a lightweight, project-local companion for Codex CLI. It passively
records observable activity, separates what Codex reported from what observable
results independently support, and rejects or weakens findings that the
retained evidence cannot justify. When evidence is insufficient, Kea reports
`unknown` instead of filling the gap with a plausible story.

Kea began as a way for its creator—who does not work inside an organization
with an unlimited AI budget—to understand their own AI-assisted development
process and use AI more deliberately. Conversations with managers and business
leaders revealed a broader concern: organizations are spending heavily on AI
while often lacking reliable evidence about what the work actually
accomplished. Kea does not calculate ROI, productivity, hours saved, financial
efficiency, employee performance, or organization-wide AI effectiveness. It
provides an evidence layer that may inform later evaluations of AI usage and
investment.

## Credential-free demo

```bash
git clone https://github.com/jjaw/kea.git
cd kea
npm ci
npm run demo
```

`npm ci` normally needs network access to install dependencies. After that,
`npm run demo` requires no API key and makes no network request. It uses a
committed, manually reviewed, sanitized recording of a real Codex-assisted Kea
development session.

Deterministic local candidate analysis replaces only the live provider call.
The real Codex adapter, evidence builder, schema parser, deterministic
validator, persistence, report renderers, disposition logic, and static inbox
still run. Demo output stays beneath `.kea-demo-output/` and does not inspect or
modify the project's real `.codex-observer/` data. The inbox opens automatically
in a supported interactive environment; use this form to suppress opening:

```bash
npm run demo -- --no-open
```




<video src="https://github.com/user-attachments/assets/bad88f61-3820-49ce-bbcb-c9e438b7dff4" width="500" autoplay loop muted playsinline></video>


The reference candidate deliberately contains three problems:

- **Rejected:** a finding cites nonexistent evidence and is removed.
- **Downgraded:** a finding claims stronger support than its citations justify,
  so its evidence basis is weakened.
- **Amended:** a valid turning point omits a required canonical citation, so
  the validator adds it in evidence order and records the repair.

The demo reports `1 rejected · 1 downgraded · 1 amended`. Those exact counts
belong to the reference fixture, not every live session.

<!-- Screenshot: Kea report inbox showing a completed session, independently
supported outcome, and uncertainty/status. -->

## What Kea produces

Kea's local report inbox gives developers and leaders a concise view of:

- the session objective and meaningful observable development activity;
- approaches, failures, changes in direction, and human corrections that can
  be reconstructed from retained evidence;
- what Codex reported versus what command output, tool results, or Git state
  independently support; and
- uncertainty, unresolved evidence gaps, and evidence-backed leadership
  insights.

Reports link findings back to sanitized evidence and include the validator's
audit. Kea does not access hidden model reasoning, and the available hooks do
not guarantee capture of every intermediate assistant message or specialized
tool.

## How the live workflow works

Developers continue to run only `codex` after project setup:

1. Project hooks capture lifecycle events, human prompts, tool attempts and
   results, assistant messages available at `Stop`, and Git snapshots.
2. Hooks write local JSONL and fail open. No model or network work occurs in a
   hook.
3. A `Stop` event starts a detached one-shot worker. It waits for the session to
   remain quiet, processes the newest evidence state, updates the inbox, and
   exits. There is no permanent Kea daemon.
4. Sessions with insufficient structural evidence receive an `activity_only`
   receipt without a provider call. Eligible sessions continue only when
   automatic analysis has explicit consent, an API key is available, and the
   complete sanitized corpus fits the request budget.
5. Candidate analysis is schema-parsed, deterministically validated, persisted
   locally, and rendered as a leadership report.

The resulting disposition is `full_report`, `activity_only`, `blocked`, or
`analysis_failed`. A receipt is a description of available evidence, not a
judgment about a developer or the value of the work.

## Evidence integrity

Every finding has one evidence basis:

- `observed`: captured activity or state supports it;
- `explicit`: a developer or Codex message states it;
- `inference`: it is reasoned from cited evidence and includes confidence; or
- `unknown`: the evidence is insufficient.

A **reported outcome** is what Codex said occurred. An **independently supported
outcome** is what result-bearing evidence such as command output, a tool result,
or Git state supports. A tool attempt proves only that an action started, not
that it succeeded.

Provider output is a candidate, not an authority. A model can return valid
structured output while making a claim stronger than its cited evidence.
Kea's deterministic rules therefore check that citations exist, source classes
are compatible with the claimed basis, outcome claims cite result-bearing
evidence, and causal claims have ordered before-and-after evidence. Findings
may be rejected, downgraded, or narrowly amended, and every action remains
visible in the validation audit.

<!-- Screenshot: evidence-backed finding with citations and validator audit
detail. -->

## Building Kea with GPT-5.6 and Codex

Kea was built through a deliberate division of responsibility between human
judgment, GPT-5.6, and Codex.

**Early product selection.** The human and GPT-5.6 explored several ideas and
narrowed them to three. Kea was selected because it addressed a real personal
problem, fit a short hackathon, and could be used recursively while being
built. Part of Kea's own Codex-assisted development activity later became the
sanitized real session used by the reference demo.

**Human role.** The human made or approved the final product, architecture,
safety, scope, and user-experience decisions. Representative choices included
keeping normal use passive; using a short-lived worker rather than a daemon;
separating reported and independently supported outcomes; preserving
`unknown`; making deterministic validation authoritative; blocking oversized
sessions instead of dropping chronological evidence; keeping raw recordings
local; requiring explicit transmission consent; selecting and reviewing the
demo fixture; and having the demo open the inbox automatically. The human also
reviewed Codex's architectural suggestions, debugged with Codex, and pushed
back when proposed work expanded beyond the frozen milestone.

**GPT-5.6 role.** GPT-5.6 served as the planning, reasoning, product-review, and
project-management partner. It helped compare ideas, challenge the positioning,
define evidence boundaries, divide the work into scoped milestones, write
implementation prompts for Codex, review results, decide whether milestones
should be accepted or revised, and refine the demo and README. GPT-5.6 did not
directly edit repository files.

**Codex role.** After the core product direction was established, Codex helped
create the implementation from the beginning. It accelerated scaffolding and
boilerplate; implementation across hooks, workers, evidence, validation,
persistence, and reporting; deterministic tests and fixtures; tracing connected
code paths; debugging from real command output; milestone-context maintenance;
clean-checkout and demo verification; and presenting diffs and test results for
human review. Codex did not autonomously choose the product direction.

```text
human product judgment
→ GPT-5.6 planning and review
→ Codex implementation and verification
→ human acceptance or revision
```

## Install and set up Kea

The MVP runs only from the cloned Kea repository; npm publication and
arbitrary-project installation are future work. These steps enable Kea inside
that checkout.

Prerequisites are Node.js 22.6 or newer, npm, Git, and Codex CLI with project
hooks. Kea was tested on macOS arm64 with `codex-cli 0.144.6`. It assumes a
POSIX-style shell and filesystem symlinks; Linux is plausible but not fully
acceptance-tested, and native Windows is unverified.

### 1. Clone and install dependencies

```bash
git clone https://github.com/jjaw/kea.git
cd kea
npm ci
```

### 2. Choose local capture or automatic analysis

Local capture needs no API key or Kea environment variable. Skip to step 3 if
you only want local recording.

For automatic provider-backed analysis, set both values in the same shell that
will launch Codex:

```bash
export OPENAI_API_KEY="your-key"
export KEA_AUTOMATIC_ANALYSIS_ENABLED=true
```

`KEA_AUTOMATIC_ANALYSIS_ENABLED` is explicit consent to send an eligible,
sanitized evidence payload to the OpenAI API; only the exact value `true`
enables it. Hook approval is separate. The worker inherits the shell
environment, and there is no `.env` loader. Never commit API keys. Users supply
their own key and pay for model usage; Kea does not host or proxy analysis.

### 3. Start Codex and approve the project hooks

Launch Codex from the repository root because the checked-in hooks resolve the
recorder through `$PWD`:

```bash
codex
```

If Codex asks you to trust the repository, review and trust it. Then enter
`/hooks` in Codex, review the commands from `.codex/hooks.json`, and trust the
current definitions. Codex skips command hooks until trusted. Trust follows the
definition hash, so changes require another review and a different machine or
Codex profile may prompt again. See the [Codex hook trust
documentation](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks).

After approval, use Codex normally. Kea captures passively; there is no Kea
command to run after each turn.

### 4. Verify capture

After submitting at least one Codex prompt and completing a turn, run this in
another terminal from the same repository:

```bash
npm run doctor
```

The doctor checks the environment, hook commands, and recent local recording.
It requires recent captured activity, so run it after using Codex rather than
immediately after installation.

### 5. Open the local inbox

After `Stop` activity, Kea's one-shot worker waits for the session to settle,
processes it, updates the inbox, and exits. Open this file in a browser:

```text
.codex-observer/reports/index.html
```

The default quiet interval is 60 seconds. For live-workflow rehearsal only,
you can set a two-second override before launching Codex:

```bash
export KEA_AUTOMATIC_QUIET_INTERVAL_MS=2000
```

This override is optional and is not needed for normal use or `npm run demo`.

## Privacy and local data

Raw prompts, tool output, paths, and Git state remain under
`.codex-observer/`, which is ignored by Git and should be treated as sensitive.
Provider transmission occurs only through a manually requested live analysis
or an eligible automatic run with explicit project consent and an API key. In
either case, only the complete sanitized evidence payload may be sent to the
OpenAI API. The provider configuration uses `store: false`.

Sanitization uses best-effort, high-precision secret patterns followed by
visible per-item truncation: 2 KiB for prompts and assistant messages, 1 KiB
for tool input, a 700-byte head and 300-byte tail for tool output, 2 KiB for Git
status, and a 3 KiB head and 1 KiB tail for Git diffs. It cannot guarantee that
every context-specific secret will be found.

Kea measures the complete sanitized corpus against a 512 KiB single-request
budget. Oversized sessions are `blocked`; Kea makes no provider call and does
not create a partial leadership report by silently dropping evidence.

Useful local paths:

```text
.codex-observer/sessions/<session-id>/events.jsonl  raw recording
.codex-observer/reports/index.html                 live report inbox
.kea-demo-output/.codex-observer/reports/index.html  demo inbox
```

## Commands

```bash
npm run check                         # typecheck and deterministic tests
npm run doctor                        # environment, hooks, and recent recording
npm run demo                          # credential-free reference demo
npm run demo -- --no-open             # demo without browser opening
npm run analyze -- --dry-run          # inspect exactly what would be sent
npm run analyze -- --dry-run SESSION_ID
npm run analyze                       # manual live analysis of latest session
npm run analyze -- SESSION_ID
npm run report                        # deterministic fallback report
npm run report -- SESSION_ID
```

Dry-run needs no API key and makes no provider call. It prints and persists the
complete sanitized corpus, its size, and request eligibility. Without an API
key, manual `npm run analyze` exits cleanly with the deterministic fallback.
`npm run doctor` requires recent local captured activity.

## Architecture

```text
Codex hooks → local JSONL → adapter and evidence builder
→ sanitization and request-budget check → analysis provider → schema parsing
→ deterministic validator → local persistence and reports → disposition → inbox
```

Agent-specific payload knowledge remains behind the Codex adapter boundary so
other coding agents can be supported later without changing the evidence and
validation model.

## Current limitations

The hackathon MVP supports Codex because it was built for a Codex-focused
hackathon. Arbitrary-project installation, npm publication, other agent
adapters, hosted sharing, authentication, and cross-session project views are
not implemented. There is no permanent daemon; `Stop` is turn-scoped rather
than a guaranteed session-end event. Oversized sessions cannot yet be segmented
across multiple requests, locking has no complete stale-lock recovery system,
and some hosted or specialized tools may not emit the expected hooks.

Local reporting is a deliberate MVP boundary, not necessarily a permanent
product boundary. Keeping raw capture, sanitization, validation, and the static
inbox project-local reduced the hackathon's privacy and security surface and
kept attention on the harder evidence problem.

## What's next for Kea

The first practical next step is making Kea installable inside any existing
repository through a one-command initializer. Because the unscoped `kea`
package name is already in use on npm, the likely experience would be something
such as `npx @jjaw/kea init`, followed by commands like `kea doctor`, `kea
report`, and `kea uninstall`.

Kea also needs to grow beyond a Codex-only recorder. The plan is to introduce a
shared adapter layer that can normalize evidence from Codex hooks, other
coding-agent hooks, structured logs, APIs, and native telemetry where those
sources are available. Each adapter would declare what it can and cannot
observe so Kea can preserve uncertainty rather than treating incomplete
telemetry as complete evidence.

For teams, the long-term model is local capture with optional organizational
sharing. Raw prompts, command output, paths, and source details would remain on
the developer's machine by default. Developers or administrators could choose
to synchronize only sanitized and validated session briefs to a shared project
dashboard.

Small teams could continue approving Kea's hooks during setup. Managed
organizations could have an administrator review Kea once and distribute its
executable and managed hook policy centrally, avoiding separate approval by
every developer.

Future team views could surface supported outcomes, recurring blockers, human
interventions, unresolved uncertainty, and evidence coverage across sessions.
Kea would continue avoiding developer rankings, speculative productivity
scores, hours-saved estimates, and automatic ROI claims.

The long-term goal is for Kea to become an agent-independent evidence layer:
not merely tracking how much AI was used, but helping individuals and
organizations understand what the available evidence says that AI-assisted
work actually accomplished.

## License

Kea is available under the [MIT License](LICENSE).
