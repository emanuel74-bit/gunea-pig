import { finish, issue, readYamlFile, resolveConventionsRoot, type Issue, type JsonMap } from "./lib/common.js";
import {
  appendMissionEvent,
  hasBlockingMissionStateIssue,
  missionCheckpointPath,
  missionIdFromArgs,
  nowIso,
  readMissionState,
  validateMissionCheckpoint,
  validateMissionJournal,
  validateMissionStateShape,
  writeMissionCheckpoint,
  writeMissionState,
} from "./mission-controller-common.js";

const SCRIPT_ID = "resume-mission";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const missionId = missionIdFromArgs();

if (!missionId) {
  issues.push(issue("error", "MISSION_ID_INVALID", "Mission id must be a non-empty path-safe identifier"));
  finish(SCRIPT_ID, issues, [], { resumed: false });
}

const state = readMissionState(root, missionId);
issues.push(...validateMissionStateShape(state, missionId));
const preJournal = validateMissionJournal(root, missionId, true);
issues.push(...preJournal.issues);
issues.push(...validateMissionCheckpoint(root, missionId, state, preJournal, true));

if (!state || hasBlockingMissionStateIssue(issues)) {
  finish(SCRIPT_ID, issues, [], { resumed: false, mission_id: missionId });
}

const checkpoint = readYamlFile(missionCheckpointPath(root, missionId));
const timestamp = nowIso();
const event: JsonMap = {
  event_type: "mission_resumed",
  route_id: "resume_mission",
  mission_id: missionId,
  timestamp,
  controller_mode: "observe",
  resumed_phase: state.current_phase ?? null,
  checkpoint_event_count_before_resume: checkpoint.journal_event_count ?? preJournal.eventCount,
};

state.controller_mode = "observe";
state.updated_at = timestamp;
state.last_resumed_at = timestamp;
state.controller_events = Array.isArray(state.controller_events) ? state.controller_events : [];
state.controller_events.push(event);
writeMissionState(root, missionId, state);
const appended = appendMissionEvent(root, missionId, event, state);
const postJournal = validateMissionJournal(root, missionId, true);
writeMissionCheckpoint(root, missionId, state, postJournal);

finish(SCRIPT_ID, issues, [`.ai/missions/${missionId}/mission-state.yaml`, `.ai/missions/${missionId}/mission-journal.ndjson`, `.ai/missions/${missionId}/mission-checkpoint.yaml`], {
  resumed: true,
  mission_id: missionId,
  event_sequence: appended.event_sequence,
  previous_journal_event_count: preJournal.eventCount,
  journal_event_count: postJournal.eventCount,
  current_phase: state.current_phase ?? null,
  controller_mode: "observe",
  checkpoint_path: `.ai/missions/${missionId}/mission-checkpoint.yaml`,
});
