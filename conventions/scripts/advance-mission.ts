import { finish, getArg, issue, resolveConventionsRoot, type Issue, type JsonMap } from "./lib/common.js";
import {
  appendMissionEvent,
  evaluateTransitionLegality,
  hasBlockingMissionStateIssue,
  missionIdFromArgs,
  nowIso,
  readMissionState,
  validateMissionCheckpoint,
  validateMissionJournal,
  validateMissionStateShape,
  writeMissionCheckpoint,
  writeMissionState,
} from "./mission-controller-common.js";

const SCRIPT_ID = "advance-mission";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const missionId = missionIdFromArgs();
const requestedPhase = getArg("to-phase") ?? getArg("to_phase") ?? getArg("phase");
const requestedEvent = getArg("event") ?? "advance_observed";

if (!missionId) {
  issues.push(issue("error", "MISSION_ID_INVALID", "Mission id must be a non-empty path-safe identifier"));
  finish(SCRIPT_ID, issues, [], { advanced: false });
}

const state = readMissionState(root, missionId);
issues.push(...validateMissionStateShape(state, missionId));
const preJournal = validateMissionJournal(root, missionId, Boolean(state));
issues.push(...preJournal.issues);
issues.push(...validateMissionCheckpoint(root, missionId, state, preJournal, Boolean(state)));
if (!state || hasBlockingMissionStateIssue(issues)) {
  finish(SCRIPT_ID, issues, [], { advanced: false, mission_id: missionId });
}

const timestamp = nowIso();
const previousPhase = String(state.current_phase ?? "mission_created");
const nextPhase = requestedPhase && requestedPhase.trim() ? requestedPhase.trim() : previousPhase;
const legality = evaluateTransitionLegality(root, previousPhase, nextPhase, requestedEvent);
issues.push(...legality.issues);

const event: JsonMap = {
  event_type: requestedEvent,
  route_id: "advance_mission",
  mission_id: missionId,
  timestamp,
  controller_mode: "observe",
  previous_phase: previousPhase,
  observed_next_phase: nextPhase,
  enforcement: "warn_only",
  transition_legality: {
    allowed: legality.allowed,
    rollout_mode: legality.rollout_mode,
    expected_next_phase: legality.expected_next_phase,
    reason: legality.reason,
    preconditions: legality.preconditions,
    missing_precondition_count: legality.preconditions.filter(item => item.required && !item.satisfied).length,
  },
};

state.controller_mode = "observe";
state.current_phase = nextPhase;
state.updated_at = timestamp;
state.controller_events = Array.isArray(state.controller_events) ? state.controller_events : [];
state.controller_events.push(event);
writeMissionState(root, missionId, state);
const appended = appendMissionEvent(root, missionId, event, state);
const postJournal = validateMissionJournal(root, missionId, true);
writeMissionCheckpoint(root, missionId, state, postJournal);

finish(SCRIPT_ID, issues, [`.ai/missions/${missionId}/mission-state.yaml`, `.ai/missions/${missionId}/mission-journal.ndjson`, `.ai/missions/${missionId}/mission-checkpoint.yaml`], {
  advanced: true,
  mission_id: missionId,
  event_sequence: appended.event_sequence,
  previous_phase: previousPhase,
  current_phase: nextPhase,
  journal_event_count: postJournal.eventCount,
  controller_mode: "observe",
  enforcement: "warn_only",
  transition_legality_allowed: legality.allowed,
  transition_reason: legality.reason,
  expected_next_phase: legality.expected_next_phase,
  transition_preconditions: legality.preconditions,
  missing_precondition_count: legality.preconditions.filter(item => item.required && !item.satisfied).length,
});
