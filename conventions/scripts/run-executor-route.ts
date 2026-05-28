import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getArg, readExecutorRoutes, resolveConventionsRoot, type JsonMap } from "./lib/common.js";

const SCRIPT_ID = "run-executor-route";
const routeId = getArg("route");
const root = resolveConventionsRoot();

function readStdin(): string {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseHookInput(stdin: string): JsonMap {
  if (!stdin.trim()) return {};
  try {
    return JSON.parse(stdin);
  } catch {
    return {};
  }
}

function collectChangedFiles(hookInput: JsonMap): string[] {
  const files = new Set<string>();
  const candidates = [
    hookInput?.tool_input?.file_path,
    hookInput?.tool_input?.path,
    hookInput?.tool_input?.notebook_path,
    hookInput?.tool_response?.filePath,
    hookInput?.tool_response?.path,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) files.add(value.trim());
  }
  return [...files];
}

function writeHookOutput(ok: boolean, message: string, details: JsonMap = {}): void {
  const hookEventName = typeof details.hook_event_name === "string" ? details.hook_event_name : undefined;
  const output: JsonMap = {
    ok,
    route: routeId,
    message,
    details,
  };
  if (hookEventName) {
    output.hookSpecificOutput = {
      hookEventName,
      additionalContext: message,
    };
    if (!ok && (hookEventName === "PostToolUse" || hookEventName === "PreToolUse")) {
      output.hookSpecificOutput.decision = "block";
      output.hookSpecificOutput.reason = message;
    }
  }
  console.log(JSON.stringify(output, null, 2));
}

if (!routeId) {
  writeHookOutput(false, "Missing --route argument", { script_id: SCRIPT_ID });
  process.exit(2);
}

const routes = readExecutorRoutes(root);
const route = routes.get(routeId);
if (!route) {
  writeHookOutput(false, `Unknown executor route: ${routeId}`, { script_id: SCRIPT_ID });
  process.exit(2);
}

if (typeof route.script !== "string" || !route.script.startsWith("scripts/")) {
  writeHookOutput(false, `Route ${routeId} does not resolve to a centralized scripts/ implementation`, { script_id: SCRIPT_ID });
  process.exit(2);
}

const scriptPath = path.join(root, route.script);
if (!fs.existsSync(scriptPath)) {
  writeHookOutput(false, `Route ${routeId} script path does not exist: ${route.script}`, { script_id: SCRIPT_ID });
  process.exit(2);
}

const stdin = readStdin();
const hookInput = parseHookInput(stdin);
const extraArgs: string[] = ["--root", root];
const changedFiles = collectChangedFiles(hookInput);
if (routeId === "validate_changed_files" && changedFiles.length) {
  extraArgs.push("--changed", changedFiles.join(","));
}

const localBin = process.platform === "win32"
  ? path.join(root, "scripts", "node_modules", ".bin", "tsx.cmd")
  : path.join(root, "scripts", "node_modules", ".bin", "tsx");
const command = fs.existsSync(localBin) ? localBin : (process.platform === "win32" ? "npx.cmd" : "npx");
const args = fs.existsSync(localBin)
  ? [scriptPath, ...process.argv.slice(2).filter(arg => arg !== "--route" && arg !== routeId), ...extraArgs]
  : ["tsx", scriptPath, ...process.argv.slice(2).filter(arg => arg !== "--route" && arg !== routeId), ...extraArgs];

const result = spawnSync(command, args, {
  cwd: path.join(root, "scripts"),
  encoding: "utf8",
  env: { ...process.env },
  input: stdin,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  writeHookOutput(false, `Executor route process failed: ${result.error.message}`, {
    script_id: SCRIPT_ID,
    route: routeId,
    script: route.script,
  });
  process.exit(3);
}

process.exit(typeof result.status === "number" ? result.status : 3);
