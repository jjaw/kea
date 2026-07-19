import { readFileSync, realpathSync } from "node:fs";
import { z } from "zod";

const GitSnapshotSchema = z
  .object({
    head: z.string().nullable(),
    branch: z.string().nullable(),
    status: z.string().nullable(),
    diff: z.string().nullable(),
    errors: z.array(z.string())
  })
  .loose();

const CapturedRecordSchema = z
  .object({
    capture: z
      .object({
        schemaVersion: z.number(),
        capturedAt: z.string().min(1),
        sessionId: z.string().nullable(),
        eventName: z.string().nullable(),
        validationErrors: z.array(z.string()).optional(),
        git: GitSnapshotSchema.optional()
      })
      .loose(),
    payload: z.unknown()
  })
  .loose();

const CommonPayloadSchema = z
  .object({
    session_id: z.string().optional(),
    hook_event_name: z.string().optional(),
    cwd: z.string().optional(),
    model: z.string().optional(),
    turn_id: z.string().optional()
  })
  .loose();

const SessionStartPayloadSchema = CommonPayloadSchema.extend({
  hook_event_name: z.literal("SessionStart"),
  source: z.string().optional()
}).loose();

const UserPromptPayloadSchema = CommonPayloadSchema.extend({
  hook_event_name: z.literal("UserPromptSubmit"),
  prompt: z.string()
}).loose();

const PreToolPayloadSchema = CommonPayloadSchema.extend({
  hook_event_name: z.literal("PreToolUse"),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  tool_input: z.unknown()
}).loose();

const PostToolPayloadSchema = CommonPayloadSchema.extend({
  hook_event_name: z.literal("PostToolUse"),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  tool_input: z.unknown(),
  tool_response: z.unknown()
}).loose();

const StopPayloadSchema = CommonPayloadSchema.extend({
  hook_event_name: z.literal("Stop"),
  last_assistant_message: z.string().nullable().optional(),
  stop_hook_active: z.boolean().optional()
}).loose();

export type GitSnapshot = z.infer<typeof GitSnapshotSchema>;

export type EvidenceRef = {
  sessionId: string | null;
  line: number;
  eventName: string | null;
  capturedAt: string;
  sourcePath: string;
};

type NormalizedEventBase = {
  cwd: string | null;
  model: string | null;
  turnId: string | null;
  evidence: EvidenceRef;
};

export type NormalizedEvent =
  | (NormalizedEventBase & {
      type: "session_start";
      source: string | null;
      git: GitSnapshot | null;
    })
  | (NormalizedEventBase & {
      type: "user_prompt";
      prompt: string;
    })
  | (NormalizedEventBase & {
      type: "tool_attempt";
      toolName: string | null;
      toolUseId: string | null;
      input: unknown;
    })
  | (NormalizedEventBase & {
      type: "tool_result";
      toolName: string | null;
      toolUseId: string | null;
      input: unknown;
      response: unknown;
    })
  | (NormalizedEventBase & {
      type: "turn_stop";
      lastAssistantMessage: string | null;
      stopHookActive: boolean | null;
      git: GitSnapshot | null;
    })
  | (NormalizedEventBase & {
      type: "unknown";
      eventName: string | null;
    });

export type AdapterDiagnostic = {
  line: number;
  message: string;
};

export type NormalizedSession = {
  schemaVersion: 1;
  sessionId: string | null;
  sourcePath: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  cwd: string | null;
  model: string | null;
  events: NormalizedEvent[];
  diagnostics: AdapterDiagnostic[];
};

export function readCodexSessionFile(filePath: string): NormalizedSession {
  const canonicalPath = realpathSync(filePath);
  return normalizeCodexSession(readFileSync(canonicalPath, "utf8"), canonicalPath);
}

export function normalizeCodexSession(
  jsonl: string,
  sourcePath: string
): NormalizedSession {
  const events: NormalizedEvent[] = [];
  const diagnostics: AdapterDiagnostic[] = [];
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let model: string | null = null;

  for (const [index, line] of jsonl.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") {
      continue;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch (error) {
      diagnostics.push({ line: lineNumber, message: `Invalid JSON: ${message(error)}` });
      continue;
    }

    const parsedRecord = CapturedRecordSchema.safeParse(decoded);
    if (!parsedRecord.success) {
      diagnostics.push({
        line: lineNumber,
        message: parsedRecord.error.issues
          .map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`)
          .join("; ")
      });
      continue;
    }

    const record = parsedRecord.data;
    const common = CommonPayloadSchema.safeParse(record.payload);
    const payloadSessionId = common.success ? common.data.session_id ?? null : null;
    const recordSessionId = record.capture.sessionId ?? payloadSessionId;

    if (sessionId === null) {
      sessionId = recordSessionId;
    } else if (recordSessionId !== null && recordSessionId !== sessionId) {
      diagnostics.push({
        line: lineNumber,
        message: `Conflicting session id ${recordSessionId}; expected ${sessionId}`
      });
    }

    if (common.success) {
      cwd ??= common.data.cwd ?? null;
      model ??= common.data.model ?? null;
    }

    const evidence: EvidenceRef = {
      sessionId: recordSessionId,
      line: lineNumber,
      eventName: record.capture.eventName,
      capturedAt: record.capture.capturedAt,
      sourcePath
    };
    events.push(normalizeEvent(record.payload, record.capture.git ?? null, evidence, diagnostics));
  }

  return {
    schemaVersion: 1,
    sessionId,
    sourcePath,
    firstObservedAt: events[0]?.evidence.capturedAt ?? null,
    lastObservedAt: events.at(-1)?.evidence.capturedAt ?? null,
    cwd,
    model,
    events,
    diagnostics
  };
}

function normalizeEvent(
  payload: unknown,
  git: GitSnapshot | null,
  evidence: EvidenceRef,
  diagnostics: AdapterDiagnostic[]
): NormalizedEvent {
  const common = CommonPayloadSchema.safeParse(payload);
  const base: NormalizedEventBase = {
    cwd: common.success ? common.data.cwd ?? null : null,
    model: common.success ? common.data.model ?? null : null,
    turnId: common.success ? common.data.turn_id ?? null : null,
    evidence
  };
  const eventName = common.success
    ? common.data.hook_event_name ?? evidence.eventName
    : evidence.eventName;

  switch (eventName) {
    case "SessionStart": {
      const parsed = SessionStartPayloadSchema.safeParse(payload);
      if (parsed.success) {
        return { ...base, type: "session_start", source: parsed.data.source ?? null, git };
      }
      break;
    }
    case "UserPromptSubmit": {
      const parsed = UserPromptPayloadSchema.safeParse(payload);
      if (parsed.success) {
        return { ...base, type: "user_prompt", prompt: parsed.data.prompt };
      }
      break;
    }
    case "PreToolUse": {
      const parsed = PreToolPayloadSchema.safeParse(payload);
      if (parsed.success) {
        return {
          ...base,
          type: "tool_attempt",
          toolName: parsed.data.tool_name ?? null,
          toolUseId: parsed.data.tool_use_id ?? null,
          input: parsed.data.tool_input
        };
      }
      break;
    }
    case "PostToolUse": {
      const parsed = PostToolPayloadSchema.safeParse(payload);
      if (parsed.success) {
        return {
          ...base,
          type: "tool_result",
          toolName: parsed.data.tool_name ?? null,
          toolUseId: parsed.data.tool_use_id ?? null,
          input: parsed.data.tool_input,
          response: parsed.data.tool_response
        };
      }
      break;
    }
    case "Stop": {
      const parsed = StopPayloadSchema.safeParse(payload);
      if (parsed.success) {
        return {
          ...base,
          type: "turn_stop",
          lastAssistantMessage: parsed.data.last_assistant_message ?? null,
          stopHookActive: parsed.data.stop_hook_active ?? null,
          git
        };
      }
      break;
    }
  }

  diagnostics.push({
    line: evidence.line,
    message: `Could not normalize ${eventName ?? "unknown event"}`
  });
  return { ...base, type: "unknown", eventName };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
