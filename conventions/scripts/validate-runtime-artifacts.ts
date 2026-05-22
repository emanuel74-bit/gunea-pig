import fs from "node:fs";
import path from "node:path";
import { finish, issue, readYamlFile, resolveConventionsRoot, type Issue } from "./lib/common.js";

const SCRIPT_ID = "validate-runtime-artifacts";
const root = resolveConventionsRoot();
const topologyPath = path.join(root, ".ai", "topologies", "runtime-artifact-topology.yaml");
const issues: Issue[] = [];
if (!fs.existsSync(topologyPath)) {
  issues.push(issue("critical", "RUNTIME_ARTIFACT_TOPOLOGY_MISSING", "runtime_artifact_topology is missing; run compile_runtime_artifact_topology first"));
} else {
  const topology = readYamlFile(topologyPath);
  for (const artifactPath of Object.keys(topology.artifacts ?? {})) {
    if (!artifactPath.startsWith(".ai/")) {
      issues.push(issue("error", "INVALID_RUNTIME_ARTIFACT_PATH", `Runtime artifact path must start with .ai/: ${artifactPath}`));
    }
    if (artifactPath.includes(";")) {
      issues.push(issue("error", "UNNORMALIZED_ARTIFACT_PATH", `Runtime artifact path contains punctuation drift: ${artifactPath}`));
    }
  }
}
finish(SCRIPT_ID, issues, [".ai/validation/validate-runtime-artifacts.result.yaml"], {
  topology_present: fs.existsSync(topologyPath),
});
