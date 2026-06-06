import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildUniversalValidationResult, extractValidationDecision, finish, findFiles, issue, readText, readYamlFile, rel, resolveConventionsRoot, writeYamlFile, type Issue, type JsonMap } from "./lib/common.js";

const SCRIPT_ID = "collect-evidence";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const MANIFEST_VERSION = "2.0";

type EvidenceEntry = {
  evidence_id: string;
  path: string;
  source_type: string;
  generated_by: string;
  status: string;
  artifact?: string;
  blocking?: boolean;
  validation_result?: JsonMap;
  score_decision?: JsonMap;
  revision_loop_analysis?: JsonMap;
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
  const status = validationDecision ? validationDecision.status : String(doc.status ?? doc.result ?? (Array.isArray(doc.errors) && doc.errors.length ? "fail" : "unknown"));
  const evidenceId = buildEvidenceId(relativePath);
  const priorPath = seenIds.get(evidenceId);
  if (priorPath && priorPath !== relativePath) {
    issues.push(issue("error", "EVIDENCE_ID_COLLISION", `Evidence id collision: ${evidenceId}`, relativePath, { prior_path: priorPath }));
  }
  seenIds.set(evidenceId, relativePath);
  const producerVerified = requireProducer(relativePath, generatedBy);

  entries.push({
    evidence_id: evidenceId,
    path: relativePath,
    source_type: sourceType,
    generated_by: generatedBy,
    status,
    artifact: typeof doc.artifact === "string" ? doc.artifact : undefined,
    content_sha256: sha256(file),
    manifest_entry_schema: "evidence_manifest_v2_entry",
    producer_verified: producerVerified,
    ...(scoreDecision ? { score_decision: scoreDecision, blocking: scoreDecision.blocking_decision } : {}),
    ...(revisionLoopAnalysis ? { revision_loop_analysis: revisionLoopAnalysis, blocking: revisionLoopAnalysis.blocking_decision } : {}),
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
