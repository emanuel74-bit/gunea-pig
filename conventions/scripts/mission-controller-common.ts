import fs from "node:fs";
import path from "node:path";
import { ensureDir, getArg, readYamlFile, writeYamlFile, type JsonMap } from "./lib/common.js";

export function missionIdFromArgs(defaultId = "default-mission"): string {
  const value = getArg("mission-id") ?? getArg("mission_id") ?? defaultId;
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
