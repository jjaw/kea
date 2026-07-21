import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve
} from "node:path";
import type { AnalysisProvider } from "./analysis-provider.ts";
import type { AnalysisRunArtifacts } from "./analysis-run-store.ts";
import {
  runAnalysisForRecording,
  type RecordingAnalysisResult
} from "./recording-analysis-run.ts";

const DEMO_OUTPUT_DIRECTORY = ".kea-demo-output";
const DEMO_SESSION_SELECTOR = "reference-session";
const TEMPORARY_TEST_OUTPUT_PREFIX = "kea-demo-output-test-";

export type DemoRunResult = {
  outputRoot: string;
  stagedRecordingPath: string;
  artifacts: AnalysisRunArtifacts;
  dispositionPath: string;
  indexPath: string;
  summary: {
    disposition: "full_report";
    rejectedCount: number;
    downgradedCount: number;
    amendedCount: number;
  };
};

export function resolveDemoOutputRoot(options: {
  projectRoot: string;
  fixtureRecordingPath: string;
  outputRoot?: string;
}): string {
  if (options.projectRoot.trim() === "") {
    throw new Error("Demo project root must not be empty");
  }
  if (options.fixtureRecordingPath.trim() === "") {
    throw new Error("Demo fixture recording path must not be empty");
  }
  if (options.outputRoot !== undefined && options.outputRoot.trim() === "") {
    throw new Error("Demo output root must not be empty");
  }
  if (
    options.outputRoot !== undefined &&
    !isAbsolute(options.outputRoot)
  ) {
    throw new Error("Demo output root must be an absolute, unambiguous path");
  }

  const projectRoot = realpathSync(options.projectRoot);
  const fixturePath = resolve(options.fixtureRecordingPath);
  const fixedOutputRoot = join(projectRoot, DEMO_OUTPUT_DIRECTORY);
  const resolvedOutputRoot = resolve(options.outputRoot ?? fixedOutputRoot);
  if (
    existsSync(resolvedOutputRoot) &&
    lstatSync(resolvedOutputRoot).isSymbolicLink()
  ) {
    throw new Error("Demo output root must not be a symbolic link");
  }
  const requestedOutputRoot = existsSync(resolvedOutputRoot)
    ? realpathSync(resolvedOutputRoot)
    : resolvedOutputRoot;
  const observerRoot = join(projectRoot, ".codex-observer");
  const committedFixtureRoot = join(
    projectRoot,
    "fixtures",
    "demo",
    DEMO_SESSION_SELECTOR
  );
  const filesystemRoot = parse(requestedOutputRoot).root;

  if (requestedOutputRoot === filesystemRoot) {
    throw new Error("Demo output root must not be the filesystem root");
  }
  if (requestedOutputRoot === projectRoot) {
    throw new Error("Demo output root must not be the repository root");
  }
  if (isSameOrInside(observerRoot, requestedOutputRoot)) {
    throw new Error("Demo output root must not be the real .codex-observer");
  }
  if (isSameOrInside(committedFixtureRoot, requestedOutputRoot)) {
    throw new Error(
      "Demo output root must not be the committed fixture directory"
    );
  }
  if (isSameOrInside(requestedOutputRoot, fixturePath)) {
    throw new Error("Demo fixture recording must not be inside the output root");
  }

  const isFixedOutputRoot = requestedOutputRoot === fixedOutputRoot;
  const isTemporaryTestRoot =
    options.outputRoot !== undefined &&
    isAcceptedTemporaryTestRoot(requestedOutputRoot);
  if (!isFixedOutputRoot && !isTemporaryTestRoot) {
    throw new Error(
      `Demo output root must be exactly ${fixedOutputRoot} or an explicitly created ${TEMPORARY_TEST_OUTPUT_PREFIX}* directory under os.tmpdir()`
    );
  }
  return requestedOutputRoot;
}

export async function runDemo(options: {
  projectRoot: string;
  fixtureRecordingPath: string;
  outputRoot?: string;
  provider: AnalysisProvider;
  now?: Date;
}): Promise<DemoRunResult> {
  if (!existsSync(options.fixtureRecordingPath)) {
    throw new Error(
      `Incomplete demo fixture: approved sanitized recording is missing at ${resolve(options.fixtureRecordingPath)}. Refusing to inspect real project recordings.`
    );
  }
  if (!statSync(options.fixtureRecordingPath).isFile()) {
    throw new Error(
      `Incomplete demo fixture: recording is not a file at ${resolve(options.fixtureRecordingPath)}`
    );
  }

  const fixtureRecordingPath = realpathSync(options.fixtureRecordingPath);
  const outputRoot = resolveDemoOutputRoot({
    projectRoot: options.projectRoot,
    fixtureRecordingPath,
    ...(options.outputRoot === undefined
      ? {}
      : { outputRoot: options.outputRoot })
  });

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const stagedRecordingPath = join(
    outputRoot,
    ".codex-observer",
    "sessions",
    DEMO_SESSION_SELECTOR,
    "events.jsonl"
  );
  mkdirSync(dirname(stagedRecordingPath), { recursive: true, mode: 0o700 });
  copyFileSync(
    fixtureRecordingPath,
    stagedRecordingPath,
    constants.COPYFILE_EXCL
  );

  const result: RecordingAnalysisResult = await runAnalysisForRecording({
    projectRoot: outputRoot,
    recordingPath: stagedRecordingPath,
    selector: DEMO_SESSION_SELECTOR,
    provider: options.provider,
    now: options.now
  });
  if (result.kind === "failure") {
    throw new Error(
      `Demo analysis failed (${result.failureKind}): ${result.message}. Artifacts were retained at ${result.artifacts.directory}`
    );
  }

  return {
    outputRoot,
    stagedRecordingPath,
    artifacts: result.artifacts,
    dispositionPath: result.dispositionPath,
    indexPath: result.indexPath,
    summary: {
      disposition: "full_report",
      ...result.summary
    }
  };
}

function isAcceptedTemporaryTestRoot(path: string): boolean {
  if (!existsSync(path) || !statSync(path).isDirectory()) return false;
  const canonicalPath = realpathSync(path);
  const canonicalTemporaryRoot = realpathSync(tmpdir());
  return (
    dirname(canonicalPath) === canonicalTemporaryRoot &&
    basename(canonicalPath).startsWith(TEMPORARY_TEST_OUTPUT_PREFIX)
  );
}

function isSameOrInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}
