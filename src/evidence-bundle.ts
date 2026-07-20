import { z } from "zod";
import type { GitSnapshot, NormalizedSession } from "./codex-session-adapter.ts";
import { SourceClassSchema, type SourceClass } from "./analysis-definitions.ts";
import { redactJson, redactText } from "./redaction.ts";
import { truncateHead, truncateHeadTail, utf8ByteLength } from "./truncation.ts";

export const BUNDLE_MAX_BYTES = 128 * 1024;
export const MESSAGE_MAX_BYTES = 2 * 1024;
export const TOOL_INPUT_MAX_BYTES = 1 * 1024;
export const TOOL_OUTPUT_HEAD_BYTES = 700;
export const TOOL_OUTPUT_TAIL_BYTES = 300;
export const GIT_STATUS_MAX_BYTES = 2 * 1024;
export const GIT_DIFF_HEAD_BYTES = 3 * 1024;
export const GIT_DIFF_TAIL_BYTES = 1 * 1024;

const ErrorIndicatorSchema = z
  .object({
    field: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()])
  })
  .strict();

const StructuralFactsSchema = z
  .object({
    sequence: z.number().int().positive(),
    toolUseId: z.string().nullable().optional(),
    matchedEvidenceId: z.string().optional(),
    errorIndicators: z.array(ErrorIndicatorSchema).optional(),
    promptOrdinal: z.number().int().positive().optional(),
    assistantMessageOrdinal: z.number().int().positive().optional()
  })
  .strict();

const EvidenceItemSchema = z
  .object({
    id: z.string().regex(/^E[1-9]\d*(?:\.git)?$/),
    sourceClass: SourceClassSchema,
    timestamp: z.string().min(1),
    turnId: z.string().nullable(),
    content: z.unknown(),
    structuralFacts: StructuralFactsSchema
  })
  .strict();

export const EvidenceBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    session: z
      .object({
        sessionId: z.string().nullable(),
        firstObservedAt: z.string().nullable(),
        lastObservedAt: z.string().nullable(),
        cwd: z.string().nullable(),
        model: z.string().nullable()
      })
      .strict(),
    evidence: z.array(EvidenceItemSchema),
    diagnostics: z.array(z.string())
  })
  .strict()
  .superRefine((bundle, context) => {
    const seenIds = new Set<string>();
    bundle.evidence.forEach((item, index) => {
      if (seenIds.has(item.id)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "id"],
          message: `Duplicate evidence id ${item.id}`
        });
      }
      seenIds.add(item.id);
      if (item.structuralFacts.sequence !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "structuralFacts", "sequence"],
          message: "Evidence sequence must match ordered bundle position"
        });
      }
    });
  });

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export function buildEvidenceBundle(session: NormalizedSession): EvidenceBundle {
  const evidence: EvidenceItem[] = [];
  const attemptsByToolUseId = new Map<string, string>();
  let promptOrdinal = 0;
  let assistantMessageOrdinal = 0;

  const append = (
    item: Omit<EvidenceItem, "structuralFacts"> & {
      structuralFacts?: Omit<EvidenceItem["structuralFacts"], "sequence">;
    }
  ): void => {
    evidence.push({
      ...item,
      structuralFacts: { sequence: evidence.length + 1, ...item.structuralFacts }
    });
  };

  for (const event of session.events) {
    const id = `E${event.evidence.line}`;
    const common = {
      timestamp: event.evidence.capturedAt,
      turnId: event.turnId
    };

    switch (event.type) {
      case "session_start":
        append({
          id,
          sourceClass: "session_event",
          ...common,
          content: { event: "session_start", source: redactNullable(event.source) }
        });
        if (event.git !== null) {
          appendGit(append, `${id}.git`, common, event.git);
        }
        break;
      case "user_prompt":
        promptOrdinal += 1;
        append({
          id,
          sourceClass: "human_message",
          ...common,
          content: truncateHead(redactText(event.prompt), MESSAGE_MAX_BYTES),
          structuralFacts: { promptOrdinal }
        });
        break;
      case "tool_attempt":
        append({
          id,
          sourceClass: "tool_attempt",
          ...common,
          content: {
            toolName: redactNullable(event.toolName),
            input: truncateHead(redactJson(event.input), TOOL_INPUT_MAX_BYTES)
          },
          structuralFacts: { toolUseId: redactNullable(event.toolUseId) }
        });
        if (event.toolUseId !== null) {
          attemptsByToolUseId.set(event.toolUseId, id);
        }
        break;
      case "tool_result": {
        const matchedEvidenceId =
          event.toolUseId === null ? undefined : attemptsByToolUseId.get(event.toolUseId);
        append({
          id,
          sourceClass: "tool_result",
          ...common,
          content: {
            toolName: redactNullable(event.toolName),
            input: truncateHead(redactJson(event.input), TOOL_INPUT_MAX_BYTES),
            output: truncateHeadTail(
              redactJson(event.response),
              TOOL_OUTPUT_HEAD_BYTES,
              TOOL_OUTPUT_TAIL_BYTES
            )
          },
          structuralFacts: {
            toolUseId: redactNullable(event.toolUseId),
            ...(matchedEvidenceId ? { matchedEvidenceId } : {}),
            errorIndicators: structuredErrorIndicators(event.response)
          }
        });
        break;
      }
      case "turn_stop":
        assistantMessageOrdinal += 1;
        append({
          id,
          sourceClass: "assistant_message",
          ...common,
          content:
            event.lastAssistantMessage === null
              ? null
              : truncateHead(
                  redactText(event.lastAssistantMessage),
                  MESSAGE_MAX_BYTES
                ),
          structuralFacts: { assistantMessageOrdinal }
        });
        if (event.git !== null) {
          appendGit(append, `${id}.git`, common, event.git);
        }
        break;
      case "unknown":
        break;
    }
  }

  const diagnostics = session.diagnostics.map((diagnostic) =>
    truncateHead(
      redactText(`Line ${diagnostic.line}: ${diagnostic.message}`),
      MESSAGE_MAX_BYTES
    )
  );
  const bundle: EvidenceBundle = {
    schemaVersion: 1,
    session: {
      sessionId: truncateNullable(session.sessionId, 512),
      firstObservedAt: truncateNullable(session.firstObservedAt, 256),
      lastObservedAt: truncateNullable(session.lastObservedAt, 256),
      cwd: truncateNullable(session.cwd, MESSAGE_MAX_BYTES),
      model: truncateNullable(session.model, MESSAGE_MAX_BYTES)
    },
    evidence,
    diagnostics
  };

  enforceBundleCeiling(bundle);
  return EvidenceBundleSchema.parse(bundle);
}

function appendGit(
  append: (
    item: Omit<EvidenceItem, "structuralFacts"> & {
      structuralFacts?: Omit<EvidenceItem["structuralFacts"], "sequence">;
    }
  ) => void,
  id: string,
  common: { timestamp: string; turnId: string | null },
  git: GitSnapshot
): void {
  append({
    id,
    sourceClass: "git_snapshot",
    ...common,
    content: {
      head: redactNullable(git.head),
      branch: redactNullable(git.branch),
      status:
        git.status === null
          ? null
          : truncateHead(redactText(git.status), GIT_STATUS_MAX_BYTES),
      diff:
        git.diff === null
          ? null
          : truncateHeadTail(
              redactText(git.diff),
              GIT_DIFF_HEAD_BYTES,
              GIT_DIFF_TAIL_BYTES
            ),
      errors: git.errors.map(redactText)
    }
  });
}

function structuredErrorIndicators(
  response: unknown
): Array<{ field: string; value: string | number | boolean }> {
  if (!isRecord(response)) {
    return [];
  }

  const indicators: Array<{ field: string; value: string | number | boolean }> = [];
  if (response.success === false) {
    indicators.push({ field: "success", value: false });
  }
  if (response.isError === true) {
    indicators.push({ field: "isError", value: true });
  }
  if (response.is_error === true) {
    indicators.push({ field: "is_error", value: true });
  }
  for (const field of ["exitCode", "exit_code"] as const) {
    const value = response[field];
    if (typeof value === "number" && value !== 0) {
      indicators.push({ field, value });
    }
  }
  if (typeof response.error === "string" && response.error.trim() !== "") {
    indicators.push({ field: "error", value: truncateHead(redactText(response.error), 256) });
  }
  return indicators;
}

function enforceBundleCeiling(bundle: EvidenceBundle): void {
  let omittedEvidence = 0;
  let omittedDiagnostics = 0;
  const prefix = "Bundle size ceiling reached; omitted ";
  const updateDiagnostic = (): void => {
    bundle.diagnostics = bundle.diagnostics.filter(
      (diagnostic) => !diagnostic.startsWith(prefix)
    );
    bundle.diagnostics.push(
      `${prefix}${omittedEvidence} trailing evidence item(s) and ${omittedDiagnostics} adapter diagnostic(s).`
    );
  };

  while (serializedBytes(bundle) > BUNDLE_MAX_BYTES) {
    if (bundle.evidence.length > 0) {
      bundle.evidence.pop();
      omittedEvidence += 1;
    } else {
      let diagnosticIndex = bundle.diagnostics.length - 1;
      while (
        diagnosticIndex >= 0 &&
        bundle.diagnostics[diagnosticIndex]?.startsWith(prefix)
      ) {
        diagnosticIndex -= 1;
      }
      if (diagnosticIndex < 0) {
        throw new Error("Bundle metadata exceeds the size ceiling");
      }
      bundle.diagnostics.splice(diagnosticIndex, 1);
      omittedDiagnostics += 1;
    }
    updateDiagnostic();
  }
}

function serializedBytes(bundle: EvidenceBundle): number {
  return utf8ByteLength(`${JSON.stringify(bundle, null, 2)}\n`);
}

function redactNullable(value: string | null): string | null {
  return value === null ? null : redactText(value);
}

function truncateNullable(value: string | null, maximumBytes: number): string | null {
  return value === null
    ? null
    : truncateHead(redactText(value), maximumBytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
