import path from "node:path";
import {
  conventionYamlFiles,
  extractAiArtifactPathsFromText,
  finish,
  readText,
  rel,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
} from "./lib/common.js";

const SCRIPT_ID = "compile-runtime-artifact-topology";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const artifacts: Record<string, any> = {};
for (const file of conventionYamlFiles(root)) {
  const relative = rel(root, file);
  for (const artifactPath of extractAiArtifactPathsFromText(readText(file))) {
    artifacts[artifactPath] ??= { referenced_by: [] };
    artifacts[artifactPath].referenced_by.push(relative);
  }
}
const topology = {
  artifact: "runtime_artifact_topology",
  generated_by: SCRIPT_ID,
  artifacts,
  summary: { artifact_count: Object.keys(artifacts).length },
};
writeYamlFile(path.join(root, ".ai", "topologies", "runtime-artifact-topology.yaml"), topology);
writeYamlFile(path.join(root, ".ai", "reports", "artifact-conflict-report.yaml"), { generated_by: SCRIPT_ID, conflicts: issues });
finish(SCRIPT_ID, issues, [".ai/topologies/runtime-artifact-topology.yaml", ".ai/reports/artifact-conflict-report.yaml"], topology.summary);
