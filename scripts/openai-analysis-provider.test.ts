import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROACH_STATUS_SEMANTICS,
  EVIDENCE_BASIS_SEMANTICS,
  OUTCOME_SUPPORT_SEMANTICS,
  SOURCE_CLASSES
} from "../src/analysis-definitions.ts";
import { buildAnalysisInstructions } from "../src/analysis-prompt.ts";
import { normalizeCodexSession } from "../src/codex-session-adapter.ts";
import { buildEvidenceBundle } from "../src/evidence-bundle.ts";
import { OpenAIAnalysisProvider } from "../src/openai-analysis-provider.ts";

test("analysis instructions are assembled from shared definitions and enforce epistemic boundaries", () => {
  const instructions = buildAnalysisInstructions();

  assert.match(instructions, new RegExp(escapeRegex(EVIDENCE_BASIS_SEMANTICS)));
  assert.match(instructions, new RegExp(escapeRegex(APPROACH_STATUS_SEMANTICS)));
  assert.match(instructions, new RegExp(escapeRegex(OUTCOME_SUPPORT_SEMANTICS)));
  for (const sourceClass of SOURCE_CLASSES) {
    assert.match(instructions, new RegExp(sourceClass));
  }
  assert.match(instructions, /cite only|Never cite/i);
  assert.match(instructions, /Use unknown findings/);
  assert.match(instructions, /reportedOutcome/);
  assert.match(instructions, /independentlySupportedOutcome/);
  assert.match(instructions, /hidden chain-of-thought/);
  assert.match(instructions, /Return only the requested structured analysis/);
});

test("OpenAI provider sends the exact Responses parse configuration", async () => {
  let capturedRequest: unknown;
  const provider = new OpenAIAnalysisProvider({
    request: async (request) => {
      capturedRequest = request;
      return {
        id: "resp_test",
        status: "completed",
        output: [],
        output_parsed: wireAnalysis()
      };
    },
    now: sequenceClock(
      "2026-07-20T01:00:00.000Z",
      "2026-07-20T01:00:01.000Z"
    )
  });

  const result = await provider.analyze(fixtureBundle());
  assert.equal(result.kind, "success");
  assert.ok(isRecord(capturedRequest));
  assert.deepEqual(Object.keys(capturedRequest).sort(), [
    "input",
    "instructions",
    "model",
    "reasoning",
    "store",
    "text"
  ]);
  assert.equal(capturedRequest.model, "gpt-5.6");
  assert.deepEqual(capturedRequest.reasoning, { effort: "medium" });
  assert.equal(capturedRequest.store, false);
  assert.equal(capturedRequest.instructions, buildAnalysisInstructions());
  assert.match(String(capturedRequest.input), /"id": "E1"/);
  assert.ok(isRecord(capturedRequest.text));
  assert.ok(isRecord(capturedRequest.text.format));
  assert.equal(capturedRequest.text.format.type, "json_schema");
  assert.equal(capturedRequest.text.format.name, "kea_session_analysis");
  assert.equal(capturedRequest.text.format.strict, true);
  assert.ok(isRecord(capturedRequest.text.format.schema));
  assert.equal(result.metadata.responseId, "resp_test");
  if (result.kind === "success" && isRecord(result.candidate)) {
    assert.equal("confidence" in (result.candidate.objective as object), false);
  }
});

test("OpenAI provider distinguishes refusal, incomplete, missing parsed output, schema invalidity, and request failure", async (t) => {
  const cases: Array<{
    name: string;
    response?: unknown;
    error?: Error;
    expected: string;
  }> = [
    {
      name: "refusal",
      response: {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "No." }] }
        ],
        output_parsed: null
      },
      expected: "refusal"
    },
    {
      name: "incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        output_parsed: null
      },
      expected: "incomplete"
    },
    {
      name: "missing parsed output",
      response: { status: "completed", output: [] },
      expected: "missing_parsed_output"
    },
    {
      name: "schema-invalid parsed output",
      response: { status: "completed", output: [], output_parsed: { nope: true } },
      expected: "schema_invalid"
    },
    {
      name: "API request failure",
      error: new Error("network unavailable"),
      expected: "request_failed"
    }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const provider = new OpenAIAnalysisProvider({
        request: async () => {
          if (testCase.error) {
            throw testCase.error;
          }
          return testCase.response;
        }
      });
      const result = await provider.analyze(fixtureBundle());
      assert.equal(result.kind, testCase.expected);
    });
  }
});

function wireAnalysis() {
  return {
    objective: {
      value: "Inspect evidence",
      basis: "explicit",
      evidenceIds: ["E1"],
      confidence: null,
      confidenceReason: null
    },
    approaches: [],
    humanInterventions: [],
    turningPoints: [],
    codexContributions: [],
    reportedOutcome: null,
    independentlySupportedOutcome: null,
    outcomeSupport: "unknown",
    evidenceGaps: [
      {
        value: "Outcome is unknown",
        basis: "unknown",
        evidenceIds: [],
        confidence: null,
        confidenceReason: null
      }
    ],
    leadershipInsights: []
  };
}

function fixtureBundle() {
  return buildEvidenceBundle(
    normalizeCodexSession(
      JSON.stringify({
        capture: {
          schemaVersion: 1,
          capturedAt: "2026-07-20T00:00:00.000Z",
          sessionId: "provider-session",
          eventName: "UserPromptSubmit"
        },
        payload: {
          hook_event_name: "UserPromptSubmit",
          session_id: "provider-session",
          prompt: "Inspect evidence"
        }
      }),
      "/recordings/provider.jsonl"
    )
  );
}

function sequenceClock(...timestamps: string[]): () => Date {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)] as string);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
