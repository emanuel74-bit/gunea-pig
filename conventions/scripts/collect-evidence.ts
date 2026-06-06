import fs from "node:fs";
import path from "node:path";
import { extractValidationDecision, finish, findFiles, readYamlFile, rel, resolveConventionsRoot, writeYamlFile, type Issue, type JsonMap } from "./lib/common.js";

const SCRIPT_ID = "collect-evidence";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

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
};

function classify(relativePath: string): string {
  for (const [type, dir] of Object.entries(sourceDirs)) {
    if (relativePath.startsWith(`${dir}/`)) return type;
  }
  return "unknown";
}

function safeReadYaml(filePath: string): any {
  try {
    return readYamlFile(filePath);
  } catch {
    return {};
  }
}

const aiRoot = path.join(root, ".ai");
const files = fs.existsSync(aiRoot)
  ? findFiles(aiRoot, file => file.endsWith(".yaml") || file.endsWith(".yml"))
  : [];

const entries: EvidenceEntry[] = [];
for (const file of files) {
  const relativePath = rel(root, file);
  if (relativePath === ".ai/reports/evidence-index.yaml" || relativePath === ".ai/reports/evidence-collection-report.yaml") continue;
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
  const status = validationDecision ? validationDecision.status : String(doc.status ?? doc.result ?? (Array.isArray(doc.errors) && doc.errors.length ? "fail" : "unknown"));
  const evidenceId = relativePath.replace(/^\.ai\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  entries.push({
    evidence_id: evidenceId || path.basename(file),
    path: relativePath,
    source_type: sourceType,
    generated_by: generatedBy,
    status,
    artifact: typeof doc.artifact === "string" ? doc.artifact : undefined,
    ...(scoreDecision ? { score_decision: scoreDecision, blocking: scoreDecision.blocking_decision } : {}),
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

const evidenceIndex = {
  artifact: "evidence_index",
  generated_by: SCRIPT_ID,
  status: "collected",
  evidence_count: entries.length,
  evidence_counts_by_type: counts,
  required_source_types: ["validation", "gate", "handoff", "revision", "report"],
  entries,
};

const collectionReport = {
  artifact: "evidence_collection_report",
  generated_by: SCRIPT_ID,
  status: "pass",
  summary: {
    evidence_count: entries.length,
    evidence_counts_by_type: counts,
  },
  missing_source_types: Object.keys(sourceDirs).filter(type => !counts[type] && ["validation", "gate", "handoff", "revision", "report"].includes(type)),
};

writeYamlFile(path.join(root, ".ai", "reports", "evidence-index.yaml"), evidenceIndex);
writeYamlFile(path.join(root, ".ai", "reports", "evidence-collection-report.yaml"), collectionReport);

finish(SCRIPT_ID, issues, [".ai/reports/evidence-index.yaml", ".ai/reports/evidence-collection-report.yaml"], {
  evidence_count: entries.length,
  evidence_counts_by_type: counts,
});
