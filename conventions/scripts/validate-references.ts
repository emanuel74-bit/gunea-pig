import fs from "node:fs";
import path from "node:path";
import {
    asArray,
    collectLocalRequiredRoutes,
    conventionYamlFiles,
    extractAiArtifactPathsFromText,
    finish,
    issue,
    readExecutorRoutes,
    readText,
    readYamlFile,
    rel,
    resolveConventionsRoot,
    writeYamlFile,
    type Issue,
} from "./lib/common.js";

const SCRIPT_ID = "validate-references";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const routes = readExecutorRoutes(root);
const topology: any = {
    files: {},
    route_references: [],
    runtime_artifact_references: [],
};
const removedRefs = [
    "core/conventions.authority-registry.yaml",
    "core/conventions.authority-boundaries.yaml",
    "scripts/conventions.script-contract.yaml",
    "scripts/conventions.script-io.yaml",
    "scripts/conventions.script-safety.yaml",
    "scripts/conventions.script-results.yaml",
];

for (const file of conventionYamlFiles(root)) {
    const relative = rel(root, file);
    const text = readText(file);
    const parsed = readYamlFile(file);
    const deps = parsed.dependencies ?? {};
    const required = asArray(deps.required_files);
    const optional = asArray(deps.optional_files);
    const artifactRefs = extractAiArtifactPathsFromText(text);
    topology.files[relative] = {
        required_files: required,
        optional_files: optional,
        runtime_artifacts: artifactRefs,
    };
    topology.runtime_artifact_references.push(
        ...artifactRefs.map((p) => ({ file: relative, path: p })),
    );

    for (const stale of removedRefs) {
        if (text.includes(stale))
            issues.push(
                issue(
                    "error",
                    "STALE_REMOVED_REFERENCE",
                    `Stale removed reference found: ${stale}`,
                    relative,
                ),
            );
    }
    for (const dep of required) {
        if (!fs.existsSync(path.join(root, dep))) {
            issues.push(
                issue(
                    "error",
                    "MISSING_REQUIRED_DEPENDENCY",
                    `Missing required dependency ${dep}`,
                    relative,
                ),
            );
        }
    }
    for (const dep of optional) {
        if (dep && !fs.existsSync(path.join(root, dep))) {
            issues.push(
                issue(
                    "warning",
                    "MISSING_OPTIONAL_DEPENDENCY",
                    `Missing optional dependency ${dep}`,
                    relative,
                ),
            );
        }
    }
}

for (const local of collectLocalRequiredRoutes(root)) {
    topology.route_references.push(local);
    for (const routeId of local.routes) {
        if (!routes.has(routeId))
            issues.push(
                issue(
                    "error",
                    "UNKNOWN_EXECUTOR_ROUTE_REFERENCE",
                    `Unknown executor route ${routeId}`,
                    local.file,
                ),
            );
    }
}

const topologyPath = path.join(
    root,
    ".ai",
    "topologies",
    "reference-topology.yaml",
);
writeYamlFile(topologyPath, topology);
finish(
    SCRIPT_ID,
    issues,
    [
        ".ai/topologies/reference-topology.yaml",
        ".ai/validation/validate-references.result.yaml",
    ],
    {
        scanned_files: Object.keys(topology.files).length,
        route_reference_blocks: topology.route_references.length,
        runtime_artifact_reference_count:
            topology.runtime_artifact_references.length,
    },
);
