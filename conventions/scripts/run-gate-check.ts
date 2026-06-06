import path from "node:path";
import { extractValidationDecision, finish, getArg, issue, readYamlFile, resolveConventionsRoot, writeYamlFile, type Issue, type JsonMap } from "./lib/common.js";

const SCRIPT_ID = "run-gate-check";
const root = resolveConventionsRoot();
const gateId = getArg("gate-id");
const validationResultPath = getArg("validation-result");
const issues: Issue[] = [];

if (!gateId) {
  issues.push(issue("error", "GATE_ID_MISSING", "Gate checks require --gate-id so the gate result can be identified and persisted."));
}

let validationStatus = "not_provided";
let validationDecision: JsonMap | null = null;
if (validationResultPath) {
  try {
    const validation = readYamlFile(path.join(root, validationResultPath));
    const decision = extractValidationDecision(validation);
    validationDecision = {
      validation_id: decision.validation_id ?? null,
      status: decision.status,
      severity: decision.severity ?? null,
      blocking: decision.blocking,
      source_shape: decision.source_shape,
    };
    validationStatus = decision.status;
    if (decision.blocking) {
      issues.push(issue("error", "GATE_INPUT_VALIDATION_BLOCKING", "Gate cannot pass because a provided validation result is blocking.", validationResultPath, validationDecision));
    }
  } catch (error) {
    issues.push(issue("error", "GATE_VALIDATION_RESULT_UNREADABLE", "Gate validation input could not be read.", validationResultPath, { error: String(error) }));
  }
}

const status = issues.some(i => i.severity === "error" || i.severity === "critical") ? "blocked" : "pass";
const safeGateId = (gateId ?? "invalid_gate").replace(/[^a-zA-Z0-9_.-]+/g, "_");
const outputRel = `.ai/gates/${safeGateId}.gate-result.yaml`;
const gateResult = {
  artifact: "gate_result",
  generated_by: SCRIPT_ID,
  gate_id: gateId ?? null,
  status,
  validation_status: validationStatus,
  validation_result_contract: validationDecision,
  decision: status === "pass" ? "allow_transition" : "block_transition",
  evidence_refs: validationResultPath ? [validationResultPath] : [],
  errors: issues.filter(i => i.severity === "error" || i.severity === "critical"),
};
writeYamlFile(path.join(root, outputRel), gateResult);
finish(SCRIPT_ID, issues, [outputRel], { gate_id: gateId ?? null, status, decision: gateResult.decision, validation_result_contract: validationDecision });
