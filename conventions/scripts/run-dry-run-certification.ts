import crypto from "node:crypto";
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
const materializeFixtureEvidence = ["true", "1", "yes"].includes(String(getArg("materialize-fixture-evidence") ?? "false"));
const requireAllDeclaredScenarios = ["true", "1", "yes"].includes(String(getArg("require-all-declared-scenarios") ?? "false"));
const allowedModes = new Set(["observe", "controlled_enforce"]);
if (!allowedModes.has(enforcementMode)) {
  issues.push(issue("error", "UNKNOWN_CERTIFICATION_ENFORCEMENT_MODE", `Unknown dry-run certification enforcement mode: ${enforcementMode}`));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonMap).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

type Scenario = {
  scenario_id: string;
  required_evidence: string[];
};

type ScenarioFixture = {
  fixture_id: string;
  scenario_id: string;
  fixture_path: string;
  execution_mode: string;
  mutation_allowed: boolean;
  language_neutral: boolean;
  framework_neutral: boolean;
};

type FixtureEvidenceArtifact = {
  evidence_type: string;
  path: string;
  artifact: string;
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

const uniqueRequestedScenarioIds = [...new Set(requestedScenarioIds)];
const missingRequiredScenarioSelections = scenarios
  .map(scenario => scenario.scenario_id)
  .filter(scenarioId => !uniqueRequestedScenarioIds.includes(scenarioId));
const unknownRequestedScenarioIds = uniqueRequestedScenarioIds.filter(scenarioId => !knownScenarioIds.has(scenarioId));
if (requireAllDeclaredScenarios && (missingRequiredScenarioSelections.length || unknownRequestedScenarioIds.length || uniqueRequestedScenarioIds.length !== scenarios.length)) {
  issues.push(issue("error", "DRY_RUN_AGGREGATE_SCENARIO_SELECTION_INCOMPLETE", "Aggregate dry-run certification requires selecting every declared scenario and no unknown scenarios."));
}

const fixtureEntries: ScenarioFixture[] = Array.isArray(convention.sections?.scenario_fixtures)
  ? convention.sections.scenario_fixtures
      .filter((entry: JsonMap) => entry && typeof entry === "object")
      .map((entry: JsonMap) => ({
        fixture_id: typeof entry.fixture_id === "string" ? entry.fixture_id : "",
        scenario_id: typeof entry.scenario_id === "string" ? entry.scenario_id : "",
        fixture_path: typeof entry.fixture_path === "string" ? entry.fixture_path : "",
        execution_mode: typeof entry.execution_mode === "string" ? entry.execution_mode : "",
        mutation_allowed: entry.mutation_allowed === true,
        language_neutral: entry.language_neutral === true,
        framework_neutral: entry.framework_neutral === true,
      }))
  : [];

const allowedFixtureExecutionModes = new Set(["artifact_presence_validation"]);
const fixtureIds = fixtureEntries.map(fixture => fixture.fixture_id).filter(Boolean);
for (const fixtureId of [...new Set(fixtureIds.filter((id, index, list) => list.indexOf(id) !== index))]) {
  issues.push(issue("error", "DUPLICATE_DRY_RUN_FIXTURE_ID", `Duplicate dry-run certification fixture id: ${fixtureId}`));
}

function validateScenarioFixture(fixture: ScenarioFixture): JsonMap {
  const fixtureIssues: Issue[] = [];
  if (!fixture.fixture_id) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_ID_MISSING", "Dry-run certification fixture is missing fixture_id."));
  if (!fixture.scenario_id || !knownScenarioIds.has(fixture.scenario_id)) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_SCENARIO_UNKNOWN", `Dry-run certification fixture ${fixture.fixture_id || "<unknown>"} references unknown scenario ${fixture.scenario_id || "<missing>"}.`));
  if (!fixture.fixture_path) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_PATH_MISSING", `Dry-run certification fixture ${fixture.fixture_id || "<unknown>"} is missing fixture_path.`));
  if (!allowedFixtureExecutionModes.has(fixture.execution_mode)) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_EXECUTION_MODE_UNKNOWN", `Dry-run certification fixture ${fixture.fixture_id || "<unknown>"} uses unsupported execution_mode ${fixture.execution_mode || "<missing>"}.`));
  if (fixture.mutation_allowed) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_MUTATION_ALLOWED", `Dry-run certification fixture ${fixture.fixture_id || "<unknown>"} allows mutation.`));
  if (!fixture.language_neutral) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_NOT_LANGUAGE_NEUTRAL", `Dry-run certification fixture ${fixture.fixture_id || "<unknown>"} is not language neutral.`));
  if (!fixture.framework_neutral) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_NOT_FRAMEWORK_NEUTRAL", `Dry-run certification fixture ${fixture.fixture_id || "<unknown>"} is not framework neutral.`));

  const absoluteFixturePath = fixture.fixture_path ? path.join(root, fixture.fixture_path) : "";
  let fixtureDocument: JsonMap = {};
  if (absoluteFixturePath && !fs.existsSync(absoluteFixturePath)) {
    fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_FILE_MISSING", `Dry-run certification fixture file is missing: ${fixture.fixture_path}`));
  } else if (absoluteFixturePath) {
    fixtureDocument = readYamlFile(absoluteFixturePath);
    const identity = fixtureDocument.sections?.fixture_identity ?? {};
    const boundaries = fixtureDocument.sections?.fixture_boundaries ?? {};
    if (identity.fixture_id !== fixture.fixture_id) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_ID_MISMATCH", `Dry-run certification fixture file ${fixture.fixture_path} does not match registered fixture_id ${fixture.fixture_id}.`));
    if (identity.scenario_id !== fixture.scenario_id) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_SCENARIO_MISMATCH", `Dry-run certification fixture file ${fixture.fixture_path} does not match registered scenario_id ${fixture.scenario_id}.`));
    if (identity.execution_mode !== fixture.execution_mode) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_EXECUTION_MODE_MISMATCH", `Dry-run certification fixture file ${fixture.fixture_path} does not match registered execution_mode ${fixture.execution_mode}.`));
    if (boundaries.mutation_allowed !== false || boundaries.source_mutation_allowed !== false) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_FILE_MUTATION_ALLOWED", `Dry-run certification fixture file ${fixture.fixture_path} does not explicitly forbid mutation.`));
    if (boundaries.language_neutral !== true || boundaries.framework_neutral !== true) fixtureIssues.push(issue("error", "DRY_RUN_FIXTURE_FILE_NOT_ADAPTER_NEUTRAL", `Dry-run certification fixture file ${fixture.fixture_path} is not explicitly adapter neutral.`));
  }

  issues.push(...fixtureIssues);
  return {
    fixture_id: fixture.fixture_id,
    scenario_id: fixture.scenario_id,
    fixture_path: fixture.fixture_path,
    execution_mode: fixture.execution_mode,
    mutation_allowed: fixture.mutation_allowed,
    language_neutral: fixture.language_neutral,
    framework_neutral: fixture.framework_neutral,
    status: fixtureIssues.length ? "fixture_invalid" : "fixture_valid",
    issue_codes: fixtureIssues.map(entry => entry.code),
  };
}

const fixtureChecks = fixtureEntries.map(validateScenarioFixture);

function selectedFixtures(): ScenarioFixture[] {
  const requested = new Set(requestedScenarioIds);
  return fixtureEntries.filter(fixture => requested.has(fixture.scenario_id));
}

function readFixtureEvidenceArtifacts(fixture: ScenarioFixture): FixtureEvidenceArtifact[] {
  if (!fixture.fixture_path) return [];
  const absoluteFixturePath = path.join(root, fixture.fixture_path);
  if (!fs.existsSync(absoluteFixturePath)) return [];
  const fixtureDocument = readYamlFile(absoluteFixturePath);
  const evidenceConfig = fixtureDocument.sections?.fixture_evidence_artifacts ?? {};
  if (evidenceConfig.materialization_mode && evidenceConfig.materialization_mode !== "explicit_route_argument_only") {
    issues.push(issue("error", "DRY_RUN_FIXTURE_EVIDENCE_MODE_UNSUPPORTED", `Dry-run fixture ${fixture.fixture_id} uses unsupported evidence materialization mode ${evidenceConfig.materialization_mode}.`, fixture.fixture_path));
    return [];
  }
  if (evidenceConfig.mutation_allowed === true) {
    issues.push(issue("error", "DRY_RUN_FIXTURE_EVIDENCE_MUTATION_ALLOWED", `Dry-run fixture ${fixture.fixture_id} evidence materialization allows mutation.`, fixture.fixture_path));
    return [];
  }
  return Array.isArray(evidenceConfig.artifacts)
    ? evidenceConfig.artifacts
        .filter((entry: JsonMap) => entry && typeof entry === "object")
        .map((entry: JsonMap) => ({
          evidence_type: typeof entry.evidence_type === "string" ? entry.evidence_type : "",
          path: typeof entry.path === "string" ? entry.path : "",
          artifact: typeof entry.artifact === "string" ? entry.artifact : "",
        }))
    : [];
}

function materializeEvidenceArtifact(fixture: ScenarioFixture, artifact: FixtureEvidenceArtifact): string | null {
  if (!artifact.evidence_type || !artifact.path || !artifact.artifact) {
    issues.push(issue("error", "DRY_RUN_FIXTURE_EVIDENCE_ARTIFACT_MALFORMED", `Dry-run fixture ${fixture.fixture_id} declares malformed evidence artifact metadata.`, fixture.fixture_path));
    return null;
  }
  if (!artifact.path.startsWith(".ai/")) {
    issues.push(issue("error", "DRY_RUN_FIXTURE_EVIDENCE_PATH_OUTSIDE_AI", `Dry-run fixture evidence artifact must be written under .ai: ${artifact.path}`, fixture.fixture_path));
    return null;
  }

  const requiredEvidenceTypes = new Set(scenarios.find(scenario => scenario.scenario_id === fixture.scenario_id)?.required_evidence ?? []);
  if (!requiredEvidenceTypes.has(artifact.evidence_type)) {
    issues.push(issue("error", "DRY_RUN_FIXTURE_EVIDENCE_TYPE_NOT_REQUIRED", `Dry-run fixture ${fixture.fixture_id} declares evidence type not required by scenario ${fixture.scenario_id}: ${artifact.evidence_type}`, fixture.fixture_path));
    return null;
  }

  const baseArtifact = {
    artifact: artifact.artifact,
    generated_by: SCRIPT_ID,
    producer_route_id: "run_dry_run_certification",
    route_produced: true,
    dry_run_fixture: true,
    fixture_id: fixture.fixture_id,
    scenario_id: fixture.scenario_id,
    evidence_type: artifact.evidence_type,
    rollout_mode: "observe",
    mutation_allowed: false,
    language_neutral: true,
    framework_neutral: true,
  };

  const validationIssues = fixture.scenario_id === "gate_block"
    ? [issue("error", "DRY_RUN_GATE_BLOCK_FIXTURE_BLOCKING_VALIDATION", "Dry-run gate_block fixture intentionally materializes a blocking validation result for certification evidence.")]
    : [];

  const content = artifact.evidence_type === "validation_result"
    ? {
        ...baseArtifact,
        status: validationIssues.length ? "failed" : "pass",
        result: validationIssues.length ? "fail" : "pass",
        expected_gate_decision: fixture.scenario_id === "gate_block" ? "block_transition" : undefined,
        validation_result: buildUniversalValidationResult(`${fixture.fixture_id}-validation-only`, validationIssues, {
          route_id: "run_dry_run_certification",
          evidence: [{ evidence_type: artifact.evidence_type, path: artifact.path, scenario_id: fixture.scenario_id, fixture_id: fixture.fixture_id }],
          summary: { dry_run_fixture: true, materialized_by: SCRIPT_ID, intentionally_blocking: fixture.scenario_id === "gate_block" },
        }),
      }
    : artifact.evidence_type === "gate_result"
      ? {
          ...baseArtifact,
          artifact: "gate_result",
          status: "blocked",
          gate_id: `dry-run-${fixture.scenario_id}`,
          validation_status: "failed",
          validation_result_contract: {
            validation_id: `${fixture.fixture_id}-validation-only`,
            status: "failed",
            severity: "error",
            blocking: true,
            source_shape: "universal",
          },
          decision: "block_transition",
          evidence_refs: readFixtureEvidenceArtifacts(fixture).filter(item => item.evidence_type === "validation_result").map(item => item.path),
          dry_run_gate_result: true,
          real_gate_result_provenance_claimed: false,
          errors: validationIssues,
        }
    : artifact.evidence_type === "revision_task"
      ? {
          ...baseArtifact,
          artifact: "revision_task",
          status: "created",
          revision_id: `dry-run-${fixture.scenario_id}`,
          failure: "dry_run_revision_loop_fixture_failure",
          failure_fingerprint: "dry-run-revision-loop-fingerprint",
          required_action: "resolve_blocking_failure_and_revalidate",
          validation_required_routes: ["validate_revision_task", "validate_changed_files"],
          dry_run_revision_task: true,
          real_revision_task_provenance_claimed: false,
          retry_control: { rollout_mode: "observe", enforcement: "disabled", analyzer_route: "analyze_revision_loop" },
        }
    : artifact.evidence_type === "revision_loop_analysis"
      ? {
          ...baseArtifact,
          artifact: "revision_loop_analysis",
          rollout_mode: "observe",
          enforcement: "disabled",
          mission_id: `dry-run-${fixture.scenario_id}`,
          active_failure_fingerprint: "dry-run-revision-loop-fingerprint",
          observe_retry_budget: 3,
          active_fingerprint_count: 1,
          repeated_fingerprints: [],
          no_progress_suspected: false,
          blocking_decision: false,
          revision_task_count: 1,
          revision_tasks: readFixtureEvidenceArtifacts(fixture)
            .filter(item => item.evidence_type === "revision_task")
            .map(item => ({
              path: item.path,
              revision_id: `dry-run-${fixture.scenario_id}`,
              status: "created",
              failure_fingerprint: "dry-run-revision-loop-fingerprint",
              required_action: "resolve_blocking_failure_and_revalidate",
            })),
          warnings: [],
          dry_run_revision_loop_analysis: true,
          real_revision_loop_analysis_provenance_claimed: false,
        }
    : artifact.evidence_type === "mission_state"
      ? {
          ...baseArtifact,
          artifact: "mission_state",
          schema_version: "1.0",
          status: "observed",
          mission_id: `dry-run-${fixture.scenario_id}`,
          selected_profile: fixture.scenario_id,
          mission_profile: fixture.scenario_id,
          controller_mode: "observe",
          current_phase: fixture.scenario_id === "resume_after_shutdown" ? "resume_validation" : "validation",
          implementation_allowed: false,
          active_phase_plan: {
            ordered_phases: ["mission_profile_selection", "validation", "resume_validation"],
            required_phases: ["validation"],
            conditional_phases: ["resume_validation"],
            forbidden_phases: [],
            skipped_phases: [],
            blocked_phases: [],
          },
          phase_statuses: [],
          report_registry_ref: ".ai/reports/report-registry.yaml",
          active_triggers: [],
          blocked_items: [],
          completed_reports: [],
          invalidated_outputs: [],
          revision_history: [],
          rerun_requests: [],
          user_approvals: [],
          controller_events: [],
          created_by: SCRIPT_ID,
          created_at: nowIso(),
          updated_at: nowIso(),
          dry_run_state: true,
          real_resume_provenance_claimed: false,
        }
      : artifact.evidence_type === "mission_checkpoint"
        ? {
            ...baseArtifact,
            artifact: "mission_checkpoint",
            schema_version: "1.0",
            status: "present",
            mission_id: `dry-run-${fixture.scenario_id}`,
            controller_mode: "observe",
            current_phase: "resume_validation",
            state_path: `.ai/missions/dry-run-${fixture.scenario_id}/mission-state.yaml`,
            journal_path: `.ai/missions/dry-run-${fixture.scenario_id}/mission-journal.ndjson`,
            journal_event_count: 2,
            last_event_sequence: 2,
            last_event_type: "resume_requested",
            state_hash: sha256({ mission_id: `dry-run-${fixture.scenario_id}`, scenario_id: fixture.scenario_id, current_phase: "resume_validation" }),
            updated_at: nowIso(),
            dry_run_checkpoint: true,
            real_resume_provenance_claimed: false,
          }
        : artifact.evidence_type === "transition_legality_result"
          ? {
              ...baseArtifact,
              artifact: "transition_legality_result",
              status: "failed",
              result: "fail",
              valid_transition: false,
              previous_phase: "mission_created",
              requested_phase: "implementation",
              expected_next_phase: "mission_profile_selection",
              transition_reason: "dry_run_illegal_transition_rejection_fixture",
              rollout_mode: "observe",
              enforcement: "graph_illegal_blocked",
              blocked_transition: true,
              transition_legality_allowed: false,
              transition_legality: {
                allowed: false,
                expected_next_phase: "mission_profile_selection",
                requested_phase: "implementation",
                reason: "dry_run_illegal_transition_rejection_fixture",
                preconditions: [
                  { precondition_id: "phase_order", required: true, satisfied: false, expected: "mission_profile_selection", actual: "implementation" },
                ],
                missing_precondition_count: 1,
              },
              validation_result: buildUniversalValidationResult(`${fixture.fixture_id}-transition-legality`, [issue("error", "DRY_RUN_ILLEGAL_TRANSITION_REJECTED", "Dry-run illegal_transition_rejection fixture intentionally materializes a rejected transition legality result.")], {
                route_id: "run_dry_run_certification",
                evidence: [{ evidence_type: artifact.evidence_type, path: artifact.path, scenario_id: fixture.scenario_id, fixture_id: fixture.fixture_id }],
                summary: { dry_run_fixture: true, materialized_by: SCRIPT_ID, illegal_transition_rejected: true },
              }),
              dry_run_transition_legality_result: true,
              real_transition_legality_provenance_claimed: false,
            }
          : artifact.evidence_type === "mission_controller_block"
            ? {
                ...baseArtifact,
                artifact: "mission_controller_block",
                status: "blocked",
                result: "fail",
                advanced: false,
                mission_id: `dry-run-${fixture.scenario_id}`,
                previous_phase: "mission_created",
                requested_phase: "implementation",
                controller_mode: "observe",
                enforcement: "graph_illegal_blocked",
                transition_legality_allowed: false,
                transition_reason: "dry_run_illegal_transition_rejection_fixture",
                expected_next_phase: "mission_profile_selection",
                transition_preconditions: [
                  { precondition_id: "phase_order", required: true, satisfied: false, expected: "mission_profile_selection", actual: "implementation" },
                ],
                missing_precondition_count: 1,
                validation_result: buildUniversalValidationResult(`${fixture.fixture_id}-controller-block`, [issue("error", "DRY_RUN_MISSION_CONTROLLER_BLOCKED_ILLEGAL_TRANSITION", "Dry-run illegal_transition_rejection fixture intentionally materializes a controller block result.")], {
                  route_id: "run_dry_run_certification",
                  evidence: [{ evidence_type: artifact.evidence_type, path: artifact.path, scenario_id: fixture.scenario_id, fixture_id: fixture.fixture_id }],
                  summary: { dry_run_fixture: true, materialized_by: SCRIPT_ID, controller_blocked: true },
                }),
                dry_run_mission_controller_block: true,
                real_mission_controller_block_provenance_claimed: false,
              }
            : artifact.evidence_type === "mission_journal"
          ? [
              {
                mission_id: `dry-run-${fixture.scenario_id}`,
                event_sequence: 1,
                previous_event_sequence: null,
                event_type: "mission_initialized",
                route_id: "run_dry_run_certification",
                timestamp: nowIso(),
                state_hash_after: sha256({ mission_id: `dry-run-${fixture.scenario_id}`, scenario_id: fixture.scenario_id, current_phase: "validation" }),
                dry_run_fixture: true,
                fixture_id: fixture.fixture_id,
              },
              {
                mission_id: `dry-run-${fixture.scenario_id}`,
                event_sequence: 2,
                previous_event_sequence: 1,
                event_type: "resume_requested",
                route_id: "run_dry_run_certification",
                timestamp: nowIso(),
                state_hash_after: sha256({ mission_id: `dry-run-${fixture.scenario_id}`, scenario_id: fixture.scenario_id, current_phase: "resume_validation" }),
                dry_run_fixture: true,
                fixture_id: fixture.fixture_id,
              },
            ]
          : artifact.evidence_type === "phase_bundle"
        ? {
            ...baseArtifact,
            status: "present",
            mission_profile: fixture.scenario_id,
            bundle_scope: "dry_run_validation_only",
            included_runtime_context: [],
            required_executor_routes: ["run_dry_run_certification", "collect_evidence"],
          }
        : {
            ...baseArtifact,
            status: "present",
          };

  const outputPath = path.join(root, artifact.path);
  if (artifact.evidence_type === "mission_journal") {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${(content as JsonMap[]).map(entry => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  } else {
    writeYamlFile(outputPath, content as JsonMap);
  }
  return artifact.path;
}

function materializeSelectedFixtureEvidence(): string[] {
  if (!materializeFixtureEvidence) return [];
  const written: string[] = [];
  for (const fixture of selectedFixtures()) {
    const fixtureCheck = fixtureChecks.find(check => check.fixture_id === fixture.fixture_id);
    if (fixtureCheck?.status !== "fixture_valid") {
      issues.push(issue("warning", "DRY_RUN_FIXTURE_EVIDENCE_SKIPPED_INVALID_FIXTURE", `Dry-run fixture evidence materialization skipped invalid fixture ${fixture.fixture_id}.`, fixture.fixture_path));
      continue;
    }
    for (const artifact of readFixtureEvidenceArtifacts(fixture)) {
      const writtenPath = materializeEvidenceArtifact(fixture, artifact);
      if (writtenPath) written.push(writtenPath);
    }
  }
  if (!written.length) {
    issues.push(issue("warning", "DRY_RUN_FIXTURE_EVIDENCE_NOT_MATERIALIZED", "No dry-run fixture evidence artifacts were materialized."));
  }
  return written;
}

const materializedFixtureEvidence = materializeSelectedFixtureEvidence();

const selectedScenarios = scenarios.filter(scenario => uniqueRequestedScenarioIds.includes(scenario.scenario_id));
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
  revision_task: [".ai/revisions/*.revision-task.yaml", ".ai/revisions/*.yaml"],
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
function artifactMatchesEvidenceType(file: string, evidenceType: string): boolean {
  if (evidenceType === "mission_journal") {
    try {
      const lines = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/).filter(line => line.trim());
      if (!lines.length) return false;
      return lines.every((line, index) => {
        const event = JSON.parse(line) as JsonMap;
        return event && typeof event === "object"
          && event.event_sequence === index + 1
          && typeof event.mission_id === "string"
          && typeof event.event_type === "string"
          && typeof event.route_id === "string"
          && typeof event.timestamp === "string"
          && typeof event.state_hash_after === "string";
      });
    } catch {
      return false;
    }
  }
  if (!["mission_state", "mission_checkpoint", "revision_task", "revision_loop_analysis", "evidence_manifest", "final_mission_report", "transition_legality_result", "mission_controller_block", "source_artifact_manifest", "architecture_quality_analysis", "safe_structure_analysis"].includes(evidenceType)) return true;
  try {
    const doc = readYamlFile(path.join(root, file));
    if (evidenceType === "mission_state") return doc.artifact === "mission_state";
    if (evidenceType === "mission_checkpoint") return doc.artifact === "mission_checkpoint";
    if (evidenceType === "source_artifact_manifest") return doc.artifact === "source_artifact_manifest" && doc.generated_by === "collect-source-artifacts" && Array.isArray(doc.files) && Array.isArray(doc.dependency_edges) && typeof doc.source_file_count === "number";
    if (evidenceType === "architecture_quality_analysis") return doc.artifact === "architecture_quality_analysis" && doc.generated_by === "analyze-architecture-quality" && doc.core_contract?.adapter_neutral === true && doc.core_contract?.hardcoded_adapter_discovery_allowed === false && Array.isArray(doc.quality_dimensions);
    if (evidenceType === "safe_structure_analysis") return doc.artifact === "safe_structure_change_analysis" && doc.generated_by === "analyze-safe-structure-change" && doc.requested_change?.behavior_evidence_provided === true && doc.requested_change?.consumer_update_plan_provided === true && doc.blocking_decision === false;
    if (evidenceType === "revision_task") return doc.artifact === "revision_task";
    if (evidenceType === "revision_loop_analysis") return doc.artifact === "revision_loop_analysis";
    if (evidenceType === "evidence_manifest") return doc.artifact === "evidence_manifest_v2" && doc.schema_version === "2.0" && doc.generated_by === "collect-evidence" && Array.isArray(doc.entries);
    if (evidenceType === "final_mission_report") return doc.artifact === "final_mission_report" && doc.generated_by === "generate-final-mission-report" && doc.summary_source === "typed_report_claims" && doc.evidence_manifest === ".ai/reports/evidence-manifest.yaml" && Array.isArray(doc.report_claims);
    if (evidenceType === "transition_legality_result") return doc.artifact === "transition_legality_result" && doc.valid_transition === false && doc.transition_legality_allowed === false && doc.real_transition_legality_provenance_claimed === false;
    return doc.artifact === "mission_controller_block" && doc.advanced === false && doc.transition_legality_allowed === false && doc.real_mission_controller_block_provenance_claimed === false;
  } catch {
    return false;
  }
}

function matchingFiles(evidenceType: string): string[] {
  const patterns = evidencePaths[evidenceType] ?? [];
  return aiFiles.filter(file => patterns.some(pattern => globToRegExp(pattern).test(file)) && artifactMatchesEvidenceType(file, evidenceType));
}

const scenarioResults = selectedScenarios.map(scenario => {
  const scenarioFixtureChecks = fixtureChecks.filter(check => check.scenario_id === scenario.scenario_id);
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
    fixture_checks: scenarioFixtureChecks,
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
const aggregateAllDeclaredScenariosCertified = requireAllDeclaredScenarios
  && missingRequiredScenarioSelections.length === 0
  && unknownRequestedScenarioIds.length === 0
  && selectedScenarios.length === scenarios.length
  && incompleteCount === 0;
if (requireAllDeclaredScenarios && incompleteCount > 0) {
  issues.push(issue("error", "DRY_RUN_AGGREGATE_CERTIFICATION_INCOMPLETE", "Aggregate dry-run certification requires every declared scenario to be certified."));
}
const blockingDecision = enforcementMode === "controlled_enforce" && (incompleteCount > 0 || (requireAllDeclaredScenarios && !aggregateAllDeclaredScenariosCertified));
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
  fixture_count: fixtureChecks.length,
  valid_fixture_count: fixtureChecks.filter(check => check.status === "fixture_valid").length,
  materialized_fixture_evidence_count: materializedFixtureEvidence.length,
  materialized_fixture_evidence_paths: materializedFixtureEvidence,
  require_all_declared_scenarios: requireAllDeclaredScenarios,
  aggregate_required_scenario_validation: {
    required: requireAllDeclaredScenarios,
    declared_scenario_count: scenarios.length,
    selected_scenario_count: selectedScenarios.length,
    all_declared_scenarios_selected: missingRequiredScenarioSelections.length === 0 && unknownRequestedScenarioIds.length === 0 && selectedScenarios.length === scenarios.length,
    all_declared_scenarios_certified: aggregateAllDeclaredScenariosCertified,
    missing_required_scenario_selections: missingRequiredScenarioSelections,
    unknown_requested_scenario_ids: unknownRequestedScenarioIds,
    selected_scenario_ids: selectedScenarios.map(scenario => scenario.scenario_id),
  },
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
    fixture_count: certification.fixture_count,
    valid_fixture_count: certification.valid_fixture_count,
    materialized_fixture_evidence_count: certification.materialized_fixture_evidence_count,
    require_all_declared_scenarios: requireAllDeclaredScenarios,
    all_declared_scenarios_certified: aggregateAllDeclaredScenariosCertified,
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
    fixture_count: certification.fixture_count,
    valid_fixture_count: certification.valid_fixture_count,
    materialized_fixture_evidence_count: certification.materialized_fixture_evidence_count,
    require_all_declared_scenarios: requireAllDeclaredScenarios,
    all_declared_scenarios_certified: aggregateAllDeclaredScenariosCertified,
    blocking_decision: blockingDecision,
    enforcement_mode: enforcementMode,
  },
  scenario_results: scenarioResults,
  materialized_fixture_evidence_paths: materializedFixtureEvidence,
  validation_result: validationResult,
});

finish(SCRIPT_ID, issues, [".ai/certification/dry-run-certification.yaml", ".ai/reports/dry-run-certification-report.yaml", ...materializedFixtureEvidence], {
  certification_result: ".ai/certification/dry-run-certification.yaml",
  certification_report: ".ai/reports/dry-run-certification-report.yaml",
  materialized_fixture_evidence_paths: materializedFixtureEvidence,
  validation_result: validationResult,
});
