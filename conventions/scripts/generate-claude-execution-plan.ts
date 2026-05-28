import path from "node:path";
import { finish, readExecutorRoutes, readYamlFile, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "generate-claude-execution-plan";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const routes = readExecutorRoutes(root);
const harness = readYamlFile(path.join(root, "claude-code", "conventions.claude-execution-harness.yaml"));
const stopPolicy = readYamlFile(path.join(root, "claude-code", "conventions.claude-stop-conditions.yaml"));

function extractStepRoutes(sectionName: string): string[] {
  const steps = harness?.sections?.[sectionName];
  if (!Array.isArray(steps)) return [];
  const found: string[] = [];
  for (const step of steps) {
    const declared = step?.required_executor_routes;
    if (Array.isArray(declared)) {
      for (const route of declared) if (typeof route === "string" && !found.includes(route)) found.push(route);
    }
  }
  return found;
}

const missionStartRoutes = extractStepRoutes("mission_start_sequence");
const phaseExecutionRoutes = extractStepRoutes("phase_execution_sequence");
const completionRoutes = extractStepRoutes("completion_sequence");
const routeSlices: Record<string, any> = {};
for (const routeId of [...new Set([...missionStartRoutes, ...phaseExecutionRoutes, ...completionRoutes])]) {
  const route = routes.get(routeId);
  if (route) {
    routeSlices[routeId] = {
      executor_type: route.executor_type,
      required_inputs: route.required_inputs,
      produced_outputs: route.produced_outputs,
      required_artifacts: route.required_artifacts,
      lifecycle_hooks: route.lifecycle_hooks,
      failure_behavior: route.failure_behavior,
      // Include script only as resolved route metadata; Claude Code must not select scripts outside route resolution.
      script: route.script,
    };
  }
}

const plan = {
  artifact: "claude_code_execution_plan",
  generated_by: SCRIPT_ID,
  status: "generated",
  source_contract: "claude-code/conventions.claude-execution-harness.yaml",
  route_resolution_authority: "executors/conventions.executor-routes.yaml",
  script_selection_rule: "scripts_may_only_be_invoked_after_executor_route_resolution",
  agent_context_rule: "consume_validated_phase_bundles_not_full_conventions_or_full_topologies",
  mission_start_routes: missionStartRoutes,
  phase_execution_routes: phaseExecutionRoutes,
  completion_routes: completionRoutes,
  route_contract_slices: routeSlices,
  stop_conditions: stopPolicy?.sections?.stop_conditions ?? [],
  completion_requires: [
    "valid_report_evidence",
    "script_generated_final_mission_report",
    "no_blocking_revision_open",
    "valid_gate_and_handoff_artifacts",
  ],
};

writeYamlFile(path.join(root, ".ai", "claude", "execution-plan.yaml"), plan);
finish(SCRIPT_ID, issues, [".ai/claude/execution-plan.yaml", ".ai/validation/generate-claude-execution-plan.result.yaml"], {
  route_count: Object.keys(routeSlices).length,
  mission_start_route_count: missionStartRoutes.length,
  phase_execution_route_count: phaseExecutionRoutes.length,
  completion_route_count: completionRoutes.length,
});
