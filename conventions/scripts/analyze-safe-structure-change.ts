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

const SCRIPT_ID = "analyze-safe-structure-change";
const ROUTE_ID = "analyze_safe_structure_change";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const manifestPath = path.join(root, ".ai", "source-artifacts", "source-artifact-manifest.yaml");

const allowedChangeKinds = new Set(["inventory_review", "deletion", "consolidation", "decomposition"]);
const changeKind = getArg("change-kind") ?? "inventory_review";
const candidateFile = normalizeCandidate(getArg("candidate-file"));
const targetFile = normalizeCandidate(getArg("target-file"));
const behaviorEvidence = getArg("behavior-evidence");
const consumerUpdatePlan = getArg("consumer-update-plan");
const routeMigrationEvidence = getArg("route-migration-evidence");
const ownershipTransferEvidence = getArg("ownership-transfer-evidence");
const enforcementMode = getArg("enforcement-mode") ?? "controlled_enforce";
const allowedEnforcementModes = new Set(["observe", "controlled_enforce"]);

interface SourceFileRecord {
  path: string;
  artifact_kind?: string;
  script_id?: string;
  route_ids?: string[];
  owned_concepts?: string[];
  yaml_role?: string;
}

interface SourceDependencyEdge {
  from: string;
  to: string;
  edge_type: string;
}

function normalizeCandidate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^conventions\//, "conventions/");
}

function asFiles(value: unknown): SourceFileRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SourceFileRecord => Boolean(entry) && typeof entry === "object" && typeof (entry as SourceFileRecord).path === "string");
}

function asEdges(value: unknown): SourceDependencyEdge[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SourceDependencyEdge => Boolean(entry) && typeof entry === "object" && typeof (entry as SourceDependencyEdge).from === "string" && typeof (entry as SourceDependencyEdge).to === "string" && typeof (entry as SourceDependencyEdge).edge_type === "string");
}

function pathMatches(edgeTarget: string, filePath: string): boolean {
  const normalizedTarget = edgeTarget.replace(/\\/g, "/");
  const normalizedFile = filePath.replace(/\\/g, "/");
  return normalizedTarget === normalizedFile || normalizedTarget === normalizedFile.replace(/^conventions\//, "") || `conventions/${normalizedTarget}` === normalizedFile;
}

if (!fs.existsSync(manifestPath)) {
  issues.push(issue("error", "SOURCE_ARTIFACT_MANIFEST_MISSING", "Safe structure change analysis requires .ai/source-artifacts/source-artifact-manifest.yaml. Run collect_source_artifacts first.", ".ai/source-artifacts/source-artifact-manifest.yaml"));
  finish(SCRIPT_ID, issues, [], {
    validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
      route_id: ROUTE_ID,
      evidence: [],
      summary: { requested_change_kind: changeKind },
    }),
  });
}

if (!allowedChangeKinds.has(changeKind)) {
  issues.push(issue("error", "UNKNOWN_STRUCTURE_CHANGE_KIND", `Unknown structure change kind: ${changeKind}.`, undefined, { allowed_change_kinds: [...allowedChangeKinds].sort() }));
}
if (!allowedEnforcementModes.has(enforcementMode)) {
  issues.push(issue("error", "UNKNOWN_SAFE_STRUCTURE_ENFORCEMENT_MODE", `Unknown safe-structure enforcement mode: ${enforcementMode}.`, undefined, { allowed_enforcement_modes: [...allowedEnforcementModes].sort() }));
}

const enforcementActive = enforcementMode === "controlled_enforce";
function safetySeverity(shouldBlock: boolean): "warning" | "error" {
  return enforcementActive && shouldBlock ? "error" : "warning";
}

const manifest = readYamlFile(manifestPath);
if (manifest.artifact !== "source_artifact_manifest" || !Array.isArray(manifest.files) || !Array.isArray(manifest.dependency_edges)) {
  issues.push(issue("error", "SOURCE_ARTIFACT_MANIFEST_INVALID", "Source artifact manifest has invalid shape for safe structure change analysis.", ".ai/source-artifacts/source-artifact-manifest.yaml"));
}

const files = asFiles(manifest.files);
const edges = asEdges(manifest.dependency_edges);
const candidateRecord = candidateFile ? files.find(file => file.path === candidateFile) : undefined;
const targetRecord = targetFile ? files.find(file => file.path === targetFile) : undefined;
const inboundEdges = candidateFile ? edges.filter(edge => pathMatches(edge.to, candidateFile)) : [];
const outboundEdges = candidateFile ? edges.filter(edge => pathMatches(edge.from, candidateFile)) : [];

if (candidateFile && !candidateRecord) {
  const destructiveChange = ["deletion", "consolidation", "decomposition"].includes(changeKind);
  issues.push(issue(safetySeverity(destructiveChange), "CANDIDATE_FILE_NOT_IN_SOURCE_MANIFEST", `Candidate file is not present in source artifact manifest: ${candidateFile}`, candidateFile));
}
if ((changeKind === "deletion" || changeKind === "decomposition") && !candidateFile) {
  issues.push(issue(safetySeverity(true), "CANDIDATE_FILE_REQUIRED_FOR_STRUCTURE_CHANGE", `${changeKind} analysis should include --candidate-file.`, undefined, { change_kind: changeKind }));
}
if (changeKind === "consolidation" && !targetFile) {
  issues.push(issue(safetySeverity(true), "TARGET_FILE_REQUIRED_FOR_CONSOLIDATION", "Consolidation analysis should include --target-file.", undefined, { change_kind: changeKind }));
}
if (targetFile && !targetRecord) {
  const requiresExistingTarget = changeKind === "consolidation";
  issues.push(issue(safetySeverity(requiresExistingTarget), "TARGET_FILE_NOT_IN_SOURCE_MANIFEST", `Target file is not present in source artifact manifest: ${targetFile}`, targetFile));
}
if (candidateRecord && (candidateRecord.script_id || (candidateRecord.route_ids?.length ?? 0) > 0) && !routeMigrationEvidence) {
  issues.push(issue(safetySeverity(["deletion", "consolidation"].includes(changeKind)), "ROUTE_BACKED_OR_ROUTE_DECLARING_CANDIDATE", "Candidate is route-backed or declares executor routes; structural changes require route migration evidence.", candidateFile, { script_id: candidateRecord.script_id, route_ids: candidateRecord.route_ids ?? [] }));
}
if (candidateRecord && ((candidateRecord.owned_concepts?.length ?? 0) > 0 || candidateRecord.yaml_role) && !ownershipTransferEvidence) {
  issues.push(issue(safetySeverity(["deletion", "consolidation"].includes(changeKind)), "CONVENTION_OWNED_CANDIDATE", "Candidate declares convention ownership metadata; structural changes require ownership transfer evidence.", candidateFile, { yaml_role: candidateRecord.yaml_role, owned_concepts: candidateRecord.owned_concepts ?? [] }));
}
if (inboundEdges.length > 0) {
  issues.push(issue(safetySeverity(["deletion", "consolidation"].includes(changeKind) && !consumerUpdatePlan), "INBOUND_DEPENDENCIES_PRESENT", "Candidate has inbound dependency edges; safe deletion/consolidation requires consumer update evidence.", candidateFile, { inbound_dependency_count: inboundEdges.length, inbound_edges: inboundEdges.slice(0, 20) }));
}
if (["deletion", "consolidation", "decomposition"].includes(changeKind) && !behaviorEvidence) {
  issues.push(issue(safetySeverity(true), "BEHAVIOR_PRESERVATION_EVIDENCE_MISSING", "Structure change is not proven behavior-preserving without explicit behavior evidence.", candidateFile));
}
if (["deletion", "consolidation"].includes(changeKind) && inboundEdges.length > 0 && !consumerUpdatePlan) {
  issues.push(issue(safetySeverity(true), "CONSUMER_UPDATE_PLAN_MISSING", "Inbound dependencies require a consumer update plan before enforcement can approve the change.", candidateFile));
}

const warningCodes = issues.filter(entry => entry.severity === "warning").map(entry => entry.code);
const errorCodes = issues.filter(entry => entry.severity === "error" || entry.severity === "critical").map(entry => entry.code);
const blockingDecision = errorCodes.length > 0;

const analysis = {
  artifact: "safe_structure_change_analysis",
  generated_by: SCRIPT_ID,
  rollout_mode: enforcementActive ? "controlled_enforce" : "observe",
  enforcement_mode: enforcementMode,
  requested_change: {
    change_kind: changeKind,
    candidate_file: candidateFile ?? null,
    target_file: targetFile ?? null,
    behavior_evidence_provided: Boolean(behaviorEvidence),
    consumer_update_plan_provided: Boolean(consumerUpdatePlan),
    route_migration_evidence_provided: Boolean(routeMigrationEvidence),
    ownership_transfer_evidence_provided: Boolean(ownershipTransferEvidence),
  },
  source_manifest_summary: {
    source_file_count: files.length,
    dependency_edge_count: edges.length,
    source_manifest_path: ".ai/source-artifacts/source-artifact-manifest.yaml",
  },
  safety_observations: {
    candidate_found: Boolean(candidateRecord),
    target_found: targetFile ? Boolean(targetRecord) : null,
    candidate_artifact_kind: candidateRecord?.artifact_kind ?? null,
    candidate_script_id: candidateRecord?.script_id ?? null,
    candidate_route_ids: candidateRecord?.route_ids ?? [],
    candidate_owned_concepts: candidateRecord?.owned_concepts ?? [],
    inbound_dependency_count: inboundEdges.length,
    outbound_dependency_count: outboundEdges.length,
    warning_codes: warningCodes,
    error_codes: errorCodes,
  },
  inbound_dependencies: inboundEdges,
  outbound_dependencies: outboundEdges,
  blocking_decision: blockingDecision,
};

const report = {
  artifact: "safe_structure_change_report",
  generated_by: SCRIPT_ID,
  status: blockingDecision ? "fail" : warningCodes.length ? "pass_with_warnings" : "pass",
  summary: {
    change_kind: changeKind,
    candidate_file: candidateFile ?? null,
    target_file: targetFile ?? null,
    warning_count: warningCodes.length,
    error_count: errorCodes.length,
    blocking_decision: blockingDecision,
    rollout_mode: enforcementActive ? "controlled_enforce" : "observe",
    enforcement_mode: enforcementMode,
  },
};

const analysisOut = ".ai/source-artifacts/safe-structure-change-analysis.yaml";
const reportOut = ".ai/reports/safe-structure-change-report.yaml";
writeYamlFile(path.join(root, analysisOut), analysis);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [analysisOut, reportOut], {
  change_kind: changeKind,
  candidate_file: candidateFile ?? null,
  warning_count: warningCodes.length,
  blocking_decision: blockingDecision,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: ROUTE_ID,
    evidence: [
      { evidence_type: "source_artifact_manifest", path: ".ai/source-artifacts/source-artifact-manifest.yaml", producer_route: "collect_source_artifacts" },
      { evidence_type: "safe_structure_change_analysis", path: analysisOut, producer_route: ROUTE_ID },
    ],
    summary: { change_kind: changeKind, candidate_file: candidateFile ?? null, warning_count: warningCodes.length, error_count: errorCodes.length, blocking_decision: blockingDecision, enforcement_mode: enforcementMode },
  }),
});
