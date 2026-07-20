# Kea

## Product goal

Build a lightweight companion for Codex CLI that records observable session
activity and turns it into evidence-backed explanations for technical leaders.

Kea should help explain:

- what the developer was trying to accomplish;
- which major approaches were attempted;
- which approaches failed, stalled, or were rejected;
- what human corrections, constraints, or decisions changed the work;
- what Codex contributed;
- what outcome resulted;
- which conclusions remain uncertain.

The primary user is a technical leader trying to understand how and why
AI-assisted development sessions succeed, fail, or require human correction.

## Product positioning

Kea explains the why behind Codex usage, not merely usage counts or activity
metrics.

It must not become an employee surveillance, ranking, or productivity-scoring
system.

## Current implementation

The repository currently includes:

- project-level passive Codex hooks;
- local JSONL event recording grouped by Codex session;
- a latest-session pointer;
- Git snapshots at session start and turn stop;
- Zod validation that preserves unknown Codex fields;
- a Codex-specific normalization adapter;
- line-level evidence references;
- a deterministic session analyzer;
- on-demand Markdown reports;
- focused recorder, normalization, and reporting tests.

The current deterministic analyzer is useful as a fallback and debugging
baseline, but it does not yet provide sufficient semantic interpretation for
the final product.

## Final hackathon MVP target

The hackathon MVP should:

1. Record observable Codex session activity with minimal developer overhead.
2. Normalize Codex-specific data into a stable Kea schema.
3. Generate a GPT-5.6-powered, evidence-backed analysis of one session.
4. Identify objectives, major approaches, failures, abandoned approaches,
   human interventions, turning points, Codex contributions, outcomes, and
   evidence gaps.
5. Present the session through a focused visual report with accessible
   supporting evidence.
6. When time permits, compare three to five sessions, identify recurring
   patterns, and produce a small number of actionable recommendations for a
   technical leader.

## Current milestone

The next milestone is the GPT-5.6-powered single-session analysis pipeline.

Preserve the existing deterministic analyzer as:

- a fallback when model analysis is unavailable;
- a debugging reference;
- a source of basic structural facts;
- a baseline for comparing model-powered analysis.

Do not build the visual report or multi-session aggregation until the
single-session analysis is validated against real recorded sessions.

## Evidence model

Every analytical finding must use one of these bases:

- `observed`: directly captured system, hook, tool, test, or Git evidence;
- `explicit`: directly stated by a human or Codex;
- `inference`: a conclusion reasoned from multiple evidence records;
- `unknown`: the available evidence is insufficient.

Every non-unknown finding must reference one or more valid evidence records.

A model may only cite evidence IDs supplied in its input. Kea must reject or
downgrade findings that cite nonexistent evidence IDs.

Do not treat a Codex success statement as independently verified success.

Use `unknown` rather than inventing intent, causality, success, failure, or
motivation that the evidence does not support.

Never request, infer, expose, or claim access to hidden chain-of-thought.

## Analysis behavior

The analysis should:

- group related tool calls into meaningful approaches;
- distinguish an initial objective from later follow-up work;
- classify later human prompts by role;
- identify only meaningful corrections, constraints, and decisions as human
  interventions;
- avoid classifying every later prompt as a correction;
- distinguish questions, approvals, clarifications, follow-up tasks, and
  direction-changing interventions;
- identify causal turning points only when supported by before-and-after
  evidence;
- distinguish reported outcomes from independently supported outcomes;
- identify unresolved questions and evidence limitations;
- produce concise, defensible leadership insights.

Possible human-message categories include:

- correction;
- constraint;
- decision;
- clarification;
- approval;
- follow-up task;
- question;
- status request;
- other.

## MVP principles

- Keep the developer-side recorder extremely lightweight.
- Developers should continue using the normal `codex` command.
- Prefer official Codex hooks over terminal scraping or a CLI wrapper.
- Store initial recordings and generated reports locally.
- The recorder must never block or crash a Codex session.
- Do not make OpenAI API requests from inside recording hooks.
- Run model-powered analysis only through an explicit user command.
- Never commit raw recorded sessions.
- Do not claim exact ROI, productivity gains, or hours saved.
- Do not create employee rankings or individual performance scores.
- Favor a focused, convincing demo over broad enterprise functionality.

## Architecture

Keep agent-specific formats behind adapters.

The intended boundary is:

    raw agent events
        -> agent-specific adapter
        -> stable Kea normalized session
        -> evidence bundle
        -> analysis provider
        -> validated structured analysis
        -> report renderer

The current MVP supports Codex only.

Do not add Claude Code, Kimi, Cursor, or other agent adapters during the
hackathon unless explicitly requested after the Codex MVP is complete.

Keep OpenAI-specific analysis code behind a small provider interface so the
normalized session and report domain remain provider-independent.

Existing internal paths such as `.codex-observer/` may remain temporarily.
Do not perform a storage migration solely to rename internal directories
unless explicitly requested.

## Out of scope

- Authentication
- Jira or Linear integration
- GitHub organization integration
- Multi-agent support
- Live coaching
- Billing ingestion
- Enterprise-wide dashboards
- Developer performance comparisons
- Employee rankings
- Exact AI ROI calculations
- Automatic model analysis inside hooks

## Engineering rules

- Use TypeScript.
- Validate external data and model output with Zod.
- Preserve unknown external fields at capture boundaries where practical.
- Keep Codex-specific formats behind an adapter.
- Keep OpenAI-specific behavior behind an analysis-provider interface.
- Use reasonable size limits for prompts, tool output, and Git evidence sent
  to a model.
- Never commit API keys, `.env` files, or raw session recordings.
- Add focused tests for parsing, normalization, evidence mapping, validation,
  and report rendering.
- Mock model providers in automated tests.
- Tests must not call the real OpenAI API.
- Prefer small, reviewable changes.
- Do not commit unless explicitly requested.
- When asked to commit, use small commits with descriptive messages.

## Existing commands

Run all current checks:

    npm run check

Generate a deterministic report for the latest recorded session:

    npm run report

Generate a deterministic report for a selected session:

    npm run report -- SESSION_ID