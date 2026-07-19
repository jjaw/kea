# Codex capture spike

## Scope

This proof of concept uses project-level Codex lifecycle hooks. Developers keep
starting Codex with the normal `codex` command; there is no wrapper, service,
database, or network destination.

The project config registers five passive events:

| Event | Evidence captured |
| --- | --- |
| `SessionStart` | Session identity, start source, and initial Git state |
| `UserPromptSubmit` | User objective, follow-up instructions, and corrections |
| `PreToolUse` | Tool attempts, including calls that may never complete |
| `PostToolUse` | Tool inputs and outputs, including failed shell commands |
| `Stop` | Latest assistant message and the latest available Git state |

Each received object is stored unchanged under `payload`. The surrounding
`capture` object adds a timestamp, session/event keys, validation errors, and
Git state where applicable. Records with a usable `session_id` are written to
`.codex-observer/sessions/<session-id>/events.jsonl`; missing or invalid session
identity is written under `ungrouped`.

## Documented event fields

The current official hook reference documents common fields including
`session_id`, `transcript_path`, `cwd`, `hook_event_name`, and `model`. All five
selected events also include `permission_mode`; turn-scoped events include
`turn_id`.

| Event | Documented event-specific fields |
| --- | --- |
| `SessionStart` | `source` |
| `UserPromptSubmit` | `turn_id`, `prompt` |
| `PreToolUse` | `turn_id`, `tool_name`, `tool_use_id`, `tool_input` |
| `PostToolUse` | `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response` |
| `Stop` | `turn_id`, `stop_hook_active`, `last_assistant_message` |

The recorder validates only stable routing fields and accepts all other keys.
Codex-specific payload details remain behind this capture boundary for a later
adapter.

## Actual observations

A real read-only `codex exec` validation on `codex-cli 0.144.6` observed all
five configured events in this order. The exact payload keys were:

| Observed event | Observed payload keys |
| --- | --- |
| `SessionStart` | `cwd`, `hook_event_name`, `model`, `permission_mode`, `session_id`, `source`, `transcript_path` |
| `UserPromptSubmit` | `cwd`, `hook_event_name`, `model`, `permission_mode`, `prompt`, `session_id`, `transcript_path`, `turn_id` |
| `PreToolUse` | `cwd`, `hook_event_name`, `model`, `permission_mode`, `session_id`, `tool_input`, `tool_name`, `tool_use_id`, `transcript_path`, `turn_id` |
| `PostToolUse` | `cwd`, `hook_event_name`, `model`, `permission_mode`, `session_id`, `tool_input`, `tool_name`, `tool_response`, `tool_use_id`, `transcript_path`, `turn_id` |
| `Stop` | `cwd`, `hook_event_name`, `last_assistant_message`, `model`, `permission_mode`, `session_id`, `stop_hook_active`, `transcript_path`, `turn_id` |

The test prompt was preserved in `UserPromptSubmit.prompt`; `PreToolUse` and
`PostToolUse` both reported `tool_name: "Bash"` and
`tool_input.command: "pwd"`; `PostToolUse.tool_response` contained the working
directory; and `Stop.last_assistant_message` contained `capture-validation`.
Both Git snapshots contained `head`, `branch`, `status`, `diff`, and `errors`,
with no capture errors. The five records appeared in one session-scoped JSONL
file.

## Suitability for later analysis

`UserPromptSubmit.prompt` supplies explicit conversational intent and human
corrections. `Stop.last_assistant_message` supplies the latest assistant-facing
outcome. Together they should support a basic "why" narrative when connected
to `PreToolUse` and `PostToolUse` evidence. They do not expose hidden model
reasoning, and they cannot prove motives that the developer did not state.
Those cases must remain inferences or `unknown`.

The documented `transcript_path` may contain richer conversation history, but
the official reference explicitly says its format is not a stable hook
interface. This spike records the path from the raw payload but does not read or
copy the transcript.

## Gaps and unstable interfaces

- Codex has `SessionStart` but no documented `SessionEnd` event. `Stop` is a
  turn-level hook, so the recorder snapshots Git after every completed turn.
  The last snapshot usually approximates session-end state but cannot observe a
  terminal being killed or Codex exiting between turns.
- Hosted tools such as web search are not covered by `PreToolUse` or
  `PostToolUse`; some specialized local tools can also opt out.
- `PermissionRequest` can observe an approval request but does not report the
  human's eventual choice, so it is not part of this minimum passive set.
- Hook payloads and `transcript_path` are Codex-owned interfaces. The raw
  payload is retained so later normalization can tolerate field changes.
- Git commands have a 1-second timeout and a 16 MiB output limit per field.
  A failure is recorded in `capture.git.errors` and never affects Codex.
- Untracked file contents are listed by Git status but are not included in
  `git diff`. Binary tracked changes are included using `--binary`.
- Project hooks run only after the repository and exact hook definition are
  trusted. Changing the hook config requires review again.

## Trust and first run

Start Codex normally from this project directory:

```sh
cd /Users/willjaw/workspace/personal/hackathon/codex/kea-cli
codex
```

At startup, run `/hooks`, review the project hook source and command, and trust
the exact definition. The command invokes only the checked-in recorder, sends
no hook output back to Codex, redirects recorder diagnostics, and ends with
`|| true` so failures cannot block the session. Do not use
`--dangerously-bypass-hook-trust` for normal development.

After submitting at least one prompt, inspect:

```text
.codex-observer/sessions/<session-id>/events.jsonl
```

The entire `.codex-observer/` directory is ignored by Git.

For this spike, start Codex from the project directory shown above. The
enclosing Git repository's top level is one directory above `kea-cli`, so the
hook command intentionally resolves the recorder from the Codex session's
working directory rather than from `git rev-parse --show-toplevel`.

## Sources checked

- [Official Codex hooks reference](https://learn.chatgpt.com/docs/hooks)
- The locally installed `codex-cli 0.144.6` feature list, where `hooks` is
  marked stable
