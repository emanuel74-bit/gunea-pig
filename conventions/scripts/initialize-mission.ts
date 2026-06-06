import fs from "node:fs";
import { finish, issue, resolveConventionsRoot, type Issue } from "./lib/common.js";
import {
  appendMissionEvent,
  baseMissionState,
  hasBlockingMissionStateIssue,
  missionCheckpointPath,
  missionIdFromArgs,
  missionJournalPath,
  missionStatePath,
  nowIso,
  readMissionState,
  validateMissionCheckpoint,
  validateMissionJournal,
  validateMissionStateShape,
  writeMissionCheckpoint,
  writeMissionState,
} from "./mission-controller-common.js";

const SCRIPT_ID = "initialize-mission";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const missionId = missionIdFromArgs();

if (!missionId) {
  issues.push(issue("error", "MISSION_ID_INVALID", "Mission id must be a non-empty path-safe identifier"));
  finish(SCRIPT_ID, issues, [], { initialized: false });
}

const existing = readMissionState(root, missionId);
if (existing) {
  issues.push(...validateMissionStateShape(existing, missionId));
  const journal = validateMissionJournal(root, missionId, true);
  issues.push(...journal.issues);
  issues.push(...validateMissionCheckpoint(root, missionId, existing, journal, true));
  if (hasBlockingMissionStateIssue(issues)) {
    finish(SCRIPT_ID, issues, [], { initialized: false, mission_id: missionId, existing_state: true });
  }
}

const timestamp = nowIso();
const state = existing ?? baseMissionState(missionId);
state.controller_mode = "observe";
state.updated_at = timestamp;
state.initialized_by_route = "initialize_mission";
state.controller_events = Array.isArray(state.controller_events) ? state.controller_events : [];
const eventType = existing ? "mission_initialization_observed" : "mission_initialized";
const controllerEvent = { event_type: eventType, route_id: "initialize_mission", mission_id: missionId, timestamp, controller_mode: "observe" };
state.controller_events.push(controllerEvent);
writeMissionState(root, missionId, state);
const event = appendMissionEvent(root, missionId, controllerEvent, state);
writeMissionCheckpoint(root, missionId, state, validateMissionJournal(root, missionId, true));

finish(SCRIPT_ID, issues, [`.ai/missions/${missionId}/mission-state.yaml`, `.ai/missions/${missionId}/mission-journal.ndjson`, `.ai/missions/${missionId}/mission-checkpoint.yaml`], {
  initialized: true,
  existing_state: Boolean(existing),
  mission_id: missionId,
  event_sequence: event.event_sequence,
  state_path_exists: fs.existsSync(missionStatePath(root, missionId)),
  journal_path_exists: fs.existsSync(missionJournalPath(root, missionId)),
  checkpoint_path_exists: fs.existsSync(missionCheckpointPath(root, missionId)),
  controller_mode: "observe",
});
