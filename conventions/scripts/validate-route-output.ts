import fs from "node:fs";
import { expectedScriptIdFromRoute, finish, getArg, issue, parseStructuredOutput, readExecutorRoutes, resolveConventionsRoot, type Issue } from "./lib/common.js";

const SCRIPT_ID = "validate-route-output";
const root = resolveConventionsRoot();
const routeId = getArg("route") ?? getArg("route-id") ?? getArg("route_id") ?? "";
const outputFile = getArg("output-file") ?? getArg("output_file");
const issues: Issue[] = [];
const routes = readExecutorRoutes(root);
const route = routeId ? routes.get(routeId) : undefined;

function readOutputText(): string {
  if (outputFile) {
    const candidate = outputFile.startsWith("/") ? outputFile : `${root}/${outputFile}`;
    if (!fs.existsSync(candidate)) {
      issues.push(issue("error", "ROUTE_OUTPUT_FILE_MISSING", `Route output file does not exist: ${outputFile}`));
      return "";
    }
    return fs.readFileSync(candidate, "utf8");
  }
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

if (!routeId) {
  issues.push(issue("error", "ROUTE_ID_MISSING", "Route output validation requires --route <route_id>"));
} else if (!route) {
  issues.push(issue("error", "UNKNOWN_EXECUTOR_ROUTE", `Unknown executor route: ${routeId}`));
}

const text = readOutputText();
const parsed = parseStructuredOutput(text);
if (!parsed) {
  issues.push(issue("error", "ROUTE_OUTPUT_UNPARSEABLE", "Route output must be YAML or JSON object using the standard script result shape"));
} else {
  if (typeof parsed.script_id !== "string" || !parsed.script_id.trim()) {
    issues.push(issue("error", "ROUTE_OUTPUT_SCRIPT_ID_INVALID", "Route output script_id must be a non-empty string"));
  } else if (route && parsed.script_id !== expectedScriptIdFromRoute(route)) {
    issues.push(issue("warning", "ROUTE_OUTPUT_SCRIPT_ID_UNEXPECTED", `Route output script_id ${parsed.script_id} does not match expected script id ${expectedScriptIdFromRoute(route)}`, undefined, { route_id: routeId }));
  }
  if (parsed.status !== "pass" && parsed.status !== "fail") {
    issues.push(issue("error", "ROUTE_OUTPUT_STATUS_INVALID", "Route output status must be pass or fail"));
  }
  for (const key of ["errors", "warnings", "info"]) {
    if (!Array.isArray(parsed[key])) {
      issues.push(issue("error", `ROUTE_OUTPUT_${key.toUpperCase()}_INVALID`, `Route output ${key} must be a list`));
    }
  }
  if ("outputs" in parsed && !Array.isArray(parsed.outputs)) {
    issues.push(issue("error", "ROUTE_OUTPUT_OUTPUTS_INVALID", "Route output outputs must be a list when present"));
  }
}

finish(SCRIPT_ID, issues, [".ai/validation/validate-route-output.result.yaml"], {
  route_id: routeId || null,
  parsed_output: Boolean(parsed),
  output_contract_version: "1.0",
  controller_mode: "observe",
});
