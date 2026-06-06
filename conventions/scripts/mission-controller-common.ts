import crypto from "node:crypto";
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

export function missionCheckpointPath(root: string, missionId: string): string {
  return path.join(missionDir(root, missionId), "mission-checkpoint.yaml");
}

export function readMissionState(root: string, missionId: string): JsonMap | undefined {
  const statePath = missionStatePath(root, missionId);
  if (!fs.existsSync(statePath)) return undefined;
  return readYamlFile(statePath);
}

export function writeMissionState(root: string, missionId: string, state: JsonMap): void {
  writeYamlFile(missionStatePath(root, missionId), state);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonMap).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashValue(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export interface MissionJournalValidation {
  issues: Issue[];
  eventCount: number;
  lastEvent?: JsonMap;
}

export function readMissionJournalEvents(root: string, missionId: string): JsonMap[] {
  const journalPath = missionJournalPath(root, missionId);
  if (!fs.existsSync(journalPath)) return [];
  const lines = fs.readFileSync(journalPath, "utf8").split(/\r?\n/).filter(line => line.trim());
  return lines.map(line => JSON.parse(line) as JsonMap);
}

export function validateMissionJournal(root: string, missionId: string, requireExisting = false): MissionJournalValidation {
  const journalPath = missionJournalPath(root, missionId);
  const issues: Issue[] = [];
  const relPath = `.ai/missions/${missionId}/mission-journal.ndjson`;
  if (!fs.existsSync(journalPath)) {
    if (requireExisting) issues.push(issue("error", "MISSION_JOURNAL_MISSING", `Mission journal is missing for mission ${missionId}`, relPath));
    return { issues, eventCount: 0 };
  }

  const lines = fs.readFileSync(journalPath, "utf8").split(/\r?\n/).filter(line => line.trim());
  const events: JsonMap[] = [];
  lines.forEach((line, index) => {
    let parsed: JsonMap | undefined;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as JsonMap;
    } catch {
      issues.push(issue("error", "MISSION_JOURNAL_LINE_UNPARSEABLE", `Mission journal line ${index + 1} is not valid JSON`, relPath));
      return;
    }
    if (!parsed) {
      issues.push(issue("error", "MISSION_JOURNAL_EVENT_INVALID", `Mission journal line ${index + 1} must be a JSON object`, relPath));
      return;
    }
    events.push(parsed);
    const expectedSequence = index + 1;
    if (parsed.event_sequence !== expectedSequence) {
      issues.push(issue("error", "MISSION_JOURNAL_SEQUENCE_INVALID", `Mission journal event_sequence must be append-only and contiguous at line ${index + 1}`, relPath, { expected: expectedSequence, actual: parsed.event_sequence }));
    }
    if (parsed.mission_id !== missionId) {
      issues.push(issue("error", "MISSION_JOURNAL_MISSION_ID_MISMATCH", `Mission journal line ${index + 1} mission_id does not match ${missionId}`, relPath));
    }
    for (const key of ["event_type", "route_id", "timestamp", "state_hash_after"]) {
      if (typeof parsed[key] !== "string" || !parsed[key].trim()) {
        issues.push(issue("error", `MISSION_JOURNAL_${key.toUpperCase()}_INVALID`, `Mission journal line ${index + 1} ${key} must be a non-empty string`, relPath));
      }
    }
  });

  return { issues, eventCount: events.length, lastEvent: events[events.length - 1] };
}

export function appendMissionEvent(root: string, missionId: string, event: JsonMap, stateAfter: JsonMap): JsonMap {
  const validation = validateMissionJournal(root, missionId, false);
  if (validation.issues.some(item => item.severity === "error" || item.severity === "critical")) {
    throw new Error(`Mission journal is corrupted for ${missionId}; refusing to append`);
  }
  const journalPath = missionJournalPath(root, missionId);
  ensureDir(path.dirname(journalPath));
  const enriched = {
    ...event,
    mission_id: missionId,
    event_sequence: validation.eventCount + 1,
    previous_event_sequence: validation.eventCount || null,
    state_hash_after: hashValue(stateAfter),
  };
  fs.appendFileSync(journalPath, `${JSON.stringify(enriched)}\n`, "utf8");
  return enriched;
}

export function writeMissionCheckpoint(root: string, missionId: string, state: JsonMap, journal: MissionJournalValidation): void {
  const lastEvent = journal.lastEvent;
  writeYamlFile(missionCheckpointPath(root, missionId), {
    artifact: "mission_checkpoint",
    schema_version: "1.0",
    mission_id: missionId,
    controller_mode: state.controller_mode ?? "observe",
    current_phase: state.current_phase ?? null,
    state_path: `.ai/missions/${missionId}/mission-state.yaml`,
    journal_path: `.ai/missions/${missionId}/mission-journal.ndjson`,
    journal_event_count: journal.eventCount,
    last_event_sequence: lastEvent?.event_sequence ?? null,
    last_event_type: lastEvent?.event_type ?? null,
    state_hash: hashValue(state),
    updated_at: state.updated_at ?? nowIso(),
  });
}

export function validateMissionCheckpoint(root: string, missionId: string, state: JsonMap | undefined, journal: MissionJournalValidation, requireExisting = false): Issue[] {
  const issues: Issue[] = [];
  const checkpointPath = missionCheckpointPath(root, missionId);
  const relPath = `.ai/missions/${missionId}/mission-checkpoint.yaml`;
  if (!fs.existsSync(checkpointPath)) {
    if (requireExisting) issues.push(issue("error", "MISSION_CHECKPOINT_MISSING", `Mission checkpoint is missing for mission ${missionId}`, relPath));
    return issues;
  }
  const checkpoint = readYamlFile(checkpointPath);
  if (checkpoint.artifact !== "mission_checkpoint") issues.push(issue("error", "MISSION_CHECKPOINT_ARTIFACT_INVALID", "Mission checkpoint artifact must be mission_checkpoint", relPath));
  if (checkpoint.schema_version !== "1.0") issues.push(issue("error", "MISSION_CHECKPOINT_SCHEMA_VERSION_INVALID", "Mission checkpoint schema_version must be 1.0", relPath));
  if (checkpoint.mission_id !== missionId) issues.push(issue("error", "MISSION_CHECKPOINT_ID_MISMATCH", `Mission checkpoint id ${String(checkpoint.mission_id)} does not match requested ${missionId}`, relPath));
  if (typeof checkpoint.journal_event_count !== "number" || checkpoint.journal_event_count !== journal.eventCount) {
    issues.push(issue("error", "MISSION_CHECKPOINT_EVENT_COUNT_MISMATCH", "Mission checkpoint journal_event_count must match journal line count", relPath, { checkpoint: checkpoint.journal_event_count, journal: journal.eventCount }));
  }
  if (state && checkpoint.state_hash !== hashValue(state)) {
    issues.push(issue("error", "MISSION_CHECKPOINT_STATE_HASH_MISMATCH", "Mission checkpoint state_hash must match mission state", relPath));
  }
  return issues;
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
