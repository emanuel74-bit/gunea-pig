import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  finish,
  getArg,
  issue,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "analyze-global-normalization";
const ROUTE_ID = "analyze_global_normalization";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const enforcementModeArg = getArg("enforcement-mode") ?? "observe";
const validEnforcementModes = new Set(["observe", "controlled_enforce"]);
if (!validEnforcementModes.has(enforcementModeArg)) {
  issues.push(issue("error", "GLOBAL_NORMALIZATION_ENFORCEMENT_MODE_INVALID", "Global normalization enforcement mode must be observe or controlled_enforce.", undefined, { enforcement_mode: enforcementModeArg }));
}
const enforcementMode = validEnforcementModes.has(enforcementModeArg) ? enforcementModeArg : "observe";

const manifestPath = path.join(root, ".ai", "source-artifacts", "source-artifact-manifest.yaml");
const adapterTopologyPath = path.join(root, ".ai", "topologies", "adapter-topology.yaml");
const architectureQualityPath = path.join(root, ".ai", "source-artifacts", "architecture-quality-analysis.yaml");

interface ManifestFile {
  path: string;
  artifact_kind?: string;
  extension?: string;
  line_count?: number;
  route_ids?: string[];
  script_id?: string;
  yaml_role?: string;
  owned_concepts?: string[];
}

interface AdapterFileEvidence {
  path: string;
  line_count?: number;
  import_count?: number;
  export_count?: number;
  import_specifiers?: string[];
  re_export_specifiers?: string[];
  symbol_hints?: JsonMap;
  evidence_flags?: JsonMap;
}

interface AdapterTopologyArtifact {
  path: string;
  artifact_id?: string;
  schema?: string;
  artifact_type?: string;
}

interface AdapterTopologyEntry {
  adapter_id: string;
  adapter_kind: "language" | "framework";
  convention_path?: string;
  producer_route_id?: string;
  produced_artifact?: string;
  output_artifacts?: AdapterTopologyArtifact[];
  required?: boolean;
}

interface AdapterInput {
  adapter_id: string;
  adapter_kind: "language" | "framework";
  path: string;
  artifact: string;
  files: AdapterFileEvidence[];
  aggregate: JsonMap;
}

function asManifestFiles(value: unknown): ManifestFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ManifestFile => Boolean(entry) && typeof entry === "object" && typeof (entry as ManifestFile).path === "string");
}

function asAdapterFiles(value: unknown): AdapterFileEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AdapterFileEvidence => Boolean(entry) && typeof entry === "object" && typeof (entry as AdapterFileEvidence).path === "string");
}

function asAdapterTopologyEntries(value: unknown): AdapterTopologyEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AdapterTopologyEntry => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as AdapterTopologyEntry;
    return typeof candidate.adapter_id === "string" && (candidate.adapter_kind === "language" || candidate.adapter_kind === "framework");
  });
}

function jsonMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readOptionalYaml(filePath: string): JsonMap | undefined {
  return fs.existsSync(filePath) ? readYamlFile(filePath) : undefined;
}

function fileBase(filePath: string): string {
  return path.basename(filePath)
    .replace(/\.(ts|tsx|js|jsx|py|java|go|cs|rb|php|yaml|yml|md|json)$/i, "")
    .replace(/\.(service|controller|module|repository|provider|validator|adapter|contract|policy|schema|report|route)$/i, "")
    .replace(/[-_](service|controller|module|repository|provider|validator|adapter|contract|policy|schema|report|route)$/i, "")
    .toLowerCase();
}

function directoryOf(filePath: string): string {
  const dir = path.dirname(filePath).replace(/\\/g, "/");
  return dir === "." ? "" : dir;
}

function outputArtifacts(entry: AdapterTopologyEntry): AdapterTopologyArtifact[] {
  return Array.isArray(entry.output_artifacts)
    ? entry.output_artifacts.filter((artifact): artifact is AdapterTopologyArtifact => Boolean(artifact) && typeof artifact === "object" && typeof (artifact as AdapterTopologyArtifact).path === "string")
    : [];
}

function loadAdapterInputs(topology: JsonMap): AdapterInput[] {
  const adapters: AdapterInput[] = [];
  for (const entry of asAdapterTopologyEntries(topology.adapters)) {
    const artifacts = outputArtifacts(entry);
    const analysisArtifact = artifacts.find(artifact => artifact.path.startsWith(".ai/source-artifacts/") && artifact.path.endsWith("-source-analysis.yaml"))
      ?? artifacts.find(artifact => artifact.artifact_type === "runtime_artifact" && artifact.path.startsWith(".ai/source-artifacts/"));
    if (!analysisArtifact) {
      issues.push(issue("warning", "GLOBAL_NORMALIZATION_ADAPTER_ANALYSIS_ARTIFACT_MISSING", "Adapter topology entry has no source-analysis artifact for normalization evidence.", entry.convention_path, { adapter_id: entry.adapter_id, adapter_kind: entry.adapter_kind }));
      continue;
    }

    const data = readOptionalYaml(path.join(root, analysisArtifact.path));
    if (!data) {
      if (entry.required === true) {
        issues.push(issue("error", "GLOBAL_NORMALIZATION_REQUIRED_ADAPTER_OUTPUT_MISSING", "Required adapter output declared in topology is missing.", analysisArtifact.path, { adapter_id: entry.adapter_id, adapter_kind: entry.adapter_kind }));
      }
      continue;
    }

    const artifact = typeof data.artifact === "string" ? data.artifact : "unknown_adapter_artifact";
    adapters.push({
      adapter_id: entry.adapter_id,
      adapter_kind: entry.adapter_kind,
      path: analysisArtifact.path,
      artifact,
      files: asAdapterFiles(data.files),
      aggregate: jsonMap(data.aggregate),
    });
  }
  return adapters;
}

function issueWhen(condition: boolean, code: string, message: string, file?: string, detail?: JsonMap): void {
  if (condition) issues.push(issue("warning", code, message, file, { ...(detail ?? {}), enforcement_mode: enforcementMode }));
}

if (!fs.existsSync(manifestPath)) {
  issues.push(issue("error", "SOURCE_ARTIFACT_MANIFEST_MISSING", "Global normalization analysis requires .ai/source-artifacts/source-artifact-manifest.yaml. Run collect_source_artifacts first.", ".ai/source-artifacts/source-artifact-manifest.yaml"));
}
if (!fs.existsSync(adapterTopologyPath)) {
  issues.push(issue("error", "ADAPTER_TOPOLOGY_MISSING", "Global normalization analysis requires generated .ai/topologies/adapter-topology.yaml. Run compile_adapter_topology first.", ".ai/topologies/adapter-topology.yaml"));
}
if (issues.some(entry => entry.severity === "error" || entry.severity === "critical")) {
  finish(SCRIPT_ID, issues, [], { validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, { route_id: ROUTE_ID, evidence: [] }) });
}

const manifest = readYamlFile(manifestPath);
const adapterTopology = readYamlFile(adapterTopologyPath);
if (manifest.artifact !== "source_artifact_manifest" || !Array.isArray(manifest.files)) {
  issues.push(issue("error", "SOURCE_ARTIFACT_MANIFEST_INVALID", "Source artifact manifest has invalid shape for global normalization analysis.", ".ai/source-artifacts/source-artifact-manifest.yaml"));
}
if (adapterTopology.artifact !== "adapter_topology" || !Array.isArray(adapterTopology.adapters)) {
  issues.push(issue("error", "ADAPTER_TOPOLOGY_INVALID", "Adapter topology has invalid shape for global normalization analysis.", ".ai/topologies/adapter-topology.yaml"));
}
if (issues.some(entry => entry.severity === "error" || entry.severity === "critical")) {
  finish(SCRIPT_ID, issues, [], { validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, { route_id: ROUTE_ID, evidence: [] }) });
}

const manifestFiles = asManifestFiles(manifest.files);
const adapterInputs = loadAdapterInputs(adapterTopology);
const adapterFiles = adapterInputs.flatMap(adapter => adapter.files.map(file => ({ ...file, adapter_id: adapter.adapter_id, adapter_kind: adapter.adapter_kind })));
const architectureQuality = readOptionalYaml(architectureQualityPath);

// Detector signals are concrete heuristics mapped to universal normalization dimensions.
// They are not policy rules and must stay replaceable by future adapter/topology evidence.
const duplicateBaseGroups = new Map<string, string[]>();
for (const file of manifestFiles) {
  const base = fileBase(file.path);
  if (!base || base.length < 4) continue;
  const group = duplicateBaseGroups.get(base) ?? [];
  group.push(file.path);
  duplicateBaseGroups.set(base, group);
}
const duplicateShapeGroups = [...duplicateBaseGroups.entries()]
  .filter(([, group]) => group.length >= 3)
  .map(([base, files]) => ({ base, file_count: files.length, files: files.slice(0, 20) }));

const tinyFilesByDirectory = new Map<string, string[]>();
for (const file of adapterFiles) {
  if (numberValue(file.line_count) > 0 && numberValue(file.line_count) <= 20) {
    const dir = directoryOf(file.path);
    const group = tinyFilesByDirectory.get(dir) ?? [];
    group.push(file.path);
    tinyFilesByDirectory.set(dir, group);
  }
}
const tinyFileClusters = [...tinyFilesByDirectory.entries()]
  .filter(([, files]) => files.length >= 5)
  .map(([directory, files]) => ({ directory, file_count: files.length, sample_files: files.slice(0, 20) }));

const longFiles = adapterFiles.filter(file => numberValue(file.line_count) >= 300).map(file => file.path);
const routeBackedCandidates = manifestFiles.filter(file => file.script_id || (Array.isArray(file.route_ids) && file.route_ids.length > 0)).map(file => file.path);
const yamlOwnedCandidates = manifestFiles.filter(file => file.yaml_role || (Array.isArray(file.owned_concepts) && file.owned_concepts.length > 0)).map(file => file.path);
const todoFiles = adapterFiles.filter(file => file.evidence_flags?.has_todo_marker === true).map(file => file.path);
const directConfigAccessFiles = adapterFiles.filter(file => file.evidence_flags?.has_direct_process_env_access === true).map(file => file.path);

const importTargetGroups = new Map<string, string[]>();
for (const file of adapterFiles) {
  const specs = Array.isArray(file.import_specifiers) ? file.import_specifiers : [];
  for (const spec of specs) {
    if (!spec || spec.startsWith("node:") || spec.startsWith("@")) continue;
    const group = importTargetGroups.get(spec) ?? [];
    group.push(file.path);
    importTargetGroups.set(spec, group);
  }
}
const repeatedImportTargets = [...importTargetGroups.entries()]
  .filter(([, files]) => files.length >= 5)
  .map(([specifier, files]) => ({ specifier, importer_count: files.length, sample_importers: files.slice(0, 20) }));

issueWhen(duplicateShapeGroups.length > 0, "GLOBAL_NORMALIZATION_CONCEPTUAL_OVERLAP_SIGNAL", "Detector signals indicate possible conceptual overlap between artifacts that should be reviewed against declared responsibilities.", undefined, { group_count: duplicateShapeGroups.length, sample_groups: duplicateShapeGroups.slice(0, 5) });
issueWhen(tinyFileClusters.length > 0, "GLOBAL_NORMALIZATION_GRANULARITY_FRAGMENTATION_SIGNAL", "Detector signals indicate possible responsibility granularity or fragmentation issues to review.", undefined, { cluster_count: tinyFileClusters.length, sample_clusters: tinyFileClusters.slice(0, 5) });
issueWhen(longFiles.length > 0, "GLOBAL_NORMALIZATION_GRANULARITY_BREADTH_SIGNAL", "Detector signals indicate possible broad-responsibility artifacts requiring later safe-structure review before any change.", longFiles[0], { file_count: longFiles.length, sample_files: longFiles.slice(0, 10) });
issueWhen(todoFiles.length > 0, "GLOBAL_NORMALIZATION_UNRESOLVED_WORK_SIGNAL", "Adapter evidence found unresolved-work signals that should be converted into tracked tasks, risks, or revision items before completion.", undefined, { file_count: todoFiles.length, sample_files: todoFiles.slice(0, 10) });
issueWhen(directConfigAccessFiles.length > 0, "GLOBAL_NORMALIZATION_CONFIGURATION_BOUNDARY_SIGNAL", "Adapter evidence found configuration or policy-boundary signals that may require explicit boundary review.", undefined, { file_count: directConfigAccessFiles.length, sample_files: directConfigAccessFiles.slice(0, 10) });
issueWhen(repeatedImportTargets.length > 0, "GLOBAL_NORMALIZATION_SHARED_MECHANISM_SIGNAL", "Detector signals indicate concentrated shared mechanisms or dependencies that may require boundary review.", undefined, { target_count: repeatedImportTargets.length, sample_targets: repeatedImportTargets.slice(0, 5) });
issueWhen(adapterInputs.length === 0, "GLOBAL_NORMALIZATION_ADAPTER_EVIDENCE_MISSING", "Global normalization is adapter-neutral and can run without adapter outputs, but normalization evidence is limited.", ".ai/topologies/adapter-topology.yaml");
issueWhen(!architectureQuality, "GLOBAL_NORMALIZATION_ARCHITECTURE_QUALITY_MISSING", "Architecture-quality analysis was not present, so global normalization cannot correlate normalization signals with quality dimensions yet.", ".ai/source-artifacts/architecture-quality-analysis.yaml");

const warningCodes = issues.filter(entry => entry.severity === "warning").map(entry => entry.code);
const errorCodes = issues.filter(entry => entry.severity === "error" || entry.severity === "critical").map(entry => entry.code);
const blockingDecision = false;

const normalizationDimensions = [
  {
    dimension: "conceptual_overlap",
    abstraction_level: "universal",
    status: duplicateShapeGroups.length ? "observe_warning" : "observed",
    evidence_categories: ["naming_similarity", "shared_responsibility_signal"],
    detector_signals: { repeated_base_name_group_count: duplicateShapeGroups.length },
  },
  {
    dimension: "responsibility_granularity",
    abstraction_level: "universal",
    status: tinyFileClusters.length || longFiles.length ? "observe_warning" : adapterFiles.length ? "observed" : "insufficient_evidence",
    evidence_categories: ["artifact_size_distribution", "directory_cohesion_distribution"],
    detector_signals: { small_artifact_cluster_count: tinyFileClusters.length, large_artifact_count: longFiles.length },
  },
  {
    dimension: "configuration_and_policy_boundary",
    abstraction_level: "universal",
    status: directConfigAccessFiles.length ? "observe_warning" : adapterFiles.length ? "observed" : "insufficient_evidence",
    evidence_categories: ["configuration_access", "policy_boundary_signal"],
    detector_signals: { direct_config_access_file_count: directConfigAccessFiles.length },
  },
  {
    dimension: "unresolved_work_normalization",
    abstraction_level: "universal",
    status: todoFiles.length ? "observe_warning" : adapterFiles.length ? "observed" : "insufficient_evidence",
    evidence_categories: ["unresolved_marker", "deferred_work_signal"],
    detector_signals: { unresolved_marker_file_count: todoFiles.length },
  },
  {
    dimension: "shared_mechanism_consistency",
    abstraction_level: "universal",
    status: repeatedImportTargets.length ? "observe_warning" : adapterFiles.length ? "observed" : "insufficient_evidence",
    evidence_categories: ["dependency_concentration", "shared_mechanism_signal"],
    detector_signals: { repeated_dependency_target_count: repeatedImportTargets.length },
  },
  {
    dimension: "ownership_and_transition_safety",
    abstraction_level: "universal",
    status: "observed",
    evidence_categories: ["route_ownership", "convention_ownership", "structural_change_safety"],
    detector_signals: { route_backed_candidate_count: routeBackedCandidates.length, convention_owned_candidate_count: yamlOwnedCandidates.length },
  },
  {
    dimension: "architecture_quality_correlation",
    abstraction_level: "universal",
    status: architectureQuality ? "observed" : "insufficient_evidence",
    evidence_categories: ["architecture_quality_evidence", "mission_context"],
    detector_signals: { architecture_quality_present: Boolean(architectureQuality) },
  },
];

const analysisOut = ".ai/source-artifacts/global-normalization-analysis.yaml";
const reportOut = ".ai/reports/global-normalization-report.yaml";
const analysis = {
  artifact: "global_normalization_analysis",
  generated_by: SCRIPT_ID,
  rollout_mode: "observe",
  enforcement_mode: enforcementMode,
  blocking_decision: blockingDecision,
  source_manifest_path: ".ai/source-artifacts/source-artifact-manifest.yaml",
  adapter_topology_path: ".ai/topologies/adapter-topology.yaml",
  architecture_quality_path: architectureQuality ? ".ai/source-artifacts/architecture-quality-analysis.yaml" : null,
  adapter_neutral: true,
  policy_abstraction: "universal_normalization_dimensions",
  concrete_signals_are_policy: false,
  project_specific_rules_allowed: false,
  mutation_allowed: false,
  automatic_rewrites_allowed: false,
  adapter_counts: {
    total: adapterInputs.length,
    language: adapterInputs.filter(adapter => adapter.adapter_kind === "language").length,
    framework: adapterInputs.filter(adapter => adapter.adapter_kind === "framework").length,
  },
  analyzed_counts: {
    manifest_file_count: manifestFiles.length,
    adapter_file_count: adapterFiles.length,
    duplicate_shape_group_count: duplicateShapeGroups.length,
    tiny_file_cluster_count: tinyFileClusters.length,
    long_file_count: longFiles.length,
    todo_marker_file_count: todoFiles.length,
    direct_config_access_file_count: directConfigAccessFiles.length,
    repeated_import_target_count: repeatedImportTargets.length,
  },
  normalization_dimensions: normalizationDimensions,
  detector_signals: {
    repeated_base_name_groups: duplicateShapeGroups.slice(0, 20),
    small_artifact_clusters: tinyFileClusters.slice(0, 20),
    large_artifact_candidates: longFiles.slice(0, 50),
    unresolved_marker_files: todoFiles.slice(0, 50),
    direct_config_access_files: directConfigAccessFiles.slice(0, 50),
    repeated_dependency_targets: repeatedImportTargets.slice(0, 20),
    route_backed_candidates: routeBackedCandidates.slice(0, 50),
    convention_owned_candidates: yamlOwnedCandidates.slice(0, 50),
  },
  findings: {
    conceptual_overlap: duplicateShapeGroups.slice(0, 20),
    responsibility_granularity: { small_artifact_clusters: tinyFileClusters.slice(0, 20), large_artifact_candidates: longFiles.slice(0, 50) },
    configuration_and_policy_boundary: directConfigAccessFiles.slice(0, 50),
    unresolved_work_normalization: todoFiles.slice(0, 50),
    shared_mechanism_consistency: repeatedImportTargets.slice(0, 20),
    ownership_and_transition_safety: { route_backed_candidates: routeBackedCandidates.slice(0, 50), convention_owned_candidates: yamlOwnedCandidates.slice(0, 50) },
  },
  warning_codes: warningCodes,
  error_codes: errorCodes,
};

const report = {
  artifact: "global_normalization_report",
  generated_by: SCRIPT_ID,
  status: errorCodes.length ? "fail" : warningCodes.length ? "pass_with_warnings" : "pass",
  source_analysis_path: analysisOut,
  summary: {
    rollout_mode: analysis.rollout_mode,
    enforcement_mode: enforcementMode,
    blocking_decision: blockingDecision,
    mutation_allowed: false,
    warning_count: warningCodes.length,
    error_count: errorCodes.length,
    normalization_dimension_count: normalizationDimensions.length,
    policy_abstraction: "universal_normalization_dimensions",
    concrete_signals_are_policy: false,
    conceptual_overlap_signal_count: duplicateShapeGroups.length,
    responsibility_granularity_signal_count: tinyFileClusters.length + longFiles.length,
  },
};

writeYamlFile(path.join(root, analysisOut), analysis);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [analysisOut, reportOut], {
  rollout_mode: "observe",
  enforcement_mode: enforcementMode,
  blocking_decision: blockingDecision,
  mutation_allowed: false,
  normalization_dimension_count: normalizationDimensions.length,
  warning_codes: warningCodes,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: ROUTE_ID,
    evidence: [
      { evidence_type: "source_artifact_manifest", path: ".ai/source-artifacts/source-artifact-manifest.yaml", producer_route: "collect_source_artifacts" },
      { evidence_type: "adapter_topology", path: ".ai/topologies/adapter-topology.yaml", producer_route: "compile_adapter_topology" },
      { evidence_type: "global_normalization_analysis", path: analysisOut, producer_route: ROUTE_ID },
    ],
    summary: {
      rollout_mode: "observe",
      enforcement_mode: enforcementMode,
      blocking_decision: blockingDecision,
      normalization_dimension_count: normalizationDimensions.length,
      policy_abstraction: "universal_normalization_dimensions",
      concrete_signals_are_policy: false,
      warning_count: warningCodes.length,
      error_count: errorCodes.length,
    },
  }),
});
