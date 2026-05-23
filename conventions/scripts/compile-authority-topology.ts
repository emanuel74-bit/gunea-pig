import path from "node:path";
import {
  asArray,
  conventionYamlFiles,
  finish,
  issue,
  readYamlFile,
  rel,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
} from "./lib/common.js";

const SCRIPT_ID = "compile-authority-topology";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const relationshipKeys = ["owns", "consumes", "produces", "validates", "extends", "specializes", "enforces", "references", "does_not_own"];
const concepts: Record<string, any> = {};
const files: Record<string, any> = {};

for (const file of conventionYamlFiles(root)) {
  const relative = rel(root, file);
  if (["PACKAGE_MANIFEST.yaml", "VALIDATION_REPORT.yaml"].includes(relative)) continue;
  const parsed = readYamlFile(file);
  const ownership = parsed.ownership ?? {};
  if (!ownership || typeof ownership !== "object" || Array.isArray(ownership)) {
    issues.push(issue("error", "MALFORMED_OWNERSHIP_BLOCK", `Ownership block must be an object`, relative));
    files[relative] = { owns: [] };
    continue;
  }
  for (const key of Object.keys(ownership)) {
    if (!relationshipKeys.includes(key)) {
      issues.push(issue("error", "UNKNOWN_OWNERSHIP_RELATIONSHIP", `Unknown ownership relationship key: ${key}`, relative));
    } else if (!Array.isArray(ownership[key])) {
      issues.push(issue("error", "MALFORMED_OWNERSHIP_RELATIONSHIP", `Ownership relationship ${key} must be a list`, relative));
    }
  }
  files[relative] = { owns: asArray(ownership.owns) };
  for (const key of relationshipKeys) {
    for (const concept of asArray(ownership[key])) {
      concepts[concept] ??= { owners: [], relationships: {} };
      concepts[concept].relationships[key] ??= [];
      concepts[concept].relationships[key].push(relative);
      if (key === "owns") concepts[concept].owners.push(relative);
    }
  }
}

for (const [concept, entry] of Object.entries(concepts)) {
  const owners = (entry as any).owners as string[];
  if (owners.length > 1) {
    issues.push(issue("critical", "DUPLICATE_CONCEPT_OWNER", `Concept ${concept} has multiple owners`, undefined, { concept, owners }));
  }
}

const topology = {
  artifact: "authority_topology",
  generated_by: SCRIPT_ID,
  source_scope: "conventions/**/*.yaml ownership blocks",
  concepts,
  files,
  summary: {
    file_count: Object.keys(files).length,
    concept_count: Object.keys(concepts).length,
    duplicate_owner_count: issues.filter(i => i.code === "DUPLICATE_CONCEPT_OWNER").length,
  },
};
const topologyPath = path.join(root, ".ai", "topologies", "authority-topology.yaml");
const conflictPath = path.join(root, ".ai", "reports", "authority-conflict-report.yaml");
writeYamlFile(topologyPath, topology);
writeYamlFile(conflictPath, { generated_by: SCRIPT_ID, conflicts: issues });
finish(SCRIPT_ID, issues, [".ai/topologies/authority-topology.yaml", ".ai/reports/authority-conflict-report.yaml"], topology.summary);
