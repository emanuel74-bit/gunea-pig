import { finish, getArg, issue, resolveConventionsRoot, type Issue } from "./lib/common.js";
import { evaluateTransitionLegality, missionIdFromArgs, readMissionState, validateMissionCheckpoint, validateMissionJournal, validateMissionStateShape, hasBlockingMissionStateIssue } from "./mission-controller-common.js";

const SCRIPT_ID = "validate-transition-legality";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const missionId = missionIdFromArgs();
const requestedPhase = getArg("to-phase") ?? getArg("to_phase") ?? getArg("phase") ?? "";
const requestedEvent = getArg("event") ?? "advance_observed";

if (!missionId) {
  issues.push(issue("error", "MISSION_ID_INVALID", "Mission id must be a non-empty path-safe identifier"));
  finish(SCRIPT_ID, issues, [], { valid_transition: false });
}
if (!requestedPhase.trim()) {
  issues.push(issue("error", "MISSION_TRANSITION_TARGET_MISSING", "Transition validation requires --to-phase <phase_id>"));
  finish(SCRIPT_ID, issues, [], { valid_transition: false, mission_id: missionId });
}

const state = readMissionState(root, missionId);
issues.push(...validateMissionStateShape(state, missionId));
const journal = validateMissionJournal(root, missionId, Boolean(state));
issues.push(...journal.issues);
issues.push(...validateMissionCheckpoint(root, missionId, state, journal, Boolean(state)));

let evaluation = null;
if (state && !hasBlockingMissionStateIssue(issues)) {
  evaluation = evaluateTransitionLegality(root, String(state.current_phase ?? "mission_created"), requestedPhase.trim(), requestedEvent);
  issues.push(...evaluation.issues);
}

finish(SCRIPT_ID, issues, [".ai/validation/validate-transition-legality.result.yaml"], {
  valid_transition: evaluation?.allowed ?? false,
  mission_id: missionId,
  previous_phase: evaluation?.previous_phase ?? state?.current_phase ?? null,
  requested_phase: requestedPhase || null,
  expected_next_phase: evaluation?.expected_next_phase ?? null,
  transition_reason: evaluation?.reason ?? null,
  preconditions: evaluation?.preconditions ?? [],
  missing_precondition_count: evaluation?.preconditions.filter(item => item.required && !item.satisfied).length ?? 0,
  rollout_mode: "observe",
  enforcement: evaluation?.allowed === false && hasBlockingMissionStateIssue(evaluation.issues) ? "graph_illegal_blocked" : "warn_only",
});
