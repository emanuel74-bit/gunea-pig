import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  finish,
  getArg,
  issue,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "evaluate-score-decision";
const ROUTE_ID = "evaluate_score_decision";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const missionId = getArg("mission-id") ?? getArg("mission_id");
const scoreFileArg = getArg("score-file") ?? getArg("score_file");
const policyPath = path.join(root, ".ai", "policy", "mission-mode-policy.yaml");
const scorePath = scoreFileArg
  ? (scoreFileArg.startsWith("/") ? scoreFileArg : path.join(root, scoreFileArg))
  : path.join(root, ".ai", "scoring", "score-vector.yaml");

function asRecord(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function relativeToRoot(filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function readOptionalYaml(filePath: string): JsonMap | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return readYamlFile(filePath);
}

const resolvedPolicy = readOptionalYaml(policyPath);
if (!resolvedPolicy) {
  issues.push(issue("error", "RESOLVED_MISSION_MODE_POLICY_MISSING", "Score decision evaluation requires .ai/policy/mission-mode-policy.yaml. Run resolve_mission_mode_policy first.", ".ai/policy/mission-mode-policy.yaml"));
}

const missionMode = typeof resolvedPolicy?.mission_mode === "string" ? resolvedPolicy.mission_mode : "unresolved";
const policy = asRecord(resolvedPolicy?.policy);
const thresholds = asRecord(policy.observe_thresholds);
const rolloutMode = typeof resolvedPolicy?.rollout_mode === "string" ? resolvedPolicy.rollout_mode : "observe";
const enforcement = typeof resolvedPolicy?.enforcement === "string" ? resolvedPolicy.enforcement : "disabled";

const providedScoreVector = readOptionalYaml(scorePath);
const scoreVectorRelativePath = relativeToRoot(scorePath);
let scores: JsonMap = {};

if (!providedScoreVector) {
  issues.push(issue("warning", "SCORE_VECTOR_MISSING", `Score vector was not found at ${scoreVectorRelativePath}; emitting insufficient-scores observe-mode decision.`, scoreVectorRelativePath));
} else {
  if (providedScoreVector.artifact !== "score_vector") {
    issues.push(issue("error", "SCORE_VECTOR_ARTIFACT_INVALID", "Score vector artifact must be 'score_vector'.", scoreVectorRelativePath));
  }
  if (!asRecord(providedScoreVector.scores) || !providedScoreVector.scores || Array.isArray(providedScoreVector.scores)) {
    issues.push(issue("error", "SCORE_VECTOR_SCORES_INVALID", "Score vector must contain a scores map.", scoreVectorRelativePath));
  } else {
    scores = asRecord(providedScoreVector.scores);
  }
}

for (const [scoreKey, scoreValue] of Object.entries(scores)) {
  if (typeof scoreValue !== "number" || Number.isNaN(scoreValue) || scoreValue < 0 || scoreValue > 1) {
    issues.push(issue("error", "SCORE_VALUE_OUT_OF_RANGE", `Score value for ${scoreKey} must be a number between 0 and 1.`, scoreVectorRelativePath, { score_key: scoreKey, value: scoreValue }));
  }
}

const scoreThresholdResults = Object.entries(thresholds).sort(([a], [b]) => a.localeCompare(b)).map(([scoreKey, rawThreshold]) => {
  const threshold = typeof rawThreshold === "number" ? rawThreshold : Number(rawThreshold);
  const rawScore = scores[scoreKey];
  const score = typeof rawScore === "number" && !Number.isNaN(rawScore) ? rawScore : null;
  const result = score === null ? "missing" : score >= threshold ? "met" : "below_threshold";
  if (result === "missing") {
    issues.push(issue("warning", "SCORE_THRESHOLD_SCORE_MISSING", `Score vector does not include threshold score key: ${scoreKey}`, scoreVectorRelativePath, { score_key: scoreKey, threshold }));
  } else if (result === "below_threshold") {
    issues.push(issue("warning", "SCORE_THRESHOLD_BELOW_OBSERVE", `Score ${scoreKey} is below observe threshold ${threshold}.`, scoreVectorRelativePath, { score_key: scoreKey, threshold, score }));
  }
  return { score_key: scoreKey, threshold, score, result };
});

const errorPresent = issues.some(entry => entry.severity === "error" || entry.severity === "critical");
const missingCount = scoreThresholdResults.filter(entry => entry.result === "missing").length;
const belowCount = scoreThresholdResults.filter(entry => entry.result === "below_threshold").length;
const warningCount = issues.filter(entry => entry.severity === "warning").length;

const deterministicRecommendation = errorPresent
  ? "invalid_scores_failed"
  : missingCount > 0 || !providedScoreVector
    ? "insufficient_scores_observe_only"
    : belowCount > 0 || warningCount > 0
      ? "proceed_with_warnings_observe_only"
      : "proceed_observe_only";

const decisionOut = ".ai/scoring/score-decision.yaml";
const reportOut = ".ai/reports/score-decision-report.yaml";
const validationOut = ".ai/validation/evaluate-score-decision.result.yaml";

const decision = {
  artifact: "score_decision",
  generated_by: SCRIPT_ID,
  status: errorPresent ? "failed" : "evaluated_observe_only",
  rollout_mode: rolloutMode,
  enforcement,
  blocking_decisions: "disabled_in_observe_mode",
  mission_id: missionId ?? resolvedPolicy?.mission_id ?? null,
  mission_mode: missionMode,
  score_vector_path: providedScoreVector ? scoreVectorRelativePath : null,
  score_threshold_results: scoreThresholdResults,
  missing_score_keys: scoreThresholdResults.filter(entry => entry.result === "missing").map(entry => entry.score_key),
  deterministic_recommendation: deterministicRecommendation,
  blocking_decision: false,
  warnings: issues.filter(entry => entry.severity === "warning").map(entry => entry.code).sort(),
};

const report = {
  artifact: "score_decision_report",
  generated_by: SCRIPT_ID,
  status: errorPresent ? "fail" : "pass",
  summary: {
    mission_id: decision.mission_id,
    mission_mode: decision.mission_mode,
    rollout_mode: decision.rollout_mode,
    enforcement: decision.enforcement,
    score_vector_present: Boolean(providedScoreVector),
    threshold_count: scoreThresholdResults.length,
    missing_score_count: missingCount,
    below_threshold_count: belowCount,
    deterministic_recommendation: decision.deterministic_recommendation,
    blocking_decision: decision.blocking_decision,
  },
};

writeYamlFile(path.join(root, decisionOut), decision);
writeYamlFile(path.join(root, reportOut), report);

finish(SCRIPT_ID, issues, [decisionOut, reportOut, validationOut], {
  mission_id: decision.mission_id,
  mission_mode: decision.mission_mode,
  rollout_mode: decision.rollout_mode,
  enforcement: decision.enforcement,
  deterministic_recommendation: decision.deterministic_recommendation,
  blocking_decision: decision.blocking_decision,
  validation_result: buildUniversalValidationResult(SCRIPT_ID, issues, {
    route_id: ROUTE_ID,
    mission_id: missionId,
    evidence: [
      { evidence_type: "resolved_mission_mode_policy", path: ".ai/policy/mission-mode-policy.yaml", producer_route: "resolve_mission_mode_policy" },
      { evidence_type: "score_decision", path: decisionOut, producer_route: ROUTE_ID },
      { evidence_type: "score_decision_report", path: reportOut, producer_route: ROUTE_ID },
    ],
    summary: {
      mission_mode: decision.mission_mode,
      deterministic_recommendation: decision.deterministic_recommendation,
      threshold_count: scoreThresholdResults.length,
      below_threshold_count: belowCount,
      missing_score_count: missingCount,
      blocking_decision: decision.blocking_decision,
    },
  }),
});
