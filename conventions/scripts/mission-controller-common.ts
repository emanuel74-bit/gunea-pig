import fs from "node:fs";
import path from "node:path";
import { ensureDir, getArg, issue, readYamlFile, writeYamlFile, type Issue, type JsonMap } from "./lib/common.js";

export function missionIdFromArgs(defaultId?: string): string {
  const value = getArg("mission-id") ?? getArg("mission_id") ?? defaultId;
  if (!value) return "";
  return sanitizeMissionId(value);
}

export function sanitizeMissionId(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return "";
  if (trimmed.includes("..") || trimmed.startsWith(".") || trimmed.endsWith(".")) return "";
  return trimmed;
}

export function missionDir(root: string, missionId: string): string {
  return path.join(root, ".ai", "missions", missionId);
}

export function missionStatePath(root: string, missionId: string): string {
  return path.join(missionDir(root, missionId), "mission-state.yaml");
}

export function missionJournalPath(root: string, missionId: string): string {
  return path.join(missionDir(root, missionId), "mission-journal.ndjson");
}

export function readMissionState(root: string, missionId: string): JsonMap | undefined {
  const statePath = missionStatePath(root, missionId);
  if (!fs.existsSync(statePath)) return undefined;
  return readYamlFile(statePath);
}

export function writeMissionState(root: string, missionId: string, state: JsonMap): void {
  writeYamlFile(missionStatePath(root, missionId), state);
}

export function appendMissionEvent(root: string, missionId: string, event: JsonMap): void {
  const journalPath = missionJournalPath(root, missionId);
  ensureDir(path.dirname(journalPath));
  fs.appendFileSync(journalPath, `${JSON.stringify(event)}\n`, "utf8");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function baseMissionState(missionId: string): JsonMap {
  return {
    artifact: "mission_state",
    schema_version: "1.0",
    mission_id: missionId,
    controller_mode: "observe",
    selected_profile: "unselected",
    current_phase: "mission_created",
    implementation_allowed: false,
    active_phase_plan: {
      ordered_phases: [],
      required_phases: [],
      conditional_phases: [],
      forbidden_phases: [],
      skipped_phases: [],
      blocked_phases: [],
    },
    phase_statuses: [],
    report_registry_ref: ".ai/reports/report-registry.yaml",
    active_triggers: [],
    blocked_items: [],
    completed_reports: [],
    invalidated_outputs: [],
    revision_history: [],
    rerun_requests: [],
    user_approvals: [],
    controller_events: [],
    created_by: "initialize-mission",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}


export function isJsonMap(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(state: JsonMap, key: string, issues: Issue[], missionId: string): void {
  const value = state[key];
  if (typeof value !== "string" || !value.trim()) {
    issues.push(issue("error", `MISSION_STATE_${key.toUpperCase()}_INVALID`, `Mission state ${key} must be a non-empty string`, `.ai/missions/${missionId}/mission-state.yaml`));
  }
}

function requireArray(state: JsonMap, key: string, issues: Issue[], missionId: string): void {
  if (!Array.isArray(state[key])) {
    issues.push(issue("error", `MISSION_STATE_${key.toUpperCase()}_INVALID`, `Mission state ${key} must be a list`, `.ai/missions/${missionId}/mission-state.yaml`));
  }
}

function requireActivePhasePlan(state: JsonMap, issues: Issue[], missionId: string): void {
  const value = state.active_phase_plan;
  if (!isJsonMap(value)) {
    issues.push(issue("error", "MISSION_STATE_ACTIVE_PHASE_PLAN_INVALID", "Mission state active_phase_plan must be an object", `.ai/missions/${missionId}/mission-state.yaml`));
    return;
  }
  for (const key of ["ordered_phases", "required_phases", "conditional_phases", "forbidden_phases", "skipped_phases", "blocked_phases"]) {
    if (!Array.isArray(value[key])) {
      issues.push(issue("error", `MISSION_STATE_ACTIVE_PHASE_PLAN_${key.toUpperCase()}_INVALID`, `Mission state active_phase_plan.${key} must be a list`, `.ai/missions/${missionId}/mission-state.yaml`));
    }
  }
}

export function validateMissionStateShape(state: JsonMap | undefined, missionId: string): Issue[] {
  const issues: Issue[] = [];
  if (!state) {
    issues.push(issue("error", "MISSION_STATE_MISSING", `Mission state is missing for mission ${missionId}`, `.ai/missions/${missionId}/mission-state.yaml`));
    return issues;
  }

  if (state.mission_id !== missionId) {
    issues.push(issue("error", "MISSION_STATE_ID_MISMATCH", `Mission state id ${String(state.mission_id)} does not match requested ${missionId}`, `.ai/missions/${missionId}/mission-state.yaml`));
  }
  if (state.artifact !== "mission_state") {
    issues.push(issue("error", "MISSION_STATE_ARTIFACT_INVALID", "Mission state artifact must be mission_state", `.ai/missions/${missionId}/mission-state.yaml`));
  }
  if (state.schema_version !== "1.0") {
    issues.push(issue("error", "MISSION_STATE_SCHEMA_VERSION_INVALID", "Mission state schema_version must be 1.0", `.ai/missions/${missionId}/mission-state.yaml`));
  }
  if (state.controller_mode !== "observe") {
    issues.push(issue("warning", "MISSION_CONTROLLER_MODE_UNEXPECTED", `Mission controller mode is ${String(state.controller_mode)}; expected observe during rollout`, `.ai/missions/${missionId}/mission-state.yaml`));
  }

  requireString(state, "current_phase", issues, missionId);
  requireString(state, "report_registry_ref", issues, missionId);
  requireArray(state, "phase_statuses", issues, missionId);
  requireArray(state, "active_triggers", issues, missionId);
  requireArray(state, "blocked_items", issues, missionId);
  requireArray(state, "completed_reports", issues, missionId);
  requireArray(state, "invalidated_outputs", issues, missionId);
  requireArray(state, "revision_history", issues, missionId);
  requireArray(state, "rerun_requests", issues, missionId);
  requireArray(state, "user_approvals", issues, missionId);
  requireArray(state, "controller_events", issues, missionId);
  requireActivePhasePlan(state, issues, missionId);

  return issues;
}

export function hasBlockingMissionStateIssue(issues: Issue[]): boolean {
  return issues.some(item => item.severity === "error" || item.severity === "critical");
}
