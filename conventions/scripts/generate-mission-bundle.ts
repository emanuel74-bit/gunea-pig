import path from "node:path";
import { finish, issue, readExecutorRoutes, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "generate-mission-bundle";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const routes = [...readExecutorRoutes(root).keys()];
const bundle = {
  artifact: "mission_context_bundle",
  generated_by: SCRIPT_ID,
  includes: {
    executor_routes: routes,
    mission_entrypoint: "missions/conventions.missions.yaml",
    multi_agent_entrypoint: "multi-agent/conventions.multi-agent.yaml",
  },
  instructions: ["resolve scripts only through executor routes", "fail closed on unknown routes"],
};
writeYamlFile(path.join(root, ".ai", "bundles", "mission-context-bundle.yaml"), bundle);
finish(SCRIPT_ID, issues, [".ai/bundles/mission-context-bundle.yaml"], { route_count: routes.length });
