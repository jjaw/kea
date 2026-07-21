import { realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runReferenceDemo } from "../src/reference-demo.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const FIXTURE_DIRECTORY = join(
  PROJECT_ROOT,
  "fixtures",
  "demo",
  "reference-session"
);

export async function runDemoCommand(options: {
  projectRoot?: string;
  fixtureDirectory?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
} = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  try {
    const displayRoot = realpathSync(projectRoot);
    const result = await runReferenceDemo({
      projectRoot,
      fixtureDirectory: options.fixtureDirectory ?? FIXTURE_DIRECTORY
    });
    const reportPath = displayPath(displayRoot, result.reportPath);
    const indexPath = displayPath(displayRoot, result.indexPath);
    stdout.write("Kea reference demo completed.\n");
    stdout.write("No credentials were used.\n");
    stdout.write("No network request was made.\n");
    stdout.write(
      `Sanitized evidence prepared for analysis: ${result.evidenceCount} items, ${result.serializedCorpusBytes.toLocaleString("en-US")} bytes\n`
    );
    stdout.write(
      `Validation safeguards applied: ${result.validationAudit.rejectedCount} rejected, ${result.validationAudit.downgradedCount} downgraded, ${result.validationAudit.amendedCount} amended\n`
    );
    stdout.write(`Leadership report: ${reportPath}\n`);
    stdout.write(`Report inbox: ${indexPath}\n`);
    stdout.write(`Open inbox: open ${JSON.stringify(indexPath)}\n`);
    return 0;
  } catch (error) {
    stderr.write(
      `Kea reference demo failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
}

function displayPath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll("\\", "/");
}

async function main(): Promise<void> {
  process.exitCode = await runDemoCommand();
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  void main();
}
