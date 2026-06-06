import fs from "node:fs";
import { finish, issue, resolveConventionsRoot, type Issue } from "./lib/common.js";
import { missionCheckpointPath, missionIdFromArgs, missionJournalPath, missionStatePath, readMissionState, validateMissionCheckpoint, validateMissionJournal, validateMissionStateShape } from "./mission-controller-common.js";

const SCRIPT_ID = "inspect-mission-state";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const missionId = missionIdFromArgs();

if (!missionId) {
  issues.push(issue("error", "MISSION_ID_INVALID", "Mission id must be a non-empty path-safe identifier"));
  finish(SCRIPT_ID, issues, [], { inspected: false });
}

const state = readMissionState(root, missionId);
issues.push(...validateMissionStateShape(state, missionId));
const journal = validateMissionJournal(root, missionId, Boolean(state));
issues.push(...journal.issues);
issues.push(...validateMissionCheckpoint(root, missionId, state, journal, Boolean(state)));

finish(SCRIPT_ID, issues, [".ai/validation/inspect-mission-state.result.yaml"], {
  inspected: Boolean(state),
  mission_id: missionId,
  state_path: `.ai/missions/${missionId}/mission-state.yaml`,
  state_path_exists: fs.existsSync(missionStatePath(root, missionId)),
  journal_path_exists: fs.existsSync(missionJournalPath(root, missionId)),
  checkpoint_path_exists: fs.existsSync(missionCheckpointPath(root, missionId)),
  journal_event_count: journal.eventCount,
  current_phase: state?.current_phase ?? null,
  controller_mode: state?.controller_mode ?? null,
});
