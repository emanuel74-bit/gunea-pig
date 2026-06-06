import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  buildUniversalValidationResult,
  ensureDir,
  extractValidationDecision,
  findFiles,
  finish,
  issue,
  readExecutorRoutes,
  readText,
  readYamlFile,
  rel,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "collect-runtime-telemetry";
const ROUTE_ID = "collect_runtime_telemetry";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const observedAt = new Date().toISOString();

interface TelemetryEvent {
  event_id: string;
  event_type: "mission_event_observed" | "validation_result_observed" | "evidence_manifest_observed" | "context_load_trace_observed" | "report_artifact_observed" | "runtime_artifact_observed";
  source_type: string;
  source_path: string;
  observed_at: string;
  route_id: string | null;
  script_id: string | null;
  status: string;
  blocking: boolean;
  severity: string;
  detail?: JsonMap;
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function eventId(parts: unknown[]): string {
  return sha256Text(parts.map(part => String(part ?? "")).join("|")).slice(0, 24);
}

function routeIdFromScriptId(scriptId: string | null): string | null {
  if (!scriptId) return null;
  const candidate = scriptId.replace(/-/g, "_");
  return readExecutorRoutes(root).has(candidate) ? candidate : null;
}

function safeReadYaml(filePath: string): JsonMap | undefined {
  try {
    return readYamlFile(filePath);
  } catch (error) {
    issues.push(issue("warning", "TELEMETRY_SOURCE_YAML_UNREADABLE", "Telemetry source YAML could not be parsed and was skipped.", rel(root, filePath), { error: String(error) }));
    return undefined;
  }
}

function pushEvent(events: TelemetryEvent[], event: Omit<TelemetryEvent, "event_id" | "observed_at">): void {
  events.push({
    ...event,
    event_id: eventId([event.event_type, event.source_path, event.route_id, event.script_id, event.status, events.length]),
    observed_at: observedAt,
  });
}

function collectMissionJournalEvents(events: TelemetryEvent[]): void {
  const missionsRoot = path.join(root, ".ai", "missions");
  if (!fs.existsSync(missionsRoot)) return;
  const journals = findFiles(missionsRoot, file => path.basename(file) === "mission-journal.ndjson");
  for (const journal of journals) {
    const sourcePath = rel(root, journal);
    const lines = readText(journal).split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      try {
        const parsed = JSON.parse(line) as JsonMap;
        const eventType = typeof parsed.event_type === "string" ? parsed.event_type : "mission_journal_event";
        const routeId = typeof parsed.route_id === "string" ? parsed.route_id : null;
        pushEvent(events, {
          event_type: "mission_event_observed",
          source_type: "mission_journal",
          source_path: sourcePath,
          route_id: routeId,
          script_id: routeId ? routeId.replace(/_/g, "-") : null,
          status: "observed",
          blocking: false,
          severity: "info",
          detail: { event_sequence: index + 1, mission_event_type: eventType, mission_id: parsed.mission_id ?? null, phase: parsed.observed_next_phase ?? parsed.current_phase ?? null },
        });
      } catch (error) {
        issues.push(issue("warning", "TELEMETRY_MISSION_JOURNAL_LINE_UNREADABLE", "Mission journal line could not be parsed for telemetry.", sourcePath, { line: index + 1, error: String(error) }));
      }
    });
  }
}

function collectValidationEvents(events: TelemetryEvent[]): void {
  const validationRoot = path.join(root, ".ai", "validation");
  if (!fs.existsSync(validationRoot)) return;
  const files = findFiles(validationRoot, file => file.endsWith(".yaml") || file.endsWith(".yml"));
  for (const file of files) {
    const doc = safeReadYaml(file);
    if (!doc) continue;
    const sourcePath = rel(root, file);
    const scriptId = typeof doc.script_id === "string" ? doc.script_id : typeof doc.summary?.validation_result?.source_script_id === "string" ? doc.summary.validation_result.source_script_id : null;
    const decision = extractValidationDecision(doc);
    pushEvent(events, {
      event_type: "validation_result_observed",
      source_type: "validation_result",
      source_path: sourcePath,
      route_id: typeof doc.summary?.validation_result?.route_id === "string" ? doc.summary.validation_result.route_id : routeIdFromScriptId(scriptId),
      script_id: scriptId,
      status: decision.status,
      blocking: decision.blocking,
      severity: typeof decision.severity === "string" ? decision.severity : "info",
      detail: { validation_id: decision.validation_id ?? scriptId, source_shape: decision.source_shape },
    });
  }
}

function collectEvidenceManifestEvents(events: TelemetryEvent[]): void {
  const manifestPath = path.join(root, ".ai", "reports", "evidence-manifest.yaml");
  if (!fs.existsSync(manifestPath)) return;
  const doc = safeReadYaml(manifestPath);
  if (!doc) return;
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  pushEvent(events, {
    event_type: "evidence_manifest_observed",
    source_type: "evidence_manifest",
    source_path: ".ai/reports/evidence-manifest.yaml",
    route_id: "collect_evidence",
    script_id: "collect-evidence",
    status: typeof doc.status === "string" ? doc.status : "observed",
    blocking: false,
    severity: "info",
    detail: { evidence_count: entries.length, schema_version: doc.schema_version ?? null },
  });
}

function collectContextTraceEvents(events: TelemetryEvent[]): void {
  const tracePath = path.join(root, ".ai", "context", "context-load-trace.yaml");
  if (!fs.existsSync(tracePath)) return;
  const doc = safeReadYaml(tracePath);
  if (!doc) return;
  const trace = Array.isArray(doc.trace) ? doc.trace : [];
  pushEvent(events, {
    event_type: "context_load_trace_observed",
    source_type: "context_trace",
    source_path: ".ai/context/context-load-trace.yaml",
    route_id: "compile_context_bundle",
    script_id: "compile-context-bundle",
    status: "observed",
    blocking: false,
    severity: "info",
    detail: { scope: doc.scope ?? null, trace_count: trace.length },
  });
}

function collectReportEvents(events: TelemetryEvent[]): void {
  const reportsRoot = path.join(root, ".ai", "reports");
  if (!fs.existsSync(reportsRoot)) return;
  const files = findFiles(reportsRoot, file => (file.endsWith(".yaml") || file.endsWith(".yml")) && path.basename(file) !== "evidence-manifest.yaml");
  for (const file of files) {
    const doc = safeReadYaml(file);
    if (!doc) continue;
    const sourcePath = rel(root, file);
    const scriptId = typeof doc.generated_by === "string" ? doc.generated_by : typeof doc.script_id === "string" ? doc.script_id : null;
    pushEvent(events, {
      event_type: sourcePath.includes("/runtime-telemetry-") ? "runtime_artifact_observed" : "report_artifact_observed",
      source_type: "report_artifact",
      source_path: sourcePath,
      route_id: routeIdFromScriptId(scriptId),
      script_id: scriptId,
      status: typeof doc.status === "string" ? doc.status : "observed",
      blocking: doc.blocking_decision === true,
      severity: doc.blocking_decision === true ? "error" : "info",
      detail: { artifact: doc.artifact ?? null },
    });
  }
}

const events: TelemetryEvent[] = [];
collectMissionJournalEvents(events);
collectValidationEvents(events);
collectEvidenceManifestEvents(events);
collectContextTraceEvents(events);
collectReportEvents(events);

const countsByType = events.reduce((acc: Record<string, number>, event) => {
  acc[event.event_type] = (acc[event.event_type] ?? 0) + 1;
  return acc;
}, {});
const routeEventCounts = events.reduce((acc: Record<string, number>, event) => {
  const routeId = event.route_id ?? "unknown";
  acc[routeId] = (acc[routeId] ?? 0) + 1;
  return acc;
}, {});

const outputEventsPath = ".ai/telemetry/runtime-telemetry-events.ndjson";
const outputSummaryPath = ".ai/telemetry/runtime-telemetry-summary.yaml";
const outputReportPath = ".ai/reports/runtime-telemetry-report.yaml";
ensureDir(path.join(root, ".ai", "telemetry"));
ensureDir(path.join(root, ".ai", "reports"));
fs.writeFileSync(path.join(root, outputEventsPath), events.map(event => JSON.stringify(event)).join("\n") + (events.length ? "\n" : ""), "utf8");

const summary = {
  artifact: "runtime_telemetry_summary",
  generated_by: SCRIPT_ID,
  route_id: ROUTE_ID,
  schema_version: "1.0",
  rollout_mode: "observe",
  enforcement_mode: "none",
  mutation_allowed: false,
  event_count: events.length,
  event_counts_by_type: countsByType,
  route_event_counts: routeEventCounts,
  blocking_event_count: events.filter(event => event.blocking).length,
  warning_event_count: events.filter(event => event.severity === "warning").length,
  error_event_count: events.filter(event => event.severity === "error" || event.severity === "critical").length,
  source_path_count: new Set(events.map(event => event.source_path)).size,
};

const validationResult = buildUniversalValidationResult(SCRIPT_ID, issues, {
  route_id: ROUTE_ID,
  evidence: [{ evidence_type: "runtime_telemetry", path: outputSummaryPath, evidence_ref: outputSummaryPath, event_count: events.length }],
  summary: { event_count: events.length, blocking_decision: false, enforcement_mode: "none" },
});

const report = {
  artifact: "runtime_telemetry_report",
  generated_by: SCRIPT_ID,
  status: validationResult.blocking ? "fail" : issues.some(entry => entry.severity === "warning") ? "pass_with_warnings" : "pass",
  summary,
  validation_result: validationResult,
};

writeYamlFile(path.join(root, outputSummaryPath), { ...summary, validation_result: validationResult });
writeYamlFile(path.join(root, outputReportPath), report);
finish(SCRIPT_ID, issues, [outputEventsPath, outputSummaryPath, outputReportPath], { runtime_telemetry: summary, validation_result: validationResult });
