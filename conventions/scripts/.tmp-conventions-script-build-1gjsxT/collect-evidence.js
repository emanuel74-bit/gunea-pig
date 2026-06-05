import fs from "node:fs";
import path from "node:path";
import { finish, findFiles, readYamlFile, rel, resolveConventionsRoot, writeYamlFile } from "./lib/common.js";
const SCRIPT_ID = "collect-evidence";
const root = resolveConventionsRoot();
const issues = [];
const sourceDirs = {
    validation: ".ai/validation",
    gate: ".ai/gates",
    handoff: ".ai/handoffs",
    revision: ".ai/revisions",
    bundle: ".ai/bundles",
    topology: ".ai/topologies",
    report: ".ai/reports",
};
function classify(relativePath) {
    for (const [type, dir] of Object.entries(sourceDirs)) {
        if (relativePath.startsWith(`${dir}/`))
            return type;
    }
    return "unknown";
}
function safeReadYaml(filePath) {
    try {
        return readYamlFile(filePath);
    }
    catch {
        return {};
    }
}
const aiRoot = path.join(root, ".ai");
const files = fs.existsSync(aiRoot)
    ? findFiles(aiRoot, file => file.endsWith(".yaml") || file.endsWith(".yml"))
    : [];
const entries = [];
for (const file of files) {
    const relativePath = rel(root, file);
    if (relativePath === ".ai/reports/evidence-index.yaml" || relativePath === ".ai/reports/evidence-collection-report.yaml")
        continue;
    const doc = safeReadYaml(file);
    const generatedBy = String(doc.generated_by ?? doc.script_id ?? doc.summary?.generated_by ?? "unknown");
    const status = String(doc.status ?? doc.result ?? (Array.isArray(doc.errors) && doc.errors.length ? "fail" : "unknown"));
    const evidenceId = relativePath.replace(/^\.ai\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    entries.push({
        evidence_id: evidenceId || path.basename(file),
        path: relativePath,
        source_type: classify(relativePath),
        generated_by: generatedBy,
        status,
        artifact: typeof doc.artifact === "string" ? doc.artifact : undefined,
    });
}
const counts = entries.reduce((acc, entry) => {
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
