import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AnalysisSchema } from "../src/analysis-definitions.ts";
import { readCodexSessionFile } from "../src/codex-session-adapter.ts";
import {
  buildEvidenceBundle,
  measureEvidenceCorpus
} from "../src/evidence-bundle.ts";
import { redactText } from "../src/redaction.ts";
import { runReferenceDemo } from "../src/reference-demo.ts";
import { FinalSessionDispositionSchema } from "../src/session-disposition.ts";
import { runDemoCommand } from "./demo.ts";

const FIXTURE_DIRECTORY = join(
  process.cwd(),
  "fixtures",
  "demo",
  "reference-session"
);
const FIXTURE_PATH = join(FIXTURE_DIRECTORY, "events.jsonl");
const FIXTURE_SHA256 =
  "5119f23824586f63a03e2a56e18bac5e7e882031f3c8ad5c875db07a25f79de9";
const EXPECTED_EVIDENCE_IDS = [
  "E2",
  "E37",
  "E38",
  "E42",
  "E44",
  "E46",
  "E50",
  "E52",
  "E54",
  "E56",
  "E58",
  "E60",
  "E64",
  "E82",
  "E88",
  "E91",
  "E92",
  "E94",
  "E98",
  "E99",
  "E100",
  "E101",
  "E101.git"
];

test("approved reference fixture preserves complete sanitized evidence and review provenance", () => {
  const recording = readFileSync(FIXTURE_PATH, "utf8");
  const lines = recording.trimEnd().split("\n");
  assert.equal(lines.length, 101);
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  assert.equal(sha256(FIXTURE_PATH), FIXTURE_SHA256);

  const session = readCodexSessionFile(FIXTURE_PATH);
  assert.equal(session.events.length, 101);
  assert.equal(session.diagnostics.length, 0);
  const bundle = buildEvidenceBundle(session);
  const corpus = measureEvidenceCorpus(bundle);
  assert.equal(bundle.evidence.length, 105);
  assert.equal(corpus.totalEvidenceCount, 105);
  assert.equal(corpus.retainedEvidenceCount, 105);
  assert.equal(corpus.omittedEvidenceCount, 0);
  assert.equal(corpus.serializedCorpusBytes, 111_102);
  assert.equal(corpus.requestBudgetBytes, 524_288);
  assert.equal(corpus.eligibleForSingleRequest, true);

  const evidenceById = new Map(bundle.evidence.map((item) => [item.id, item]));
  for (const evidenceId of EXPECTED_EVIDENCE_IDS) {
    assert.ok(evidenceById.has(evidenceId), `Missing evidence ${evidenceId}`);
  }
  const attempts = bundle.evidence.filter(
    (item) => item.sourceClass === "tool_attempt"
  );
  const results = bundle.evidence.filter(
    (item) => item.sourceClass === "tool_result"
  );
  assert.equal(attempts.length, 47);
  assert.equal(results.length, 47);
  assert.equal(
    results.filter((item) => item.structuralFacts.matchedEvidenceId).length,
    47
  );

  assert.doesNotMatch(
    recording,
    /\/Users\/|\/home\/|\/private\/var\/folders\/|\/var\/folders\/|workspace\/personal/i
  );
  assert.doesNotMatch(
    recording,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
  );
  for (const value of allStrings(lines.map((line) => JSON.parse(line)))) {
    assert.equal(redactText(value), value);
  }

  const provenance = readFileSync(
    join(FIXTURE_DIRECTORY, "PROVENANCE.md"),
    "utf8"
  );
  assert.match(provenance, /Manual review: complete/);
  assert.match(provenance, /Reviewer: project owner/);
  assert.match(provenance, /Manual-review date: July 20, 2026 PDT/);
  assert.match(provenance, /Source serialized evidence-corpus size/);
  assert.doesNotMatch(provenance, /Manual review: pending|Reviewer: pending/);
});

test("reference demo ignores credentials and unreadable real observer while running the real pipeline", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-reference-project-"));
  const realObserver = join(projectRoot, ".codex-observer");
  const malformedLatest = join(realObserver, "latest", "events.jsonl");
  const sentinel = join(realObserver, "sentinel.txt");
  mkdirSync(join(realObserver, "latest"), { recursive: true });
  writeFileSync(malformedLatest, "malformed real recording\n", "utf8");
  writeFileSync(sentinel, "real observer sentinel\n", "utf8");
  const observerHashBefore = directoryFileHashes(realObserver);
  chmodSync(realObserver, 0o000);

  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Network access is forbidden in the reference demo");
  }) as typeof fetch;

  let first;
  let second;
  let firstAnalysis;
  try {
    delete process.env.OPENAI_API_KEY;
    first = await runReferenceDemo({
      projectRoot,
      fixtureDirectory: FIXTURE_DIRECTORY
    });
    firstAnalysis = AnalysisSchema.parse(
      JSON.parse(readFileSync(first.demo.artifacts.analysisPath ?? "", "utf8"))
    );
    writeFileSync(join(first.demo.outputRoot, "stale-output.txt"), "stale\n");

    process.env.OPENAI_API_KEY = "fake-key-that-must-be-ignored";
    second = await runReferenceDemo({
      projectRoot,
      fixtureDirectory: FIXTURE_DIRECTORY
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    chmodSync(realObserver, 0o700);
  }

  assert.equal(fetchCalls, 0);
  assert.equal(first.providerCallCount, 1);
  assert.equal(second.providerCallCount, 1);
  assert.equal(first.evidenceCount, 105);
  assert.equal(second.evidenceCount, 105);
  assert.equal(first.serializedCorpusBytes, 111_102);
  assert.equal(second.serializedCorpusBytes, 111_102);
  assert.deepEqual(first.validationAudit, second.validationAudit);
  assert.deepEqual(
    firstAnalysis,
    AnalysisSchema.parse(
      JSON.parse(readFileSync(second.demo.artifacts.analysisPath ?? "", "utf8"))
    )
  );
  assert.deepEqual(first.validationAudit, {
    rejectedCount: 1,
    downgradedCount: 1,
    amendedCount: 1,
    actions: [
      {
        action: "downgraded",
        target: "objective",
        reason:
          "Observed basis was not supported exclusively by activity or state evidence.",
        evidenceIds: ["E2", "E38", "E88"]
      },
      {
        action: "rejected",
        target: "approaches[1]",
        reason: "Finding cites nonexistent evidence: E999.",
        evidenceIds: ["E999"]
      },
      {
        action: "amended",
        code: "turning_point_citations_completed",
        target: "turningPoints[0]",
        reason: "Added temporal evidence missing from canonical citations: E42.",
        evidenceIds: ["E42"]
      }
    ]
  });

  assert.equal(existsSync(join(second.demo.outputRoot, "stale-output.txt")), false);
  assert.equal(
    readdirSync(join(second.demo.outputRoot, ".codex-observer", "analysis-runs"))
      .length,
    1
  );
  assert.equal(
    existsSync(join(second.demo.outputRoot, ".codex-observer", "latest")),
    false
  );
  assert.equal(sha256(FIXTURE_PATH), FIXTURE_SHA256);
  assert.equal(sha256(second.demo.stagedRecordingPath), FIXTURE_SHA256);
  assert.deepEqual(directoryFileHashes(realObserver), observerHashBefore);

  for (const path of [
    second.demo.artifacts.bundlePath,
    second.demo.artifacts.candidateAnalysisPath,
    second.demo.artifacts.analysisPath,
    second.demo.artifacts.validationSummaryPath,
    second.demo.artifacts.reportPath,
    second.demo.artifacts.htmlReportPath,
    second.demo.dispositionPath,
    second.demo.indexPath
  ]) {
    assert.ok(path && existsSync(path));
  }
  const disposition = FinalSessionDispositionSchema.parse(
    JSON.parse(readFileSync(second.demo.dispositionPath, "utf8"))
  );
  assert.equal(disposition.kind, "full_report");
  assert.equal(
    disposition.kind === "full_report"
      ? disposition.validatedRun.runId
      : undefined,
    second.demo.artifacts.runId
  );
  const index = readFileSync(second.demo.indexPath, "utf8");
  assert.match(
    index,
    new RegExp(
      `href="\\.\\.\/analysis-runs\/${second.demo.artifacts.runId}\/report\\.html"`
    )
  );
  assert.equal((index.match(/<article class="entry /g) ?? []).length, 1);
});

test("reference demo modules have no live-provider, credential, or network path", () => {
  for (const path of [
    join(process.cwd(), "src", "reference-demo.ts"),
    join(process.cwd(), "scripts", "demo.ts")
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /openai-analysis-provider|OpenAIAnalysisProvider/);
    assert.doesNotMatch(source, /OPENAI_API_KEY/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
  }
});

test("public demo command reports real progress, stable values, and credential-free generated paths", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-reference-command-"));
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  const originalApiKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    const exitCode = await runDemoCommand({
      projectRoot,
      fixtureDirectory: FIXTURE_DIRECTORY,
      args: ["--no-open"],
      stdout,
      stderr,
      platform: "darwin",
      interactive: true,
      launchBrowser: async () => {
        throw new Error("--no-open must suppress browser launching");
      }
    });
    assert.equal(exitCode, 0);
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }

  assert.equal(stderr.value(), "");
  assert.match(stdout.value(), /No credentials were used\./);
  assert.match(stdout.value(), /No network request was made\./);
  const outputLines = stdout.value().split("\n");
  let previousProgressIndex = -1;
  for (const line of [
    "Kea reference demo",
    "✓ Loaded the approved 101-record Codex session",
    "✓ Prepared 105 sanitized evidence items (111,102 bytes)",
    "✓ Ran deterministic reference analysis",
    "✓ Applied validation safeguards",
    "  1 rejected · 1 downgraded · 1 amended",
    "✓ Generated the leadership report",
    "✓ Updated the report inbox"
  ]) {
    const progressIndex = outputLines.indexOf(line);
    assert.ok(
      progressIndex > previousProgressIndex,
      `Missing or out-of-order output line: ${line}`
    );
    previousProgressIndex = progressIndex;
  }
  assert.match(
    stdout.value(),
    /Leadership report: \.kea-demo-output\/\.codex-observer\/analysis-runs\/[^/]+\/report\.html/
  );
  assert.match(
    stdout.value(),
    /Report inbox: \.kea-demo-output\/\.codex-observer\/reports\/index\.html/
  );
  assert.match(
    stdout.value(),
    /Open inbox: open "\.kea-demo-output\/\.codex-observer\/reports\/index\.html"/
  );
  assert.equal(stdout.value().includes(projectRoot), false);

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts.demo, "node scripts/demo.ts");
  assert.equal(sha256(FIXTURE_PATH), FIXTURE_SHA256);
});

test("interactive macOS demo opens the generated inbox with one separate path argument", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-reference-open-macos-"));
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  const launches: Array<{ command: string; args: readonly string[] }> = [];

  const exitCode = await runDemoCommand({
    projectRoot,
    fixtureDirectory: FIXTURE_DIRECTORY,
    stdout,
    stderr,
    platform: "darwin",
    interactive: true,
    environment: {},
    launchBrowser: async (command, args) => {
      launches.push({ command, args: [...args] });
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value(), "");
  assert.deepEqual(launches, [
    {
      command: "open",
      args: [
        join(
          realpathSync(projectRoot),
          ".kea-demo-output",
          ".codex-observer",
          "reports",
          "index.html"
        )
      ]
    }
  ]);
  assert.match(
    stdout.value(),
    /Open inbox: open "\.kea-demo-output\/\.codex-observer\/reports\/index\.html"/
  );
  assert.equal(sha256(FIXTURE_PATH), FIXTURE_SHA256);
});

test("--no-open always suppresses browser launching", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-reference-no-open-"));
  let launchCount = 0;
  const exitCode = await runDemoCommand({
    projectRoot,
    fixtureDirectory: FIXTURE_DIRECTORY,
    args: ["--no-open"],
    stdout: bufferOutput(),
    stderr: bufferOutput(),
    platform: "darwin",
    interactive: true,
    environment: {},
    launchBrowser: async () => {
      launchCount += 1;
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(launchCount, 0);
});

test("CI and noninteractive demo runs suppress browser launching", async (t) => {
  for (const testCase of [
    { name: "CI", interactive: true, environment: { CI: "true" } },
    { name: "noninteractive", interactive: false, environment: {} }
  ] as const) {
    await t.test(testCase.name, async () => {
      const projectRoot = mkdtempSync(
        join(tmpdir(), `kea-reference-${testCase.name}-`)
      );
      let launchCount = 0;
      const exitCode = await runDemoCommand({
        projectRoot,
        fixtureDirectory: FIXTURE_DIRECTORY,
        stdout: bufferOutput(),
        stderr: bufferOutput(),
        platform: "darwin",
        interactive: testCase.interactive,
        environment: testCase.environment,
        launchBrowser: async () => {
          launchCount += 1;
        }
      });

      assert.equal(exitCode, 0);
      assert.equal(launchCount, 0);
    });
  }
});

test("Linux opens only when xdg-open is available", async (t) => {
  for (const available of [true, false]) {
    await t.test(available ? "available" : "unavailable", async () => {
      const projectRoot = mkdtempSync(
        join(tmpdir(), `kea-reference-linux-${available}-`)
      );
      const launches: Array<{ command: string; args: readonly string[] }> = [];
      const exitCode = await runDemoCommand({
        projectRoot,
        fixtureDirectory: FIXTURE_DIRECTORY,
        stdout: bufferOutput(),
        stderr: bufferOutput(),
        platform: "linux",
        interactive: true,
        environment: { DISPLAY: ":0" },
        commandAvailable: (command) => {
          assert.equal(command, "xdg-open");
          return available;
        },
        launchBrowser: async (command, args) => {
          launches.push({ command, args: [...args] });
        }
      });

      assert.equal(exitCode, 0);
      assert.equal(launches.length, available ? 1 : 0);
      if (available) {
        assert.equal(launches[0]?.command, "xdg-open");
        assert.equal(launches[0]?.args.length, 1);
      }
    });
  }
});

test("unsupported platforms print the inbox path without launching or failing", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-reference-unsupported-"));
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  let launchCount = 0;
  const exitCode = await runDemoCommand({
    projectRoot,
    fixtureDirectory: FIXTURE_DIRECTORY,
    stdout,
    stderr,
    platform: "win32",
    interactive: true,
    environment: {},
    launchBrowser: async () => {
      launchCount += 1;
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(launchCount, 0);
  assert.equal(stderr.value(), "");
  assert.match(
    stdout.value(),
    /Open inbox manually in a browser: \.kea-demo-output\/\.codex-observer\/reports\/index\.html/
  );
});

test("browser launch failure warns without changing demo success", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "kea-reference-open-failure-"));
  const stdout = bufferOutput();
  const stderr = bufferOutput();
  const exitCode = await runDemoCommand({
    projectRoot,
    fixtureDirectory: FIXTURE_DIRECTORY,
    stdout,
    stderr,
    platform: "darwin",
    interactive: true,
    environment: {},
    launchBrowser: async () => {
      throw new Error("injected launch failure");
    }
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.value(), /✓ Updated the report inbox/);
  assert.equal(
    stderr.value(),
    "Warning: could not open the report inbox automatically: injected launch failure\n"
  );
});

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function directoryFileHashes(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const visit = (directory: string, relativeDirectory = ""): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, relativePath);
      else if (entry.isFile()) hashes[relativePath] = sha256(path);
    }
  };
  visit(root);
  return hashes;
}

function bufferOutput(): {
  write(value: string): boolean;
  value(): string;
} {
  let output = "";
  return {
    write: (value) => {
      output += value;
      return true;
    },
    value: () => output
  };
}
