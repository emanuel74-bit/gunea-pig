import { finish, getArg, issue, resolveConventionsRoot, type Issue, type JsonMap } from "./lib/common.js";
import { appendMissionEvent, hasBlockingMissionStateIssue, missionIdFromArgs, nowIso, readMissionState, validateMissionStateShape, writeMissionState } from "./mission-controller-common.js";

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
if (!state || hasBlockingMissionStateIssue(issues)) {
  finish(SCRIPT_ID, issues, [], { advanced: false, mission_id: missionId });
}

const timestamp = nowIso();
const previousPhase = String(state.current_phase ?? "mission_created");
const nextPhase = requestedPhase && requestedPhase.trim() ? requestedPhase.trim() : previousPhase;
const event: JsonMap = {
  event_type: requestedEvent,
  route_id: "advance_mission",
  mission_id: missionId,
  timestamp,
  controller_mode: "observe",
  previous_phase: previousPhase,
  observed_next_phase: nextPhase,
  enforcement: "not_yet_enabled",
};

state.controller_mode = "observe";
state.current_phase = nextPhase;
state.updated_at = timestamp;
state.controller_events = Array.isArray(state.controller_events) ? state.controller_events : [];
state.controller_events.push(event);
writeMissionState(root, missionId, state);
appendMissionEvent(root, missionId, event);

finish(SCRIPT_ID, issues, [`.ai/missions/${missionId}/mission-state.yaml`, `.ai/missions/${missionId}/mission-journal.ndjson`], {
  advanced: true,
  mission_id: missionId,
  previous_phase: previousPhase,
  current_phase: nextPhase,
  controller_mode: "observe",
  enforcement: "not_yet_enabled",
});
