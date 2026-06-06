import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  buildUniversalValidationResult,
  ensureDir,
  finish,
  issue,
  readYamlFile,
  rel,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "validate-runtime-telemetry";
const ROUTE_ID = "validate_runtime_telemetry";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const eventsPath = path.join(root, ".ai", "telemetry", "runtime-telemetry-events.ndjson");
const summaryPath = path.join(root, ".ai", "telemetry", "runtime-telemetry-summary.yaml");
const reportPath = path.join(root, ".ai", "reports", "runtime-telemetry-report.yaml");
const outputReportPath = ".ai/reports/runtime-telemetry-validation-report.yaml";

const allowedEventTypes = new Set([
  "mission_event_observed",
  "validation_result_observed",
  "evidence_manifest_observed",
  "context_load_trace_observed",
  "report_artifact_observed",
  "runtime_artifact_observed",
]);
const allowedSeverities = new Set(["info", "warning", "error", "critical"]);

function add(severity: Issue["severity"], code: string, message: string, file?: string, detail?: JsonMap): void {
  issues.push(issue(severity, code, message, file, detail));
}

function isObject(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readYamlIfExists(filePath: string, code: string, label: string): JsonMap | undefined {
  if (!fs.existsSync(filePath)) {
    add("error", code, `${label} is missing.`, rel(root, filePath));
    return undefined;
  }
  try {
    return readYamlFile(filePath);
  } catch (error) {
    add("error", "TELEMETRY_YAML_UNREADABLE", `${label} could not be parsed.`, rel(root, filePath), { error: String(error) });
    return undefined;
  }
}

function readEvents(): JsonMap[] {
  if (!fs.existsSync(eventsPath)) {
    add("error", "TELEMETRY_EVENTS_MISSING", "Runtime telemetry event stream is missing.", rel(root, eventsPath));
    return [];
  }
  const text = fs.readFileSync(eventsPath, "utf8");
  if (!text.trim()) return [];
  const events: JsonMap[] = [];
  text.split(/\r?\n/).filter(Boolean).forEach((line, index) => {
    try {
      const parsed = JSON.parse(line);
      if (!isObject(parsed)) {
        add("error", "TELEMETRY_EVENT_NOT_OBJECT", "Telemetry event line must be a JSON object.", rel(root, eventsPath), { line: index + 1 });
        return;
      }
      events.push(parsed);
    } catch (error) {
      add("error", "TELEMETRY_EVENT_LINE_UNREADABLE", "Telemetry event line could not be parsed as JSON.", rel(root, eventsPath), { line: index + 1, error: String(error) });
    }
  });
  return events;
}

function validateEvent(event: JsonMap, index: number): void {
  const location = { index: index + 1 };
  for (const field of ["event_id", "event_type", "source_type", "source_path", "observed_at", "status", "severity"]) {
    if (typeof event[field] !== "string" || !String(event[field]).trim()) {
      add("error", "TELEMETRY_EVENT_REQUIRED_FIELD_INVALID", `Telemetry event field ${field} must be a non-empty string.`, rel(root, eventsPath), { ...location, field });
    }
  }
  if (!("route_id" in event) || !(typeof event.route_id === "string" || event.route_id === null)) {
    add("error", "TELEMETRY_EVENT_ROUTE_ID_INVALID", "Telemetry event route_id must be a string or null.", rel(root, eventsPath), location);
  }
  if (!("script_id" in event) || !(typeof event.script_id === "string" || event.script_id === null)) {
    add("error", "TELEMETRY_EVENT_SCRIPT_ID_INVALID", "Telemetry event script_id must be a string or null.", rel(root, eventsPath), location);
  }
  if (typeof event.blocking !== "boolean") {
    add("error", "TELEMETRY_EVENT_BLOCKING_INVALID", "Telemetry event blocking must be boolean.", rel(root, eventsPath), location);
  }
  if (typeof event.event_type === "string" && !allowedEventTypes.has(event.event_type)) {
    add("error", "TELEMETRY_EVENT_TYPE_UNKNOWN", "Telemetry event_type is not declared by the telemetry contract.", rel(root, eventsPath), { ...location, event_type: event.event_type });
  }
  if (typeof event.severity === "string" && !allowedSeverities.has(event.severity)) {
    add("error", "TELEMETRY_EVENT_SEVERITY_UNKNOWN", "Telemetry event severity is not allowed.", rel(root, eventsPath), { ...location, severity: event.severity });
  }
  if (typeof event.source_path === "string" && !event.source_path.startsWith(".ai/")) {
    add("error", "TELEMETRY_EVENT_SOURCE_PATH_INVALID", "Telemetry event source_path must reference a runtime .ai artifact.", rel(root, eventsPath), { ...location, source_path: event.source_path });
  }
}

function validateSummary(summary: JsonMap | undefined, events: JsonMap[]): void {
  if (!summary) return;
  if (summary.artifact !== "runtime_telemetry_summary") add("error", "TELEMETRY_SUMMARY_ARTIFACT_INVALID", "Telemetry summary artifact identity is invalid.", rel(root, summaryPath));
  if (summary.generated_by !== "collect-runtime-telemetry") add("error", "TELEMETRY_SUMMARY_PRODUCER_INVALID", "Telemetry summary must be produced by collect-runtime-telemetry.", rel(root, summaryPath));
  if (summary.route_id !== "collect_runtime_telemetry") add("error", "TELEMETRY_SUMMARY_ROUTE_INVALID", "Telemetry summary route_id must be collect_runtime_telemetry.", rel(root, summaryPath));
  if (summary.rollout_mode !== "observe" || summary.enforcement_mode !== "none" || summary.mutation_allowed !== false) {
    add("error", "TELEMETRY_SUMMARY_POLICY_INVALID", "Telemetry summary must remain observe-only, non-enforcing, and non-mutating.", rel(root, summaryPath));
  }
  if (summary.event_count !== events.length) {
    add("error", "TELEMETRY_SUMMARY_EVENT_COUNT_MISMATCH", "Telemetry summary event_count must equal the event stream count.", rel(root, summaryPath), { summary_event_count: summary.event_count, actual_event_count: events.length });
  }
  const blockingCount = events.filter(event => event.blocking === true).length;
  const warningCount = events.filter(event => event.severity === "warning").length;
  const errorCount = events.filter(event => event.severity === "error" || event.severity === "critical").length;
  if (summary.blocking_event_count !== blockingCount) add("error", "TELEMETRY_SUMMARY_BLOCKING_COUNT_MISMATCH", "Telemetry summary blocking_event_count does not match events.", rel(root, summaryPath), { expected: blockingCount, actual: summary.blocking_event_count });
  if (summary.warning_event_count !== warningCount) add("error", "TELEMETRY_SUMMARY_WARNING_COUNT_MISMATCH", "Telemetry summary warning_event_count does not match events.", rel(root, summaryPath), { expected: warningCount, actual: summary.warning_event_count });
  if (summary.error_event_count !== errorCount) add("error", "TELEMETRY_SUMMARY_ERROR_COUNT_MISMATCH", "Telemetry summary error_event_count does not match events.", rel(root, summaryPath), { expected: errorCount, actual: summary.error_event_count });
  if (!isObject(summary.event_counts_by_type)) add("error", "TELEMETRY_SUMMARY_TYPE_COUNTS_INVALID", "Telemetry summary event_counts_by_type must be a map.", rel(root, summaryPath));
  if (!isObject(summary.route_event_counts)) add("error", "TELEMETRY_SUMMARY_ROUTE_COUNTS_INVALID", "Telemetry summary route_event_counts must be a map.", rel(root, summaryPath));
  if (!isObject(summary.validation_result) || summary.validation_result?.route_id !== "collect_runtime_telemetry" || summary.validation_result?.blocking !== false) {
    add("error", "TELEMETRY_SUMMARY_VALIDATION_RESULT_INVALID", "Telemetry summary must include non-blocking universal validation metadata from collect_runtime_telemetry.", rel(root, summaryPath));
  }
}

function validateReport(report: JsonMap | undefined): void {
  if (!report) return;
  if (report.artifact !== "runtime_telemetry_report") add("error", "TELEMETRY_REPORT_ARTIFACT_INVALID", "Telemetry report artifact identity is invalid.", rel(root, reportPath));
  if (report.generated_by !== "collect-runtime-telemetry") add("error", "TELEMETRY_REPORT_PRODUCER_INVALID", "Telemetry report must be produced by collect-runtime-telemetry.", rel(root, reportPath));
  if (!isObject(report.summary)) add("error", "TELEMETRY_REPORT_SUMMARY_INVALID", "Telemetry report must include summary object.", rel(root, reportPath));
  if (!isObject(report.validation_result) || report.validation_result?.route_id !== "collect_runtime_telemetry" || report.validation_result?.blocking !== false) {
    add("error", "TELEMETRY_REPORT_VALIDATION_RESULT_INVALID", "Telemetry report must include non-blocking universal validation metadata from collect_runtime_telemetry.", rel(root, reportPath));
  }
}

const events = readEvents();
events.forEach(validateEvent);
const summary = readYamlIfExists(summaryPath, "TELEMETRY_SUMMARY_MISSING", "Runtime telemetry summary");
const report = readYamlIfExists(reportPath, "TELEMETRY_REPORT_MISSING", "Runtime telemetry report");
validateSummary(summary, events);
validateReport(report);

const validationResult = buildUniversalValidationResult(SCRIPT_ID, issues, {
  route_id: ROUTE_ID,
  evidence: [
    { evidence_type: "runtime_telemetry_validation", path: ".ai/telemetry/runtime-telemetry-events.ndjson", evidence_ref: ".ai/telemetry/runtime-telemetry-events.ndjson", event_count: events.length },
    { evidence_type: "runtime_telemetry_validation", path: ".ai/telemetry/runtime-telemetry-summary.yaml", evidence_ref: ".ai/telemetry/runtime-telemetry-summary.yaml" },
  ],
  summary: {
    event_count: events.length,
    validated_artifacts: ["runtime-telemetry-events.ndjson", "runtime-telemetry-summary.yaml", "runtime-telemetry-report.yaml"],
    enforcement_mode: "shape_and_coverage_only",
    workflow_policy_enforced: false,
  },
});

const validationReport = {
  artifact: "runtime_telemetry_validation_report",
  generated_by: SCRIPT_ID,
  route_id: ROUTE_ID,
  status: validationResult.blocking ? "fail" : "pass",
  event_count: events.length,
  validation_scope: "shape_and_coverage_only",
  workflow_policy_enforced: false,
  validation_result: validationResult,
};
ensureDir(path.join(root, ".ai", "reports"));
writeYamlFile(path.join(root, outputReportPath), validationReport);
finish(SCRIPT_ID, issues, [outputReportPath], { validation_result: validationResult, runtime_telemetry_validation: validationReport });
