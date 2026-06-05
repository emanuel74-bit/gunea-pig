import path from "node:path";
import { collectRuntimeArtifactDeclarations, conventionYamlFiles, extractRawAiArtifactPathsFromText, finish, globMatches, isGlobPath, issue, normalizeRelPath, readExecutorRoutes, readText, rel, resolveConventionsRoot, routeAllowsArtifact, writeYamlFile, } from "./lib/common.js";
const SCRIPT_ID = "compile-runtime-artifact-topology";
const root = resolveConventionsRoot();
const issues = [];
const declarations = collectRuntimeArtifactDeclarations(root);
const routes = readExecutorRoutes(root);
const declarationsByPath = new Map();
const declarationsById = new Map();
for (const declaration of declarations) {
    declarationsByPath.set(declaration.path, [...(declarationsByPath.get(declaration.path) ?? []), declaration]);
    declarationsById.set(declaration.artifact_id, [...(declarationsById.get(declaration.artifact_id) ?? []), declaration]);
}
const references = [];
const normalizationDrift = [];
for (const file of conventionYamlFiles(root)) {
    const relative = rel(root, file);
    for (const raw of extractRawAiArtifactPathsFromText(readText(file))) {
        const normalized = normalizeRelPath(raw);
        references.push({ file: relative, raw_path: raw, normalized_path: normalized });
        if (raw !== normalized)
            normalizationDrift.push({ file: relative, raw_path: raw, normalized_path: normalized });
    }
}
const exactDeclarations = declarations.filter(d => !isGlobPath(d.path));
const globDeclarations = declarations.filter(d => isGlobPath(d.path));
const artifactEntries = {};
for (const declaration of declarations) {
    const matchingReferences = references.filter(ref => ref.normalized_path === declaration.path || globMatches(declaration.path, ref.normalized_path));
    const producerRoutes = [...routes.entries()]
        .filter(([, route]) => routeAllowsArtifact(route, declaration.path))
        .map(([routeId]) => routeId)
        .sort();
    artifactEntries[declaration.artifact_id] = {
        path: declaration.path,
        artifact_type: declaration.artifact_type ?? (isGlobPath(declaration.path) ? "glob" : "runtime_artifact"),
        schema: declaration.schema ?? null,
        producer: declaration.producer ?? null,
        producer_routes: declaration.producer_routes?.length ? declaration.producer_routes : producerRoutes,
        consumers: declaration.consumers ?? [],
        scope: declaration.scope ?? null,
        lifecycle: declaration.lifecycle ?? null,
        write_mode: declaration.write_mode ?? null,
        required: declaration.required ?? null,
        declared_by: declaration.declared_by,
        referenced_by: [...new Set(matchingReferences.map(ref => ref.file))].sort(),
        reference_count: matchingReferences.length,
    };
}
const undeclaredReferences = references.filter(ref => {
    if (exactDeclarations.some(d => d.path === ref.normalized_path))
        return false;
    if (globDeclarations.some(d => globMatches(d.path, ref.normalized_path)))
        return false;
    return true;
});
const duplicatePathConflicts = [];
for (const [artifactPath, entries] of declarationsByPath.entries()) {
    const ids = [...new Set(entries.map(e => e.artifact_id))];
    if (ids.length > 1)
        duplicatePathConflicts.push({ path: artifactPath, artifact_ids: ids, declared_by: entries.map(e => e.declared_by) });
}
const duplicateIdConflicts = [];
for (const [artifactId, entries] of declarationsById.entries()) {
    const paths = [...new Set(entries.map(e => e.path))];
    if (paths.length > 1)
        duplicateIdConflicts.push({ artifact_id: artifactId, paths, declared_by: entries.map(e => e.declared_by) });
}
for (const drift of normalizationDrift) {
    issues.push(issue("warning", "RUNTIME_ARTIFACT_PATH_NORMALIZATION_DRIFT", `Runtime artifact path should be normalized: ${drift.raw_path} -> ${drift.normalized_path}`, drift.file));
}
for (const conflict of duplicatePathConflicts) {
    issues.push(issue("error", "RUNTIME_ARTIFACT_SAME_PATH_DIFFERENT_ID", `Runtime artifact path has multiple artifact IDs: ${conflict.path}`, undefined, conflict));
}
for (const conflict of duplicateIdConflicts) {
    issues.push(issue("error", "RUNTIME_ARTIFACT_SAME_ID_DIFFERENT_PATH", `Runtime artifact ID has multiple paths: ${conflict.artifact_id}`, undefined, conflict));
}
for (const ref of undeclaredReferences) {
    issues.push(issue("warning", "UNDECLARED_RUNTIME_ARTIFACT_REFERENCE", `Runtime artifact reference is not declared in runtime artifact registry or covered by a declared glob: ${ref.normalized_path}`, ref.file));
}
const topology = {
    artifact: "runtime_artifact_topology",
    generated_by: SCRIPT_ID,
    source_model: "reports/conventions.runtime-artifacts.yaml",
    artifacts: artifactEntries,
    references,
    conflicts: {
        duplicate_path_conflicts: duplicatePathConflicts,
        duplicate_id_conflicts: duplicateIdConflicts,
        normalization_drift: normalizationDrift,
        undeclared_references: undeclaredReferences,
    },
    summary: {
        declared_artifact_count: declarations.length,
        exact_artifact_count: exactDeclarations.length,
        glob_artifact_count: globDeclarations.length,
        runtime_artifact_reference_count: references.length,
        undeclared_reference_count: undeclaredReferences.length,
        normalization_drift_count: normalizationDrift.length,
        duplicate_path_conflict_count: duplicatePathConflicts.length,
        duplicate_id_conflict_count: duplicateIdConflicts.length,
    },
};
writeYamlFile(path.join(root, ".ai", "topologies", "runtime-artifact-topology.yaml"), topology);
writeYamlFile(path.join(root, ".ai", "reports", "artifact-conflict-report.yaml"), { generated_by: SCRIPT_ID, issues, conflicts: topology.conflicts, summary: topology.summary });
finish(SCRIPT_ID, issues, [".ai/topologies/runtime-artifact-topology.yaml", ".ai/reports/artifact-conflict-report.yaml"], topology.summary);
