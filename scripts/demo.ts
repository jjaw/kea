import { execFile } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runReferenceDemo,
  type ReferenceDemoProgress
} from "../src/reference-demo.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const FIXTURE_DIRECTORY = join(
  PROJECT_ROOT,
  "fixtures",
  "demo",
  "reference-session"
);

type Output = Pick<NodeJS.WriteStream, "write">;
type BrowserLauncher = (
  command: string,
  args: readonly string[]
) => Promise<void>;

export async function runDemoCommand(options: {
  projectRoot?: string;
  fixtureDirectory?: string;
  args?: string[];
  stdout?: Output;
  stderr?: Output;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  interactive?: boolean;
  launchBrowser?: BrowserLauncher;
  commandAvailable?: (
    command: string,
    environment: NodeJS.ProcessEnv
  ) => boolean;
} = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  try {
    const { noOpen } = parseArguments(options.args ?? []);
    const displayRoot = realpathSync(projectRoot);
    stdout.write("Kea reference demo\n\n");
    const result = await runReferenceDemo({
      projectRoot,
      fixtureDirectory: options.fixtureDirectory ?? FIXTURE_DIRECTORY,
      onProgress: (progress) => writeProgress(stdout, progress)
    });
    const reportPath = displayPath(displayRoot, result.reportPath);
    const indexPath = displayPath(displayRoot, result.indexPath);
    stdout.write("\n");
    stdout.write("No credentials were used.\n");
    stdout.write("No network request was made.\n");
    stdout.write(`Leadership report: ${reportPath}\n`);
    stdout.write(`Report inbox: ${indexPath}\n`);
    const platform = options.platform ?? process.platform;
    writeManualOpenCommand(stdout, platform, indexPath);

    const environment = options.environment ?? process.env;
    const interactive =
      options.interactive ??
      (stdout === process.stdout &&
        process.stdin.isTTY === true &&
        process.stdout.isTTY === true);
    const command = browserCommand(
      platform,
      environment,
      options.commandAvailable ?? executableIsAvailable
    );
    if (!noOpen && interactive && !isCi(environment) && command !== null) {
      try {
        await (options.launchBrowser ?? launchBrowser)(command, [
          result.indexPath
        ]);
      } catch (error) {
        stderr.write(
          `Warning: could not open the report inbox automatically: ${errorMessage(error)}\n`
        );
      }
    }
    return 0;
  } catch (error) {
    stderr.write(
      `Kea reference demo failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
}

function writeProgress(output: Output, progress: ReferenceDemoProgress): void {
  switch (progress.stage) {
    case "fixture_loaded":
      output.write(
        `✓ Loaded the approved ${progress.recordCount}-record Codex session\n`
      );
      return;
    case "evidence_prepared":
      output.write(
        `✓ Prepared ${progress.evidenceCount} sanitized evidence items (${progress.serializedCorpusBytes.toLocaleString("en-US")} bytes)\n`
      );
      return;
    case "reference_analysis_completed":
      output.write("✓ Ran deterministic reference analysis\n");
      return;
    case "validation_completed":
      output.write("✓ Applied validation safeguards\n");
      output.write(
        `  ${progress.rejectedCount} rejected · ${progress.downgradedCount} downgraded · ${progress.amendedCount} amended\n`
      );
      return;
    case "report_generated":
      output.write("✓ Generated the leadership report\n");
      return;
    case "inbox_updated":
      output.write("✓ Updated the report inbox\n");
  }
}

function parseArguments(args: string[]): { noOpen: boolean } {
  if (args.length === 0) return { noOpen: false };
  if (args.length === 1 && args[0] === "--no-open") {
    return { noOpen: true };
  }
  throw new Error("Usage: npm run demo -- [--no-open]");
}

function browserCommand(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  commandAvailable: (
    command: string,
    environment: NodeJS.ProcessEnv
  ) => boolean
): "open" | "xdg-open" | null {
  if (platform === "darwin") return "open";
  if (
    platform === "linux" &&
    linuxDesktopIsAvailable(environment) &&
    commandAvailable("xdg-open", environment)
  ) {
    return "xdg-open";
  }
  return null;
}

function linuxDesktopIsAvailable(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(
    environment.DISPLAY?.trim() || environment.WAYLAND_DISPLAY?.trim()
  );
}

function writeManualOpenCommand(
  output: Output,
  platform: NodeJS.Platform,
  indexPath: string
): void {
  if (platform === "darwin") {
    output.write(`Open inbox: open ${JSON.stringify(indexPath)}\n`);
    return;
  }
  if (platform === "linux") {
    output.write(`Open inbox: xdg-open ${JSON.stringify(indexPath)}\n`);
    return;
  }
  output.write(`Open inbox manually in a browser: ${indexPath}\n`);
}

function executableIsAvailable(
  command: string,
  environment: NodeJS.ProcessEnv
): boolean {
  const path = environment.PATH;
  if (!path) return false;
  return path.split(delimiter).some((directory) => {
    if (directory === "") return false;
    try {
      accessSync(join(directory, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function isCi(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.CI?.trim().toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}

function launchBrowser(
  command: string,
  args: readonly string[]
): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    execFile(command, [...args], { windowsHide: true }, (error) => {
      if (error) rejectLaunch(error);
      else resolveLaunch();
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function displayPath(projectRoot: string, path: string): string {
  return relative(projectRoot, path).replaceAll("\\", "/");
}

async function main(): Promise<void> {
  process.exitCode = await runDemoCommand({ args: process.argv.slice(2) });
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  void main();
}
