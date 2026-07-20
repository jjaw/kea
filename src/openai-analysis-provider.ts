import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  ANALYSIS_RESPONSE_FORMAT_NAME,
  DEFAULT_ANALYSIS_PROVIDER_CONFIG,
  type AnalysisProviderConfig
} from "./analysis-config.ts";
import {
  normalizeStructuredOutputAnalysis,
  StructuredOutputAnalysisSchema
} from "./analysis-definitions.ts";
import {
  serializeError,
  type AnalysisProvider,
  type AnalysisProviderResult,
  type ProviderRunMetadata
} from "./analysis-provider.ts";
import { buildAnalysisInput, buildAnalysisInstructions } from "./analysis-prompt.ts";
import type { EvidenceBundle } from "./evidence-bundle.ts";

type Clock = () => Date;
type RequestExecutor = (request: unknown) => Promise<unknown>;

export class OpenAIAnalysisProvider implements AnalysisProvider {
  readonly config: AnalysisProviderConfig;
  private readonly request: RequestExecutor;
  private readonly now: Clock;

  constructor(options: {
    apiKey?: string;
    config?: Partial<AnalysisProviderConfig>;
    request?: RequestExecutor;
    now?: Clock;
  } = {}) {
    this.config = { ...DEFAULT_ANALYSIS_PROVIDER_CONFIG, ...options.config };
    this.now = options.now ?? (() => new Date());

    if (options.request) {
      this.request = options.request;
    } else {
      const client = new OpenAI({ apiKey: options.apiKey });
      this.request = (request) =>
        client.responses.parse(
          request as Parameters<typeof client.responses.parse>[0]
        );
    }
  }

  async analyze(bundle: EvidenceBundle): Promise<AnalysisProviderResult> {
    const requestedAt = this.now().toISOString();
    const request = {
      model: this.config.model,
      reasoning: { effort: this.config.reasoningEffort },
      store: this.config.store,
      instructions: buildAnalysisInstructions(),
      input: buildAnalysisInput(bundle),
      text: {
        format: zodTextFormat(
          StructuredOutputAnalysisSchema,
          ANALYSIS_RESPONSE_FORMAT_NAME
        )
      }
    };

    let response: unknown;
    try {
      response = await this.request(request);
    } catch (error) {
      const metadata = this.metadata(requestedAt);
      return error instanceof z.ZodError
        ? { kind: "schema_invalid", error: serializeError(error), metadata }
        : { kind: "request_failed", error: serializeError(error), metadata };
    }

    const metadata = this.metadata(requestedAt, response);
    if (readString(response, "status") === "incomplete") {
      return {
        kind: "incomplete",
        reason: readNestedString(response, "incomplete_details", "reason"),
        rawResponse: response,
        metadata
      };
    }

    const refusal = findRefusal(response);
    if (refusal !== null) {
      return { kind: "refusal", refusal, rawResponse: response, metadata };
    }

    if (!isRecord(response) || response.output_parsed === null || response.output_parsed === undefined) {
      return {
        kind: "missing_parsed_output",
        message: "The provider response did not contain output_parsed.",
        rawResponse: response,
        metadata
      };
    }

    const wireCandidate = StructuredOutputAnalysisSchema.safeParse(
      response.output_parsed
    );
    if (!wireCandidate.success) {
      return {
        kind: "schema_invalid",
        error: serializeError(wireCandidate.error),
        rawResponse: response,
        metadata
      };
    }

    return {
      kind: "success",
      candidate: normalizeStructuredOutputAnalysis(wireCandidate.data),
      rawResponse: response,
      metadata
    };
  }

  private metadata(requestedAt: string, response?: unknown): ProviderRunMetadata {
    return {
      provider: "openai",
      model: this.config.model,
      reasoningEffort: this.config.reasoningEffort,
      store: this.config.store,
      requestedAt,
      completedAt: this.now().toISOString(),
      ...(readString(response, "id") ? { responseId: readString(response, "id") as string } : {}),
      ...(readString(response, "status")
        ? { responseStatus: readString(response, "status") as string }
        : {})
    };
  }
}

function findRefusal(response: unknown): string | null {
  if (!isRecord(response) || !Array.isArray(response.output)) {
    return null;
  }
  for (const output of response.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) {
      continue;
    }
    for (const content of output.content) {
      if (
        isRecord(content) &&
        content.type === "refusal" &&
        typeof content.refusal === "string"
      ) {
        return content.refusal;
      }
    }
  }
  return null;
}

function readString(value: unknown, field: string): string | null {
  return isRecord(value) && typeof value[field] === "string"
    ? value[field]
    : null;
}

function readNestedString(
  value: unknown,
  field: string,
  nestedField: string
): string | null {
  if (!isRecord(value) || !isRecord(value[field])) {
    return null;
  }
  const nested = value[field];
  return typeof nested[nestedField] === "string" ? nested[nestedField] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
