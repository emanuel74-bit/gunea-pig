import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finish, getArg, issue, readExecutorRoutes, removeRouteArgs, resolveConventionsRoot, type Issue } from "./lib/common.js";

const SCRIPT_ID = "invoke-route";
const root = resolveConventionsRoot();
const routeId = getArg("route") ?? getArg("route-id") ?? getArg("route_id") ?? "";
const issues: Issue[] = [];
const currentScriptDir = path.dirname(fileURLToPath(import.meta.url));

function readStdin(): string {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function runnableFor(scriptRel: string): { command: string; args: string[] } {
  const compiledCandidate = path.join(currentScriptDir, path.basename(scriptRel).replace(/\.ts$/, ".js"));
  if (fs.existsSync(compiledCandidate)) return { command: process.execPath, args: [compiledCandidate] };
  return { command: process.platform === "win32" ? "npx.cmd" : "npx", args: ["tsx", path.join(root, scriptRel)] };
}

function spawnScript(scriptRel: string, args: string[], stdin: string, envOverrides: Record<string, string> = {}) {
  const runnable = runnableFor(scriptRel);
  return spawnSync(runnable.command, [...runnable.args, "--root", root, ...args], {
    cwd: path.join(root, "scripts"),
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, ...envOverrides },
  });
}

if (!routeId) {
  issues.push(issue("error", "ROUTE_ID_MISSING", "Route invocation requires --route <route_id>"));
  finish(SCRIPT_ID, issues, [], { invoked: false });
}

const stdin = readStdin();
const routes = readExecutorRoutes(root);
const route = routes.get(routeId);
if (!route) {
  issues.push(issue("error", "UNKNOWN_EXECUTOR_ROUTE", `Unknown executor route: ${routeId}`));
  finish(SCRIPT_ID, issues, [], { invoked: false, route_id: routeId });
}
if (typeof route.script !== "string" || !route.script.startsWith("scripts/")) {
  issues.push(issue("error", "ROUTE_SCRIPT_MAPPING_INVALID", `Route ${routeId} must resolve to a centralized scripts/ implementation`));
  finish(SCRIPT_ID, issues, [], { invoked: false, route_id: routeId });
}

const forwardedArgs = removeRouteArgs(process.argv.slice(2));
const validation = spawnScript("scripts/validate-route-invocation.ts", ["--route", routeId, ...forwardedArgs], stdin);
if (validation.status !== 0) {
  issues.push(issue("error", "ROUTE_INVOCATION_CONTRACT_FAILED", `Route invocation contract failed for ${routeId}`, undefined, { stdout: validation.stdout, stderr: validation.stderr }));
  finish(SCRIPT_ID, issues, [".ai/validation/invoke-route.result.yaml"], { invoked: false, route_id: routeId });
}

const result = spawnScript(route.script, forwardedArgs, stdin, { SCRIPT_RESULT_STDOUT: "" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const outputValidation = spawnScript("scripts/validate-route-output.ts", ["--route", routeId], result.stdout);
if (outputValidation.status !== 0) {
  issues.push(issue("error", "ROUTE_OUTPUT_CONTRACT_FAILED", `Route output contract failed for ${routeId}`, undefined, { stdout: outputValidation.stdout, stderr: outputValidation.stderr }));
  finish(SCRIPT_ID, issues, [".ai/validation/invoke-route.result.yaml"], { invoked: true, route_id: routeId, route_exit_code: result.status });
}

process.exit(typeof result.status === "number" ? result.status : 3);
