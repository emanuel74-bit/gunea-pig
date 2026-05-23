import path from "node:path";
import { finish, getArg, issue, readYamlFile, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "run-gate-check";
const root = resolveConventionsRoot();
const gateId = getArg("gate-id");
const validationResultPath = getArg("validation-result");
const issues: Issue[] = [];

if (!gateId) {
  issues.push(issue("error", "GATE_ID_MISSING", "Gate checks require --gate-id so the gate result can be identified and persisted."));
}

let validationStatus = "not_provided";
if (validationResultPath) {
  try {
    const validation = readYamlFile(path.join(root, validationResultPath));
    validationStatus = String(validation.status ?? validation.result?.status ?? "unknown");
    if (validationStatus === "fail" || validationStatus === "blocked") {
      issues.push(issue("error", "GATE_INPUT_VALIDATION_FAILED", "Gate cannot pass because a provided validation result failed.", validationResultPath));
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
  decision: status === "pass" ? "allow_transition" : "block_transition",
  evidence_refs: validationResultPath ? [validationResultPath] : [],
  errors: issues.filter(i => i.severity === "error" || i.severity === "critical"),
};
writeYamlFile(path.join(root, outputRel), gateResult);
finish(SCRIPT_ID, issues, [outputRel], { gate_id: gateId ?? null, status, decision: gateResult.decision });
