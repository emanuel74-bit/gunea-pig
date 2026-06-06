import fs from "node:fs";
import { finish, getArg, issue, parseStructuredOutput, resolveConventionsRoot, type Issue, type JsonMap } from "./lib/common.js";

const SCRIPT_ID = "validate-validation-result";
const root = resolveConventionsRoot();
const inputFile = getArg("input-file") ?? getArg("input_file");
const routeId = getArg("route") ?? getArg("route-id") ?? getArg("route_id");
const missionId = getArg("mission-id") ?? getArg("mission_id");
const phaseId = getArg("phase-id") ?? getArg("phase_id");
const issues: Issue[] = [];

const universalStatuses = new Set(["passed", "passed_with_warnings", "failed", "blocked", "not_applicable"]);
const scriptStatuses = new Set(["pass", "fail"]);
const severities = ["info", "warning", "error", "critical"] as const;
const severityRank = new Map(severities.map((value, index) => [value, index]));

type NormalizedValidationResult = {
  validation_id: string;
  status: "passed" | "passed_with_warnings" | "failed" | "blocked" | "not_applicable";
  severity: "info" | "warning" | "error" | "critical";
  blocking: boolean;
  issues: JsonMap[];
  evidence: JsonMap[];
  route_id?: string;
  mission_id?: string;
  phase_id?: string;
  source_script_id?: string;
  source_status?: string;
  summary?: JsonMap;
};

function isPlainObject(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readInputText(): string {
  if (inputFile) {
    const candidate = inputFile.startsWith("/") ? inputFile : `${root}/${inputFile}`;
    if (!fs.existsSync(candidate)) {
      issues.push(issue("error", "VALIDATION_RESULT_FILE_MISSING", `Validation result file does not exist: ${inputFile}`));
      return "";
    }
    return fs.readFileSync(candidate, "utf8");
  }
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function validateIssueEntry(entry: unknown, index: number, fieldName: string): entry is JsonMap {
  if (!isPlainObject(entry)) {
    issues.push(issue("error", "VALIDATION_RESULT_ISSUE_ENTRY_INVALID", `${fieldName}[${index}] must be an issue object`, undefined, { field: fieldName, index }));
    return false;
  }
  const severity = entry.severity;
  const code = entry.code;
  const message = entry.message;
  if (!severities.includes(severity as any)) {
    issues.push(issue("error", "VALIDATION_RESULT_ISSUE_SEVERITY_INVALID", `${fieldName}[${index}].severity must be info, warning, error, or critical`, undefined, { field: fieldName, index }));
  }
  if (typeof code !== "string" || !code.trim()) {
    issues.push(issue("error", "VALIDATION_RESULT_ISSUE_CODE_INVALID", `${fieldName}[${index}].code must be a non-empty string`, undefined, { field: fieldName, index }));
  }
  if (typeof message !== "string" || !message.trim()) {
    issues.push(issue("error", "VALIDATION_RESULT_ISSUE_MESSAGE_INVALID", `${fieldName}[${index}].message must be a non-empty string`, undefined, { field: fieldName, index }));
  }
  return true;
}

function validateEvidenceEntry(entry: unknown, index: number): entry is JsonMap {
  if (!isPlainObject(entry)) {
    issues.push(issue("error", "VALIDATION_RESULT_EVIDENCE_ENTRY_INVALID", `evidence[${index}] must be an evidence object`, undefined, { index }));
    return false;
  }
  if (typeof entry.evidence_type !== "string" || !entry.evidence_type.trim()) {
    issues.push(issue("error", "VALIDATION_RESULT_EVIDENCE_TYPE_INVALID", `evidence[${index}].evidence_type must be a non-empty string`, undefined, { index }));
  }
  if (typeof entry.path !== "string" || !entry.path.trim()) {
    issues.push(issue("error", "VALIDATION_RESULT_EVIDENCE_PATH_INVALID", `evidence[${index}].path must be a non-empty string`, undefined, { index }));
  }
  return true;
}

function validateIssueList(fieldName: string, value: unknown): JsonMap[] {
  if (!Array.isArray(value)) {
    issues.push(issue("error", "VALIDATION_RESULT_ISSUES_INVALID", `${fieldName} must be a list`));
    return [];
  }
  return value.filter((entry, index) => validateIssueEntry(entry, index, fieldName)) as JsonMap[];
}

function highestSeverity(issueEntries: JsonMap[]): NormalizedValidationResult["severity"] {
  let selected: NormalizedValidationResult["severity"] = "info";
  for (const entry of issueEntries) {
    const candidate = typeof entry.severity === "string" ? entry.severity : "info";
    if ((severityRank.get(candidate as any) ?? -1) > (severityRank.get(selected) ?? -1)) {
      selected = candidate as NormalizedValidationResult["severity"];
    }
  }
  return selected;
}

function normalizeLegacyScriptResult(parsed: JsonMap): NormalizedValidationResult | undefined {
  if (typeof parsed.script_id !== "string" || !parsed.script_id.trim()) {
    issues.push(issue("error", "VALIDATION_RESULT_SOURCE_ID_INVALID", "Legacy validation result script_id must be a non-empty string"));
  }
  if (!scriptStatuses.has(String(parsed.status))) {
    issues.push(issue("error", "VALIDATION_RESULT_SOURCE_STATUS_INVALID", "Legacy validation result status must be pass or fail"));
  }

  const errors = validateIssueList("errors", parsed.errors);
  const warnings = validateIssueList("warnings", parsed.warnings);
  const info = validateIssueList("info", parsed.info);
  const allIssues = [...errors, ...warnings, ...info];
  const severity = highestSeverity(allIssues);
  const blocking = parsed.status === "fail" || severity === "error" || severity === "critical";

  let evidence: JsonMap[] = [];
  const summary = isPlainObject(parsed.summary) ? parsed.summary : undefined;
  if (summary && "evidence" in summary) {
    if (!Array.isArray(summary.evidence)) {
      issues.push(issue("error", "VALIDATION_RESULT_EVIDENCE_INVALID", "summary.evidence must be a list when present"));
    } else {
      evidence = summary.evidence.filter((entry: unknown, index: number) => validateEvidenceEntry(entry, index)) as JsonMap[];
    }
  }

  if (issues.some(entry => entry.severity === "error" || entry.severity === "critical")) return undefined;

  const status: NormalizedValidationResult["status"] = parsed.status === "fail"
    ? "failed"
    : warnings.length > 0
      ? "passed_with_warnings"
      : "passed";

  return {
    validation_id: parsed.script_id.trim(),
    status,
    severity,
    blocking,
    issues: allIssues,
    evidence,
    ...(routeId ? { route_id: routeId } : {}),
    ...(missionId ? { mission_id: missionId } : {}),
    ...(phaseId ? { phase_id: phaseId } : {}),
    source_script_id: parsed.script_id.trim(),
    source_status: String(parsed.status),
    ...(summary ? { summary } : {}),
  };
}

function normalizeUniversalValidationResult(parsed: JsonMap): NormalizedValidationResult | undefined {
  const validationId = typeof parsed.validation_id === "string" ? parsed.validation_id.trim() : "";
  if (!validationId) {
    issues.push(issue("error", "VALIDATION_RESULT_ID_INVALID", "Universal validation result validation_id must be a non-empty string"));
  }
  if (!universalStatuses.has(String(parsed.status))) {
    issues.push(issue("error", "VALIDATION_RESULT_STATUS_INVALID", "Universal validation result status is not allowed"));
  }
  if (!severities.includes(parsed.severity as any)) {
    issues.push(issue("error", "VALIDATION_RESULT_SEVERITY_INVALID", "Universal validation result severity must be info, warning, error, or critical"));
  }
  if (typeof parsed.blocking !== "boolean") {
    issues.push(issue("error", "VALIDATION_RESULT_BLOCKING_INVALID", "Universal validation result blocking must be boolean"));
  }
  const universalIssues = validateIssueList("issues", parsed.issues);
  let evidence: JsonMap[] = [];
  if (!Array.isArray(parsed.evidence)) {
    issues.push(issue("error", "VALIDATION_RESULT_EVIDENCE_INVALID", "Universal validation result evidence must be a list"));
  } else {
    evidence = parsed.evidence.filter((entry: unknown, index: number) => validateEvidenceEntry(entry, index)) as JsonMap[];
  }

  if (issues.some(entry => entry.severity === "error" || entry.severity === "critical")) return undefined;

  return {
    validation_id: validationId,
    status: parsed.status as NormalizedValidationResult["status"],
    severity: parsed.severity as NormalizedValidationResult["severity"],
    blocking: parsed.blocking as boolean,
    issues: universalIssues,
    evidence,
    ...(typeof parsed.route_id === "string" ? { route_id: parsed.route_id } : routeId ? { route_id: routeId } : {}),
    ...(typeof parsed.mission_id === "string" ? { mission_id: parsed.mission_id } : missionId ? { mission_id: missionId } : {}),
    ...(typeof parsed.phase_id === "string" ? { phase_id: parsed.phase_id } : phaseId ? { phase_id: phaseId } : {}),
    ...(typeof parsed.source_script_id === "string" ? { source_script_id: parsed.source_script_id } : {}),
    ...(typeof parsed.source_status === "string" ? { source_status: parsed.source_status } : {}),
    ...(isPlainObject(parsed.summary) ? { summary: parsed.summary } : {}),
  };
}

const text = readInputText();
const parsed = parseStructuredOutput(text);
let normalized: NormalizedValidationResult | undefined;

if (!parsed) {
  issues.push(issue("error", "VALIDATION_RESULT_UNPARSEABLE", "Validation result must be YAML or JSON object"));
} else if ("validation_id" in parsed) {
  normalized = normalizeUniversalValidationResult(parsed);
} else if ("script_id" in parsed) {
  normalized = normalizeLegacyScriptResult(parsed);
} else {
  issues.push(issue("error", "VALIDATION_RESULT_SHAPE_UNKNOWN", "Validation result must use universal validation_id shape or legacy script_id result shape"));
}

finish(SCRIPT_ID, issues, [".ai/validation/validate-validation-result.result.yaml"], {
  contract_version: "1.0",
  rollout_mode: "normalize_observe",
  policy_change_allowed: false,
  parsed_result: Boolean(parsed),
  normalized_result: normalized ?? null,
});
