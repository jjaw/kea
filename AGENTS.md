# Kea

Kea is a lightweight companion for Codex CLI. It passively records observable
session activity and turns it into evidence-backed explanations of why an
AI-assisted coding session succeeded, failed, changed direction, or required
human correction. The primary reader is a technical leader; the developer must
be able to verify every claim.

Kea's differentiator is epistemic honesty: every finding carries an evidence
basis, machine-checked citations, and a clear line between what an agent
*claimed* and what the evidence *supports*.

Kea must never become an employee surveillance, ranking, or
productivity-scoring system.

**Before working on milestone or feature tasks, read `docs/mvp-brief.md`.**
It contains current status, the active milestone, scope decisions, and the
demo plan. This file contains only durable rules.

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
  finding's basis. A finding claiming `observed` whose citations are not
  system-captured evidence is downgraded, not trusted.
- Causal claims (turning points) require temporally ordered before-and-after
  evidence.
- Never treat an assistant success statement as independently verified
  success. Report "reported outcome" and "independently supported outcome"
  separately.
- Use `unknown` rather than inventing intent, causality, success, failure,
  or motivation.
- Never request, infer, expose, or claim access to hidden chain-of-thought.

## Architecture

Keep agent-specific formats behind adapters:

    raw agent events
        -> agent-specific adapter
        -> stable Kea normalized session
        -> compact evidence bundle (deliberately lossy: truncated + redacted)
        -> analysis provider interface
        -> validated structured analysis
        -> report renderer

- Only the adapter layer may know Codex payload shapes.
- Only the provider layer may know OpenAI APIs. Keep model names and provider
  configuration centralized.
- The evidence bundle is intentionally lossy. Truncation and redaction before
  model calls take precedence over field preservation.
- Preserve unknown external fields at the *capture* boundary; recordings are
  the source of truth, bundles are derived.
- Do not add adapters for other agents (Claude Code, Cursor, Kimi, etc.)
  unless explicitly requested.

## Recorder principles

- Developers keep using the normal `codex` command; hooks are passive.
- The recorder must never block, slow, or crash a Codex session.
- No network or model calls inside hooks. Model analysis runs only via an
  explicit user command.
- Recordings and generated analyses stay local. Never commit raw session
  recordings, API keys, or `.env` files.

## Privacy and safety

- Treat prompts, tool outputs, file paths, and Git diffs as sensitive.
- Before any model call: apply per-item size caps and redact recognizable
  secret patterns (cloud keys, bearer tokens, PEM blocks, env-style
  assignments).
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
- Add focused tests for parsing, normalization, evidence mapping, validation,
  and rendering. Mock providers in tests; tests must never call a real API.
- Maintain at least one sanitized real recorded session as a committed test
  fixture, and test the full pipeline against it with a mocked provider.
- Prefer small, reviewable changes. Do not commit unless explicitly asked;
  when asked, use small commits with descriptive messages.
- Existing internal paths such as `.codex-observer/` may remain; do not
  perform storage migrations solely to rename directories unless requested.

## Commands

    npm run check      # typecheck + tests
    npm run report     # deterministic report for the latest session
    npm run report -- SESSION_ID