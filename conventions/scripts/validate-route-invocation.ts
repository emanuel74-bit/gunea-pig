import fs from "node:fs";
import path from "node:path";
import { finish, getArg, issue, readExecutorRoutes, resolveConventionsRoot, routeIdLooksValid, type Issue, type JsonMap } from "./lib/common.js";

const SCRIPT_ID = "validate-route-invocation";
const root = resolveConventionsRoot();
const routeId = getArg("route") ?? getArg("route-id") ?? getArg("route_id") ?? "";
const issues: Issue[] = [];

function readStdinJson(): JsonMap {
  try {
    if (process.stdin.isTTY) return {};
    const text = fs.readFileSync(0, "utf8").trim();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    issues.push(issue("warning", "INVOCATION_STDIN_NOT_JSON", "Invocation stdin was not parseable JSON; continuing in observe mode"));
    return {};
  }
}

const payload = readStdinJson();
const routes = readExecutorRoutes(root);
const route = routeId ? routes.get(routeId) : undefined;

if (!routeId) {
  issues.push(issue("error", "ROUTE_ID_MISSING", "Route invocation requires --route <route_id>"));
} else if (routeId.startsWith("scripts/") || routeId.endsWith(".ts")) {
  issues.push(issue("error", "DIRECT_SCRIPT_INVOCATION_FORBIDDEN", `Route invocation must use route id, not script path: ${routeId}`));
} else if (!routeIdLooksValid(routeId)) {
  issues.push(issue("error", "ROUTE_ID_INVALID", `Route id does not match route naming policy: ${routeId}`));
} else if (!route) {
  issues.push(issue("error", "UNKNOWN_EXECUTOR_ROUTE", `Unknown executor route: ${routeId}`));
}

if (route) {
  if (typeof route.script !== "string" || !route.script.startsWith("scripts/")) {
    issues.push(issue("error", "ROUTE_SCRIPT_MAPPING_INVALID", `Route ${routeId} must resolve to a centralized scripts/ implementation`));
  } else if (!fs.existsSync(path.join(root, route.script))) {
    issues.push(issue("error", "ROUTE_SCRIPT_MISSING", `Route ${routeId} script is missing: ${route.script}`));
  }

  if (!Array.isArray(route.required_inputs)) {
    issues.push(issue("error", "ROUTE_REQUIRED_INPUTS_INVALID", `Route ${routeId} required_inputs must be a list`));
  } else {
    const suppliedArgs = new Set<string>();
    for (let index = 0; index < process.argv.length; index += 1) {
      const arg = process.argv[index];
      if (!arg.startsWith("--")) continue;
      suppliedArgs.add(arg.slice(2).replace(/-/g, "_"));
    }
    for (const required of route.required_inputs) {
      const key = String(required).replace(/-/g, "_");
      if (key === "central_executor_route_map" || key === "executor_routes") continue;
      const suppliedByArgs = suppliedArgs.has(key);
      const suppliedByPayload = Object.prototype.hasOwnProperty.call(payload, key);
      if (!suppliedByArgs && !suppliedByPayload) {
        issues.push(issue("warning", "ROUTE_REQUIRED_INPUT_NOT_OBSERVED", `Route ${routeId} declares required input ${required}, but the generic invocation validator did not observe it`, undefined, { route_id: routeId, required_input: required }));
      }
    }
  }
}

finish(SCRIPT_ID, issues, [".ai/validation/validate-route-invocation.result.yaml"], {
  route_id: routeId || null,
  known_route: Boolean(route),
  controller_mode: "observe",
  invocation_contract_version: "1.0",
});
