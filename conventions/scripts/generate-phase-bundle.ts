import path from "node:path";
import { finish, issue, readExecutorRoutes, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "generate-phase-bundle";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const requiredRoutes = ["generate_phase_bundle", "validate_phase_bundle", "validate_phase_output", "collect_phase_report"];
const routeMap = readExecutorRoutes(root);
for (const routeId of requiredRoutes) {
  if (!routeMap.has(routeId)) issues.push(issue("error", "PHASE_ROUTE_MISSING", `Required phase route missing: ${routeId}`));
}
const bundle = {
  artifact: "phase_context_bundle",
  generated_by: SCRIPT_ID,
  scope: "single_phase_agent_invocation",
  required_executor_routes: requiredRoutes,
  included_files: [
    "phases/conventions.phase-lifecycle.yaml",
    "multi-agent/conventions.phase-bundle-policy.yaml",
    "executors/conventions.executor-routes.yaml",
  ],
  exclusion_policy: "exclude unrelated subsystem files and full package dumps",
};
writeYamlFile(path.join(root, ".ai", "bundles", "phase-context-bundle.yaml"), bundle);
writeYamlFile(path.join(root, ".ai", "bundles", "phase-bundle-manifest.yaml"), {
  generated_by: SCRIPT_ID,
  bundle: ".ai/bundles/phase-context-bundle.yaml",
  route_count: requiredRoutes.length,
});
finish(SCRIPT_ID, issues, [".ai/bundles/phase-context-bundle.yaml", ".ai/bundles/phase-bundle-manifest.yaml"], { required_route_count: requiredRoutes.length });
