import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCodexSessionFile } from "../src/codex-session-adapter.ts";
import {
  persistAnalysisRun,
  serializeJson,
  type AnalysisRunArtifacts
} from "../src/analysis-run-store.ts";
import { buildEvidenceBundle, type EvidenceBundle } from "../src/evidence-bundle.ts";
import { resolveSessionFile } from "./report-session.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export function generateDryRun(
  projectRoot: string,
  selector: string = "latest"
): { bundle: EvidenceBundle; serializedBundle: string; artifacts: AnalysisRunArtifacts } {
  const canonicalRoot = realpathSync(projectRoot);
  const sessionFile = resolveSessionFile(canonicalRoot, selector);
  if (!existsSync(sessionFile)) {
    throw new Error(`No recording found for ${selector} at ${sessionFile}`);
  }
  const session = readCodexSessionFile(sessionFile);
  if (session.events.length === 0) {
    throw new Error(`No valid hook events found in ${session.sourcePath}`);
  }

  const bundle = buildEvidenceBundle(session);
  const serializedBundle = serializeJson(bundle);
  const artifacts = persistAnalysisRun(canonicalRoot, bundle);
  return { bundle, serializedBundle, artifacts };
}

function parseArguments(args: string[]): { selector: string } {
  const dryRunArguments = args.filter((argument) => argument === "--dry-run");
  const selectors = args.filter((argument) => argument !== "--dry-run");
  if (dryRunArguments.length !== 1 || selectors.length > 1) {
    throw new Error("Usage: npm run analyze -- --dry-run [latest|session-id]");
  }
  return { selector: selectors[0] ?? "latest" };
}

function main(): void {
  try {
    const { selector } = parseArguments(process.argv.slice(2));
    const result = generateDryRun(PROJECT_ROOT, selector);
    process.stdout.write(result.serializedBundle);
    process.stderr.write(
      `Bundle saved to ${relative(process.cwd(), result.artifacts.bundlePath) || result.artifacts.bundlePath}\n`
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  main();
}
