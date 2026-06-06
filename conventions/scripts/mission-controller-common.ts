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

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === "string").map(item => item.trim()).filter(Boolean);
}

export function transitionLegalityGraphPath(root: string): string {
  return path.join(root, "transitions", "conventions.transition-legality-graph.yaml");
}

export interface TransitionLegalityEvaluation {
  allowed: boolean;
  rollout_mode: "observe";
  previous_phase: string;
  requested_phase: string;
  expected_next_phase: string | null;
  reason: string;
  issues: Issue[];
}

export function evaluateTransitionLegality(root: string, previousPhase: string, requestedPhase: string, eventType: string): TransitionLegalityEvaluation {
  const issues: Issue[] = [];
  const graphPath = transitionLegalityGraphPath(root);
  const relPath = "transitions/conventions.transition-legality-graph.yaml";
  const fallbackOrder = ["mission_created", "mission_profile_selection", "mission_initialization", "active_context_manifest", "phase_accounting", "behavior_contract", "codebase_reconnaissance", "local_alignment", "risk_classification", "boundary_contract_classification", "dependency_classification", "architecture_decomposition", "draft_role_pass", "pattern_pressure_detection", "artifact_reuse_analysis", "artifact_action_resolution", "refactor_strategy_selection", "call_site_impact_analysis", "change_impact_analysis", "final_role_assignment", "pattern_selection", "structure_rendering", "test_derivation", "implementation_sequence", "checkpoint_validation_plan", "pre_implementation_gate", "implementation", "failure_classification", "feedback_repair", "post_implementation_validation", "trigger_review", "report_artifact_validation", "final_validation", "mission_complete"];
  let phaseOrder = fallbackOrder;
  let samePhaseEvents = ["advance_observed", "mission_resumed", "mission_initialization_observed"];
  let terminalPhases = ["mission_complete"];

  if (fs.existsSync(graphPath)) {
    const graph = readYamlFile(graphPath);
    const order = stringList(graph?.sections?.phase_transition_order?.canonical_order);
    if (order.length > 0) phaseOrder = order;
    const configuredSamePhaseEvents = stringList(graph?.sections?.phase_transition_order?.same_phase_allowed_when_event_type_in);
    if (configuredSamePhaseEvents.length > 0) samePhaseEvents = configuredSamePhaseEvents;
    const configuredTerminalPhases = stringList(graph?.sections?.phase_transition_order?.terminal_phases);
    if (configuredTerminalPhases.length > 0) terminalPhases = configuredTerminalPhases;
  } else {
    issues.push(issue("warning", "MISSION_TRANSITION_GRAPH_MISSING", "Transition legality graph is missing; using compiled fallback order in observe mode", relPath));
  }

  const previousIndex = phaseOrder.indexOf(previousPhase);
  const requestedIndex = phaseOrder.indexOf(requestedPhase);
  const expectedNextPhase = previousIndex >= 0 && previousIndex + 1 < phaseOrder.length ? phaseOrder[previousIndex + 1] : null;
  let allowed = true;
  let reason = "transition_allowed_by_observe_graph";

  if (requestedIndex < 0) {
    allowed = false;
    reason = "requested_phase_unknown";
    issues.push(issue("warning", "MISSION_TRANSITION_UNKNOWN_PHASE", `Requested phase ${requestedPhase} is not in the transition legality graph`, relPath, { previous_phase: previousPhase, requested_phase: requestedPhase }));
  } else if (previousIndex < 0) {
    allowed = false;
    reason = "previous_phase_unknown";
    issues.push(issue("warning", "MISSION_TRANSITION_PREVIOUS_PHASE_UNKNOWN", `Previous phase ${previousPhase} is not in the transition legality graph`, relPath, { previous_phase: previousPhase, requested_phase: requestedPhase }));
  } else if (terminalPhases.includes(previousPhase) && requestedPhase !== previousPhase) {
    allowed = false;
    reason = "requested_phase_after_terminal_phase";
    issues.push(issue("warning", "MISSION_TRANSITION_AFTER_TERMINAL", `Mission transition requested after terminal phase ${previousPhase}`, relPath, { previous_phase: previousPhase, requested_phase: requestedPhase }));
  } else if (requestedPhase === previousPhase) {
    if (!samePhaseEvents.includes(eventType)) {
      allowed = false;
      reason = "same_phase_event_not_allowed";
      issues.push(issue("warning", "MISSION_TRANSITION_SAME_PHASE_EVENT_UNEXPECTED", `Same-phase transition event ${eventType} is not explicitly allowed`, relPath, { previous_phase: previousPhase, requested_phase: requestedPhase, event_type: eventType }));
    }
  } else if (requestedIndex === previousIndex + 1) {
    allowed = true;
  } else if (requestedIndex > previousIndex + 1) {
    allowed = false;
    reason = "requested_phase_skips_canonical_order";
    issues.push(issue("warning", "MISSION_TRANSITION_SKIPPED_PHASE_ORDER", `Transition from ${previousPhase} to ${requestedPhase} skips expected next phase ${expectedNextPhase}`, relPath, { previous_phase: previousPhase, requested_phase: requestedPhase, expected_next_phase: expectedNextPhase }));
  } else if (requestedIndex < previousIndex) {
    const revisionEvent = eventType.includes("revision") || eventType.includes("rerun") || eventType.includes("repair");
    if (!revisionEvent) {
      allowed = false;
      reason = "requested_phase_moves_back_without_revision_event";
      issues.push(issue("warning", "MISSION_TRANSITION_BACKWARD_WITHOUT_REVISION", `Backward transition from ${previousPhase} to ${requestedPhase} requires revision, rerun, or repair event context`, relPath, { previous_phase: previousPhase, requested_phase: requestedPhase, event_type: eventType }));
    }
  }

  return { allowed, rollout_mode: "observe", previous_phase: previousPhase, requested_phase: requestedPhase, expected_next_phase: expectedNextPhase, reason, issues };
}
