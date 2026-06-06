import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  findFiles,
  finish,
  getArg,
  issue,
  readYamlFile,
  rel,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "analyze-revision-loop";
const ROUTE_ID = "analyze_revision_loop";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const missionId = getArg("mission-id") ?? getArg("mission_id") ?? null;
const revisionTaskArg = getArg("revision-task") ?? getArg("revision_task");
const failureResultArg = getArg("failure-result") ?? getArg("failure_result");
const explicitFingerprint = getArg("failure-fingerprint") ?? getArg("failure_fingerprint");
const observeRetryBudgetRaw = getArg("observe-retry-budget") ?? getArg("observe_retry_budget") ?? "3";
const observeRetryBudget = Number(observeRetryBudgetRaw);

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function readOptionalYaml(relativePath: string | undefined): JsonMap | undefined {
  if (!relativePath) return undefined;
  const full = relativePath.startsWith("/") ? relativePath : path.join(root, relativePath);
  if (!fs.existsSync(full)) return undefined;
  return readYamlFile(full);
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: any): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function fingerprintFromFailureResult(doc: JsonMap | undefined): string | null {
  if (!doc) return null;
  const errors = asArray(doc.errors).map(entry => asRecord(entry).code).filter(Boolean).sort();
  const warnings = asArray(doc.warnings).map(entry => asRecord(entry).code).filter(Boolean).sort();
  const summaryValidation = asRecord(asRecord(doc.summary).validation_result);
  const payload = {
    script_id: doc.script_id ?? summaryValidation.source_script_id ?? null,
    status: doc.status ?? summaryValidation.status ?? null,
    errors,
    warnings,
    validation_id: summaryValidation.validation_id ?? null,
    blocking: summaryValidation.blocking ?? null,
  };
  return hash(payload).slice(0, 16);
}

function fingerprintFromRevisionTask(task: JsonMap | undefined): string | null {
  if (!task) return null;
  if (typeof task.failure_fingerprint === "string" && task.failure_fingerprint.trim()) return task.failure_fingerprint.trim();
  const summary = asRecord(task.failure_summary);
  const payload = {
    failure: task.failure ?? null,
    failure_result: task.failure_result ?? null,
    status: summary.status ?? null,
    script_id: summary.script_id ?? null,
    errors: asArray(summary.errors).sort(),
  };
  return hash(payload).slice(0, 16);
}

function readRevisionTasks(): JsonMap[] {
  const revisionRoot = path.join(root, ".ai", "revisions");
  if (!fs.existsSync(revisionRoot)) return [];
  return findFiles(revisionRoot, file => file.endsWith(".yaml") || file.endsWith(".yml"))
    .map(file => {
      try {
        const doc = readYamlFile(file);
        return { ...doc, __path: rel(root, file) };
      } catch {
        return { artifact: "unreadable_revision_artifact", __path: rel(root, file) };
      }
    })
    .filter(doc => doc.artifact === "revision_task");
}

if (Number.isNaN(observeRetryBudget) || observeRetryBudget < 1) {
  issues.push(issue("error", "REVISION_RETRY_BUDGET_INVALID", "observe retry budget must be a positive number."));
}

const revisionTask = readOptionalYaml(revisionTaskArg);
if (revisionTaskArg && !revisionTask) {
  issues.push(issue("error", "REVISION_TASK_MISSING", "Revision loop analysis revision task input does not exist.", revisionTaskArg));
}

const failureResult = readOptionalYaml(failureResultArg ?? (typeof revisionTask?.failure_result === "string" ? revisionTask.failure_result : undefined));
if ((failureResultArg || revisionTask?.failure_result) && !failureResult) {
  issues.push(issue("error", "REVISION_FAILURE_RESULT_MISSING", "Revision loop analysis failure result input does not exist.", failureResultArg ?? revisionTask?.failure_result));
}

const activeFingerprint = explicitFingerprint
  ?? fingerprintFromRevisionTask(revisionTask)
  ?? fingerprintFromFailureResult(failureResult)
  ?? null;

if (!activeFingerprint) {
  issues.push(issue("warning", "REVISION_FAILURE_FINGERPRINT_MISSING", "No revision task, failure result, or explicit fingerprint was available; emitting baseline observe-mode analysis."));
}

const tasks = readRevisionTasks().map(task => ({
  path: String(task.__path),
  revision_id: typeof task.revision_id === "string" ? task.revision_id : path.basename(String(task.__path), ".yaml"),
  status: typeof task.status === "string" ? task.status : "unknown",
  failure_fingerprint: fingerprintFromRevisionTask(task),
  failure_result: typeof task.failure_result === "string" ? task.failure_result : null,
  required_action: typeof task.required_action === "string" ? task.required_action : null,
}));

const fingerprintCounts = new Map<string, number>();
for (const task of tasks) {
  if (!task.failure_fingerprint) continue;
  fingerprintCounts.set(task.failure_fingerprint, (fingerprintCounts.get(task.failure_fingerprint) ?? 0) + 1);
}

const activeFingerprintCount = activeFingerprint ? fingerprintCounts.get(activeFingerprint) ?? 0 : 0;
const repeatedFingerprints = [...fingerprintCounts.entries()]
  .filter(([, count]) => count > 1)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([fingerprint, count]) => ({ fingerprint, count }));

if (activeFingerprint && activeFingerprintCount > 1) {
  issues.push(issue("warning", "REVISION_FAILURE_FINGERPRINT_REPEATED", "The active failure fingerprint appears in more than one revision task; observe potential retry loop.", undefined, { fingerprint: activeFingerprint, count: activeFingerprintCount }));
}
if (activeFingerprint && activeFingerprintCount >= observeRetryBudget) {
  issues.push(issue("warning", "REVISION_RETRY_BUDGET_OBSERVED", "The active failure fingerprint has reached or exceeded the observe retry budget; no blocking is applied in observe mode.", undefined, { fingerprint: activeFingerprint, count: activeFingerprintCount, observe_retry_budget: observeRetryBudget }));
}

const noProgressSuspected = Boolean(activeFingerprint && activeFingerprintCount >= observeRetryBudget);
const analysisOut = ".ai/revisions/revision-loop-analysis.yaml";
const reportOut = ".ai/reports/revision-loop-analysis-report.yaml";
const validationOut = ".ai/validation/analyze-revision-loop.result.yaml";

const analysis = {
  artifact: "revision_loop_analysis",
  generated_by: SCRIPT_ID,
  rollout_mode: "observe",
  enforcement: "disabled",
  mission_id: missionId,
  active_failure_fingerprint: activeFingerprint,
  observe_retry_budget: observeRetryBudget,
  active_fingerprint_count: activeFingerprintCount,
  repeated_fingerprints: repeatedFingerprints,
  no_progress_suspected: noProgressSuspected,
  blocking_decision: false,
  revision_task_count: tasks.length,
  revision_tasks: tasks,
  warnings: issues.filter(entry => entry.severity === "warning").map(entry => entry.code).sort(),
};

const report = {
  artifact: "revision_loop_analysis_report",
  generated_by: SCRIPT_ID,
  status: issues.some(entry => entry.severity === "error" || entry.severity === "critical") ? "fail" : "pass",
  summary: {
    rollout_mode: analysis.rollout_mode,
    enforcement: analysis.enforcement,
    mission_id: analysis.mission_id,
    active_failure_fingerprint: analysis.active_failure_fingerprint,
    active_fingerprint_count: analysis.active_fingerprint_count,
    observe_retry_budget: analysis.observe_retry_budget,
    repeated_fingerprint_count: repeatedFingerprints.length,
    no_progress_suspected: analysis.no_progress_suspected,
    blocking_decision: analysis.blocking_decision,
  },
};

writeYamlFile(path.join(root, analysisOut), analysis);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [analysisOut, reportOut, validationOut], {
  mission_id: missionId,
  rollout_mode: analysis.rollout_mode,
  enforcement: analysis.enforcement,
  active_failure_fingerprint: activeFingerprint,
  active_fingerprint_count: activeFingerprintCount,
  repeated_fingerprint_count: repeatedFingerprints.length,
  no_progress_suspected: noProgressSuspected,
  blocking_decision: false,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: ROUTE_ID,
    mission_id: missionId ?? undefined,
    evidence: [
      { evidence_type: "revision_loop_analysis", path: analysisOut, producer_route: ROUTE_ID },
      { evidence_type: "revision_loop_analysis_report", path: reportOut, producer_route: ROUTE_ID },
    ],
    summary: {
      active_failure_fingerprint: activeFingerprint,
      active_fingerprint_count: activeFingerprintCount,
      repeated_fingerprint_count: repeatedFingerprints.length,
      no_progress_suspected: noProgressSuspected,
      blocking_decision: false,
    },
  }),
});
