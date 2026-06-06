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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateIssueList(key: "errors" | "warnings" | "info", value: unknown): void {
  if (!Array.isArray(value)) {
    issues.push(issue("error", `ROUTE_OUTPUT_${key.toUpperCase()}_INVALID`, `Route output ${key} must be a list`));
    return;
  }

  value.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push(issue("error", "ROUTE_OUTPUT_ISSUE_ENTRY_INVALID", `Route output ${key}[${index}] must be an issue object`, undefined, { field: key, index }));
      return;
    }

    const severity = entry.severity;
    const code = entry.code;
    const message = entry.message;
    if (severity !== "info" && severity !== "warning" && severity !== "error" && severity !== "critical") {
      issues.push(issue("error", "ROUTE_OUTPUT_ISSUE_SEVERITY_INVALID", `Route output ${key}[${index}].severity must be info, warning, error, or critical`, undefined, { field: key, index }));
    }
    if (typeof code !== "string" || !code.trim()) {
      issues.push(issue("error", "ROUTE_OUTPUT_ISSUE_CODE_INVALID", `Route output ${key}[${index}].code must be a non-empty string`, undefined, { field: key, index }));
    }
    if (typeof message !== "string" || !message.trim()) {
      issues.push(issue("error", "ROUTE_OUTPUT_ISSUE_MESSAGE_INVALID", `Route output ${key}[${index}].message must be a non-empty string`, undefined, { field: key, index }));
    }
  });
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

  validateIssueList("errors", parsed.errors);
  validateIssueList("warnings", parsed.warnings);
  validateIssueList("info", parsed.info);

  if ("outputs" in parsed) {
    if (!Array.isArray(parsed.outputs)) {
      issues.push(issue("error", "ROUTE_OUTPUT_OUTPUTS_INVALID", "Route output outputs must be a list when present"));
    } else {
      parsed.outputs.forEach((entry: unknown, index: number) => {
        if (typeof entry !== "string" || !entry.trim()) {
          issues.push(issue("error", "ROUTE_OUTPUT_OUTPUT_ENTRY_INVALID", `Route output outputs[${index}] must be a non-empty string`, undefined, { index }));
        }
      });
    }
  }
  if ("summary" in parsed && !isPlainObject(parsed.summary)) {
    issues.push(issue("error", "ROUTE_OUTPUT_SUMMARY_INVALID", "Route output summary must be an object when present"));
  }
}

finish(SCRIPT_ID, issues, [".ai/validation/validate-route-output.result.yaml"], {
  route_id: routeId || null,
  parsed_output: Boolean(parsed),
  output_contract_version: "1.0",
  controller_mode: "observe",
});
