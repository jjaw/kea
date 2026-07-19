import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readCodexSessionFile } from "../src/codex-session-adapter.ts";
import { analyzeSession, renderSessionReport } from "../src/session-report.ts";

const SessionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "Invalid session id");

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export function resolveSessionFile(
  projectRoot: string,
  selector: string = "latest"
): string {
  if (selector === "latest") {
    return join(projectRoot, ".codex-observer", "latest", "events.jsonl");
  }

  const sessionId = SessionIdSchema.parse(selector);
  return join(
    projectRoot,
    ".codex-observer",
    "sessions",
    sessionId,
    "events.jsonl"
  );
}

export function generateSessionReport(
  projectRoot: string,
  selector: string = "latest"
): { markdown: string; reportPath: string } {
  const canonicalRoot = realpathSync(projectRoot);
  const sessionFile = resolveSessionFile(canonicalRoot, selector);
  if (!existsSync(sessionFile)) {
    throw new Error(`No recording found for ${selector} at ${sessionFile}`);
  }

  const session = readCodexSessionFile(sessionFile);
  if (session.events.length === 0) {
    throw new Error(`No valid hook events found in ${session.sourcePath}`);
  }

  const fallbackSessionId = basename(dirname(session.sourcePath));
  const reportSessionId = SessionIdSchema.parse(session.sessionId ?? fallbackSessionId);
  const reportPath = join(
    canonicalRoot,
    ".codex-observer",
    "reports",
    `${reportSessionId}.md`
  );
  const markdown = renderSessionReport(session, analyzeSession(session), reportPath);

  writeReportAtomically(reportPath, markdown);
  return { markdown, reportPath };
}

function writeReportAtomically(reportPath: string, markdown: string): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    writeFileSync(temporaryPath, markdown, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, reportPath);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the original report and surface the write error below.
      }
    }
    throw error;
  }
}

function main(): void {
  try {
    const selectors = process.argv.slice(2);
    if (selectors.length > 1) {
      throw new Error("Usage: npm run report -- [latest|session-id]");
    }

    const result = generateSessionReport(PROJECT_ROOT, selectors[0] ?? "latest");
    const displayedPath = relative(process.cwd(), result.reportPath) || result.reportPath;
    process.stdout.write(`${result.markdown}\nReport saved to ${displayedPath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  main();
}
