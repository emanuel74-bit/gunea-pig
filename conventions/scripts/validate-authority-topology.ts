import fs from "node:fs";
import path from "node:path";
import { finish, issue, readYamlFile, resolveConventionsRoot, type Issue } from "./lib/common.js";

const SCRIPT_ID = "validate-authority-topology";
const root = resolveConventionsRoot();
const topologyPath = path.join(root, ".ai", "topologies", "authority-topology.yaml");
const issues: Issue[] = [];

if (!fs.existsSync(topologyPath)) {
  issues.push(issue("critical", "AUTHORITY_TOPOLOGY_MISSING", "authority_topology artifact is missing; run compile_authority_topology first"));
} else {
  const topology = readYamlFile(topologyPath);
  const concepts = topology.concepts ?? {};
  for (const [concept, entry] of Object.entries(concepts)) {
    const owners = Array.isArray((entry as any).owners) ? (entry as any).owners : [];
    if (owners.length > 1) issues.push(issue("critical", "DUPLICATE_CONCEPT_OWNER", `Concept ${concept} has multiple owners`, undefined, { concept, owners }));
  }
}

finish(SCRIPT_ID, issues, [".ai/validation/validate-authority-topology.result.yaml"], {
  topology_present: fs.existsSync(topologyPath),
});
