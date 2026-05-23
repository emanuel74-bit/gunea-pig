import path from "node:path";
import {
  asArray,
  getArg,
  readExecutorRoutes,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  issue,
  type Issue,
  finish,
  normalizeRelPath,
} from "./lib/common.js";

const SCRIPT_ID = "generate-phase-bundle";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const missionId = normalizeSegment(getArg("mission-id") ?? "mission");
const phaseId = getArg("phase-id") ?? "mission_profile_selection";
const outputArg = getArg("output");

function normalizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]/g, "_") || "mission";
}

function readConvention(relPath: string): any {
  return readYamlFile(path.join(root, relPath));
}

function sectionArray(file: any, key: string): any[] {
  const value = file?.sections?.[key];
  return Array.isArray(value) ? value : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function pickRoute(route: any): any {
  return {
    executor_type: route.executor_type,
    script: route.script,
    lifecycle_hooks: asArray(route.lifecycle_hooks),
    required_inputs: asArray(route.required_inputs),
    produced_outputs: asArray(route.produced_outputs),
    required_artifacts: asArray(route.required_artifacts),
    allowed_write_paths: asArray(route.allowed_write_paths),
    failure_behavior: route.failure_behavior,
  };
}

const routes = readExecutorRoutes(root);
const phaseContractsFile = readConvention("phases/conventions.phase-contracts.yaml");
const phaseOwnershipFile = readConvention("agents/conventions.agent-phase-ownership.yaml");
const bundlePolicyFile = readConvention("multi-agent/conventions.phase-bundle-policy.yaml");

const phaseContracts = sectionArray(phaseContractsFile, "phase_contract_registry");
const ownershipRecords = sectionArray(phaseOwnershipFile, "phase_ownership_records");
const phaseContract = phaseContracts.find(record => record?.phase_id === phaseId);
const ownershipRecord = ownershipRecords.find(record => record?.phase_id === phaseId);

if (!phaseContract) {
  issues.push(issue("critical", "PHASE_CONTRACT_MISSING", `No phase contract found for phase_id ${phaseId}`));
}
if (!ownershipRecord) {
  issues.push(issue("critical", "PHASE_OWNERSHIP_MISSING", `No phase ownership record found for phase_id ${phaseId}`));
}

const ownerAgent = phaseContract?.owner_agent ?? ownershipRecord?.owner_agent ?? getArg("owner-agent") ?? "unknown_agent";
const beforePhaseRoutes = asArray(bundlePolicyFile?.sections?.required_executor_routes?.before_phase_start);
const phaseRuntimeRoutes = ["validate_phase_output", "validate_semantic_completeness", "run_gate_check", "prepare_agent_handoff", "collect_phase_report"];
const requiredExecutorRoutes = unique([...beforePhaseRoutes, ...phaseRuntimeRoutes]);

for (const routeId of requiredExecutorRoutes) {
  if (!routes.has(routeId)) {
    issues.push(issue("critical", "PHASE_BUNDLE_ROUTE_MISSING", `Phase bundle requires unknown executor route: ${routeId}`));
  }
}

const routeContracts: Record<string, any> = {};
for (const routeId of requiredExecutorRoutes) {
  const route = routes.get(routeId);
  if (route) routeContracts[routeId] = pickRoute(route);
}

const allowedConventionRefs = unique([
  "multi-agent/conventions.phase-bundle-policy.yaml",
  "phases/conventions.phase-contracts.yaml",
  "phases/conventions.phase-lifecycle.yaml",
  "agents/conventions.agent-phase-ownership.yaml",
  "agents/conventions.agent-contracts.yaml",
  "agents/conventions.agent-prompts.yaml",
  "agents/conventions.agent-permissions.yaml",
  "executors/conventions.executor-routes.yaml",
  "reports/conventions.report-templates.yaml",
  "reports/conventions.report-registry.yaml",
  ...asArray(phaseContract?.allowed_conventions?.required_files),
  ...asArray(phaseContract?.allowed_conventions?.optional_files),
]);

const requiredOutputs = asArray(phaseContract?.required_outputs);
const optionalOutputs = asArray(phaseContract?.optional_outputs);
const requiredInputs = asArray(phaseContract?.required_inputs);
const optionalInputs = asArray(phaseContract?.optional_inputs);
const allowedWriteScope = asArray(phaseContract?.allowed_write_scope);
const forbiddenWriteScope = asArray(phaseContract?.forbidden_write_scope);

const bundlePath = outputArg
  ? normalizeRelPath(outputArg)
  : `.ai/bundles/phases/${missionId}/${phaseId}.bundle.yaml`;
const manifestPath = bundlePath.replace(/\.bundle\.ya?ml$/, ".manifest.yaml");

const bundle = {
  artifact: "phase_context_bundle",
  generated_by: SCRIPT_ID,
  mission_id: missionId,
  phase_id: phaseId,
  owner_agent: ownerAgent,
  scope: "single_phase_agent_invocation",
  agent_consumption_model: {
    agent_reads_this_bundle: true,
    agent_reads_full_topologies: false,
    agent_scans_full_convention_system: false,
    topology_outputs_are_script_facing: true,
  },
  source_refs: {
    phase_contract_ref: "phases/conventions.phase-contracts.yaml#sections.phase_contract_registry",
    phase_ownership_ref: "agents/conventions.agent-phase-ownership.yaml#sections.phase_ownership_records",
    executor_routes_ref: "executors/conventions.executor-routes.yaml#sections.executor_routes",
    bundle_policy_ref: "multi-agent/conventions.phase-bundle-policy.yaml",
  },
  required_executor_routes: requiredExecutorRoutes,
  route_contracts: routeContracts,
  selected_records: {
    phase_contract: phaseContract ?? null,
    phase_ownership: ownershipRecord ?? null,
  },
  required_inputs: requiredInputs,
  optional_inputs: optionalInputs,
  required_outputs: requiredOutputs,
  optional_outputs: optionalOutputs,
  allowed_convention_refs: allowedConventionRefs,
  allowed_write_scope: allowedWriteScope,
  forbidden_write_scope: forbiddenWriteScope,
  gates: phaseContract?.gate_refs ?? {},
  handoff_requirements: phaseContract?.handoff ?? {},
  must_do: asArray(phaseContract?.must_do),
  must_not_do: asArray(phaseContract?.must_not_do),
  completion_contract: bundlePolicyFile?.sections?.completion_contract ?? {},
  minimization: {
    contains_full_convention_package: false,
    contains_full_topology_outputs: false,
    includes_selected_records_only: true,
    max_context_policy: "include selected phase, owner, route, artifact, gate, handoff, and output requirements only",
  },
};

const manifest = {
  artifact: "phase_bundle_manifest",
  generated_by: SCRIPT_ID,
  mission_id: missionId,
  phase_id: phaseId,
  bundle: bundlePath,
  required_executor_routes: requiredExecutorRoutes,
  allowed_convention_ref_count: allowedConventionRefs.length,
  required_output_count: requiredOutputs.length,
  route_contract_count: Object.keys(routeContracts).length,
  agent_consumption_model: bundle.agent_consumption_model,
};

writeYamlFile(path.join(root, bundlePath), bundle);
writeYamlFile(path.join(root, manifestPath), manifest);

finish(SCRIPT_ID, issues, [bundlePath, manifestPath], {
  mission_id: missionId,
  phase_id: phaseId,
  owner_agent: ownerAgent,
  required_route_count: requiredExecutorRoutes.length,
  allowed_convention_ref_count: allowedConventionRefs.length,
  required_output_count: requiredOutputs.length,
});
