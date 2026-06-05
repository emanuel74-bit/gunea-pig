import fs from "node:fs";
import path from "node:path";
import { finish, issue, readYamlFile, resolveConventionsRoot } from "./lib/common.js";
const SCRIPT_ID = "validate-runtime-artifacts";
const root = resolveConventionsRoot();
const topologyPath = path.join(root, ".ai", "topologies", "runtime-artifact-topology.yaml");
const issues = [];
const allowedScopes = new Set(["mission_runtime", "phase_runtime", "package_runtime", "execution_runtime", "context_dependent"]);
const allowedLifecycles = new Set(["generated_runtime_output", "generated_validation_output", "generated_report_output", "generated_bundle_output", "runtime_state", "context_dependent"]);
const allowedWriteModes = new Set(["single_writer", "append", "aggregate", "single_writer_unless_append_or_aggregate_declared", "context_dependent"]);
if (!fs.existsSync(topologyPath)) {
    issues.push(issue("critical", "RUNTIME_ARTIFACT_TOPOLOGY_MISSING", "runtime_artifact_topology is missing; run compile_runtime_artifact_topology first"));
}
else {
    const topology = readYamlFile(topologyPath);
    const artifacts = topology.artifacts ?? {};
    for (const [artifactId, artifact] of Object.entries(artifacts)) {
        const artifactPath = String(artifact.path ?? "");
        if (!artifactId)
            issues.push(issue("error", "RUNTIME_ARTIFACT_ID_MISSING", "Runtime artifact entry is missing artifact_id"));
        if (!artifactPath.startsWith(".ai/")) {
            issues.push(issue("error", "INVALID_RUNTIME_ARTIFACT_PATH", `Runtime artifact path must start with .ai/: ${artifactPath}`));
        }
        if (/[;,]$/.test(artifactPath) || artifactPath.includes('"') || artifactPath.includes("'")) {
            issues.push(issue("error", "UNNORMALIZED_ARTIFACT_PATH", `Runtime artifact path contains punctuation or quote drift: ${artifactPath}`));
        }
        for (const field of ["schema", "producer", "consumers", "scope", "lifecycle", "write_mode", "required"]) {
            if (artifact[field] === null || artifact[field] === undefined || artifact[field] === "") {
                issues.push(issue("error", "RUNTIME_ARTIFACT_REQUIRED_FIELD_MISSING", `Runtime artifact ${artifactId} is missing required field: ${field}`));
            }
        }
        if (artifact.scope && !allowedScopes.has(String(artifact.scope))) {
            issues.push(issue("warning", "RUNTIME_ARTIFACT_SCOPE_UNDECLARED", `Runtime artifact ${artifactId} uses nonstandard scope: ${artifact.scope}`));
        }
        if (artifact.lifecycle && !allowedLifecycles.has(String(artifact.lifecycle))) {
            issues.push(issue("warning", "RUNTIME_ARTIFACT_LIFECYCLE_UNDECLARED", `Runtime artifact ${artifactId} uses nonstandard lifecycle: ${artifact.lifecycle}`));
        }
        if (artifact.write_mode && !allowedWriteModes.has(String(artifact.write_mode))) {
            issues.push(issue("warning", "RUNTIME_ARTIFACT_WRITE_MODE_UNDECLARED", `Runtime artifact ${artifactId} uses nonstandard write_mode: ${artifact.write_mode}`));
        }
        if (!Array.isArray(artifact.consumers)) {
            issues.push(issue("error", "RUNTIME_ARTIFACT_CONSUMERS_NOT_LIST", `Runtime artifact ${artifactId} consumers must be a list`));
        }
        if (artifact.artifact_type !== "glob" && (!Array.isArray(artifact.producer_routes) || artifact.producer_routes.length === 0)) {
            issues.push(issue("warning", "RUNTIME_ARTIFACT_NO_ROUTE_BACKED_PRODUCER", `Runtime artifact ${artifactId} has no route-backed producer inferred from executor allowed_write_paths`));
        }
    }
    const conflicts = topology.conflicts ?? {};
    for (const conflict of conflicts.duplicate_path_conflicts ?? []) {
        issues.push(issue("error", "RUNTIME_ARTIFACT_SAME_PATH_DIFFERENT_ID", `Runtime artifact path conflict: ${conflict.path}`, undefined, conflict));
    }
    for (const conflict of conflicts.duplicate_id_conflicts ?? []) {
        issues.push(issue("error", "RUNTIME_ARTIFACT_SAME_ID_DIFFERENT_PATH", `Runtime artifact id conflict: ${conflict.artifact_id}`, undefined, conflict));
    }
    for (const drift of conflicts.normalization_drift ?? []) {
        issues.push(issue("warning", "RUNTIME_ARTIFACT_PATH_NORMALIZATION_DRIFT", `Runtime artifact path normalization drift: ${drift.raw_path} -> ${drift.normalized_path}`, drift.file));
    }
    for (const ref of conflicts.undeclared_references ?? []) {
        issues.push(issue("warning", "UNDECLARED_RUNTIME_ARTIFACT_REFERENCE", `Runtime artifact reference is not declared or glob-covered: ${ref.normalized_path}`, ref.file));
    }
}
finish(SCRIPT_ID, issues, [".ai/validation/validate-runtime-artifacts.result.yaml"], {
    topology_present: fs.existsSync(topologyPath),
});
