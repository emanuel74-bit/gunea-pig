import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  collectLocalRequiredRoutes,
  finish,
  issue,
  readExecutorRoutes,
  resolveConventionsRoot,
  routeIdLooksValid,
  type Issue,
} from "./lib/common.js";

const SCRIPT_ID = "validate-executor-routes";
const root = resolveConventionsRoot();
const routes = readExecutorRoutes(root);
const issues: Issue[] = [];
const requiredFields = [
  "executor_type",
  "description",
  "script",
  "required_inputs",
  "produced_outputs",
  "allowed_write_paths",
  "required_artifacts",
  "lifecycle_hooks",
  "failure_behavior",
  "consumers",
];
const allowedTypes = new Set(["validation", "compiler", "generator", "gate", "handoff", "revision", "report", "bundle", "mission_controller", "invocation"]);
const allowedFailure = new Set(["block", "warn", "retry", "revise", "report_only"]);
const allowedHooks = new Set([
  "before_mission_start",
  "before_phase_start",
  "before_file_change",
  "after_file_change",
  "after_phase_output",
  "before_handoff",
  "after_handoff",
  "on_gate_check",
  "on_validation_failure",
  "before_mission_complete",
]);
const listFields = new Set(["required_inputs", "produced_outputs", "allowed_write_paths", "required_artifacts", "lifecycle_hooks", "consumers"]);

for (const [routeId, route] of routes.entries()) {
  if (!routeIdLooksValid(routeId)) {
    issues.push(issue("error", "INVALID_ROUTE_ID", `Route id must use verb_noun format: ${routeId}`));
  }
  for (const field of requiredFields) {
    if (!(field in route)) {
      issues.push(issue("error", "ROUTE_MISSING_FIELD", `Route ${routeId} is missing required field ${field}`));
    }
  }
  for (const field of listFields) {
    if (field in route && !Array.isArray(route[field])) {
      issues.push(issue("error", "ROUTE_FIELD_NOT_LIST", `Route ${routeId} field ${field} must be a list`));
    }
  }
  if ("blocking" in route) issues.push(issue("error", "FORBIDDEN_BLOCKING_FIELD", `Route ${routeId} uses forbidden blocking field`));
  if ("failure_policy" in route) issues.push(issue("error", "FORBIDDEN_FAILURE_POLICY", `Route ${routeId} uses forbidden failure_policy field`));
  if (!allowedTypes.has(route.executor_type)) {
    issues.push(issue("error", "UNKNOWN_EXECUTOR_TYPE", `Route ${routeId} has unknown executor_type ${route.executor_type}`));
  }
  if (route.route_group && route.executor_type && route.route_group !== route.executor_type) {
    issues.push(issue("error", "ROUTE_GROUP_TYPE_MISMATCH", `Route ${routeId} is under ${route.route_group} but declares ${route.executor_type}`));
  }
  if (!allowedFailure.has(route.failure_behavior)) {
    issues.push(issue("error", "UNKNOWN_FAILURE_BEHAVIOR", `Route ${routeId} has unknown failure_behavior ${route.failure_behavior}`));
  }
  if (Array.isArray(route.lifecycle_hooks)) {
    for (const hook of route.lifecycle_hooks) {
      if (!allowedHooks.has(String(hook))) {
        issues.push(issue("error", "UNKNOWN_LIFECYCLE_HOOK", `Route ${routeId} has unknown lifecycle hook ${hook}`));
      }
    }
  }
  if (typeof route.script !== "string" || !route.script.startsWith("scripts/")) {
    issues.push(issue("error", "INVALID_SCRIPT_PATH", `Route ${routeId} must point to centralized scripts/ path`));
  } else {
    const scriptPath = path.join(root, route.script);
    if (!fs.existsSync(scriptPath)) {
      issues.push(issue("error", "MISSING_SCRIPT_IMPLEMENTATION", `Route ${routeId} script does not exist: ${route.script}`));
    }
  }
}

for (const local of collectLocalRequiredRoutes(root)) {
  for (const routeId of local.routes) {
    if (routeId.startsWith("scripts/") || routeId.endsWith(".ts")) {
      issues.push(issue("error", "DIRECT_SCRIPT_REFERENCE", `Local required_executor_routes must use route ids, not script paths: ${routeId}`, local.file));
      continue;
    }
    if (!routes.has(routeId)) {
      issues.push(issue("error", "UNKNOWN_LOCAL_ROUTE", `Unknown local executor route reference: ${routeId}`, local.file, { hook: local.hookPath }));
    }
  }
}

const outputPath = ".ai/validation/validate-executor-routes.result.yaml";
finish(SCRIPT_ID, issues, [outputPath], {
  route_count: routes.size,
  local_requirement_blocks: collectLocalRequiredRoutes(root).length,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: "validate_executor_routes",
    evidence: [{ evidence_type: "validation_artifact", path: outputPath, producer_route: "validate_executor_routes" }],
    summary: { route_count: routes.size, local_requirement_blocks: collectLocalRequiredRoutes(root).length },
  }),
});
