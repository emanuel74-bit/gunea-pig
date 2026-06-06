import fs from "node:fs";
import { finish, issue, resolveConventionsRoot, type Issue } from "./lib/common.js";
import { appendMissionEvent, baseMissionState, missionIdFromArgs, missionJournalPath, missionStatePath, nowIso, readMissionState, writeMissionState } from "./mission-controller-common.js";

const SCRIPT_ID = "initialize-mission";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const missionId = missionIdFromArgs();

if (!missionId) {
  issues.push(issue("error", "MISSION_ID_INVALID", "Mission id must be a non-empty path-safe identifier"));
  finish(SCRIPT_ID, issues, [], { initialized: false });
}

const existing = readMissionState(root, missionId);
if (existing && existing.mission_id !== missionId) {
  issues.push(issue("error", "MISSION_STATE_ID_MISMATCH", `Existing mission state id does not match requested mission id ${missionId}`));
  finish(SCRIPT_ID, issues, [], { initialized: false, mission_id: missionId });
}

const timestamp = nowIso();
const state = existing ?? baseMissionState(missionId);
state.controller_mode = "observe";
state.updated_at = timestamp;
state.initialized_by_route = "initialize_mission";
state.controller_events = Array.isArray(state.controller_events) ? state.controller_events : [];
state.controller_events.push({ event_type: existing ? "mission_initialization_observed" : "mission_initialized", route_id: "initialize_mission", timestamp });
writeMissionState(root, missionId, state);
appendMissionEvent(root, missionId, { event_type: existing ? "mission_initialization_observed" : "mission_initialized", route_id: "initialize_mission", mission_id: missionId, timestamp, controller_mode: "observe" });

finish(SCRIPT_ID, issues, [`.ai/missions/${missionId}/mission-state.yaml`, `.ai/missions/${missionId}/mission-journal.ndjson`], {
  initialized: true,
  existing_state: Boolean(existing),
  mission_id: missionId,
  state_path_exists: fs.existsSync(missionStatePath(root, missionId)),
  journal_path_exists: fs.existsSync(missionJournalPath(root, missionId)),
  controller_mode: "observe",
});
