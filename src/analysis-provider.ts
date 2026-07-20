import type { EvidenceBundle } from "./evidence-bundle.ts";

export type ProviderRunMetadata = {
  provider: string;
  model: string;
  reasoningEffort: string;
  store: boolean;
  requestedAt: string;
  completedAt: string;
  responseId?: string;
  responseStatus?: string;
};

export type SerializableErrorDetails = {
  name: string;
  message: string;
  stack?: string;
  status?: number;
  code?: string;
  type?: string;
};

type ProviderResultBase = {
  metadata: ProviderRunMetadata;
  rawResponse?: unknown;
};

export type AnalysisProviderResult =
  | (ProviderResultBase & {
      kind: "success";
      candidate: unknown;
    })
  | (ProviderResultBase & {
      kind: "refusal";
      refusal: string;
    })
  | (ProviderResultBase & {
      kind: "incomplete";
      reason: string | null;
    })
  | (ProviderResultBase & {
      kind: "missing_parsed_output";
      message: string;
    })
  | (ProviderResultBase & {
      kind: "schema_invalid";
      error: SerializableErrorDetails;
    })
  | (ProviderResultBase & {
      kind: "request_failed";
      error: SerializableErrorDetails;
    });

export interface AnalysisProvider {
  analyze(bundle: EvidenceBundle): Promise<AnalysisProviderResult>;
}

export function serializeError(error: unknown): SerializableErrorDetails {
  if (error instanceof Error) {
    const extended = error as Error & {
      status?: unknown;
      code?: unknown;
      type?: unknown;
    };
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(typeof extended.status === "number" ? { status: extended.status } : {}),
      ...(typeof extended.code === "string" ? { code: extended.code } : {}),
      ...(typeof extended.type === "string" ? { type: extended.type } : {})
    };
  }

  return { name: "UnknownError", message: String(error) };
}
