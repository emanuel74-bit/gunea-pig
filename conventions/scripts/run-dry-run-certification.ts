import fs from "node:fs";
import path from "node:path";
import {
  buildUniversalValidationResult,
  finish,
  getArg,
  issue,
  readYamlFile,
  rel,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "run-dry-run-certification";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const scenarioArg = getArg("scenario");
const enforcementMode = getArg("enforcement-mode") ?? "observe";
const allowedModes = new Set(["observe", "controlled_enforce"]);
if (!allowedModes.has(enforcementMode)) {
  issues.push(issue("error", "UNKNOWN_CERTIFICATION_ENFORCEMENT_MODE", `Unknown dry-run certification enforcement mode: ${enforcementMode}`));
}

type Scenario = {
  scenario_id: string;
  required_evidence: string[];
};

const certificationConvention = path.join(root, "certification", "conventions.dry-run-certification.yaml");
const convention = fs.existsSync(certificationConvention) ? readYamlFile(certificationConvention) : {};
const scenarios: Scenario[] = Array.isArray(convention.sections?.required_scenarios)
  ? convention.sections.required_scenarios
      .filter((entry: JsonMap) => typeof entry?.scenario_id === "string")
      .map((entry: JsonMap) => ({
        scenario_id: String(entry.scenario_id),
        required_evidence: Array.isArray(entry.required_evidence) ? entry.required_evidence.filter((value: unknown) => typeof value === "string") : [],
      }))
  : [];

const requestedScenarioIds = scenarioArg
  ? scenarioArg.split(",").map(value => value.trim()).filter(Boolean)
  : scenarios.map(scenario => scenario.scenario_id);
const knownScenarioIds = new Set(scenarios.map(scenario => scenario.scenario_id));
for (const scenarioId of requestedScenarioIds) {
  if (!knownScenarioIds.has(scenarioId)) {
    issues.push(issue("error", "UNKNOWN_DRY_RUN_CERTIFICATION_SCENARIO", `Unknown dry-run certification scenario: ${scenarioId}`));
  }
}

const selectedScenarios = scenarios.filter(scenario => requestedScenarioIds.includes(scenario.scenario_id));
const evidencePaths: Record<string, string[]> = {
  mission_state: [".ai/missions/**/mission-state.yaml"],
  mission_checkpoint: [".ai/missions/**/mission-checkpoint.yaml"],
  mission_journal: [".ai/missions/**/mission-journal.ndjson"],
  phase_bundle: [".ai/bundles/**", ".ai/phase-bundles/**"],
  validation_result: [".ai/validation/*.result.yaml"],
  evidence_manifest: [".ai/reports/evidence-manifest.yaml"],
  source_artifact_manifest: [".ai/source-artifacts/source-artifact-manifest.yaml"],
  architecture_quality_analysis: [".ai/source-artifacts/architecture-quality-analysis.yaml"],
  safe_structure_analysis: [".ai/source-artifacts/safe-structure-change-analysis.yaml"],
  gate_result: [".ai/gates/*.gate-result.yaml"],
  revision_task: [".ai/revisions/*.yaml"],
  revision_loop_analysis: [".ai/revisions/revision-loop-analysis.yaml"],
  final_mission_report: [".ai/reports/final-mission-report.yaml"],
  transition_legality_result: [".ai/validation/validate-transition-legality.result.yaml"],
  mission_controller_block: [".ai/validation/advance-mission.result.yaml"],
};

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "__DOUBLE_STAR__").replace(/\*/g, "[^/]*").replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function listAiFiles(): string[] {
  const base = path.join(root, ".ai");
  const out: string[] = [];
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(rel(root, full));
    }
  }
  walk(base);
  return out.sort();
}

const aiFiles = listAiFiles();
function matchingFiles(evidenceType: string): string[] {
  const patterns = evidencePaths[evidenceType] ?? [];
  return aiFiles.filter(file => patterns.some(pattern => globToRegExp(pattern).test(file)));
}

const scenarioResults = selectedScenarios.map(scenario => {
  const evidenceChecks = scenario.required_evidence.map(evidenceType => {
    const matches = matchingFiles(evidenceType);
    if (!matches.length) {
      issues.push(issue("warning", "DRY_RUN_SCENARIO_EVIDENCE_MISSING", `Dry-run scenario ${scenario.scenario_id} is missing evidence type ${evidenceType}`));
    }
    return {
      evidence_type: evidenceType,
      status: matches.length ? "present" : "missing",
      matched_paths: matches,
    };
  });
  const missingEvidence = evidenceChecks.filter(check => check.status === "missing").map(check => check.evidence_type);
  return {
    scenario_id: scenario.scenario_id,
    status: missingEvidence.length ? "incomplete" : "certified",
    required_evidence: scenario.required_evidence,
    missing_evidence: missingEvidence,
    evidence_checks: evidenceChecks,
  };
});

const duplicateIds = scenarios.map(s => s.scenario_id).filter((id, index, list) => list.indexOf(id) !== index);
for (const id of [...new Set(duplicateIds)]) {
  issues.push(issue("error", "DUPLICATE_DRY_RUN_SCENARIO_ID", `Duplicate dry-run certification scenario id: ${id}`));
}
if (!scenarios.length) {
  issues.push(issue("error", "DRY_RUN_CERTIFICATION_SCENARIOS_MISSING", "Dry-run certification convention declares no required scenarios."));
}

const incompleteCount = scenarioResults.filter(result => result.status !== "certified").length;
const blockingDecision = enforcementMode === "controlled_enforce" && incompleteCount > 0;
if (blockingDecision) {
  issues.push(issue("error", "DRY_RUN_CERTIFICATION_INCOMPLETE", "Dry-run certification is incomplete in controlled enforcement mode."));
}

const certification = {
  artifact: "dry_run_certification_result",
  generated_by: SCRIPT_ID,
  rollout_mode: "observe",
  enforcement_mode: enforcementMode,
  mutation_allowed: false,
  language_neutral: true,
  framework_neutral: true,
  adapter_outputs_required: false,
  selected_scenario_count: selectedScenarios.length,
  certified_scenario_count: scenarioResults.length - incompleteCount,
  incomplete_scenario_count: incompleteCount,
  blocking_decision: blockingDecision,
  scenario_results: scenarioResults,
};

const validationResult = buildUniversalValidationResult(SCRIPT_ID, issues, {
  route_id: "run_dry_run_certification",
  evidence: scenarioResults.map(result => ({ evidence_type: "dry_run_certification_scenario", path: ".ai/certification/dry-run-certification.yaml", scenario_id: result.scenario_id, status: result.status })),
  summary: {
    selected_scenario_count: certification.selected_scenario_count,
    certified_scenario_count: certification.certified_scenario_count,
    incomplete_scenario_count: certification.incomplete_scenario_count,
    enforcement_mode: enforcementMode,
  },
});
(certification as JsonMap).validation_result = validationResult;

const certificationPath = path.join(root, ".ai", "certification", "dry-run-certification.yaml");
const reportPath = path.join(root, ".ai", "reports", "dry-run-certification-report.yaml");
writeYamlFile(certificationPath, certification);
writeYamlFile(reportPath, {
  artifact: "dry_run_certification_report",
  generated_by: SCRIPT_ID,
  summary: {
    selected_scenario_count: certification.selected_scenario_count,
    certified_scenario_count: certification.certified_scenario_count,
    incomplete_scenario_count: certification.incomplete_scenario_count,
    blocking_decision: blockingDecision,
    enforcement_mode: enforcementMode,
  },
  scenario_results: scenarioResults,
  validation_result: validationResult,
});

finish(SCRIPT_ID, issues, [".ai/certification/dry-run-certification.yaml", ".ai/reports/dry-run-certification-report.yaml"], {
  certification_result: ".ai/certification/dry-run-certification.yaml",
  certification_report: ".ai/reports/dry-run-certification-report.yaml",
  validation_result: validationResult,
});
