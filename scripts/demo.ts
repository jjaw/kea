import { dirname, join, resolve } from "node:path";
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
  try {
    const result = await runReferenceDemo({
      projectRoot: options.projectRoot ?? PROJECT_ROOT,
      fixtureDirectory: options.fixtureDirectory ?? FIXTURE_DIRECTORY
    });
    stdout.write("Kea reference demo completed.\n");
    stdout.write("No credentials were used.\n");
    stdout.write("No network request was made.\n");
    stdout.write(`Evidence items: ${result.evidenceCount}\n`);
    stdout.write(
      `Serialized evidence corpus: ${result.serializedCorpusBytes} bytes\n`
    );
    stdout.write(
      `Validation: ${result.validationAudit.rejectedCount} rejected, ${result.validationAudit.downgradedCount} downgraded, ${result.validationAudit.amendedCount} amended\n`
    );
    stdout.write(`Leadership report: ${result.reportPath}\n`);
    stdout.write(`Report inbox: ${result.indexPath}\n`);
    stdout.write(`Open inbox: open ${JSON.stringify(result.indexPath)}\n`);
    return 0;
  } catch (error) {
    stderr.write(
      `Kea reference demo failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runDemoCommand();
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  void main();
}
