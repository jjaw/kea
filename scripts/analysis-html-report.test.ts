import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisSchema,
  OUTCOME_SUPPORT_VALUES,
  type Analysis
} from "../src/analysis-definitions.ts";
import { renderAnalysisHtmlReport } from "../src/analysis-html-report.ts";
import { ValidationSummarySchema } from "../src/analysis-validator.ts";
import { EvidenceBundleSchema } from "../src/evidence-bundle.ts";

const RUN_ID = "run-html-test";

test("leadership HTML escapes findings, sanitized evidence, audit text, and unresolved IDs", () => {
  const bundle = evidenceBundle('<img src=x onerror="alert(1)">& sanitized');
  bundle.session.sessionId = '<section onclick="session()">';
  const analysis = analysisFixture();
  analysis.objective.value = '<script>alert("objective")</script>';
  analysis.objective.evidenceIds.push('<svg onload="alert(2)">');
  analysis.leadershipInsights[0]!.confidenceReason =
    'Because </style><script>alert("reason")</script>';
  const summary = validationSummary();
  summary.validatedAt = '<time onmouseover="audit()">';
  summary.actions[0]!.target = '<img src=x onerror="audit()">';
  summary.actions[0]!.reason = "Rejected <script>audit()</script> & corrected";

  const html = renderAnalysisHtmlReport(bundle, analysis, summary, RUN_ID);

  assert.match(html, /&lt;script&gt;alert\(&quot;objective&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp; sanitized/);
  assert.match(html, /&lt;img src=x onerror=&quot;audit\(\)&quot;&gt;/);
  assert.match(html, /Rejected &lt;script&gt;audit\(\)&lt;\/script&gt; &amp; corrected/);
  assert.match(html, /&lt;svg onload=&quot;alert\(2\)&quot;&gt;/);
  assert.match(html, /&lt;section onclick=&quot;session\(\)&quot;&gt;/);
  assert.match(html, /&lt;time onmouseover=&quot;audit\(\)&quot;&gt;/);
  assert.match(html, /Evidence unavailable in supplied sanitized bundle/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+=/i);
});

test("executive brief renders hierarchy, bases, confidence, unknowns, and separate outcomes", () => {
  const html = renderAnalysisHtmlReport(
    evidenceBundle("captured output"),
    analysisFixture(),
    validationSummary(),
    RUN_ID
  );

  for (const basis of ["observed", "explicit", "inference", "unknown"]) {
    assert.match(html, new RegExp(`class="badge">${basis}<`));
  }
  assert.match(html, /Kea for Codex — validated session brief/);
  assert.match(html, /Evidence for Codex-assisted development/);
  assert.match(html, /Validated session brief/);
  assert.match(html, /Leadership summary/);
  assert.match(html, /Executive snapshot/);
  assert.match(html, /What was attempted\?/);
  assert.match(html, /Where human judgment mattered/);
  assert.match(html, /Remaining uncertainty/);
  assert.match(html, /Confidence:<\/strong> high — Result and claim conflict/);
  assert.doesNotMatch(html, /Confidence:<\/strong> explicit/);
  assert.match(html, /Unknown — the supplied evidence was insufficient/);
  assert.match(html, /Outcome comparison/);
  assert.match(html, /class="outcome-column reported"/);
  assert.match(html, /class="outcome-column supported"/);
  assert.match(html, /What Codex reported/);
  assert.match(html, /What captured evidence independently supports/);
  assert.match(html, /The assistant reported success/);
  assert.match(html, /The captured result failed/);
  assert.match(html, /Approaches and statuses/);
  assert.match(html, /How the work unfolded/);
  assert.match(html, /Human interventions/);
  assert.match(html, /Codex contributions/);
  assert.match(html, /Leadership takeaways/);
  assert.match(html, /What still needs verification/);
  assert.doesNotMatch(html, /The session succeeded|successful session/i);
});

test("all outcome-support values use fixed, non-synthesized explanations", () => {
  const expected = {
    reported_only:
      "A reported outcome is present, but independent support was not established.",
    independently_supported:
      "Captured result-bearing evidence supports the validated outcome finding.",
    contradicted: "Captured evidence conflicts with the reported outcome.",
    unknown:
      "The relationship cannot be established from the supplied evidence."
  } as const;
  const labels = {
    reported_only: "Reported, not independently verified",
    independently_supported: "Independently supported",
    contradicted: "Contradicted by captured evidence",
    unknown: "Support relationship unknown"
  } as const;

  for (const value of OUTCOME_SUPPORT_VALUES) {
    const analysis = analysisFixture();
    analysis.outcomeSupport = value;
    const html = renderAnalysisHtmlReport(
      evidenceBundle("output"),
      analysis,
      validationSummary(),
      RUN_ID
    );
    assert.match(html, new RegExp(expected[value].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(labels[value]));
  }
});

test("progressive disclosures preserve all evidence and turning-point structure", () => {
  const html = renderAnalysisHtmlReport(
    evidenceBundle("structured result"),
    analysisFixture(),
    validationSummary(),
    RUN_ID
  );

  assert.match(html, /<strong>E3<\/strong>/);
  assert.match(html, /tool_result · 2026-07-20T20:02:00.000Z/);
  assert.match(html, /structured result/);
  assert.match(html, /<details><summary>Evidence \(1\)<\/summary>/);
  assert.match(html, /<ol class="timeline">/);
  assert.match(html, /Before evidence \(1\)/);
  assert.match(html, /After evidence \(1\)/);
  assert.match(html, /Canonical citations \(2\)/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/);
});

test("validation corrections remain complete and visually secondary", () => {
  const html = renderAnalysisHtmlReport(
    evidenceBundle("output"),
    analysisFixture(),
    validationSummary(),
    RUN_ID
  );

  assert.match(html, /class="trust-section audit"/);
  assert.match(html, /<summary>Validation audit — 1 rejected · 1 downgraded · 1 amended<\/summary>/);
  assert.match(html, /<span class="badge audit-badge">rejected<\/span>/);
  assert.match(html, /<span class="badge audit-badge">downgraded<\/span>/);
  assert.match(html, /<span class="badge audit-badge">amended<\/span>/);
  assert.match(html, /approaches\[1\]/);
  assert.match(html, /Basis adjusted/);
  assert.match(html, /turning_point_citations_completed/);
  assert.match(html, /Relevant evidence \(1\)/);
  assert.match(html, /<summary>Session and run metadata<\/summary>/);
  assert.match(html, /<dt>Session<\/dt><dd>session-html<\/dd>/);
  assert.match(html, /<dt>Run<\/dt><dd>run-html-test<\/dd>/);
  assert.match(html, /<dt>Evidence items<\/dt><dd>4<\/dd>/);
  assert.doesNotMatch(html, /candidate-analysis|provider-response|raw provider/i);
});

test("report is self-contained and readable without JavaScript", () => {
  const html = renderAnalysisHtmlReport(
    evidenceBundle("output"),
    analysisFixture(),
    validationSummary(),
    RUN_ID
  );

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<style>/);
  assert.match(html, /<details>/);
  assert.match(html, /<summary>/);
  assert.match(html, /@media \(max-width:700px\)/);
  assert.doesNotMatch(
    html,
    /<script\b|<link\b|@import|https?:\/\/|<img\b|\burl\s*\(/i
  );
});

function evidenceBundle(content: string) {
  return EvidenceBundleSchema.parse({
    schemaVersion: 1,
    session: {
      sessionId: "session-html",
      firstObservedAt: "2026-07-20T20:00:00.000Z",
      lastObservedAt: "2026-07-20T20:03:00.000Z",
      cwd: "/sanitized/workspace",
      model: "test-model"
    },
    evidence: [
      item("E1", "human_message", "Please fix it", 1),
      item("E2", "tool_attempt", { input: "run" }, 2),
      item("E3", "tool_result", content, 3),
      item("E4", "assistant_message", "The assistant reported success", 4)
    ],
    diagnostics: []
  });
}

function item(
  id: string,
  sourceClass:
    | "human_message"
    | "tool_attempt"
    | "tool_result"
    | "assistant_message",
  content: unknown,
  sequence: number
) {
  return {
    id,
    sourceClass,
    timestamp: `2026-07-20T20:0${sequence - 1}:00.000Z`,
    turnId: sequence < 4 ? "turn-1" : "turn-2",
    content,
    structuralFacts: { sequence }
  };
}

function analysisFixture(): Analysis {
  return AnalysisSchema.parse({
    objective: { value: "Fix the parser", basis: "explicit", evidenceIds: ["E1"] },
    approaches: [
      { value: "Run the parser", basis: "observed", evidenceIds: ["E2", "E3"], status: "completed" }
    ],
    humanInterventions: [
      { value: "Requested a correction", basis: "explicit", evidenceIds: ["E1"], category: "correction", justification: "The human redirected the work." }
    ],
    turningPoints: [
      { value: "The result changed the direction", basis: "inference", evidenceIds: ["E1", "E3"], beforeEvidenceIds: ["E1"], afterEvidenceIds: ["E3"], confidence: "medium", confidenceReason: "The evidence is ordered." }
    ],
    codexContributions: [
      { value: "Ran the tool", basis: "observed", evidenceIds: ["E2"] }
    ],
    reportedOutcome: { value: "The assistant reported success", basis: "explicit", evidenceIds: ["E4"] },
    independentlySupportedOutcome: { value: "The captured result failed", basis: "observed", evidenceIds: ["E3"] },
    outcomeSupport: "contradicted",
    evidenceGaps: [
      { value: null, basis: "unknown", evidenceIds: [] }
    ],
    leadershipInsights: [
      { value: "The claim conflicts with captured activity", basis: "inference", evidenceIds: ["E3", "E4"], confidence: "high", confidenceReason: "Result and claim conflict" }
    ]
  });
}

function validationSummary() {
  return ValidationSummarySchema.parse({
    schemaVersion: 1,
    runId: RUN_ID,
    validatedAt: "2026-07-20T20:04:00.000Z",
    rejectedCount: 1,
    downgradedCount: 1,
    amendedCount: 1,
    actions: [
      { action: "rejected", target: "approaches[1]", reason: "Invalid citation", evidenceIds: ["E3"] },
      { action: "downgraded", target: "objective", reason: "Basis adjusted", evidenceIds: ["E1"] },
      { action: "amended", code: "turning_point_citations_completed", target: "turningPoints[0].evidenceIds", reason: "Canonical citations completed", evidenceIds: ["E3"] }
    ]
  });
}
