import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readCodexSessionFile } from "../src/codex-session-adapter.ts";

export const DEFAULT_RECENT_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type DoctorCheck = {
  name: "node" | "hook" | "recording" | "api_key";
  ok: boolean;
  required: boolean;
  message: string;
};

export type DoctorResult = {
  ok: boolean;
  checks: DoctorCheck[];
};

const HooksFileSchema = z
  .object({
    hooks: z.record(
      z.string(),
      z.array(
        z
          .object({
            hooks: z.array(
              z
                .object({
                  type: z.literal("command"),
                  command: z.string().min(1)
                })
                .loose()
            )
          })
          .loose()
      )
    )
  })
  .loose();

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export function runDoctor(options: {
  projectRoot: string;
  launchDirectory?: string;
  now?: Date;
  nodeVersion?: string;
  typeStripping?: boolean;
  recentWindowMs?: number;
  apiKey?: string | null;
}): DoctorResult {
  const launchDirectory = options.launchDirectory ?? options.projectRoot;
  const now = options.now ?? new Date();
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const typeStripping =
    options.typeStripping ??
    (process.features as unknown as { typescript?: string }).typescript === "strip";
  const recentWindowMs = options.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const checks = [
    checkNode(nodeVersion, typeStripping),
    checkHook(options.projectRoot, launchDirectory),
    checkRecording(options.projectRoot, now, recentWindowMs),
    checkApiKey(
      Object.prototype.hasOwnProperty.call(options, "apiKey")
        ? options.apiKey
        : process.env.OPENAI_API_KEY
    )
  ];
  return { ok: checks.filter((check) => check.required).every((check) => check.ok), checks };
}

function checkNode(version: string, typeStripping: boolean): DoctorCheck {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const supportedVersion = major > 22 || (major === 22 && minor >= 6);
  return {
    name: "node",
    ok: supportedVersion && typeStripping,
    required: true,
    message:
      supportedVersion && typeStripping
        ? `Node ${version} supports type stripping.`
        : `Node >= 22.6 with type stripping is required; found ${version} (${typeStripping ? "strip" : "no strip"}).`
  };
}

function checkHook(projectRoot: string, launchDirectory: string): DoctorCheck {
  const hooksPath = resolve(projectRoot, ".codex", "hooks.json");
  try {
    const hooks = HooksFileSchema.parse(JSON.parse(readFileSync(hooksPath, "utf8")));
    const commands = Object.values(hooks.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command))
    );
    if (commands.length === 0) {
      throw new Error("no hook commands are configured");
    }

    const unresolved = commands.flatMap((command) => {
      const match = command.match(/\$PWD\/([^\s"']+)/);
      if (!match?.[1]) {
        return [`command does not contain a $PWD-relative executable: ${command}`];
      }
      const commandPath = resolve(launchDirectory, match[1]);
      return existsSync(commandPath) ? [] : [`missing ${commandPath}`];
    });
    if (unresolved.length > 0) {
      throw new Error(unresolved.join("; "));
    }

    return {
      name: "hook",
      ok: true,
      required: true,
      message: `${commands.length} hook command(s) resolve from ${launchDirectory}.`
    };
  } catch (error) {
    return { name: "hook", ok: false, required: true, message: errorMessage(error) };
  }
}

function checkRecording(
  projectRoot: string,
  now: Date,
  recentWindowMs: number
): DoctorCheck {
  const latestPath = resolve(
    projectRoot,
    ".codex-observer",
    "latest",
    "events.jsonl"
  );
  try {
    const modifiedAt = statSync(latestPath).mtime;
    const ageMs = now.getTime() - modifiedAt.getTime();
    if (ageMs < 0 || ageMs > recentWindowMs) {
      throw new Error(
        `Latest recording is not recent (modified ${modifiedAt.toISOString()}; window ${Math.round(recentWindowMs / 3_600_000)}h).`
      );
    }

    const session = readCodexSessionFile(latestPath);
    if (session.events.length === 0) {
      throw new Error(`Latest recording has no valid events: ${latestPath}`);
    }
    if (session.diagnostics.length > 0) {
      throw new Error(
        `Latest recording has parse diagnostics: ${session.diagnostics
          .map((diagnostic) => `line ${diagnostic.line}: ${diagnostic.message}`)
          .join("; ")}`
      );
    }

    return {
      name: "recording",
      ok: true,
      required: true,
      message: `Latest recording parses (${session.events.length} events, modified ${modifiedAt.toISOString()}).`
    };
  } catch (error) {
    return {
      name: "recording",
      ok: false,
      required: true,
      message: errorMessage(error)
    };
  }
}

function checkApiKey(apiKey: string | null | undefined): DoctorCheck {
  const present = typeof apiKey === "string" && apiKey.trim() !== "";
  return {
    name: "api_key",
    ok: present,
    required: false,
    message: present
      ? "OPENAI_API_KEY is configured; live analysis is available."
      : "OPENAI_API_KEY is not configured; capture, dry-run, and deterministic reports remain available, but live analysis is unavailable."
  };
}

function main(): void {
  const result = runDoctor({ projectRoot: PROJECT_ROOT, launchDirectory: process.cwd() });
  for (const check of result.checks) {
    const marker = check.ok ? "✓" : check.required ? "✗" : "!";
    process.stdout.write(`${marker} ${check.name}: ${check.message}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const invokedPath = process.argv[1];
if (invokedPath && SCRIPT_PATH === resolve(invokedPath)) {
  main();
}
