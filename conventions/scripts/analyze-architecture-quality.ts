import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  finish,
  issue,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "analyze-architecture-quality";
const ROUTE_ID = "analyze_architecture_quality";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const manifestPath = path.join(root, ".ai", "source-artifacts", "source-artifact-manifest.yaml");
const policyPath = path.join(root, ".ai", "policy", "mission-mode-policy.yaml");
const safeStructurePath = path.join(root, ".ai", "source-artifacts", "safe-structure-change-analysis.yaml");

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

interface DependencyEdge {
  from: string;
  to: string;
  edge_type?: string;
}

interface AdapterFileEvidence {
  path: string;
  line_count?: number;
  import_count?: number;
  export_count?: number;
  import_specifiers?: string[];
  symbol_hints?: JsonMap;
  evidence_flags?: JsonMap;
  decorators?: string[];
}

interface AdapterInput {
  adapter_id: string;
  adapter_kind: "language" | "framework";
  path: string;
  artifact: string;
  files: AdapterFileEvidence[];
  aggregate: JsonMap;
}

const optionalAdapterSources: Array<{ adapter_id: string; adapter_kind: "language" | "framework"; path: string; expected_artifact: string }> = [
  { adapter_id: "typescript", adapter_kind: "language", path: ".ai/source-artifacts/typescript-source-analysis.yaml", expected_artifact: "typescript_source_analysis" },
  { adapter_id: "nestjs", adapter_kind: "framework", path: ".ai/source-artifacts/nestjs-source-analysis.yaml", expected_artifact: "nestjs_source_analysis" },
];

function asManifestFiles(value: unknown): ManifestFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ManifestFile => Boolean(entry) && typeof entry === "object" && typeof (entry as ManifestFile).path === "string");
}

function asDependencyEdges(value: unknown): DependencyEdge[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is DependencyEdge => Boolean(entry) && typeof entry === "object" && typeof (entry as DependencyEdge).from === "string" && typeof (entry as DependencyEdge).to === "string");
}

function asAdapterFiles(value: unknown): AdapterFileEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AdapterFileEvidence => Boolean(entry) && typeof entry === "object" && typeof (entry as AdapterFileEvidence).path === "string");
}

function readOptionalYaml(filePath: string): JsonMap | undefined {
  return fs.existsSync(filePath) ? readYamlFile(filePath) : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function jsonMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function symbolCount(file: AdapterFileEvidence): number {
  const hints = file.symbol_hints ?? {};
  return numberValue(hints.class_count) + numberValue(hints.interface_count) + numberValue(hints.function_count) + numberValue(hints.enum_count) + numberValue(hints.type_alias_count);
}

function fileBase(filePath: string): string {
  return path.basename(filePath).replace(/\.(ts|tsx|js|jsx|py|java|go|cs|rb|php|yaml|yml|md|json)$/i, "").replace(/\.(service|controller|module|repository|provider|validator|adapter|contract)$/i, "");
}

function warnWhen(condition: boolean, code: string, message: string, file?: string, detail?: JsonMap): void {
  if (condition) issues.push(issue("warning", code, message, file, detail));
}

function loadAdapterInputs(): AdapterInput[] {
  const adapters: AdapterInput[] = [];
  for (const source of optionalAdapterSources) {
    const absolutePath = path.join(root, source.path);
    const data = readOptionalYaml(absolutePath);
    if (!data) continue;
    const artifact = typeof data.artifact === "string" ? data.artifact : "unknown_adapter_artifact";
    if (artifact !== source.expected_artifact) {
      issues.push(issue("warning", "ADAPTER_OUTPUT_UNEXPECTED_ARTIFACT", "Adapter output exists but does not match the registered adapter artifact shape.", source.path, { adapter_id: source.adapter_id, expected_artifact: source.expected_artifact, actual_artifact: artifact }));
      continue;
    }
    adapters.push({
      adapter_id: source.adapter_id,
      adapter_kind: source.adapter_kind,
      path: source.path,
      artifact,
      files: asAdapterFiles(data.files),
      aggregate: jsonMap(data.aggregate),
    });
  }
  return adapters;
}

if (!fs.existsSync(manifestPath)) {
  issues.push(issue("error", "SOURCE_ARTIFACT_MANIFEST_MISSING", "Architecture quality analysis requires .ai/source-artifacts/source-artifact-manifest.yaml. Run collect_source_artifacts first.", ".ai/source-artifacts/source-artifact-manifest.yaml"));
  finish(SCRIPT_ID, issues, [], {
    validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, { route_id: ROUTE_ID, evidence: [] }),
  });
}

const manifest = readYamlFile(manifestPath);
if (manifest.artifact !== "source_artifact_manifest" || !Array.isArray(manifest.files) || !Array.isArray(manifest.dependency_edges)) {
  issues.push(issue("error", "SOURCE_ARTIFACT_MANIFEST_INVALID", "Source artifact manifest has invalid shape for architecture quality analysis.", ".ai/source-artifacts/source-artifact-manifest.yaml"));
}

const policy = readOptionalYaml(policyPath);
const safeStructure = readOptionalYaml(safeStructurePath);
const adapterInputs = loadAdapterInputs();
const languageAdapters = adapterInputs.filter(adapter => adapter.adapter_kind === "language");
const frameworkAdapters = adapterInputs.filter(adapter => adapter.adapter_kind === "framework");

if (languageAdapters.length === 0) issues.push(issue("warning", "LANGUAGE_ADAPTER_EVIDENCE_MISSING", "Architecture quality analysis is adapter-neutral and can run without language adapter output, but language-specific evidence is limited.", ".ai/source-artifacts"));
if (frameworkAdapters.length === 0) issues.push(issue("warning", "FRAMEWORK_ADAPTER_EVIDENCE_MISSING", "Architecture quality analysis is adapter-neutral and can run without framework adapter output, but framework-specific evidence is limited.", ".ai/source-artifacts"));
if (!policy) issues.push(issue("warning", "MISSION_MODE_POLICY_MISSING", "Architecture quality analysis is using generic observe thresholds without mission-mode policy.", ".ai/policy/mission-mode-policy.yaml"));

const manifestFiles = asManifestFiles(manifest.files);
const dependencyEdges = asDependencyEdges(manifest.dependency_edges);
const adapterFiles = adapterInputs.flatMap(adapter => adapter.files.map(file => ({ ...file, adapter_id: adapter.adapter_id, adapter_kind: adapter.adapter_kind })));
const languageFiles = adapterFiles.filter(file => file.adapter_kind === "language");
const frameworkFiles = adapterFiles.filter(file => file.adapter_kind === "framework");

const longFiles = adapterFiles.filter(file => numberValue(file.line_count) >= 300).map(file => file.path);
const highSymbolFiles = adapterFiles.filter(file => symbolCount(file) >= 12).map(file => file.path);
const anyFiles = adapterFiles.filter(file => file.evidence_flags?.uses_any_keyword === true).map(file => file.path);
const unknownFiles = adapterFiles.filter(file => file.evidence_flags?.uses_unknown_keyword === true).map(file => file.path);
const todoFiles = adapterFiles.filter(file => file.evidence_flags?.has_todo_marker === true).map(file => file.path);
const envFiles = adapterFiles.filter(file => file.evidence_flags?.has_direct_process_env_access === true).map(file => file.path);
const loggerEvidenceFiles = adapterFiles.filter(file => {
  const imports = Array.isArray(file.import_specifiers) ? file.import_specifiers.join(" ").toLowerCase() : "";
  const name = file.path.toLowerCase();
  return imports.includes("logger") || name.includes("logger") || imports.includes("observability") || name.includes("telemetry");
}).map(file => file.path);

const duplicateNameGroups = new Map<string, string[]>();
for (const file of manifestFiles) {
  const base = fileBase(file.path);
  if (!base || base.length < 4) continue;
  const group = duplicateNameGroups.get(base) ?? [];
  group.push(file.path);
  duplicateNameGroups.set(base, group);
}
const duplicateLikeGroups = [...duplicateNameGroups.entries()].filter(([, group]) => group.length >= 3).map(([base, files]) => ({ base, files: files.slice(0, 20), file_count: files.length }));

const routeBackedFiles = manifestFiles.filter(file => file.script_id || (Array.isArray(file.route_ids) && file.route_ids.length > 0));
const yamlOwnedFiles = manifestFiles.filter(file => file.yaml_role || (Array.isArray(file.owned_concepts) && file.owned_concepts.length > 0));

const frameworkAggregate = frameworkAdapters.reduce<JsonMap>((summary, adapter) => {
  for (const [key, value] of Object.entries(adapter.aggregate)) {
    if (typeof value === "number") summary[key] = numberValue(summary[key]) + value;
  }
  return summary;
}, {});
const componentFileCount = numberValue(frameworkAggregate.controller_file_count) + numberValue(frameworkAggregate.injectable_file_count) + numberValue(frameworkAggregate.module_file_count);
const injectionEvidenceCount = numberValue(frameworkAggregate.constructor_injection_file_count);

warnWhen(longFiles.length > 0, "ARCH_LONG_FILE_RISK", "Some adapter-reported files are long enough to require SRP/decomposition review.", longFiles[0], { file_count: longFiles.length, sample_files: longFiles.slice(0, 10) });
warnWhen(highSymbolFiles.length > 0, "ARCH_MULTI_ROLE_FILE_RISK", "Some adapter-reported files expose many symbol hints and may need role-shape review.", highSymbolFiles[0], { file_count: highSymbolFiles.length, sample_files: highSymbolFiles.slice(0, 10) });
warnWhen(duplicateLikeGroups.length > 0, "ARCH_DUPLICATE_SHAPE_RISK", "Repeated file base names indicate possible duplicate/parallel abstractions to normalize.", undefined, { group_count: duplicateLikeGroups.length, sample_groups: duplicateLikeGroups.slice(0, 5) });
warnWhen(anyFiles.length > 0 || unknownFiles.length > 0, "ARCH_UNSAFE_TYPE_SIGNAL", "Language adapter evidence found unsafe or imprecise type signals requiring contract-integrity review.", undefined, { any_file_count: anyFiles.length, unknown_file_count: unknownFiles.length, sample_any_files: anyFiles.slice(0, 10), sample_unknown_files: unknownFiles.slice(0, 10) });
warnWhen(todoFiles.length > 0, "ARCH_TODO_SIGNAL", "Adapter evidence found TODO markers that must be tracked before enforcement.", undefined, { file_count: todoFiles.length, sample_files: todoFiles.slice(0, 10) });
warnWhen(envFiles.length > 0, "ARCH_DIRECT_CONFIG_ACCESS_SIGNAL", "Adapter evidence found direct configuration/environment access that should be reviewed for boundary integrity.", undefined, { file_count: envFiles.length, sample_files: envFiles.slice(0, 10) });
warnWhen(adapterFiles.length > 0 && loggerEvidenceFiles.length === 0, "ARCH_OBSERVABILITY_EVIDENCE_MISSING", "No logger/telemetry evidence was detected in available adapter outputs.", undefined, { analyzed_file_count: adapterFiles.length });
warnWhen(frameworkFiles.length > 0 && componentFileCount === 0, "ARCH_FRAMEWORK_COMPONENT_EVIDENCE_MISSING", "Framework adapter files were detected without framework component evidence.", undefined, { framework_file_count: frameworkFiles.length });
warnWhen(componentFileCount > 0 && injectionEvidenceCount === 0, "ARCH_FRAMEWORK_DEPENDENCY_EVIDENCE_MISSING", "Framework component evidence exists without dependency injection or equivalent wiring evidence.", undefined, { framework_component_file_count: componentFileCount });
warnWhen(safeStructure?.artifact === "safe_structure_change_analysis" && safeStructure.blocking_decision === true, "ARCH_SAFE_STRUCTURE_BLOCKING_SIGNAL", "Safe-structure analysis reports a blocking structural decision.", ".ai/source-artifacts/safe-structure-change-analysis.yaml");

const warningCodes = issues.filter(entry => entry.severity === "warning").map(entry => entry.code);
const errorCodes = issues.filter(entry => entry.severity === "error" || entry.severity === "critical").map(entry => entry.code);
const blockingDecision = false;

const aggregateNumber = (key: string): number => adapterInputs.reduce((total, adapter) => total + numberValue(adapter.aggregate[key]), 0);
const qualityDimensions = [
  { dimension: "role_shape_integrity", status: highSymbolFiles.length ? "observe_warning" : "observed", evidence_basis: "source_artifact_manifest_plus_optional_adapter_outputs", signals: { high_symbol_file_count: highSymbolFiles.length } },
  { dimension: "layer_boundary_integrity", status: dependencyEdges.length ? "observed" : "insufficient_evidence", evidence_basis: "dependency_edges_plus_optional_framework_outputs", signals: { dependency_edge_count: dependencyEdges.length, route_backed_file_count: routeBackedFiles.length, yaml_owned_file_count: yamlOwnedFiles.length } },
  { dimension: "duplication_and_normalization", status: duplicateLikeGroups.length ? "observe_warning" : "observed", evidence_basis: "source_artifact_manifest", signals: { duplicate_like_group_count: duplicateLikeGroups.length } },
  { dimension: "srp_and_file_shape", status: longFiles.length ? "observe_warning" : "observed", evidence_basis: "source_artifact_manifest_plus_optional_adapter_outputs", signals: { long_file_count: longFiles.length } },
  { dimension: "abstraction_economics", status: languageAdapters.length ? "observed" : "insufficient_evidence", evidence_basis: "optional_language_adapter_outputs", signals: { interface_count: aggregateNumber("interface_count"), type_alias_count: aggregateNumber("type_alias_count"), class_count: aggregateNumber("class_count") } },
  { dimension: "contract_integrity", status: anyFiles.length || unknownFiles.length || envFiles.length ? "observe_warning" : "observed", evidence_basis: "source_artifact_manifest_plus_optional_language_adapter_outputs", signals: { unsafe_type_file_count: anyFiles.length + unknownFiles.length, direct_config_access_file_count: envFiles.length } },
  { dimension: "unsafe_constructs_and_magic_values", status: anyFiles.length || todoFiles.length ? "observe_warning" : "observed", evidence_basis: "optional_language_adapter_outputs", signals: { unsafe_type_file_count: anyFiles.length + unknownFiles.length, todo_file_count: todoFiles.length } },
  { dimension: "observability_coverage", status: adapterFiles.length === 0 ? "insufficient_evidence" : loggerEvidenceFiles.length ? "observed" : "observe_warning", evidence_basis: "optional_language_and_framework_adapter_outputs", signals: { logger_evidence_file_count: loggerEvidenceFiles.length } },
];

const analysisOut = ".ai/source-artifacts/architecture-quality-analysis.yaml";
const reportOut = ".ai/reports/architecture-quality-report.yaml";
const evidenceInputs = {
  source_artifact_manifest: true,
  language_analysis_outputs: languageAdapters.map(adapter => ({ adapter_id: adapter.adapter_id, artifact: adapter.artifact, path: adapter.path, file_count: adapter.files.length })),
  framework_analysis_outputs: frameworkAdapters.map(adapter => ({ adapter_id: adapter.adapter_id, artifact: adapter.artifact, path: adapter.path, file_count: adapter.files.length })),
  mission_mode_policy: Boolean(policy),
  safe_structure_change_analysis: Boolean(safeStructure),
};
const analysis = {
  artifact: "architecture_quality_analysis",
  generated_by: SCRIPT_ID,
  rollout_mode: "observe",
  enforcement_mode: "observe",
  blocking_decision: blockingDecision,
  core_contract: {
    adapter_neutral: true,
    requires_specific_language_adapter: false,
    requires_specific_framework_adapter: false,
  },
  evidence_inputs: evidenceInputs,
  adapter_evidence_summary: {
    language_adapter_count: languageAdapters.length,
    framework_adapter_count: frameworkAdapters.length,
    language_file_count: languageFiles.length,
    framework_file_count: frameworkFiles.length,
  },
  source_summary: {
    source_file_count: manifestFiles.length,
    dependency_edge_count: dependencyEdges.length,
    adapter_reported_file_count: adapterFiles.length,
  },
  quality_dimensions: qualityDimensions,
  observations: {
    warning_codes: warningCodes,
    error_codes: errorCodes,
    long_files: longFiles.slice(0, 25),
    high_symbol_files: highSymbolFiles.slice(0, 25),
    duplicate_like_groups: duplicateLikeGroups.slice(0, 10),
    unsafe_type_files: { any_files: anyFiles.slice(0, 25), unknown_files: unknownFiles.slice(0, 25) },
    todo_files: todoFiles.slice(0, 25),
    direct_config_access_files: envFiles.slice(0, 25),
    logger_evidence_files: loggerEvidenceFiles.slice(0, 25),
  },
};

const report = {
  artifact: "architecture_quality_report",
  generated_by: SCRIPT_ID,
  status: errorCodes.length ? "fail" : warningCodes.length ? "pass_with_warnings" : "pass",
  summary: {
    rollout_mode: "observe",
    enforcement_mode: "observe",
    blocking_decision: blockingDecision,
    analyzed_file_count: manifestFiles.length,
    adapter_reported_file_count: adapterFiles.length,
    warning_count: warningCodes.length,
    error_count: errorCodes.length,
    quality_dimension_count: qualityDimensions.length,
    adapter_neutral_core: true,
  },
};

writeYamlFile(path.join(root, analysisOut), analysis);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [analysisOut, reportOut], {
  rollout_mode: "observe",
  enforcement_mode: "observe",
  warning_count: warningCodes.length,
  error_count: errorCodes.length,
  blocking_decision: blockingDecision,
  quality_dimension_count: qualityDimensions.length,
  adapter_neutral_core: true,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: ROUTE_ID,
    evidence: [
      { evidence_type: "source_artifact_manifest", path: ".ai/source-artifacts/source-artifact-manifest.yaml", producer_route: "collect_source_artifacts" },
      ...languageAdapters.map(adapter => ({ evidence_type: "language_adapter_analysis", adapter_id: adapter.adapter_id, path: adapter.path })),
      ...frameworkAdapters.map(adapter => ({ evidence_type: "framework_adapter_analysis", adapter_id: adapter.adapter_id, path: adapter.path })),
      { evidence_type: "architecture_quality_analysis", path: analysisOut, producer_route: ROUTE_ID },
    ],
    summary: { rollout_mode: "observe", warning_count: warningCodes.length, error_count: errorCodes.length, blocking_decision: blockingDecision, quality_dimension_count: qualityDimensions.length, adapter_neutral_core: true },
  }),
});
