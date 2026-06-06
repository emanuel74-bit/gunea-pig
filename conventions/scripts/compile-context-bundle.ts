import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  finish,
  getArg,
  issue,
  readExecutorRoutes,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "compile-context-bundle";
const ROUTE_ID = "compile_context_bundle";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readOptionalYaml(relPath: string): JsonMap | undefined {
  const full = path.join(root, relPath);
  if (!fs.existsSync(full)) return undefined;
  return readYamlFile(full);
}

const scope = getArg("scope") ?? "all";
const supportedScopes = new Set(["mission_control", "planning_scope_and_evidence", "architecture_design", "implementation_and_refactoring", "transition_control", "validation_reporting_completion", "all"]);
if (!supportedScopes.has(scope)) {
  issues.push(issue("error", "CONTEXT_BUNDLE_SCOPE_UNKNOWN", "Requested context bundle scope is not supported.", undefined, { scope }));
}

const routes = readExecutorRoutes(root);
const runtimeArtifacts = readYamlFile(path.join(root, "reports", "conventions.runtime-artifacts.yaml"));
const engagement = readYamlFile(path.join(root, "claude-code", "conventions.claude-subsystem-engagement.yaml"));
const adapterTopology = readOptionalYaml(".ai/topologies/adapter-topology.yaml");
const promptContracts = readOptionalYaml(".ai/prompt-contracts/prompt-contract-analysis.yaml");

const workflowLanes = (engagement.sections?.workflow_lanes ?? {}) as JsonMap;
const selectedLaneNames = scope === "all" ? Object.keys(workflowLanes).sort() : [scope].filter(name => workflowLanes[name]);
if (scope !== "all" && selectedLaneNames.length === 0) {
  issues.push(issue("error", "CONTEXT_BUNDLE_LANE_MISSING", "Requested context bundle scope has no Claude workflow lane.", "conventions/claude-code/conventions.claude-subsystem-engagement.yaml", { scope }));
}

const selectedRoutes = new Set<string>();
const selectedArtifacts = new Set<string>();
const selectedSubsystems = new Set<string>();
for (const laneName of selectedLaneNames) {
  const lane = workflowLanes[laneName] as JsonMap;
  for (const routeId of Array.isArray(lane?.routes) ? lane.routes : []) selectedRoutes.add(String(routeId));
  for (const artifact of Array.isArray(lane?.artifacts) ? lane.artifacts : []) selectedArtifacts.add(String(artifact));
  for (const subsystem of Array.isArray(lane?.subsystems) ? lane.subsystems : []) selectedSubsystems.add(String(subsystem));
}

for (const routeId of selectedRoutes) {
  if (!routes.has(routeId)) issues.push(issue("error", "CONTEXT_BUNDLE_UNKNOWN_ROUTE", "Context bundle selected an unknown executor route.", "conventions/claude-code/conventions.claude-subsystem-engagement.yaml", { route_id: routeId, scope }));
}

const routeEntries = [...selectedRoutes].sort().map(routeId => {
  const route = routes.get(routeId) ?? {};
  return {
    route_id: routeId,
    executor_type: route.executor_type ?? "unknown",
    script: route.script ?? null,
    failure_behavior: route.failure_behavior ?? null,
    lifecycle_hooks: Array.isArray(route.lifecycle_hooks) ? route.lifecycle_hooks : [],
    required_artifacts: Array.isArray(route.required_artifacts) ? route.required_artifacts : [],
    produced_outputs: Array.isArray(route.produced_outputs) ? route.produced_outputs : [],
  };
});

const registry = Array.isArray(runtimeArtifacts.sections?.runtime_artifact_registry) ? runtimeArtifacts.sections.runtime_artifact_registry : [];
const artifactEntries = [...selectedArtifacts].sort().map(artifactPath => {
  const match = registry.find((entry: JsonMap) => entry?.path === artifactPath || artifactPath.startsWith(String(entry?.path ?? "").replace("**", "")));
  return {
    artifact_ref: artifactPath,
    registry_artifact_id: match?.artifact_id ?? null,
    producer_routes: Array.isArray(match?.producer_routes) ? match.producer_routes : [],
    schema: match?.schema ?? null,
    required: match?.required ?? "context_dependent",
  };
});

const adapterSummary = adapterTopology ? {
  topology_present: true,
  adapter_count: Array.isArray(adapterTopology.adapters) ? adapterTopology.adapters.length : Array.isArray(adapterTopology.adapter_topology?.adapters) ? adapterTopology.adapter_topology.adapters.length : 0,
  source_ref: ".ai/topologies/adapter-topology.yaml",
} : { topology_present: false, adapter_count: 0, source_ref: null };

const promptSummary = promptContracts ? {
  prompt_contract_analysis_present: true,
  prompt_surface_count: promptContracts.summary?.prompt_surface_count ?? promptContracts.prompt_surfaces?.length ?? null,
  source_ref: ".ai/prompt-contracts/prompt-contract-analysis.yaml",
} : { prompt_contract_analysis_present: false, prompt_surface_count: null, source_ref: null };

const trace = [
  { trace_id: "workflow_lane_selection", source_type: "convention", source_ref: "conventions/claude-code/conventions.claude-subsystem-engagement.yaml", inclusion_reason: "selected scope determines route, artifact, and subsystem slices", included_item_count: selectedLaneNames.length, scope },
  { trace_id: "executor_route_slice", source_type: "convention", source_ref: "conventions/executors/conventions.executor-routes.yaml", inclusion_reason: "selected routes are resolved to script and lifecycle metadata", included_item_count: routeEntries.length, scope },
  { trace_id: "runtime_artifact_slice", source_type: "convention", source_ref: "conventions/reports/conventions.runtime-artifacts.yaml", inclusion_reason: "selected artifacts are mapped to registry metadata when available", included_item_count: artifactEntries.length, scope },
  { trace_id: "adapter_topology_optional", source_type: "runtime_artifact", source_ref: ".ai/topologies/adapter-topology.yaml", inclusion_reason: "adapter topology is included when present to avoid hardcoded adapter discovery", included_item_count: adapterSummary.adapter_count, scope },
  { trace_id: "prompt_contract_optional", source_type: "runtime_artifact", source_ref: ".ai/prompt-contracts/prompt-contract-analysis.yaml", inclusion_reason: "prompt contract analysis is included when present to guide compact Claude prompt surfaces", included_item_count: Number(promptSummary.prompt_surface_count ?? 0), scope },
];

const outPath = ".ai/context/compiled-context-bundle.yaml";
const tracePath = ".ai/context/context-load-trace.yaml";
const reportPath = ".ai/reports/context-bundle-report.yaml";
const validationResult = buildUniversalValidationResult(SCRIPT_ID, issues, {
  route_id: ROUTE_ID,
  evidence: [{ evidence_type: "compiled_context_bundle", path: outPath, evidence_ref: outPath, scope, route_count: routeEntries.length, artifact_count: artifactEntries.length }],
  summary: { scope, route_count: routeEntries.length, artifact_count: artifactEntries.length, subsystem_count: selectedSubsystems.size, blocking_decision: issues.some(entry => entry.severity === "error" || entry.severity === "critical") },
});

const bundle = {
  artifact: "compiled_context_bundle",
  generated_by: SCRIPT_ID,
  route_id: ROUTE_ID,
  schema_version: "1.0",
  scope,
  mutation_allowed: false,
  enforcement_mode: "observe",
  context_selection: { selected_workflow_lanes: selectedLaneNames, selection_source: "claude_subsystem_engagement_map", adapter_discovery_source: "generated_adapter_topology_when_present" },
  included_subsystems: [...selectedSubsystems].sort(),
  included_routes: routeEntries,
  included_artifacts: artifactEntries,
  optional_runtime_context: { adapter_topology: adapterSummary, prompt_contract_analysis: promptSummary },
  source_references: ["conventions/claude-code/conventions.claude-subsystem-engagement.yaml", "conventions/executors/conventions.executor-routes.yaml", "conventions/reports/conventions.runtime-artifacts.yaml", "context/conventions.retrieval-context-economy.yaml"],
  retrieval_trace: trace,
  validation_result: validationResult,
};

const report = {
  artifact: "context_bundle_report",
  generated_by: SCRIPT_ID,
  status: validationResult.blocking ? "fail" : issues.some(entry => entry.severity === "warning") ? "pass_with_warnings" : "pass",
  summary: validationResult.summary,
  validation_result: validationResult,
};

writeYamlFile(path.join(root, outPath), bundle);
writeYamlFile(path.join(root, tracePath), { artifact: "context_load_trace", generated_by: SCRIPT_ID, schema_version: "1.0", scope, trace });
writeYamlFile(path.join(root, reportPath), report);
finish(SCRIPT_ID, issues, [outPath, tracePath, reportPath], { compiled_context_bundle: validationResult.summary, validation_result: validationResult });
