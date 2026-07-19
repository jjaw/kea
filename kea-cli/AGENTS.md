# Codex Observer

## Product goal

Build a lightweight companion for Codex CLI that records observable
session activity and generates evidence-backed explanations for
technical leaders.

The product should help explain:

- what the developer was trying to accomplish;
- which approaches were attempted;
- which approaches failed or were rejected;
- what human corrections or decisions changed the work;
- what outcome resulted.

## MVP principles

- Keep the developer-side recorder extremely lightweight.
- Developers should continue using the normal `codex` command.
- Prefer official Codex hooks over terminal scraping or a CLI wrapper.
- Store all initial data locally.
- The recorder must never block or crash a Codex session.
- Do not build employee rankings or productivity scores.
- Do not claim exact ROI or hours saved.
- Every analytical finding must link to observable evidence.
- Distinguish observed facts, explicit statements, and inferences.
- Use “unknown” when evidence is insufficient.

## Current MVP scope

1. Record one Codex CLI session.
2. Save raw hook events as JSONL.
3. Capture Git state at session start and end.
4. Normalize the raw events into a stable internal schema.
5. Analyze objective, attempts, failures, corrections, and outcome.
6. Display one evidence-backed session report.

## Out of scope

- Authentication
- Jira or Linear
- GitHub organization integration
- Multi-agent support
- Live coaching
- Billing ingestion
- Enterprise dashboards
- Developer performance comparisons
- Exact AI ROI calculations

## Engineering rules

- Use TypeScript.
- Validate external data with Zod.
- Keep Codex-specific formats behind an adapter.
- Never commit raw recorded sessions.
- Add focused tests for parsing and normalization.
- Make small, reviewable commits.
