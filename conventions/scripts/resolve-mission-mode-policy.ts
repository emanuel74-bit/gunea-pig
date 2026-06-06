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

const SCRIPT_ID = "resolve-mission-mode-policy";
const ROUTE_ID = "resolve_mission_mode_policy";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const explicitMissionId = getArg("mission-id");
const explicitProfile = getArg("mission-profile");
const explicitMode = getArg("mission-mode");

const policyPath = path.join(root, "policy", "conventions.mission-mode-policy.yaml");
const statePath = explicitMissionId ? path.join(root, ".ai", "missions", explicitMissionId, "mission-state.yaml") : "";

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map(entry => entry.trim()) : [];
}

function readOptionalYaml(filePath: string): JsonMap | undefined {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  return readYamlFile(filePath);
}

const policyDoc = readYamlFile(policyPath);
const sections = asRecord(policyDoc.sections);
const rollout = asRecord(sections.rollout);
const mapping = asRecord(sections.mission_profile_to_mode_mapping);
const records = asRecord(sections.mission_mode_policy_records);
const allowedModes = asStringArray(asRecord(sections.mission_mode_enum).allowed);

let selectedProfile = explicitProfile;
let selectedProfileSource = explicitProfile ? "argument" : "unresolved";
const missionState = readOptionalYaml(statePath);

if (!selectedProfile && missionState) {
  const stateProfile = typeof missionState.selected_profile === "string" ? missionState.selected_profile : "";
  if (stateProfile) {
    selectedProfile = stateProfile;
    selectedProfileSource = "mission_state";
  }
}

if (explicitMissionId && !missionState) {
  issues.push(issue("warning", "MISSION_STATE_NOT_FOUND", `Mission state was not found for mission id ${explicitMissionId}; resolving policy from provided arguments only.`, `.ai/missions/${explicitMissionId}/mission-state.yaml`));
}

let missionMode = explicitMode;
let modeSource = explicitMode ? "argument" : "profile_mapping";

if (!missionMode && selectedProfile) {
  const mapped = mapping[selectedProfile];
  if (typeof mapped === "string" && mapped.trim()) missionMode = mapped.trim();
}

if (!missionMode) {
  issues.push(issue("error", "MISSION_MODE_UNRESOLVED", "Mission mode could not be resolved from --mission-mode, --mission-profile, or mission state selected_profile.", policyPath));
}

if (missionMode && !allowedModes.includes(missionMode)) {
  issues.push(issue("error", "MISSION_MODE_UNKNOWN", `Mission mode is not declared in mission_mode_enum: ${missionMode}`, policyPath));
}

if (selectedProfile && !mapping[selectedProfile] && !explicitMode) {
  issues.push(issue("error", "MISSION_PROFILE_UNMAPPED", `Mission profile has no mission-mode mapping: ${selectedProfile}`, policyPath));
}

const policy = missionMode && records[missionMode] && typeof records[missionMode] === "object" ? records[missionMode] as JsonMap : undefined;
if (missionMode && !policy) {
  issues.push(issue("error", "MISSION_MODE_POLICY_MISSING", `Mission mode has no policy record: ${missionMode}`, policyPath));
}

const adapterEvidence = {
  source_artifact_manifest_present: fs.existsSync(path.join(root, ".ai", "source-artifacts", "source-artifact-manifest.yaml")),
  typescript_source_analysis_present: fs.existsSync(path.join(root, ".ai", "source-artifacts", "typescript-source-analysis.yaml")),
  nestjs_source_analysis_present: fs.existsSync(path.join(root, ".ai", "source-artifacts", "nestjs-source-analysis.yaml")),
};

const resolvedOut = ".ai/policy/mission-mode-policy.yaml";
const reportOut = ".ai/reports/mission-mode-policy-report.yaml";
const validationOut = ".ai/validation/resolve-mission-mode-policy.result.yaml";

const warningCodes = issues.filter(entry => entry.severity === "warning").map(entry => entry.code).sort();
const hasErrors = issues.some(entry => entry.severity === "error" || entry.severity === "critical");
const resolved = {
  artifact: "resolved_mission_mode_policy",
  generated_by: SCRIPT_ID,
  status: hasErrors ? "failed" : "resolved_observe_only",
  rollout_mode: typeof rollout.mode === "string" ? rollout.mode : "observe",
  enforcement: typeof rollout.enforcement === "string" ? rollout.enforcement : "disabled",
  blocking_decisions: "disabled_in_observe_mode",
  mission_id: explicitMissionId ?? null,
  mission_mode: missionMode ?? "unresolved",
  source_profile: selectedProfile ?? "unresolved",
  selected_profile_source: selectedProfileSource,
  mode_source: explicitMode ? modeSource : (selectedProfile ? modeSource : "unresolved"),
  policy: policy ?? {},
  adapter_evidence: adapterEvidence,
  warnings: warningCodes,
};

const report = {
  artifact: "mission_mode_policy_report",
  generated_by: SCRIPT_ID,
  status: hasErrors ? "fail" : "pass",
  rollout_mode: resolved.rollout_mode,
  enforcement: resolved.enforcement,
  summary: {
    mission_id: explicitMissionId ?? null,
    mission_mode: resolved.mission_mode,
    source_profile: resolved.source_profile,
    selected_profile_source: resolved.selected_profile_source,
    warning_count: warningCodes.length,
    adapter_evidence: adapterEvidence,
    observe_threshold_keys: policy?.observe_thresholds ? Object.keys(asRecord(policy.observe_thresholds)).sort() : [],
  },
};

writeYamlFile(path.join(root, resolvedOut), resolved);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [resolvedOut, reportOut, validationOut], {
  mission_id: explicitMissionId ?? null,
  mission_mode: resolved.mission_mode,
  source_profile: resolved.source_profile,
  rollout_mode: resolved.rollout_mode,
  enforcement: resolved.enforcement,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: ROUTE_ID,
    mission_id: explicitMissionId,
    evidence: [
      { evidence_type: "mission_mode_policy_contract", path: "conventions/policy/conventions.mission-mode-policy.yaml", producer_route: ROUTE_ID },
      { evidence_type: "resolved_policy", path: resolvedOut, producer_route: ROUTE_ID },
      { evidence_type: "policy_report", path: reportOut, producer_route: ROUTE_ID },
    ],
    summary: {
      mission_mode: resolved.mission_mode,
      source_profile: resolved.source_profile,
      rollout_mode: resolved.rollout_mode,
      enforcement: resolved.enforcement,
    },
  }),
});
