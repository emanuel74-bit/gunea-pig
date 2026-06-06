import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  finish,
  issue,
  readExecutorRoutes,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "compile-adapter-topology";
const ROUTE_ID = "compile_adapter_topology";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

interface AdapterDeclaration {
  adapter_id: string;
  adapter_kind: "language" | "framework";
  convention_path: string;
  role: string;
  generated_by_script?: string;
  producer_route_id?: string;
  produced_artifact?: string;
  produced_report?: string;
  output_artifacts: Array<{ path: string; artifact_id: string; schema?: string; artifact_type?: string }>;
  required: boolean;
  rollout_mode?: string;
  enforcement?: string;
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function scriptBasename(scriptPath: unknown): string | undefined {
  if (typeof scriptPath !== "string") return undefined;
  return path.basename(scriptPath).replace(/\.ts$/, "");
}

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function findAnalysisContract(doc: JsonMap): JsonMap | undefined {
  const sections = asMap(doc.sections);
  for (const value of Object.values(sections)) {
    const section = asMap(value);
    if (typeof section.generated_by === "string" && typeof section.produced_artifact === "string") return section;
  }
  return undefined;
}

function adapterIdFromRoleOrName(role: string, fileName: string): string {
  const fromRole = role.replace(/_(language|framework)_adapter$/, "");
  if (fromRole && fromRole !== role) return fromRole;
  return fileName.replace(/^conventions\./, "").replace(/-adapter\.ya?ml$/, "").replace(/\.ya?ml$/, "");
}

function readRuntimeRegistry(): JsonMap[] {
  const registryPath = path.join(root, "reports", "conventions.runtime-artifacts.yaml");
  if (!fs.existsSync(registryPath)) return [];
  const doc = readYamlFile(registryPath);
  const registry = doc?.sections?.runtime_artifact_registry;
  return Array.isArray(registry) ? registry.filter((entry): entry is JsonMap => Boolean(entry) && typeof entry === "object") : [];
}

function routeForGeneratedBy(generatedBy: string | undefined): string | undefined {
  if (!generatedBy) return undefined;
  const routes = readExecutorRoutes(root);
  for (const [routeId, route] of routes.entries()) {
    if (scriptBasename(route.script) === generatedBy) return routeId;
  }
  return undefined;
}

function outputArtifactsForRoute(routeId: string | undefined): AdapterDeclaration["output_artifacts"] {
  if (!routeId) return [];
  return readRuntimeRegistry()
    .filter(entry => Array.isArray(entry.producer_routes) && (entry.producer_routes as unknown[]).includes(routeId))
    .filter(entry => typeof entry.path === "string" && !(entry.path as string).includes("**"))
    .map(entry => ({
      path: normalizeRel(String(entry.path)),
      artifact_id: String(entry.artifact_id ?? "unknown_artifact"),
      ...(typeof entry.schema === "string" ? { schema: entry.schema } : {}),
      ...(typeof entry.artifact_type === "string" ? { artifact_type: entry.artifact_type } : {}),
    }));
}

function collectAdapterDeclarations(): AdapterDeclaration[] {
  const adaptersDir = path.join(root, "adapters");
  if (!fs.existsSync(adaptersDir)) return [];
  const files = fs.readdirSync(adaptersDir)
    .filter(name => /^conventions\..*-adapter\.ya?ml$/.test(name))
    .map(name => path.join(adaptersDir, name))
    .sort();

  const declarations: AdapterDeclaration[] = [];
  for (const filePath of files) {
    const doc = readYamlFile(filePath);
    const role = typeof doc?.file?.role === "string" ? doc.file.role : "";
    const isLanguage = role.endsWith("_language_adapter");
    const isFramework = role.endsWith("_framework_adapter");
    if (!isLanguage && !isFramework) continue;

    const contract = findAnalysisContract(doc);
    const generatedBy = typeof contract?.generated_by === "string" ? contract.generated_by : undefined;
    const routeId = routeForGeneratedBy(generatedBy);
    const conventionPath = normalizeRel(path.relative(root, filePath));
    const adapterId = adapterIdFromRoleOrName(role, path.basename(filePath));

    if (!contract) issues.push(issue("warning", "ADAPTER_CONTRACT_METADATA_MISSING", "Adapter convention does not expose generated_by/produced_artifact metadata for topology compilation.", conventionPath));
    if (generatedBy && !routeId) issues.push(issue("warning", "ADAPTER_PRODUCER_ROUTE_MISSING", "Adapter generated_by script has no matching executor route.", conventionPath, { adapter_id: adapterId, generated_by: generatedBy }));

    declarations.push({
      adapter_id: adapterId,
      adapter_kind: isFramework ? "framework" : "language",
      convention_path: conventionPath,
      role,
      ...(generatedBy ? { generated_by_script: generatedBy } : {}),
      ...(routeId ? { producer_route_id: routeId } : {}),
      ...(typeof contract?.produced_artifact === "string" ? { produced_artifact: contract.produced_artifact } : {}),
      ...(typeof contract?.produced_report === "string" ? { produced_report: contract.produced_report } : {}),
      output_artifacts: outputArtifactsForRoute(routeId),
      required: false,
      rollout_mode: typeof doc?.sections?.rollout?.mode === "string" ? doc.sections.rollout.mode : "collect_only",
      enforcement: typeof doc?.sections?.rollout?.enforcement === "string" ? doc.sections.rollout.enforcement : "none",
    });
  }
  return declarations;
}

const adapters = collectAdapterDeclarations();
if (adapters.length === 0) {
  issues.push(issue("error", "ADAPTER_DECLARATIONS_MISSING", "No language/framework adapter declarations were found for adapter topology compilation.", "adapters/"));
}

for (const adapter of adapters) {
  if (!adapter.producer_route_id) issues.push(issue("warning", "ADAPTER_TOPOLOGY_ROUTE_UNRESOLVED", "Adapter topology entry has no producer route and will only be informational.", adapter.convention_path, { adapter_id: adapter.adapter_id }));
  if (adapter.output_artifacts.length === 0) issues.push(issue("warning", "ADAPTER_TOPOLOGY_OUTPUTS_UNRESOLVED", "Adapter topology entry has no route-produced runtime artifacts registered.", adapter.convention_path, { adapter_id: adapter.adapter_id, producer_route_id: adapter.producer_route_id }));
}

const topologyOut = ".ai/topologies/adapter-topology.yaml";
const reportOut = ".ai/reports/adapter-topology-report.yaml";
const languageAdapters = adapters.filter(adapter => adapter.adapter_kind === "language");
const frameworkAdapters = adapters.filter(adapter => adapter.adapter_kind === "framework");
const topology = {
  artifact: "adapter_topology",
  generated_by: SCRIPT_ID,
  topology_schema_version: "1.0",
  source_of_truth: "adapter_convention_files_plus_executor_routes_plus_runtime_artifact_registry",
  core_contract: {
    adapter_neutral: true,
    hardcoded_adapter_discovery_allowed: false,
    adapters_are_optional_evidence_providers: true,
  },
  adapter_counts: {
    total: adapters.length,
    language: languageAdapters.length,
    framework: frameworkAdapters.length,
  },
  adapters,
};
const report = {
  artifact: "adapter_topology_report",
  generated_by: SCRIPT_ID,
  status: issues.some(entry => entry.severity === "error" || entry.severity === "critical") ? "fail" : issues.some(entry => entry.severity === "warning") ? "pass_with_warnings" : "pass",
  summary: {
    adapter_count: adapters.length,
    language_adapter_count: languageAdapters.length,
    framework_adapter_count: frameworkAdapters.length,
    warning_count: issues.filter(entry => entry.severity === "warning").length,
    error_count: issues.filter(entry => entry.severity === "error" || entry.severity === "critical").length,
  },
};

writeYamlFile(path.join(root, topologyOut), topology);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [topologyOut, reportOut], {
  adapter_count: adapters.length,
  language_adapter_count: languageAdapters.length,
  framework_adapter_count: frameworkAdapters.length,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: ROUTE_ID,
    evidence: [
      { evidence_type: "adapter_topology", path: topologyOut, producer_route: ROUTE_ID },
      ...adapters.map(adapter => ({ evidence_type: "adapter_declaration", adapter_id: adapter.adapter_id, adapter_kind: adapter.adapter_kind, path: adapter.convention_path, producer_route: adapter.producer_route_id })),
    ],
    summary: { adapter_count: adapters.length, language_adapter_count: languageAdapters.length, framework_adapter_count: frameworkAdapters.length },
  }),
});
