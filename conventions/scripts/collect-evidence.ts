import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildUniversalValidationResult, extractValidationDecision, finish, findFiles, issue, readExecutorRoutes, readText, readYamlFile, rel, resolveConventionsRoot, writeYamlFile, type Issue, type JsonMap } from "./lib/common.js";

const SCRIPT_ID = "collect-evidence";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const MANIFEST_VERSION = "2.0";

type EvidenceEntry = {
  evidence_id: string;
  path: string;
  source_type: string;
  generated_by: string;
  producer_route_id: string | null;
  route_produced: boolean;
  status: string;
  artifact?: string;
  blocking?: boolean;
  validation_result?: JsonMap;
  score_decision?: JsonMap;
  revision_loop_analysis?: JsonMap;
  safe_structure_analysis?: JsonMap;
  architecture_quality_analysis?: JsonMap;
  global_normalization_analysis?: JsonMap;
  prompt_contract_analysis?: JsonMap;
  context_bundle?: JsonMap;
  runtime_telemetry?: JsonMap;
  content_sha256: string;
  manifest_entry_schema: "evidence_manifest_v2_entry";
  producer_verified: boolean;
};

const sourceDirs: Record<string, string> = {
  validation: ".ai/validation",
  gate: ".ai/gates",
  handoff: ".ai/handoffs",
  revision: ".ai/revisions",
  bundle: ".ai/bundles",
  topology: ".ai/topologies",
  report: ".ai/reports",
  scoring: ".ai/scoring",
  policy: ".ai/policy",
  source_artifact: ".ai/source-artifacts",
  prompt_contract: ".ai/prompt-contracts",
  context: ".ai/context",
  telemetry: ".ai/telemetry",
};

const collectorOutputs = new Set([
  ".ai/reports/evidence-index.yaml",
  ".ai/reports/evidence-manifest.yaml",
  ".ai/reports/evidence-collection-report.yaml",
  ".ai/reports/final-mission-report.yaml",
  ".ai/reports/mission-evidence-summary.yaml",
  ".ai/reports/report-evidence-validation.yaml",
]);

function classify(relativePath: string): string {
  for (const [type, dir] of Object.entries(sourceDirs)) {
    if (relativePath.startsWith(`${dir}/`)) return type;
  }
  return "unknown";
}

function safeReadYaml(filePath: string): any {
  try {
    return readYamlFile(filePath);
  } catch (error) {
    issues.push(issue("error", "EVIDENCE_YAML_UNREADABLE", `Evidence YAML could not be read: ${rel(root, filePath)}`, rel(root, filePath), String(error)));
    return {};
  }
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(readText(filePath), "utf8").digest("hex");
}

function buildEvidenceId(relativePath: string): string {
  return relativePath.replace(/^\.ai\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || path.basename(relativePath);
}

function requireProducer(entryPath: string, generatedBy: string): boolean {
  if (!generatedBy || generatedBy === "unknown") {
    issues.push(issue("warning", "EVIDENCE_ENTRY_GENERATOR_UNKNOWN", `Evidence entry does not identify a script generator: ${entryPath}`, entryPath));
    return false;
  }
  return true;
}

function normalizeScriptIdToRouteId(generatedBy: string): string | null {
  if (!generatedBy || generatedBy === "unknown") return null;
  return generatedBy.replace(/-/g, "_");
}

const executorRouteIds = new Set(Array.from(readExecutorRoutes(root).keys()));
const nonRouteSystemProducers = new Set(["verify-scripts"]);
const aiRoot = path.join(root, ".ai");
const files = fs.existsSync(aiRoot)
  ? findFiles(aiRoot, file => (file.endsWith(".yaml") || file.endsWith(".yml")) && !collectorOutputs.has(rel(root, file)))
  : [];

const entries: EvidenceEntry[] = [];
const seenIds = new Map<string, string>();
for (const file of files) {
  const relativePath = rel(root, file);
  if (!relativePath.startsWith(".ai/")) {
    issues.push(issue("error", "EVIDENCE_OUTSIDE_AI_ROOT", `Evidence path must stay under .ai: ${relativePath}`, relativePath));
    continue;
  }
  const doc = safeReadYaml(file);
  const generatedBy = String(doc.generated_by ?? doc.script_id ?? doc.summary?.generated_by ?? "unknown");
  const sourceType = classify(relativePath);
  const validationDecision = sourceType === "validation" ? extractValidationDecision(doc) : undefined;
  const scoreDecision = doc.artifact === "score_decision" ? {
    mission_mode: typeof doc.mission_mode === "string" ? doc.mission_mode : null,
    deterministic_recommendation: typeof doc.deterministic_recommendation === "string" ? doc.deterministic_recommendation : null,
    blocking_decision: doc.blocking_decision === true,
    rollout_mode: typeof doc.rollout_mode === "string" ? doc.rollout_mode : null,
    enforcement: typeof doc.enforcement === "string" ? doc.enforcement : null,
    missing_score_keys: Array.isArray(doc.missing_score_keys) ? doc.missing_score_keys : [],
    threshold_result_count: Array.isArray(doc.score_threshold_results) ? doc.score_threshold_results.length : 0,
  } : undefined;
  const revisionLoopAnalysis = doc.artifact === "revision_loop_analysis" ? {
    mission_id: typeof doc.mission_id === "string" ? doc.mission_id : null,
    active_failure_fingerprint: typeof doc.active_failure_fingerprint === "string" ? doc.active_failure_fingerprint : null,
    active_fingerprint_count: typeof doc.active_fingerprint_count === "number" ? doc.active_fingerprint_count : 0,
    observe_retry_budget: typeof doc.observe_retry_budget === "number" ? doc.observe_retry_budget : null,
    repeated_fingerprint_count: Array.isArray(doc.repeated_fingerprints) ? doc.repeated_fingerprints.length : 0,
    no_progress_suspected: doc.no_progress_suspected === true,
    blocking_decision: doc.blocking_decision === true,
    rollout_mode: typeof doc.rollout_mode === "string" ? doc.rollout_mode : null,
    enforcement: typeof doc.enforcement === "string" ? doc.enforcement : null,
    warning_codes: Array.isArray(doc.warnings) ? doc.warnings.filter((value: unknown) => typeof value === "string") : [],
  } : undefined;
  const safeStructureAnalysis = doc.artifact === "safe_structure_change_analysis" ? {
    change_kind: typeof doc.requested_change?.change_kind === "string" ? doc.requested_change.change_kind : null,
    candidate_file: typeof doc.requested_change?.candidate_file === "string" ? doc.requested_change.candidate_file : null,
    target_file: typeof doc.requested_change?.target_file === "string" ? doc.requested_change.target_file : null,
    rollout_mode: typeof doc.rollout_mode === "string" ? doc.rollout_mode : null,
    enforcement_mode: typeof doc.enforcement_mode === "string" ? doc.enforcement_mode : null,
    blocking_decision: doc.blocking_decision === true,
    inbound_dependency_count: typeof doc.safety_observations?.inbound_dependency_count === "number" ? doc.safety_observations.inbound_dependency_count : 0,
    outbound_dependency_count: typeof doc.safety_observations?.outbound_dependency_count === "number" ? doc.safety_observations.outbound_dependency_count : 0,
    candidate_route_ids: Array.isArray(doc.safety_observations?.candidate_route_ids) ? doc.safety_observations.candidate_route_ids.filter((value: unknown) => typeof value === "string") : [],
    warning_codes: Array.isArray(doc.safety_observations?.warning_codes) ? doc.safety_observations.warning_codes.filter((value: unknown) => typeof value === "string") : [],
    error_codes: Array.isArray(doc.safety_observations?.error_codes) ? doc.safety_observations.error_codes.filter((value: unknown) => typeof value === "string") : [],
  } : undefined;
  const architectureQualityAnalysis = doc.artifact === "architecture_quality_analysis" ? {
    rollout_mode: typeof doc.rollout_mode === "string" ? doc.rollout_mode : null,
    enforcement_mode: typeof doc.enforcement_mode === "string" ? doc.enforcement_mode : null,
    blocking_decision: doc.blocking_decision === true,
    adapter_neutral: doc.core_contract?.adapter_neutral === true,
    adapter_discovery_source: typeof doc.core_contract?.adapter_discovery_source === "string" ? doc.core_contract.adapter_discovery_source : null,
    language_adapter_count: typeof doc.adapter_evidence_summary?.language_adapter_count === "number" ? doc.adapter_evidence_summary.language_adapter_count : 0,
    framework_adapter_count: typeof doc.adapter_evidence_summary?.framework_adapter_count === "number" ? doc.adapter_evidence_summary.framework_adapter_count : 0,
    quality_dimension_count: Array.isArray(doc.quality_dimensions) ? doc.quality_dimensions.length : 0,
    warning_codes: Array.isArray(doc.observations?.warning_codes) ? doc.observations.warning_codes.filter((value: unknown) => typeof value === "string") : [],
    error_codes: Array.isArray(doc.observations?.error_codes) ? doc.observations.error_codes.filter((value: unknown) => typeof value === "string") : [],
  } : undefined;
  const globalNormalizationAnalysis = doc.artifact === "global_normalization_analysis" ? {
    rollout_mode: typeof doc.rollout_mode === "string" ? doc.rollout_mode : null,
    enforcement_mode: typeof doc.enforcement_mode === "string" ? doc.enforcement_mode : null,
    blocking_decision: doc.blocking_decision === true,
    adapter_neutral: doc.adapter_neutral === true,
    policy_abstraction: typeof doc.policy_abstraction === "string" ? doc.policy_abstraction : null,
    concrete_signals_are_policy: doc.concrete_signals_are_policy === true,
    project_specific_rules_allowed: doc.project_specific_rules_allowed === true,
    mutation_allowed: doc.mutation_allowed === true,
    automatic_rewrites_allowed: doc.automatic_rewrites_allowed === true,
    normalization_dimension_count: Array.isArray(doc.normalization_dimensions) ? doc.normalization_dimensions.length : 0,
    adapter_count: typeof doc.adapter_counts?.total === "number" ? doc.adapter_counts.total : 0,
    detector_signal_keys: doc.detector_signals && typeof doc.detector_signals === "object" && !Array.isArray(doc.detector_signals) ? Object.keys(doc.detector_signals).sort() : [],
    finding_keys: doc.findings && typeof doc.findings === "object" && !Array.isArray(doc.findings) ? Object.keys(doc.findings).sort() : [],
    warning_codes: Array.isArray(doc.warning_codes) ? doc.warning_codes.filter((value: unknown) => typeof value === "string") : [],
    error_codes: Array.isArray(doc.error_codes) ? doc.error_codes.filter((value: unknown) => typeof value === "string") : [],
  } : undefined;

  const promptContractAnalysis = doc.artifact === "prompt_contract_analysis" ? {
    rollout_mode: typeof doc.rollout_mode === "string" ? doc.rollout_mode : null,
    enforcement_mode: typeof doc.enforcement_mode === "string" ? doc.enforcement_mode : null,
    blocking_decision: doc.blocking_decision === true,
    mutation_allowed: doc.mutation_allowed === true,
    prompt_rewrite_allowed: doc.prompt_rewrite_allowed === true,
    prompt_surface_count: typeof doc.summary?.prompt_surface_count === "number" ? doc.summary.prompt_surface_count : 0,
    surfaces_with_complete_contract: typeof doc.summary?.surfaces_with_complete_contract === "number" ? doc.summary.surfaces_with_complete_contract : 0,
    total_missing_sections: typeof doc.summary?.total_missing_sections === "number" ? doc.summary.total_missing_sections : 0,
    warning_count: typeof doc.summary?.warning_count === "number" ? doc.summary.warning_count : 0,
    error_count: typeof doc.summary?.error_count === "number" ? doc.summary.error_count : 0,
    required_sections: Array.isArray(doc.contract_model?.required_sections) ? doc.contract_model.required_sections.filter((value: unknown) => typeof value === "string") : [],
    missing_sections_behavior: typeof doc.contract_model?.missing_sections_behavior === "string" ? doc.contract_model.missing_sections_behavior : null,
    unknown_route_behavior: typeof doc.contract_model?.unknown_route_behavior === "string" ? doc.contract_model.unknown_route_behavior : null,
    direct_script_reference_behavior: typeof doc.contract_model?.direct_script_reference_behavior === "string" ? doc.contract_model.direct_script_reference_behavior : null,
  } : undefined;

  const contextBundle = doc.artifact === "compiled_context_bundle" ? {
    scope: typeof doc.scope === "string" ? doc.scope : null,
    enforcement_mode: typeof doc.enforcement_mode === "string" ? doc.enforcement_mode : null,
    mutation_allowed: doc.mutation_allowed === true,
    selected_workflow_lanes: Array.isArray(doc.context_selection?.selected_workflow_lanes) ? doc.context_selection.selected_workflow_lanes.filter((value: unknown) => typeof value === "string") : [],
    selection_source: typeof doc.context_selection?.selection_source === "string" ? doc.context_selection.selection_source : null,
    adapter_discovery_source: typeof doc.context_selection?.adapter_discovery_source === "string" ? doc.context_selection.adapter_discovery_source : null,
    included_route_count: Array.isArray(doc.included_routes) ? doc.included_routes.length : 0,
    included_artifact_count: Array.isArray(doc.included_artifacts) ? doc.included_artifacts.length : 0,
    included_subsystem_count: Array.isArray(doc.included_subsystems) ? doc.included_subsystems.length : 0,
    retrieval_trace_count: Array.isArray(doc.retrieval_trace) ? doc.retrieval_trace.length : 0,
    adapter_topology_present: doc.optional_runtime_context?.adapter_topology?.topology_present === true,
    prompt_contract_analysis_present: doc.optional_runtime_context?.prompt_contract_analysis?.prompt_contract_analysis_present === true,
    blocking_decision: doc.validation_result?.blocking === true,
  } : doc.artifact === "context_load_trace" ? {
    scope: typeof doc.scope === "string" ? doc.scope : null,
    enforcement_mode: "observe",
    mutation_allowed: false,
    selected_workflow_lanes: [],
    selection_source: "context_load_trace",
    adapter_discovery_source: null,
    included_route_count: 0,
    included_artifact_count: 0,
    included_subsystem_count: 0,
    retrieval_trace_count: Array.isArray(doc.trace) ? doc.trace.length : 0,
    adapter_topology_present: Array.isArray(doc.trace) ? doc.trace.some((entry: JsonMap) => entry?.trace_id === "adapter_topology_optional" && Number(entry?.included_item_count ?? 0) > 0) : false,
    prompt_contract_analysis_present: Array.isArray(doc.trace) ? doc.trace.some((entry: JsonMap) => entry?.trace_id === "prompt_contract_optional" && Number(entry?.included_item_count ?? 0) > 0) : false,
    blocking_decision: false,
  } : undefined;
  const runtimeTelemetry = doc.artifact === "runtime_telemetry_summary" ? {
    artifact_kind: "summary",
    rollout_mode: typeof doc.rollout_mode === "string" ? doc.rollout_mode : null,
    enforcement_mode: typeof doc.enforcement_mode === "string" ? doc.enforcement_mode : null,
    mutation_allowed: doc.mutation_allowed === true,
    event_count: typeof doc.event_count === "number" ? doc.event_count : 0,
    blocking_event_count: typeof doc.blocking_event_count === "number" ? doc.blocking_event_count : 0,
    warning_event_count: typeof doc.warning_event_count === "number" ? doc.warning_event_count : 0,
    error_event_count: typeof doc.error_event_count === "number" ? doc.error_event_count : 0,
    source_path_count: typeof doc.source_path_count === "number" ? doc.source_path_count : 0,
    event_type_keys: doc.event_counts_by_type && typeof doc.event_counts_by_type === "object" && !Array.isArray(doc.event_counts_by_type) ? Object.keys(doc.event_counts_by_type).sort() : [],
    route_event_keys: doc.route_event_counts && typeof doc.route_event_counts === "object" && !Array.isArray(doc.route_event_counts) ? Object.keys(doc.route_event_counts).sort() : [],
    blocking_decision: doc.validation_result?.blocking === true,
  } : doc.artifact === "runtime_telemetry_report" ? {
    artifact_kind: "report",
    rollout_mode: typeof doc.summary?.rollout_mode === "string" ? doc.summary.rollout_mode : null,
    enforcement_mode: typeof doc.summary?.enforcement_mode === "string" ? doc.summary.enforcement_mode : null,
    mutation_allowed: doc.summary?.mutation_allowed === true,
    event_count: typeof doc.summary?.event_count === "number" ? doc.summary.event_count : 0,
    blocking_event_count: typeof doc.summary?.blocking_event_count === "number" ? doc.summary.blocking_event_count : 0,
    warning_event_count: typeof doc.summary?.warning_event_count === "number" ? doc.summary.warning_event_count : 0,
    error_event_count: typeof doc.summary?.error_event_count === "number" ? doc.summary.error_event_count : 0,
    source_path_count: typeof doc.summary?.source_path_count === "number" ? doc.summary.source_path_count : 0,
    event_type_keys: doc.summary?.event_counts_by_type && typeof doc.summary.event_counts_by_type === "object" && !Array.isArray(doc.summary.event_counts_by_type) ? Object.keys(doc.summary.event_counts_by_type).sort() : [],
    route_event_keys: doc.summary?.route_event_counts && typeof doc.summary.route_event_counts === "object" && !Array.isArray(doc.summary.route_event_counts) ? Object.keys(doc.summary.route_event_counts).sort() : [],
    blocking_decision: doc.validation_result?.blocking === true,
  } : undefined;
  const status = validationDecision ? validationDecision.status : String(doc.status ?? doc.result ?? (Array.isArray(doc.errors) && doc.errors.length ? "fail" : "unknown"));
  const evidenceId = buildEvidenceId(relativePath);
  const priorPath = seenIds.get(evidenceId);
  if (priorPath && priorPath !== relativePath) {
    issues.push(issue("error", "EVIDENCE_ID_COLLISION", `Evidence id collision: ${evidenceId}`, relativePath, { prior_path: priorPath }));
  }
  seenIds.set(evidenceId, relativePath);
  const producerVerified = requireProducer(relativePath, generatedBy);
  const producerRouteId = normalizeScriptIdToRouteId(generatedBy);
  const routeProduced = producerRouteId !== null && executorRouteIds.has(producerRouteId);
  if (producerVerified && !routeProduced && !nonRouteSystemProducers.has(generatedBy) && ["validation", "gate", "handoff", "revision", "scoring", "policy", "source_artifact", "prompt_contract", "context", "telemetry"].includes(sourceType)) {
    issues.push(issue("warning", "EVIDENCE_ENTRY_ROUTE_NOT_REGISTERED", `Evidence producer does not map to a registered executor route: ${generatedBy}`, relativePath, { generated_by: generatedBy, expected_route_id: producerRouteId }));
  }

  entries.push({
    evidence_id: evidenceId,
    path: relativePath,
    source_type: sourceType,
    generated_by: generatedBy,
    producer_route_id: producerRouteId,
    route_produced: routeProduced,
    status,
    artifact: typeof doc.artifact === "string" ? doc.artifact : undefined,
    content_sha256: sha256(file),
    manifest_entry_schema: "evidence_manifest_v2_entry",
    producer_verified: producerVerified,
    ...(scoreDecision ? { score_decision: scoreDecision, blocking: scoreDecision.blocking_decision } : {}),
    ...(revisionLoopAnalysis ? { revision_loop_analysis: revisionLoopAnalysis, blocking: revisionLoopAnalysis.blocking_decision } : {}),
    ...(safeStructureAnalysis ? { safe_structure_analysis: safeStructureAnalysis, blocking: safeStructureAnalysis.blocking_decision } : {}),
    ...(architectureQualityAnalysis ? { architecture_quality_analysis: architectureQualityAnalysis, blocking: architectureQualityAnalysis.blocking_decision } : {}),
    ...(globalNormalizationAnalysis ? { global_normalization_analysis: globalNormalizationAnalysis, blocking: globalNormalizationAnalysis.blocking_decision } : {}),
    ...(promptContractAnalysis ? { prompt_contract_analysis: promptContractAnalysis, blocking: promptContractAnalysis.blocking_decision } : {}),
    ...(contextBundle ? { context_bundle: contextBundle, blocking: contextBundle.blocking_decision } : {}),
    ...(runtimeTelemetry ? { runtime_telemetry: runtimeTelemetry, blocking: runtimeTelemetry.blocking_decision } : {}),
    ...(validationDecision ? {
      blocking: validationDecision.blocking,
      validation_result: {
        validation_id: validationDecision.validation_id ?? null,
        status: validationDecision.status,
        severity: validationDecision.severity ?? null,
        blocking: validationDecision.blocking,
        source_shape: validationDecision.source_shape,
      },
    } : {}),
  });
}

const counts = entries.reduce<Record<string, number>>((acc, entry) => {
  acc[entry.source_type] = (acc[entry.source_type] ?? 0) + 1;
  return acc;
}, {});

const validationResult = buildUniversalValidationResult(SCRIPT_ID, issues, {
  evidence: entries.map(entry => ({ evidence_type: "runtime_artifact", path: entry.path, content_sha256: entry.content_sha256, source_type: entry.source_type })),
  summary: {
    manifest_version: MANIFEST_VERSION,
    evidence_count: entries.length,
    evidence_counts_by_type: counts,
  },
});

const evidenceManifest = {
  artifact: "evidence_manifest_v2",
  schema_version: MANIFEST_VERSION,
  generated_by: SCRIPT_ID,
  status: issues.some(entry => entry.severity === "error" || entry.severity === "critical") ? "fail" : "validated",
  manifest_validation: validationResult,
  evidence_count: entries.length,
  evidence_counts_by_type: counts,
  required_source_types: ["validation", "gate", "handoff", "revision", "report"],
  entries,
};

const evidenceIndex = {
  artifact: "evidence_index",
  schema_version: MANIFEST_VERSION,
  generated_by: SCRIPT_ID,
  status: evidenceManifest.status === "fail" ? "fail" : "collected",
  evidence_manifest: ".ai/reports/evidence-manifest.yaml",
  evidence_count: entries.length,
  evidence_counts_by_type: counts,
  required_source_types: evidenceManifest.required_source_types,
  entries,
};

const collectionReport = {
  artifact: "evidence_collection_report",
  generated_by: SCRIPT_ID,
  status: evidenceManifest.status === "fail" ? "fail" : "pass",
  evidence_manifest: ".ai/reports/evidence-manifest.yaml",
  summary: {
    manifest_version: MANIFEST_VERSION,
    evidence_count: entries.length,
    evidence_counts_by_type: counts,
  },
  validation_result: validationResult,
  missing_source_types: Object.keys(sourceDirs).filter(type => !counts[type] && ["validation", "gate", "handoff", "revision", "report"].includes(type)),
};

writeYamlFile(path.join(root, ".ai", "reports", "evidence-manifest.yaml"), evidenceManifest);
writeYamlFile(path.join(root, ".ai", "reports", "evidence-index.yaml"), evidenceIndex);
writeYamlFile(path.join(root, ".ai", "reports", "evidence-collection-report.yaml"), collectionReport);

finish(SCRIPT_ID, issues, [".ai/reports/evidence-manifest.yaml", ".ai/reports/evidence-index.yaml", ".ai/reports/evidence-collection-report.yaml"], {
  evidence_manifest: ".ai/reports/evidence-manifest.yaml",
  evidence_count: entries.length,
  evidence_counts_by_type: counts,
  validation_result: validationResult,
});
