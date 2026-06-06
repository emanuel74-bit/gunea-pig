import fs from "node:fs";
import { finish, issue, resolveConventionsRoot, type Issue } from "./lib/common.js";
import { missionIdFromArgs, missionJournalPath, missionStatePath, readMissionState } from "./mission-controller-common.js";

const SCRIPT_ID = "inspect-mission-state";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const missionId = missionIdFromArgs();

if (!missionId) {
  issues.push(issue("error", "MISSION_ID_INVALID", "Mission id must be a non-empty path-safe identifier"));
  finish(SCRIPT_ID, issues, [], { inspected: false });
}

const state = readMissionState(root, missionId);
if (!state) {
  issues.push(issue("error", "MISSION_STATE_MISSING", `Mission state is missing for mission ${missionId}`, `.ai/missions/${missionId}/mission-state.yaml`));
} else {
  if (state.mission_id !== missionId) issues.push(issue("error", "MISSION_STATE_ID_MISMATCH", `Mission state id ${state.mission_id} does not match requested ${missionId}`));
  if (state.controller_mode !== "observe") issues.push(issue("warning", "MISSION_CONTROLLER_MODE_UNEXPECTED", `Mission controller mode is ${state.controller_mode}; expected observe during rollout`));
  if (!state.current_phase) issues.push(issue("error", "MISSION_CURRENT_PHASE_MISSING", "Mission state is missing current_phase"));
  if (!Array.isArray(state.phase_statuses)) issues.push(issue("error", "MISSION_PHASE_STATUSES_INVALID", "Mission phase_statuses must be a list"));
}

finish(SCRIPT_ID, issues, [".ai/validation/inspect-mission-state.result.yaml"], {
  inspected: Boolean(state),
  mission_id: missionId,
  state_path: `.ai/missions/${missionId}/mission-state.yaml`,
  state_path_exists: fs.existsSync(missionStatePath(root, missionId)),
  journal_path_exists: fs.existsSync(missionJournalPath(root, missionId)),
  current_phase: state?.current_phase ?? null,
  controller_mode: state?.controller_mode ?? null,
});
