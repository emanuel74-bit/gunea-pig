import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  ensureDir,
  finish,
  globMatches,
  issue,
  readExecutorRoutes,
  readYamlFile,
  resolveConventionsRoot,
  writeYamlFile,
  type Issue,
  type JsonMap,
} from "./lib/common.js";

const SCRIPT_ID = "verify-scripts";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const reportPath = path.join(root, ".ai", "reports", "script-verification-report.yaml");

const compiledScriptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conventions-script-build-"));
const tsc = childProcess.spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--outDir", compiledScriptRoot, "--rootDir", ".", "--noEmit", "false"], {
  cwd: path.join(root, "scripts"),
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 4,
});
if (tsc.status !== 0) {
  issues.push(issue("critical", "SCRIPT_BUILD_FAILED", "TypeScript script build failed before verification", undefined, { stdout: tsc.stdout, stderr: tsc.stderr }));
}


const buildNodeModules = path.join(compiledScriptRoot, "node_modules");
const sourceNodeModules = path.join(root, "scripts", "node_modules");
if (fs.existsSync(sourceNodeModules) && !fs.existsSync(buildNodeModules)) {
  fs.symlinkSync(sourceNodeModules, buildNodeModules, "dir");
}

interface ScriptRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  result?: JsonMap;
  writtenFiles: string[];
}

interface TestCase {
  name: string;
  routeId: string;
  script: string;
  category: "valid_input" | "missing_input" | "malformed_input" | "invalid_state" | "operation_correctness" | "output_contract";
  args?: string[];
  setup?: (fixtureRoot: string) => void;
  preRun?: (fixtureRoot: string) => void;
  expectedExit: number;
  expectedStatus: "pass" | "fail";
  expectedErrorCodes?: string[];
  expectedWarningCodes?: string[];
  expectedOutputs?: string[];
  assert?: (fixtureRoot: string, run: ScriptRun) => void;
}

function copyDirectory(source: string, target: string): void {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: copiedPath => {
      const base = path.basename(copiedPath);
      if (["node_modules", ".git", ".ai"].includes(base)) return false;
      if (base === "package-lock.json") return false;
      return true;
    },
  });
}

function listFiles(base: string): Set<string> {
  const out = new Set<string>();
  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git"].includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        out.add(path.relative(base, full).replace(/\\/g, "/"));
      }
    }
  }
  walk(base);
  return out;
}

function parseStdoutResult(stdout: string): JsonMap | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = YAML.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed as JsonMap : undefined;
  } catch {
    return undefined;
  }
}

function runScript(fixtureRoot: string, scriptRel: string, args: string[] = []): ScriptRun {
  const before = listFiles(fixtureRoot);
  const compiledRel = scriptRel.replace(/^scripts\//, "").replace(/\.ts$/, ".js");
  const scriptAbs = path.join(compiledScriptRoot, compiledRel);
  const child = childProcess.spawnSync(process.execPath, [scriptAbs, "--root", fixtureRoot, ...args], {
    cwd: path.join(root, "scripts"),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
    timeout: 60000,
    env: { ...process.env, SCRIPT_RESULT_STDOUT: "suppress" },
  });
  const after = listFiles(fixtureRoot);
  const writtenFiles = [...after].filter(file => !before.has(file)).sort();
  const scriptId = path.basename(scriptRel).replace(/\.ts$/, "");
  const resultPath = path.join(fixtureRoot, ".ai", "validation", `${scriptId}.result.yaml`);
  const fileResult = fs.existsSync(resultPath) ? readYamlFile(resultPath) : undefined;
  return {
    exitCode: child.status,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    result: fileResult ?? parseStdoutResult(child.stdout ?? ""),
    writtenFiles,
  };
}

function makeFixture(name: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `conventions-script-verification-${name}-`));
  copyDirectory(root, base);
  return base;
}

function mutateYaml(filePath: string, mutator: (doc: JsonMap) => void): void {
  const doc = readYamlFile(filePath);
  mutator(doc);
  writeYamlFile(filePath, doc);
}

function addFixtureConvention(fixtureRoot: string, relPath: string, content: JsonMap): void {
  writeYamlFile(path.join(fixtureRoot, relPath), content);
}

function resultErrorCodes(result?: JsonMap): string[] {
  const errors = Array.isArray(result?.errors) ? result!.errors : [];
  return errors.map((entry: any) => String(entry?.code ?? "")).filter(Boolean);
}

function resultWarningCodes(result?: JsonMap): string[] {
  const warnings = Array.isArray(result?.warnings) ? result!.warnings : [];
  return warnings.map((entry: any) => String(entry?.code ?? "")).filter(Boolean);
}

function routeAllowedWritePatterns(routes: Map<string, JsonMap>, routeId: string): string[] {
  const route = routes.get(routeId);
  const declared = Array.isArray(route?.allowed_write_paths) ? route!.allowed_write_paths.map(String) : [];
  return [...new Set([...declared, ".ai/validation/**"])];
}

function writtenFilesAreAllowed(writtenFiles: string[], allowedPatterns: string[]): string[] {
  return writtenFiles.filter(file => file.startsWith(".ai/") && !allowedPatterns.some(pattern => globMatches(pattern, file)));
}

function assertScriptResultShape(test: TestCase, run: ScriptRun): void {
  const result = run.result;
  if (!result) {
    issues.push(issue("critical", "SCRIPT_RESULT_NOT_PARSEABLE", `Script ${test.script} did not print parseable YAML/JSON result`, undefined, { test: test.name, stdout: run.stdout, stderr: run.stderr }));
    return;
  }
  for (const field of ["script_id", "status", "errors", "warnings", "info"]) {
    if (!(field in result)) issues.push(issue("error", "SCRIPT_RESULT_FIELD_MISSING", `Script result missing field ${field}`, undefined, { test: test.name, script: test.script }));
  }
  if (!Array.isArray(result.errors) || !Array.isArray(result.warnings) || !Array.isArray(result.info)) {
    issues.push(issue("error", "SCRIPT_RESULT_LIST_FIELD_INVALID", "Script result errors/warnings/info must be arrays", undefined, { test: test.name, script: test.script }));
  }
  if (result.status !== test.expectedStatus) {
    issues.push(issue("error", "SCRIPT_RESULT_STATUS_UNEXPECTED", `Script ${test.script} status ${result.status} did not match expected ${test.expectedStatus}`, undefined, { test: test.name }));
  }
}

function validConvention(name: string, ownedConcept: string, extra: JsonMap = {}): JsonMap {
  return {
    version: "1.0",
    file: { name: path.basename(name), path: name, role: "test_fixture", executability: "policy" },
    ownership: { owns: [ownedConcept] },
    sections: {},
    ...extra,
  };
}

function mutateExecutorRoute(fixtureRoot: string, mutator: (routes: JsonMap) => void): void {
  mutateYaml(path.join(fixtureRoot, "executors", "conventions.executor-routes.yaml"), doc => mutator(doc.sections.executor_routes));
}


function writeEvidenceManifestFixture(fixtureRoot: string, entries: JsonMap[]): void {
  writeYamlFile(path.join(fixtureRoot, ".ai", "reports", "evidence-manifest.yaml"), {
    artifact: "evidence_manifest_v2",
    schema_version: "2.0",
    generated_by: "collect-evidence",
    status: "validated",
    manifest_validation: {
      validation_id: "fixture_manifest",
      status: "passed",
      severity: "info",
      blocking: false,
      issues: [],
      evidence: [],
    },
    evidence_count: entries.length,
    evidence_counts_by_type: entries.reduce((acc: Record<string, number>, entry: JsonMap) => {
      const type = String(entry.source_type ?? "unknown");
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {}),
    entries: entries.map((entry: JsonMap, index: number) => ({
      evidence_id: entry.evidence_id ?? `fixture_${index}`,
      path: entry.path,
      source_type: entry.source_type ?? "unknown",
      generated_by: entry.generated_by ?? "verify-scripts-fixture",
      status: entry.status ?? "pass",
      content_sha256: entry.content_sha256 ?? "0".repeat(64),
      manifest_entry_schema: "evidence_manifest_v2_entry",
      producer_verified: entry.producer_verified ?? true,
      ...entry,
    })),
  });
}

function writePhaseBundleFixture(fixtureRoot: string, mutator?: (bundle: JsonMap) => void, writeManifest = true): void {
  const bundlePath = path.join(fixtureRoot, ".ai", "bundles", "phases", "verify", "mission_profile_selection.bundle.yaml");
  const manifestPath = path.join(fixtureRoot, ".ai", "bundles", "phases", "verify", "mission_profile_selection.manifest.yaml");
  const generated = runScript(fixtureRoot, "scripts/generate-phase-bundle.ts", ["--mission-id", "verify", "--phase-id", "mission_profile_selection"]);
  if (generated.exitCode !== 0) throw new Error(`Could not generate base phase bundle for fixture: ${generated.stderr}`);
  const bundle = readYamlFile(bundlePath);
  mutator?.(bundle);
  writeYamlFile(bundlePath, bundle);
  if (!writeManifest && fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
}


const canonicalPhaseOrder = [
  "mission_created",
  "mission_profile_selection",
  "mission_initialization",
  "active_context_manifest",
  "phase_accounting",
  "behavior_contract",
  "codebase_reconnaissance",
  "local_alignment",
  "risk_classification",
  "boundary_contract_classification",
  "dependency_classification",
  "architecture_decomposition",
  "draft_role_pass",
  "pattern_pressure_detection",
  "artifact_reuse_analysis",
  "artifact_action_resolution",
  "refactor_strategy_selection",
  "call_site_impact_analysis",
  "change_impact_analysis",
  "final_role_assignment",
  "pattern_selection",
  "structure_rendering",
  "test_derivation",
  "implementation_sequence",
  "checkpoint_validation_plan",
  "pre_implementation_gate",
  "implementation",
  "failure_classification",
  "feedback_repair",
  "post_implementation_validation",
  "trigger_review",
  "report_artifact_validation",
  "final_validation",
  "mission_complete",
];

function advanceMissionToPhase(fixtureRoot: string, missionId: string, targetPhase: string): void {
  const targetIndex = canonicalPhaseOrder.indexOf(targetPhase);
  if (targetIndex < 0) throw new Error(`Unknown canonical target phase ${targetPhase}`);
  for (const phase of canonicalPhaseOrder.slice(1, targetIndex + 1)) {
    const result = runScript(fixtureRoot, "scripts/advance-mission.ts", ["--mission-id", missionId, "--to-phase", phase]);
    if (result.exitCode !== 0) throw new Error(`Could not advance ${missionId} to ${phase}: ${result.stderr}`);
  }
}

function testCases(): TestCase[] {
  return [
    // validate-executor-routes.ts
    { name: "executor routes valid input passes", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-executor-routes.result.yaml"], assert: (_r, run) => { const direct = run.result?.summary?.validation_result as JsonMap | undefined; if (!direct || direct.validation_id !== "validate-executor-routes" || direct.status !== "passed" || direct.blocking !== false || direct.source_script_id !== "validate-executor-routes") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Executor route validator did not emit compatible universal validation_result summary.")); } },
    { name: "executor route validation fails missing script", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "invalid_state", setup: r => mutateExecutorRoute(r, routes => { routes.validation.validate_executor_routes.script = "scripts/missing-script.ts"; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSING_SCRIPT_IMPLEMENTATION"] },
    { name: "executor route validation fails unknown local route", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "phases/conventions.unknown-route-fixture.yaml", validConvention("phases/conventions.unknown-route-fixture.yaml", "unknown_route_fixture", { sections: { required_executor_routes: { before_phase_start: ["missing_unknown_route"] } } })), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["UNKNOWN_LOCAL_ROUTE"] },
    { name: "executor route validation fails direct script reference", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "phases/conventions.direct-script-fixture.yaml", validConvention("phases/conventions.direct-script-fixture.yaml", "direct_script_fixture", { sections: { required_executor_routes: { before_phase_start: ["scripts/validate-references.ts"] } } })), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["DIRECT_SCRIPT_REFERENCE"] },
    { name: "executor route validation fails invalid route id", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "malformed_input", setup: r => mutateExecutorRoute(r, routes => { routes.validation.badroute = { ...routes.validation.validate_executor_routes }; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["INVALID_ROUTE_ID"] },
    { name: "executor route validation fails missing required field", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "malformed_input", setup: r => mutateExecutorRoute(r, routes => { delete routes.validation.validate_executor_routes.failure_behavior; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["ROUTE_MISSING_FIELD", "UNKNOWN_FAILURE_BEHAVIOR"] },
    { name: "executor route validation fails unknown executor type", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "malformed_input", setup: r => mutateExecutorRoute(r, routes => { routes.validation.validate_executor_routes.executor_type = "nonsense"; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["UNKNOWN_EXECUTOR_TYPE", "ROUTE_GROUP_TYPE_MISMATCH"] },
    { name: "executor route validation fails forbidden blocking field", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "malformed_input", setup: r => mutateExecutorRoute(r, routes => { routes.validation.validate_executor_routes.blocking = true; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["FORBIDDEN_BLOCKING_FIELD"] },
    { name: "executor route validation fails forbidden failure policy field", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "malformed_input", setup: r => mutateExecutorRoute(r, routes => { routes.validation.validate_executor_routes.failure_policy = { behavior: "block" }; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["FORBIDDEN_FAILURE_POLICY"] },
    { name: "executor route validation fails unknown lifecycle hook", routeId: "validate_executor_routes", script: "scripts/validate-executor-routes.ts", category: "malformed_input", setup: r => mutateExecutorRoute(r, routes => { routes.validation.validate_executor_routes.lifecycle_hooks = ["while_moon_is_full"]; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["UNKNOWN_LIFECYCLE_HOOK"] },

    // universal route invocation/output contracts
    { name: "route invocation validation passes known route", routeId: "validate_route_invocation", script: "scripts/validate-route-invocation.ts", category: "valid_input", args: ["--route", "validate_executor_routes"], expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-route-invocation.result.yaml"] },
    { name: "route invocation validation fails unknown route", routeId: "validate_route_invocation", script: "scripts/validate-route-invocation.ts", category: "invalid_state", args: ["--route", "missing_route_for_test"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["UNKNOWN_EXECUTOR_ROUTE"] },
    { name: "route invocation validation rejects direct script path", routeId: "validate_route_invocation", script: "scripts/validate-route-invocation.ts", category: "malformed_input", args: ["--route", "scripts/validate-executor-routes.ts"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["DIRECT_SCRIPT_INVOCATION_FORBIDDEN"] },
    { name: "route output validation passes standard result", routeId: "validate_route_output", script: "scripts/validate-route-output.ts", category: "valid_input", args: ["--route", "validate_executor_routes", "--output-file", "route-output-fixture.yaml"], setup: r => writeYamlFile(path.join(r, "route-output-fixture.yaml"), { script_id: "validate-executor-routes", status: "pass", errors: [], warnings: [], info: [], outputs: [".ai/validation/validate-executor-routes.result.yaml"], summary: {} }), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-route-output.result.yaml"] },
    { name: "route output validation fails malformed result", routeId: "validate_route_output", script: "scripts/validate-route-output.ts", category: "malformed_input", args: ["--route", "validate_executor_routes", "--output-file", "route-output-fixture.yaml"], setup: r => fs.writeFileSync(path.join(r, "route-output-fixture.yaml"), "not: [valid", "utf8"), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["ROUTE_OUTPUT_UNPARSEABLE"] },
    { name: "route output validation fails invalid issue entry", routeId: "validate_route_output", script: "scripts/validate-route-output.ts", category: "output_contract", args: ["--route", "validate_executor_routes", "--output-file", "route-output-fixture.yaml"], setup: r => writeYamlFile(path.join(r, "route-output-fixture.yaml"), { script_id: "validate-executor-routes", status: "pass", errors: [{ severity: "danger", code: "", message: "" }], warnings: [], info: [] }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["ROUTE_OUTPUT_ISSUE_SEVERITY_INVALID", "ROUTE_OUTPUT_ISSUE_CODE_INVALID", "ROUTE_OUTPUT_ISSUE_MESSAGE_INVALID"] },
    { name: "route output validation fails invalid optional fields", routeId: "validate_route_output", script: "scripts/validate-route-output.ts", category: "output_contract", args: ["--route", "validate_executor_routes", "--output-file", "route-output-fixture.yaml"], setup: r => writeYamlFile(path.join(r, "route-output-fixture.yaml"), { script_id: "validate-executor-routes", status: "pass", errors: [], warnings: [], info: [], outputs: [".ai/validation/validate-executor-routes.result.yaml", 42], summary: [] }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["ROUTE_OUTPUT_OUTPUT_ENTRY_INVALID", "ROUTE_OUTPUT_SUMMARY_INVALID"] },

    // validate-validation-result.ts
    { name: "validation result validation normalizes legacy script result", routeId: "validate_validation_result", script: "scripts/validate-validation-result.ts", category: "valid_input", args: ["--route", "validate_executor_routes", "--input-file", "validation-result-fixture.yaml"], setup: r => writeYamlFile(path.join(r, "validation-result-fixture.yaml"), { script_id: "validate-executor-routes", status: "pass", errors: [], warnings: [], info: [], summary: { evidence: [{ evidence_type: "validation_artifact", path: ".ai/validation/validate-executor-routes.result.yaml", producer_route: "validate_executor_routes" }] } }), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-validation-result.result.yaml"] },
    { name: "validation result validation accepts universal result", routeId: "validate_validation_result", script: "scripts/validate-validation-result.ts", category: "valid_input", args: ["--input-file", "validation-result-fixture.yaml"], setup: r => writeYamlFile(path.join(r, "validation-result-fixture.yaml"), { validation_id: "fixture_validation", status: "passed_with_warnings", severity: "warning", blocking: false, issues: [{ severity: "warning", code: "FIXTURE_WARNING", message: "Fixture warning" }], evidence: [{ evidence_type: "fixture", path: ".ai/reports/fixture.yaml" }] }), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-validation-result.result.yaml"] },
    { name: "validation result validation fails unknown shape", routeId: "validate_validation_result", script: "scripts/validate-validation-result.ts", category: "malformed_input", args: ["--input-file", "validation-result-fixture.yaml"], setup: r => writeYamlFile(path.join(r, "validation-result-fixture.yaml"), { status: "pass", errors: [], warnings: [], info: [] }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["VALIDATION_RESULT_SHAPE_UNKNOWN"] },
    { name: "validation result validation fails invalid evidence", routeId: "validate_validation_result", script: "scripts/validate-validation-result.ts", category: "output_contract", args: ["--input-file", "validation-result-fixture.yaml"], setup: r => writeYamlFile(path.join(r, "validation-result-fixture.yaml"), { validation_id: "fixture_validation", status: "passed", severity: "info", blocking: false, issues: [], evidence: [{ evidence_type: "", path: "" }] }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["VALIDATION_RESULT_EVIDENCE_TYPE_INVALID", "VALIDATION_RESULT_EVIDENCE_PATH_INVALID"] },
    { name: "route invocation wrapper invokes known route", routeId: "invoke_route", script: "scripts/invoke-route.ts", category: "valid_input", args: ["--route", "initialize_mission", "--mission-id", "invoke_verify"], expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/missions/invoke_verify/mission-state.yaml", ".ai/missions/invoke_verify/mission-journal.ndjson", ".ai/missions/invoke_verify/mission-checkpoint.yaml"] },
    { name: "route invocation wrapper rejects unknown route", routeId: "invoke_route", script: "scripts/invoke-route.ts", category: "invalid_state", args: ["--route", "missing_route_for_test"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["UNKNOWN_EXECUTOR_ROUTE"] },

    // compile-authority-topology.ts / validate-authority-topology.ts
    { name: "authority topology compile valid input passes", routeId: "compile_authority_topology", script: "scripts/compile-authority-topology.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/topologies/authority-topology.yaml", ".ai/reports/authority-conflict-report.yaml"] },
    { name: "authority topology compile fails duplicate owner", routeId: "compile_authority_topology", script: "scripts/compile-authority-topology.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "core/conventions.duplicate-owner-fixture.yaml", validConvention("core/conventions.duplicate-owner-fixture.yaml", "central_executor_route_map")), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["DUPLICATE_CONCEPT_OWNER"] },
    { name: "authority topology compile fails unknown relationship key", routeId: "compile_authority_topology", script: "scripts/compile-authority-topology.ts", category: "malformed_input", setup: r => addFixtureConvention(r, "core/conventions.unknown-ownership-key-fixture.yaml", { version: "1.0", file: { name: "conventions.unknown-ownership-key-fixture.yaml", path: "core/conventions.unknown-ownership-key-fixture.yaml", role: "test_fixture", executability: "policy" }, ownership: { owns: ["unknown_ownership_key_fixture"], stewards: ["other_concept"] }, sections: {} }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["UNKNOWN_OWNERSHIP_RELATIONSHIP"] },
    { name: "authority topology compile fails malformed relationship list", routeId: "compile_authority_topology", script: "scripts/compile-authority-topology.ts", category: "malformed_input", setup: r => addFixtureConvention(r, "core/conventions.malformed-ownership-fixture.yaml", { version: "1.0", file: { name: "conventions.malformed-ownership-fixture.yaml", path: "core/conventions.malformed-ownership-fixture.yaml", role: "test_fixture", executability: "policy" }, ownership: { owns: "not-a-list" }, sections: {} }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MALFORMED_OWNERSHIP_RELATIONSHIP"] },
    { name: "authority topology validation fails missing topology", routeId: "validate_authority_topology", script: "scripts/validate-authority-topology.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["AUTHORITY_TOPOLOGY_MISSING"] },
    { name: "authority topology validation passes after compile", routeId: "validate_authority_topology", script: "scripts/validate-authority-topology.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/compile-authority-topology.ts"); }, expectedExit: 0, expectedStatus: "pass" },
    { name: "authority topology validation fails duplicate owner in topology", routeId: "validate_authority_topology", script: "scripts/validate-authority-topology.ts", category: "invalid_state", preRun: r => { runScript(r, "scripts/compile-authority-topology.ts"); mutateYaml(path.join(r, ".ai", "topologies", "authority-topology.yaml"), doc => { doc.concepts.__fixture_duplicate = { owners: ["a.yaml", "b.yaml"] }; }); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["DUPLICATE_CONCEPT_OWNER"] },

    // validate-references.ts
    { name: "reference validation valid input passes", routeId: "validate_references", script: "scripts/validate-references.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/topologies/reference-topology.yaml", ".ai/validation/validate-references.result.yaml"] },
    { name: "reference validation fails missing required dependency", routeId: "validate_references", script: "scripts/validate-references.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "core/conventions.missing-dependency-fixture.yaml", validConvention("core/conventions.missing-dependency-fixture.yaml", "missing_dependency_fixture", { dependencies: { required_files: ["core/does-not-exist.yaml"], optional_files: [] } })), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSING_REQUIRED_DEPENDENCY"] },
    { name: "reference validation fails stale removed reference", routeId: "validate_references", script: "scripts/validate-references.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "core/conventions.stale-reference-fixture.yaml", validConvention("core/conventions.stale-reference-fixture.yaml", "stale_reference_fixture", { purpose: "mentions core/conventions.authority-registry.yaml as stale text" })), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["STALE_REMOVED_REFERENCE"] },
    { name: "reference validation fails unknown executor route reference", routeId: "validate_references", script: "scripts/validate-references.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "phases/conventions.unknown-route-reference-fixture.yaml", validConvention("phases/conventions.unknown-route-reference-fixture.yaml", "unknown_route_reference_fixture", { sections: { required_executor_routes: { before_phase_start: ["unknown_route_from_reference_test"] } } })), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["UNKNOWN_EXECUTOR_ROUTE_REFERENCE"] },

    // validate-changed-files.ts
    { name: "changed files validation passes valid file", routeId: "validate_changed_files", script: "scripts/validate-changed-files.ts", category: "valid_input", args: ["--changed", "core/conventions.core.yaml"], expectedExit: 0, expectedStatus: "pass" },
    { name: "changed files validation passes empty input as advisory", routeId: "validate_changed_files", script: "scripts/validate-changed-files.ts", category: "missing_input", expectedExit: 0, expectedStatus: "pass" },
    { name: "changed files validation fails missing file", routeId: "validate_changed_files", script: "scripts/validate-changed-files.ts", category: "invalid_state", args: ["--changed", "core/missing-file.yaml"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["CHANGED_FILE_MISSING"] },
    { name: "changed files validation fails malformed changed yaml", routeId: "validate_changed_files", script: "scripts/validate-changed-files.ts", category: "malformed_input", setup: r => fs.writeFileSync(path.join(r, "core", "conventions.malformed-yaml-fixture.yaml"), "version: [unterminated", "utf8"), args: ["--changed", "core/conventions.malformed-yaml-fixture.yaml"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["CHANGED_YAML_PARSE_ERROR"] },

    // runtime artifact compiler / validator
    { name: "runtime artifact topology compile valid input passes", routeId: "compile_runtime_artifact_topology", script: "scripts/compile-runtime-artifact-topology.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/topologies/runtime-artifact-topology.yaml", ".ai/reports/artifact-conflict-report.yaml"] },
    { name: "mission mode policy resolves profile", routeId: "resolve_mission_mode_policy", script: "scripts/resolve-mission-mode-policy.ts", category: "valid_input", args: ["--mission-profile", "bugfix"], expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/policy/mission-mode-policy.yaml", ".ai/reports/mission-mode-policy-report.yaml", ".ai/validation/resolve-mission-mode-policy.result.yaml"], assert: r => { const resolved = readYamlFile(path.join(r, ".ai", "policy", "mission-mode-policy.yaml")); if (resolved.artifact !== "resolved_mission_mode_policy" || resolved.mission_mode !== "bugfix" || resolved.rollout_mode !== "observe" || resolved.blocking_decisions !== "disabled_in_observe_mode") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Mission-mode policy resolver did not produce observe-mode bugfix policy.")); const result = readYamlFile(path.join(r, ".ai", "validation", "resolve-mission-mode-policy.result.yaml")); if (result.summary?.validation_result?.route_id !== "resolve_mission_mode_policy" || result.summary?.validation_result?.blocking !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Mission-mode policy resolver did not emit universal validation_result metadata.")); } },
    { name: "mission mode policy resolves from mission state", routeId: "resolve_mission_mode_policy", script: "scripts/resolve-mission-mode-policy.ts", category: "valid_input", args: ["--mission-id", "policy_resume_fixture"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "policy_resume_fixture", "--profile", "large_refactor"]); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/policy/mission-mode-policy.yaml", ".ai/reports/mission-mode-policy-report.yaml"], assert: r => { const resolved = readYamlFile(path.join(r, ".ai", "policy", "mission-mode-policy.yaml")); if (resolved.mission_mode !== "refactor" || resolved.source_profile !== "large_refactor" || resolved.selected_profile_source !== "mission_state") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Mission-mode policy resolver did not use mission state selected_profile.")); } },
    { name: "mission mode policy fails unknown profile", routeId: "resolve_mission_mode_policy", script: "scripts/resolve-mission-mode-policy.ts", category: "malformed_input", args: ["--mission-profile", "unknown_profile"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_MODE_UNRESOLVED", "MISSION_PROFILE_UNMAPPED"] },
    { name: "score decision evaluates complete vector in observe mode", routeId: "evaluate_score_decision", script: "scripts/evaluate-score-decision.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/resolve-mission-mode-policy.ts", ["--mission-profile", "bugfix"]); writeYamlFile(path.join(r, ".ai", "scoring", "score-vector.yaml"), { artifact: "score_vector", generated_by: "verify-scripts-fixture", scores: { reproduction_confidence_min: 0.9, regression_coverage_min: 0.85, blast_radius_confidence_min: 0.8 } }); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/scoring/score-decision.yaml", ".ai/reports/score-decision-report.yaml", ".ai/validation/evaluate-score-decision.result.yaml"], assert: r => { const decision = readYamlFile(path.join(r, ".ai", "scoring", "score-decision.yaml")); if (decision.artifact !== "score_decision" || decision.mission_mode !== "bugfix" || decision.deterministic_recommendation !== "proceed_observe_only" || decision.blocking_decision !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Score decision did not produce observe-mode proceed decision.")); const result = readYamlFile(path.join(r, ".ai", "validation", "evaluate-score-decision.result.yaml")); if (result.summary?.validation_result?.route_id !== "evaluate_score_decision" || result.summary?.validation_result?.blocking !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Score decision did not emit universal validation_result metadata.")); } },
    { name: "score decision warns missing vector", routeId: "evaluate_score_decision", script: "scripts/evaluate-score-decision.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/resolve-mission-mode-policy.ts", ["--mission-profile", "bugfix"]); }, expectedExit: 0, expectedStatus: "pass", expectedWarningCodes: ["SCORE_VECTOR_MISSING", "SCORE_THRESHOLD_SCORE_MISSING"], expectedOutputs: [".ai/scoring/score-decision.yaml", ".ai/reports/score-decision-report.yaml"], assert: r => { const decision = readYamlFile(path.join(r, ".ai", "scoring", "score-decision.yaml")); if (decision.deterministic_recommendation !== "insufficient_scores_observe_only" || decision.blocking_decision !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Score decision missing-vector path must remain observe-only and non-blocking.")); } },
    { name: "score decision fails malformed score value", routeId: "evaluate_score_decision", script: "scripts/evaluate-score-decision.ts", category: "malformed_input", preRun: r => { runScript(r, "scripts/resolve-mission-mode-policy.ts", ["--mission-profile", "bugfix"]); writeYamlFile(path.join(r, ".ai", "scoring", "score-vector.yaml"), { artifact: "score_vector", generated_by: "verify-scripts-fixture", scores: { reproduction_confidence_min: 1.2 } }); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["SCORE_VALUE_OUT_OF_RANGE"] },
    { name: "score decision fails missing policy", routeId: "evaluate_score_decision", script: "scripts/evaluate-score-decision.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["RESOLVED_MISSION_MODE_POLICY_MISSING"] },
    { name: "source artifact collection writes manifest", routeId: "collect_source_artifacts", script: "scripts/collect-source-artifacts.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/source-artifacts/source-artifact-manifest.yaml", ".ai/reports/source-collection-report.yaml"], assert: r => { const manifest = readYamlFile(path.join(r, ".ai", "source-artifacts", "source-artifact-manifest.yaml")); if (manifest.artifact !== "source_artifact_manifest" || !Array.isArray(manifest.files) || !Array.isArray(manifest.dependency_edges) || !(manifest.source_file_count > 0)) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Source artifact manifest did not expose source files and dependency edges.")); const routeFile = manifest.files.find((entry: any) => entry.path === "conventions/executors/conventions.executor-routes.yaml"); if (!routeFile || !Array.isArray(routeFile.route_ids) || !routeFile.route_ids.includes("collect_source_artifacts")) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Source artifact manifest did not record executor route IDs.")); } },
    { name: "typescript language adapter consumes source manifest", routeId: "analyze_typescript_source", script: "scripts/analyze-typescript-source.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/collect-source-artifacts.ts"); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/source-artifacts/typescript-source-analysis.yaml", ".ai/reports/typescript-source-analysis-report.yaml"], assert: r => { const analysis = readYamlFile(path.join(r, ".ai", "source-artifacts", "typescript-source-analysis.yaml")); if (analysis.artifact !== "typescript_source_analysis" || analysis.generated_by !== "analyze-typescript-source" || analysis.language !== "typescript" || !Array.isArray(analysis.files)) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "TypeScript language adapter did not produce expected analysis shape.")); const adapterScript = analysis.files.find((entry: any) => entry.path === "conventions/scripts/analyze-typescript-source.ts"); if (!adapterScript || !adapterScript.symbol_hints || typeof adapterScript.import_count !== "number") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "TypeScript language adapter did not analyze script-level TypeScript evidence.")); } },
    { name: "typescript language adapter fails missing source manifest", routeId: "analyze_typescript_source", script: "scripts/analyze-typescript-source.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["SOURCE_ARTIFACT_MANIFEST_MISSING"] },
    { name: "nestjs framework adapter consumes typescript analysis", routeId: "analyze_nestjs_source", script: "scripts/analyze-nestjs-source.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/collect-source-artifacts.ts"); runScript(r, "scripts/analyze-typescript-source.ts"); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/source-artifacts/nestjs-source-analysis.yaml", ".ai/reports/nestjs-source-analysis-report.yaml"], assert: r => { const analysis = readYamlFile(path.join(r, ".ai", "source-artifacts", "nestjs-source-analysis.yaml")); if (analysis.artifact !== "nestjs_source_analysis" || analysis.generated_by !== "analyze-nestjs-source" || analysis.framework !== "nestjs" || !Array.isArray(analysis.files)) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "NestJS framework adapter did not produce expected analysis shape.")); if (analysis.adapter_kind !== "framework_adapter" || typeof analysis.detected_file_count !== "number") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "NestJS framework adapter did not expose adapter metadata.")); } },
    { name: "nestjs framework adapter detects fixture source", routeId: "analyze_nestjs_source", script: "scripts/analyze-nestjs-source.ts", category: "valid_input", setup: r => { const fixtureDir = path.join(r, "scripts", "fixture-app"); fs.mkdirSync(fixtureDir, { recursive: true }); fs.writeFileSync(path.join(fixtureDir, "fixture.service.ts"), 'import { Injectable } from "@nestjs/common";\n@Injectable()\nexport class FixtureService { constructor(private readonly dep: FixtureDep) {} }\nclass FixtureDep {}\n', "utf8"); }, preRun: r => { runScript(r, "scripts/collect-source-artifacts.ts"); runScript(r, "scripts/analyze-typescript-source.ts"); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/source-artifacts/nestjs-source-analysis.yaml", ".ai/reports/nestjs-source-analysis-report.yaml"], assert: r => { const analysis = readYamlFile(path.join(r, ".ai", "source-artifacts", "nestjs-source-analysis.yaml")); const fixture = analysis.files.find((entry: any) => entry.path === "conventions/scripts/fixture-app/fixture.service.ts"); if (!fixture || !fixture.evidence_flags?.has_injectable_decorator || !fixture.evidence_flags?.has_constructor_injection) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "NestJS framework adapter did not detect fixture Injectable evidence.")); } },
    { name: "nestjs framework adapter fails missing typescript analysis", routeId: "analyze_nestjs_source", script: "scripts/analyze-nestjs-source.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["TYPESCRIPT_SOURCE_ANALYSIS_MISSING"] },
    { name: "runtime artifact topology compile fails same path different id", routeId: "compile_runtime_artifact_topology", script: "scripts/compile-runtime-artifact-topology.ts", category: "invalid_state", setup: r => mutateYaml(path.join(r, "reports", "conventions.runtime-artifacts.yaml"), doc => { doc.sections.runtime_artifact_registry.push({ artifact_id: "duplicate_path_fixture", path: ".ai/reports/00-mission-profile.yaml", artifact_type: "report", schema: "fixture", producer: "fixture", consumers: ["fixture"], scope: "phase_runtime", lifecycle: "generated_report_output", write_mode: "single_writer", required: true }); }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["RUNTIME_ARTIFACT_SAME_PATH_DIFFERENT_ID"] },
    { name: "runtime artifact validation fails without topology", routeId: "validate_runtime_artifacts", script: "scripts/validate-runtime-artifacts.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["RUNTIME_ARTIFACT_TOPOLOGY_MISSING"] },
    { name: "runtime artifact validation passes after compile", routeId: "validate_runtime_artifacts", script: "scripts/validate-runtime-artifacts.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/compile-runtime-artifact-topology.ts"); }, expectedExit: 0, expectedStatus: "pass" },
    { name: "runtime artifact validation fails invalid topology path", routeId: "validate_runtime_artifacts", script: "scripts/validate-runtime-artifacts.ts", category: "invalid_state", preRun: r => { runScript(r, "scripts/compile-runtime-artifact-topology.ts"); mutateYaml(path.join(r, ".ai", "topologies", "runtime-artifact-topology.yaml"), doc => { doc.artifacts.invalid_path_fixture = { path: "reports/not-ai.yaml", artifact_type: "report", schema: "fixture", producer: "fixture", producer_routes: ["collect_phase_report"], consumers: [], scope: "phase_runtime", lifecycle: "generated_report_output", write_mode: "single_writer", required: true }; }); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["INVALID_RUNTIME_ARTIFACT_PATH"] },
    { name: "runtime artifact validation fails unnormalized topology path", routeId: "validate_runtime_artifacts", script: "scripts/validate-runtime-artifacts.ts", category: "malformed_input", preRun: r => { runScript(r, "scripts/compile-runtime-artifact-topology.ts"); mutateYaml(path.join(r, ".ai", "topologies", "runtime-artifact-topology.yaml"), doc => { doc.artifacts.unnormalized_path_fixture = { path: ".ai/reports/drift.yaml;", artifact_type: "report", schema: "fixture", producer: "fixture", producer_routes: ["collect_phase_report"], consumers: [], scope: "phase_runtime", lifecycle: "generated_report_output", write_mode: "single_writer", required: true }; }); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["UNNORMALIZED_ARTIFACT_PATH"] },

    // phase bundle generator / validator
    { name: "phase bundle generation passes known phase", routeId: "generate_phase_bundle", script: "scripts/generate-phase-bundle.ts", category: "valid_input", args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"], expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/bundles/phases/verify/mission_profile_selection.bundle.yaml", ".ai/bundles/phases/verify/mission_profile_selection.manifest.yaml"] },
    { name: "phase bundle generation fails unknown phase", routeId: "generate_phase_bundle", script: "scripts/generate-phase-bundle.ts", category: "invalid_state", args: ["--mission-id", "verify", "--phase-id", "unknown_phase_for_test"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["PHASE_CONTRACT_MISSING", "PHASE_OWNERSHIP_MISSING"] },
    { name: "phase bundle validation passes after generation", routeId: "validate_phase_bundle", script: "scripts/validate-phase-bundle.ts", category: "valid_input", args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"], preRun: r => { runScript(r, "scripts/generate-phase-bundle.ts", ["--mission-id", "verify", "--phase-id", "mission_profile_selection"]); }, expectedExit: 0, expectedStatus: "pass" },
    { name: "phase bundle validation fails missing bundle", routeId: "validate_phase_bundle", script: "scripts/validate-phase-bundle.ts", category: "missing_input", args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["PHASE_BUNDLE_MISSING"] },
    { name: "phase bundle validation fails unknown route", routeId: "validate_phase_bundle", script: "scripts/validate-phase-bundle.ts", category: "invalid_state", args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"], preRun: r => writePhaseBundleFixture(r, bundle => { bundle.required_executor_routes.push("unknown_route_inside_bundle"); }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["PHASE_BUNDLE_UNKNOWN_ROUTE", "PHASE_BUNDLE_MISSING_ROUTE_CONTRACT"] },
    { name: "phase bundle validation fails full context dump", routeId: "validate_phase_bundle", script: "scripts/validate-phase-bundle.ts", category: "invalid_state", args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"], preRun: r => writePhaseBundleFixture(r, bundle => { bundle.all_conventions = { forbidden: true }; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["PHASE_BUNDLE_CONTAINS_FULL_CONTEXT_DUMP"] },
    { name: "phase bundle validation fails weak agent context boundary", routeId: "validate_phase_bundle", script: "scripts/validate-phase-bundle.ts", category: "invalid_state", args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"], preRun: r => writePhaseBundleFixture(r, bundle => { bundle.agent_consumption_model.agent_reads_full_topologies = true; }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["PHASE_BUNDLE_AGENT_CONTEXT_BOUNDARY_WEAK"] },
    { name: "phase bundle validation fails missing manifest", routeId: "validate_phase_bundle", script: "scripts/validate-phase-bundle.ts", category: "invalid_state", args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"], preRun: r => writePhaseBundleFixture(r, undefined, false), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["PHASE_BUNDLE_MANIFEST_MISSING"] },

    // semantic completeness validator
    { name: "semantic completeness validation passes current conventions", routeId: "validate_semantic_completeness", script: "scripts/validate-semantic-completeness.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-semantic-completeness.result.yaml", ".ai/reports/semantic-completeness-report.yaml"] },
    { name: "semantic completeness validation fails placeholder content", routeId: "validate_semantic_completeness", script: "scripts/validate-semantic-completeness.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "phases/conventions.semantic-placeholder-fixture.yaml", validConvention("phases/conventions.semantic-placeholder-fixture.yaml", "semantic_placeholder_fixture", { sections: { executable_rule: "TODO" } })), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["SEMANTIC_PLACEHOLDER_TEXT"] },
    { name: "semantic completeness validation fails policy loaded vague phrase", routeId: "validate_semantic_completeness", script: "scripts/validate-semantic-completeness.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "phases/conventions.semantic-vague-fixture.yaml", validConvention("phases/conventions.semantic-vague-fixture.yaml", "semantic_vague_fixture", { sections: { executable_rule: "someone should run validation" } })), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["SEMANTIC_VAGUE_EXECUTABLE_PHRASE"] },
    { name: "semantic completeness validation fails dynamically added policy phrase", routeId: "validate_semantic_completeness", script: "scripts/validate-semantic-completeness.ts", category: "invalid_state", setup: r => { mutateYaml(path.join(r, "core", "conventions.semantic-completeness.yaml"), doc => { doc.sections.vague_content_policy.vague_execution_phrases.push("magic vague action"); }); addFixtureConvention(r, "phases/conventions.semantic-dynamic-policy-fixture.yaml", validConvention("phases/conventions.semantic-dynamic-policy-fixture.yaml", "semantic_dynamic_policy_fixture", { sections: { executable_rule: "magic vague action" } })); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["SEMANTIC_VAGUE_EXECUTABLE_PHRASE"] },
    { name: "semantic completeness validation fails decision without rejection", routeId: "validate_semantic_completeness", script: "scripts/validate-semantic-completeness.ts", category: "invalid_state", setup: r => addFixtureConvention(r, "phases/conventions.semantic-decision-fixture.yaml", validConvention("phases/conventions.semantic-decision-fixture.yaml", "semantic_decision_fixture", { sections: { routing_decision: { choose_when: ["input_present"], decision: "use_path_a" } } })), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["SEMANTIC_DECISION_REJECT_LOGIC_MISSING"] },
    { name: "semantic completeness validation fails weak phase output claim", routeId: "validate_semantic_completeness", script: "scripts/validate-semantic-completeness.ts", category: "missing_input", args: ["--phase-output", ".ai/phase/weak-output.yaml"], setup: r => writeYamlFile(path.join(r, ".ai", "phase", "weak-output.yaml"), { artifact: "phase_output", completion_claim: { completed_requirements: [] } }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["SEMANTIC_COMPLETION_EVIDENCE_FIELD_MISSING"] },

    // script placeholders / runtime action scripts are still route-backed and contract-checked.
    { name: "phase output validation passes advisory missing output", routeId: "validate_phase_output", script: "scripts/validate-phase-output.ts", category: "missing_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-phase-output.result.yaml"] },
    { name: "phase output validation passes existing output", routeId: "validate_phase_output", script: "scripts/validate-phase-output.ts", category: "valid_input", setup: r => writeYamlFile(path.join(r, ".ai", "phase", "phase-output.yaml"), { artifact: "phase_output" }), expectedExit: 0, expectedStatus: "pass" },
    { name: "mission bundle generation passes", routeId: "generate_mission_bundle", script: "scripts/generate-mission-bundle.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/bundles/mission-context-bundle.yaml"] },
    { name: "gate check fails missing gate id", routeId: "run_gate_check", script: "scripts/run-gate-check.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["GATE_ID_MISSING"] },
    { name: "gate check writes pass result", routeId: "run_gate_check", script: "scripts/run-gate-check.ts", category: "valid_input", args: ["--gate-id", "verify_gate"], expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/gates/verify_gate.gate-result.yaml"] },
    { name: "gate check blocks normalized validation result", routeId: "run_gate_check", script: "scripts/run-gate-check.ts", category: "operation_correctness", args: ["--gate-id", "normalized_blocking_gate", "--validation-result", "normalized-blocking-validation.yaml"], setup: r => writeYamlFile(path.join(r, "normalized-blocking-validation.yaml"), { validation_id: "blocking_fixture", status: "failed", severity: "error", blocking: true, issues: [{ severity: "error", code: "BLOCKING_FIXTURE", message: "Fixture failure" }], evidence: [] }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["GATE_INPUT_VALIDATION_BLOCKING"], expectedOutputs: [".ai/gates/normalized_blocking_gate.gate-result.yaml"], assert: r => { const gate = readYamlFile(path.join(r, ".ai", "gates", "normalized_blocking_gate.gate-result.yaml")); if (gate.validation_result_contract?.source_shape !== "universal" || gate.validation_result_contract?.blocking !== true) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Gate result did not preserve normalized validation_result contract fields.")); } },
    { name: "gate result validation passes valid result", routeId: "validate_gate_result", script: "scripts/validate-gate-result.ts", category: "valid_input", args: ["--gate-id", "verify_gate"], preRun: r => { runScript(r, "scripts/run-gate-check.ts", ["--gate-id", "verify_gate"]); }, expectedExit: 0, expectedStatus: "pass" },
    { name: "gate result validation fails missing result", routeId: "validate_gate_result", script: "scripts/validate-gate-result.ts", category: "missing_input", args: ["--gate-id", "missing_gate"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["GATE_RESULT_MISSING"] },
    { name: "gate result validation rejects manual result", routeId: "validate_gate_result", script: "scripts/validate-gate-result.ts", category: "invalid_state", args: ["--gate-result", ".ai/gates/manual.gate-result.yaml"], setup: r => writeYamlFile(path.join(r, ".ai", "gates", "manual.gate-result.yaml"), { artifact: "gate_result", gate_id: "manual", status: "pass", decision: "allow_transition" }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["GATE_RESULT_NOT_SCRIPT_PRODUCED"] },
    { name: "handoff preparation fails missing input", routeId: "prepare_agent_handoff", script: "scripts/prepare-agent-handoff.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["HANDOFF_SOURCE_OUTPUT_MISSING", "HANDOFF_TARGET_AGENT_MISSING"] },
    { name: "handoff preparation writes handoff packet", routeId: "prepare_agent_handoff", script: "scripts/prepare-agent-handoff.ts", category: "valid_input", args: ["--source-output", ".ai/phase/source-output.yaml", "--target-agent", "builder_agent", "--handoff-id", "verify_handoff"], setup: r => writeYamlFile(path.join(r, ".ai", "phase", "source-output.yaml"), { artifact: "phase_output", status: "complete" }), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/handoffs/verify_handoff.yaml"] },
    { name: "handoff validation passes valid packet", routeId: "validate_handoff", script: "scripts/validate-handoff.ts", category: "valid_input", args: ["--handoff", ".ai/handoffs/verify_handoff.yaml"], preRun: r => { writeYamlFile(path.join(r, ".ai", "phase", "source-output.yaml"), { artifact: "phase_output", status: "complete" }); runScript(r, "scripts/prepare-agent-handoff.ts", ["--source-output", ".ai/phase/source-output.yaml", "--target-agent", "builder_agent", "--handoff-id", "verify_handoff"]); }, expectedExit: 0, expectedStatus: "pass" },
    { name: "handoff validation fails missing packet", routeId: "validate_handoff", script: "scripts/validate-handoff.ts", category: "missing_input", args: ["--handoff", ".ai/handoffs/missing.yaml"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["HANDOFF_PACKET_MISSING"] },
    { name: "handoff validation rejects manual packet", routeId: "validate_handoff", script: "scripts/validate-handoff.ts", category: "invalid_state", args: ["--handoff", ".ai/handoffs/manual.yaml"], setup: r => { writeYamlFile(path.join(r, ".ai", "phase", "source-output.yaml"), { artifact: "phase_output", status: "complete" }); writeYamlFile(path.join(r, ".ai", "handoffs", "manual.yaml"), { artifact: "agent_handoff_packet", status: "prepared", source_output: ".ai/phase/source-output.yaml", target_agent: "builder_agent", evidence_refs: [".ai/phase/source-output.yaml"] }); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["HANDOFF_NOT_SCRIPT_PRODUCED"] },
    { name: "revision task creation fails missing failure", routeId: "create_revision_task", script: "scripts/create-revision-task.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["REVISION_FAILURE_INPUT_MISSING"] },
    { name: "revision task creation writes revision task", routeId: "create_revision_task", script: "scripts/create-revision-task.ts", category: "valid_input", args: ["--failure", "verify_failure", "--revision-id", "verify_revision"], expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/revisions/verify_revision.yaml"], assert: r => { const task = readYamlFile(path.join(r, ".ai", "revisions", "verify_revision.yaml")); if (typeof task.failure_fingerprint !== "string" || !task.retry_control || task.retry_control.analyzer_route !== "analyze_revision_loop") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Revision task did not include observe-mode fingerprint metadata.")); } },
    { name: "revision loop analysis emits baseline fingerprint warning", routeId: "analyze_revision_loop", script: "scripts/analyze-revision-loop.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedWarningCodes: ["REVISION_FAILURE_FINGERPRINT_MISSING"], expectedOutputs: [".ai/revisions/revision-loop-analysis.yaml", ".ai/reports/revision-loop-analysis-report.yaml"], assert: r => { const analysis = readYamlFile(path.join(r, ".ai", "revisions", "revision-loop-analysis.yaml")); if (analysis.artifact !== "revision_loop_analysis" || analysis.rollout_mode !== "enforce" || analysis.blocking_decision !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Revision loop analysis did not emit enforce-mode baseline analysis without blocking first-pass setup.")); } },
    { name: "revision loop analysis blocks repeated fingerprint at retry budget", routeId: "analyze_revision_loop", script: "scripts/analyze-revision-loop.ts", category: "operation_correctness", args: ["--failure-fingerprint", "repeat123", "--observe-retry-budget", "2"], setup: r => { writeYamlFile(path.join(r, ".ai", "revisions", "repeat-a.yaml"), { artifact: "revision_task", generated_by: "create-revision-task", revision_id: "repeat-a", status: "created", failure: "same", failure_fingerprint: "repeat123", required_action: "resolve_blocking_failure_and_revalidate", validation_required_routes: ["validate_revision_task", "validate_changed_files"] }); writeYamlFile(path.join(r, ".ai", "revisions", "repeat-b.yaml"), { artifact: "revision_task", generated_by: "create-revision-task", revision_id: "repeat-b", status: "created", failure: "same", failure_fingerprint: "repeat123", required_action: "resolve_blocking_failure_and_revalidate", validation_required_routes: ["validate_revision_task", "validate_changed_files"] }); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["REVISION_RETRY_BUDGET_EXCEEDED"], expectedWarningCodes: ["REVISION_FAILURE_FINGERPRINT_REPEATED"], expectedOutputs: [".ai/revisions/revision-loop-analysis.yaml", ".ai/reports/revision-loop-analysis-report.yaml"], assert: r => { const analysis = readYamlFile(path.join(r, ".ai", "revisions", "revision-loop-analysis.yaml")); if (analysis.active_fingerprint_count !== 2 || analysis.no_progress_suspected !== true || analysis.blocking_decision !== true || analysis.enforcement !== "retry_budget") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Revision loop analysis did not enforce repeated fingerprint retry budget.")); } },
    { name: "revision loop analysis can still observe repeated fingerprint when requested", routeId: "analyze_revision_loop", script: "scripts/analyze-revision-loop.ts", category: "operation_correctness", args: ["--failure-fingerprint", "repeat123", "--observe-retry-budget", "2", "--enforcement-mode", "observe"], setup: r => { writeYamlFile(path.join(r, ".ai", "revisions", "repeat-a.yaml"), { artifact: "revision_task", generated_by: "create-revision-task", revision_id: "repeat-a", status: "created", failure: "same", failure_fingerprint: "repeat123", required_action: "resolve_blocking_failure_and_revalidate", validation_required_routes: ["validate_revision_task", "validate_changed_files"] }); writeYamlFile(path.join(r, ".ai", "revisions", "repeat-b.yaml"), { artifact: "revision_task", generated_by: "create-revision-task", revision_id: "repeat-b", status: "created", failure: "same", failure_fingerprint: "repeat123", required_action: "resolve_blocking_failure_and_revalidate", validation_required_routes: ["validate_revision_task", "validate_changed_files"] }); }, expectedExit: 0, expectedStatus: "pass", expectedWarningCodes: ["REVISION_FAILURE_FINGERPRINT_REPEATED", "REVISION_RETRY_BUDGET_OBSERVED"], expectedOutputs: [".ai/revisions/revision-loop-analysis.yaml", ".ai/reports/revision-loop-analysis-report.yaml"], assert: r => { const analysis = readYamlFile(path.join(r, ".ai", "revisions", "revision-loop-analysis.yaml")); if (analysis.rollout_mode !== "observe" || analysis.active_fingerprint_count !== 2 || analysis.no_progress_suspected !== true || analysis.blocking_decision !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Revision loop analysis did not preserve explicit observe mode for repeated fingerprint.")); } },
    { name: "revision loop analysis fails invalid retry budget", routeId: "analyze_revision_loop", script: "scripts/analyze-revision-loop.ts", category: "malformed_input", args: ["--observe-retry-budget", "0"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["REVISION_RETRY_BUDGET_INVALID"] },
    { name: "revision loop analysis fails invalid enforcement mode", routeId: "analyze_revision_loop", script: "scripts/analyze-revision-loop.ts", category: "malformed_input", args: ["--enforcement-mode", "invalid"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["REVISION_LOOP_ENFORCEMENT_MODE_INVALID"] },
    { name: "revision task validation passes valid task", routeId: "validate_revision_task", script: "scripts/validate-revision-task.ts", category: "valid_input", args: ["--revision-task", ".ai/revisions/verify_revision.yaml"], preRun: r => { runScript(r, "scripts/create-revision-task.ts", ["--failure", "verify_failure", "--revision-id", "verify_revision"]); }, expectedExit: 0, expectedStatus: "pass" },
    { name: "revision task validation fails missing task", routeId: "validate_revision_task", script: "scripts/validate-revision-task.ts", category: "missing_input", args: ["--revision-task", ".ai/revisions/missing.yaml"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["REVISION_TASK_MISSING"] },
    { name: "revision task validation rejects manual task", routeId: "validate_revision_task", script: "scripts/validate-revision-task.ts", category: "invalid_state", args: ["--revision-task", ".ai/revisions/manual.yaml"], setup: r => writeYamlFile(path.join(r, ".ai", "revisions", "manual.yaml"), { artifact: "revision_task", revision_id: "manual", status: "created", failure: "manual_failure", required_action: "resolve_blocking_failure_and_revalidate", validation_required_routes: ["validate_revision_task", "validate_changed_files"] }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["REVISION_TASK_NOT_SCRIPT_PRODUCED"] },
    { name: "phase report collection writes report", routeId: "collect_phase_report", script: "scripts/collect-phase-report.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/phase-report.yaml"] },
    { name: "evidence collection writes evidence index", routeId: "collect_evidence", script: "scripts/collect-evidence.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/validate-executor-routes.ts"); runScript(r, "scripts/run-gate-check.ts", ["--gate-id", "evidence_gate"]); runScript(r, "scripts/prepare-agent-handoff.ts", ["--source-output", ".ai/phase/source-output.yaml", "--target-agent", "builder_agent", "--handoff-id", "evidence_handoff"]); }, setup: r => writeYamlFile(path.join(r, ".ai", "phase", "source-output.yaml"), { artifact: "phase_output", status: "complete" }), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/evidence-manifest.yaml", ".ai/reports/evidence-index.yaml", ".ai/reports/evidence-collection-report.yaml"] },
    { name: "evidence collection indexes normalized validation result", routeId: "collect_evidence", script: "scripts/collect-evidence.ts", category: "operation_correctness", setup: r => writeYamlFile(path.join(r, ".ai", "validation", "normalized-fixture.result.yaml"), { script_id: "validate-validation-result", status: "pass", errors: [], warnings: [], info: [], summary: { normalized_result: { validation_id: "normalized_fixture", status: "blocked", severity: "critical", blocking: true, issues: [{ severity: "critical", code: "BLOCKED_FIXTURE", message: "Blocked fixture" }], evidence: [] } } }), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/evidence-manifest.yaml", ".ai/reports/evidence-index.yaml", ".ai/reports/evidence-collection-report.yaml"], assert: r => { const index = readYamlFile(path.join(r, ".ai", "reports", "evidence-index.yaml")); const entry = Array.isArray(index.entries) ? index.entries.find((candidate: any) => candidate.path === ".ai/validation/normalized-fixture.result.yaml") : undefined; if (!entry || entry.status !== "blocked" || entry.blocking !== true || entry.validation_result?.source_shape !== "normalized_summary") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Evidence index did not expose normalized validation_result contract fields.")); } },
    { name: "evidence collection indexes score decision observe result", routeId: "collect_evidence", script: "scripts/collect-evidence.ts", category: "operation_correctness", preRun: r => { runScript(r, "scripts/resolve-mission-mode-policy.ts", ["--mission-profile", "bugfix"]); writeYamlFile(path.join(r, ".ai", "scoring", "score-vector.yaml"), { artifact: "score_vector", generated_by: "verify-scripts-fixture", scores: { reproduction_confidence_min: 0.9, regression_coverage_min: 0.85, blast_radius_confidence_min: 0.8 } }); runScript(r, "scripts/evaluate-score-decision.ts"); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/evidence-manifest.yaml", ".ai/reports/evidence-index.yaml", ".ai/reports/evidence-collection-report.yaml"], assert: r => { const index = readYamlFile(path.join(r, ".ai", "reports", "evidence-index.yaml")); const entry = Array.isArray(index.entries) ? index.entries.find((candidate: any) => candidate.path === ".ai/scoring/score-decision.yaml") : undefined; if (!entry || entry.source_type !== "scoring" || entry.blocking !== false || entry.score_decision?.deterministic_recommendation !== "proceed_observe_only" || entry.score_decision?.blocking_decision !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Evidence index did not expose observe-mode score decision fields without blocking.")); } },
    { name: "evidence collection indexes revision loop observe analysis", routeId: "collect_evidence", script: "scripts/collect-evidence.ts", category: "operation_correctness", preRun: r => { writeYamlFile(path.join(r, ".ai", "revisions", "repeat-a.yaml"), { artifact: "revision_task", generated_by: "create-revision-task", revision_id: "repeat-a", status: "created", failure: "same", failure_fingerprint: "repeat123", required_action: "resolve_blocking_failure_and_revalidate", validation_required_routes: ["validate_revision_task", "validate_changed_files"] }); writeYamlFile(path.join(r, ".ai", "revisions", "repeat-b.yaml"), { artifact: "revision_task", generated_by: "create-revision-task", revision_id: "repeat-b", status: "created", failure: "same", failure_fingerprint: "repeat123", required_action: "resolve_blocking_failure_and_revalidate", validation_required_routes: ["validate_revision_task", "validate_changed_files"] }); runScript(r, "scripts/analyze-revision-loop.ts", ["--failure-fingerprint", "repeat123", "--observe-retry-budget", "2", "--enforcement-mode", "observe"]); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/evidence-manifest.yaml", ".ai/reports/evidence-index.yaml", ".ai/reports/evidence-collection-report.yaml"], assert: r => { const index = readYamlFile(path.join(r, ".ai", "reports", "evidence-index.yaml")); const entry = Array.isArray(index.entries) ? index.entries.find((candidate: any) => candidate.path === ".ai/revisions/revision-loop-analysis.yaml") : undefined; if (!entry || entry.source_type !== "revision" || entry.blocking !== false || entry.revision_loop_analysis?.no_progress_suspected !== true || entry.revision_loop_analysis?.blocking_decision !== false || entry.revision_loop_analysis?.repeated_fingerprint_count !== 1) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Evidence index did not expose observe-mode revision loop analysis fields without blocking.")); } },
    { name: "report evidence validation fails missing evidence index", routeId: "validate_report_evidence", script: "scripts/validate-report-evidence.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["EVIDENCE_MANIFEST_MISSING"] },
    { name: "report evidence validation passes collected evidence", routeId: "validate_report_evidence", script: "scripts/validate-report-evidence.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/validate-executor-routes.ts"); runScript(r, "scripts/collect-evidence.ts"); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/report-evidence-validation.yaml"] },
    { name: "final mission report generation fails missing evidence", routeId: "generate_final_mission_report", script: "scripts/generate-final-mission-report.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["EVIDENCE_MANIFEST_MISSING"] },
    { name: "final mission report generation writes evidence backed report", routeId: "generate_final_mission_report", script: "scripts/generate-final-mission-report.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/validate-executor-routes.ts"); runScript(r, "scripts/collect-evidence.ts"); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/final-mission-report.yaml", ".ai/reports/mission-evidence-summary.yaml"] },
    { name: "final mission report reads normalized blocking evidence", routeId: "generate_final_mission_report", script: "scripts/generate-final-mission-report.ts", category: "operation_correctness", setup: r => writeEvidenceManifestFixture(r, [{ evidence_id: "normalized_fixture", path: ".ai/validation/normalized-fixture.result.yaml", source_type: "validation", generated_by: "validate-validation-result", status: "blocked", blocking: true }]), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/final-mission-report.yaml", ".ai/reports/mission-evidence-summary.yaml"], assert: r => { const report = readYamlFile(path.join(r, ".ai", "reports", "final-mission-report.yaml")); if (report.status !== "blocked" || report.validation_summary?.blocking_evidence_count !== 1 || !Array.isArray(report.validation_summary?.blocking_validation_refs) || !report.validation_summary.blocking_validation_refs.includes(".ai/validation/normalized-fixture.result.yaml")) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Final mission report did not use normalized blocking validation evidence.")); } },
    { name: "final mission report summarizes observe score decision without blocking", routeId: "generate_final_mission_report", script: "scripts/generate-final-mission-report.ts", category: "operation_correctness", setup: r => writeEvidenceManifestFixture(r, [{ evidence_id: "score_decision", path: ".ai/scoring/score-decision.yaml", source_type: "scoring", generated_by: "evaluate-score-decision", status: "evaluated_observe_only", blocking: false, score_decision: { mission_mode: "bugfix", deterministic_recommendation: "proceed_observe_only", blocking_decision: false } }]), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/final-mission-report.yaml", ".ai/reports/mission-evidence-summary.yaml"], assert: r => { const report = readYamlFile(path.join(r, ".ai", "reports", "final-mission-report.yaml")); if (report.status !== "complete" || report.score_decision_summary?.score_decision_count !== 1 || report.score_decision_summary?.observe_mode_only !== true || report.score_decision_summary?.recommendations?.[0]?.blocking_decision !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Final mission report did not summarize observe-mode score decision without blocking.")); } },
    { name: "final mission report summarizes observe revision loop without blocking", routeId: "generate_final_mission_report", script: "scripts/generate-final-mission-report.ts", category: "operation_correctness", setup: r => writeEvidenceManifestFixture(r, [{ evidence_id: "revision_loop_analysis", path: ".ai/revisions/revision-loop-analysis.yaml", source_type: "revision", generated_by: "analyze-revision-loop", status: "pass", blocking: false, revision_loop_analysis: { mission_id: "verify", active_failure_fingerprint: "repeat123", active_fingerprint_count: 2, repeated_fingerprint_count: 1, no_progress_suspected: true, blocking_decision: false } }]), expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/final-mission-report.yaml", ".ai/reports/mission-evidence-summary.yaml"], assert: r => { const report = readYamlFile(path.join(r, ".ai", "reports", "final-mission-report.yaml")); if (report.status !== "complete" || report.revision_loop_summary?.revision_loop_count !== 1 || report.revision_loop_summary?.observe_mode_only !== true || report.revision_loop_summary?.no_progress_suspected_count !== 1 || report.revision_loop_summary?.analyses?.[0]?.blocking_decision !== false) issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Final mission report did not summarize observe-mode revision loop analysis without blocking.")); } },
    { name: "mission initialization writes state", routeId: "initialize_mission", script: "scripts/initialize-mission.ts", category: "valid_input", args: ["--mission-id", "verify_mission"], expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/missions/verify_mission/mission-state.yaml", ".ai/missions/verify_mission/mission-journal.ndjson", ".ai/missions/verify_mission/mission-checkpoint.yaml"] },
    { name: "mission initialization rejects missing id", routeId: "initialize_mission", script: "scripts/initialize-mission.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_ID_INVALID"] },
    { name: "mission initialization rejects unsafe id", routeId: "initialize_mission", script: "scripts/initialize-mission.ts", category: "malformed_input", args: ["--mission-id", "../unsafe"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_ID_INVALID"] },
    { name: "mission initialization rejects malformed existing state", routeId: "initialize_mission", script: "scripts/initialize-mission.ts", category: "invalid_state", args: ["--mission-id", "malformed_mission"], setup: r => writeYamlFile(path.join(r, ".ai", "missions", "malformed_mission", "mission-state.yaml"), { artifact: "mission_state", schema_version: "1.0", mission_id: "malformed_mission", controller_mode: "observe", current_phase: "", phase_statuses: "not-a-list" }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_STATE_CURRENT_PHASE_INVALID", "MISSION_STATE_PHASE_STATUSES_INVALID"] },
    { name: "mission state inspection passes initialized state", routeId: "inspect_mission_state", script: "scripts/inspect-mission-state.ts", category: "valid_input", args: ["--mission-id", "verify_mission"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "verify_mission"]); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/inspect-mission-state.result.yaml"] },
    { name: "mission resume validates checkpoint and appends event", routeId: "resume_mission", script: "scripts/resume-mission.ts", category: "valid_input", args: ["--mission-id", "resume_mission_verify"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "resume_mission_verify"]); runScript(r, "scripts/advance-mission.ts", ["--mission-id", "resume_mission_verify", "--to-phase", "mission_profile_selection"]); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/missions/resume_mission_verify/mission-state.yaml", ".ai/missions/resume_mission_verify/mission-journal.ndjson", ".ai/missions/resume_mission_verify/mission-checkpoint.yaml"] },
    { name: "mission resume rejects missing id", routeId: "resume_mission", script: "scripts/resume-mission.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_ID_INVALID"] },
    { name: "mission resume rejects stale checkpoint", routeId: "resume_mission", script: "scripts/resume-mission.ts", category: "invalid_state", args: ["--mission-id", "resume_stale_checkpoint"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "resume_stale_checkpoint"]); mutateYaml(path.join(r, ".ai", "missions", "resume_stale_checkpoint", "mission-checkpoint.yaml"), doc => { doc.journal_event_count = 99; }); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_CHECKPOINT_EVENT_COUNT_MISMATCH"] },
    { name: "mission state inspection rejects missing id", routeId: "inspect_mission_state", script: "scripts/inspect-mission-state.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_ID_INVALID"] },
    { name: "mission state inspection rejects malformed state", routeId: "inspect_mission_state", script: "scripts/inspect-mission-state.ts", category: "invalid_state", args: ["--mission-id", "malformed_mission"], setup: r => writeYamlFile(path.join(r, ".ai", "missions", "malformed_mission", "mission-state.yaml"), { artifact: "mission_state", schema_version: "1.0", mission_id: "malformed_mission", controller_mode: "observe", current_phase: "mission_created", phase_statuses: [] }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_STATE_REPORT_REGISTRY_REF_INVALID", "MISSION_STATE_ACTIVE_PHASE_PLAN_INVALID"] },
    { name: "mission state inspection rejects corrupted journal", routeId: "inspect_mission_state", script: "scripts/inspect-mission-state.ts", category: "invalid_state", args: ["--mission-id", "corrupt_journal"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "corrupt_journal"]); fs.appendFileSync(path.join(r, ".ai", "missions", "corrupt_journal", "mission-journal.ndjson"), "not-json\n", "utf8"); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_JOURNAL_LINE_UNPARSEABLE"] },
    { name: "mission state inspection rejects stale checkpoint", routeId: "inspect_mission_state", script: "scripts/inspect-mission-state.ts", category: "invalid_state", args: ["--mission-id", "stale_checkpoint"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "stale_checkpoint"]); mutateYaml(path.join(r, ".ai", "missions", "stale_checkpoint", "mission-checkpoint.yaml"), doc => { doc.journal_event_count = 99; }); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_CHECKPOINT_EVENT_COUNT_MISMATCH"] },
    { name: "mission advance rejects missing id", routeId: "advance_mission", script: "scripts/advance-mission.ts", category: "missing_input", args: ["--to-phase", "planning"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_ID_INVALID"] },
    { name: "mission advance fails missing state", routeId: "advance_mission", script: "scripts/advance-mission.ts", category: "missing_input", args: ["--mission-id", "missing_mission", "--to-phase", "planning"], expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_STATE_MISSING"] },
    { name: "mission advance rejects malformed state", routeId: "advance_mission", script: "scripts/advance-mission.ts", category: "invalid_state", args: ["--mission-id", "malformed_mission", "--to-phase", "planning"], setup: r => writeYamlFile(path.join(r, ".ai", "missions", "malformed_mission", "mission-state.yaml"), { artifact: "mission_state", schema_version: "1.0", mission_id: "malformed_mission", controller_mode: "observe", current_phase: "mission_created", active_phase_plan: {}, phase_statuses: [] }), expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_STATE_REPORT_REGISTRY_REF_INVALID", "MISSION_STATE_ACTIVE_PHASE_PLAN_ORDERED_PHASES_INVALID"] },
    { name: "mission advance records observe transition", routeId: "advance_mission", script: "scripts/advance-mission.ts", category: "valid_input", args: ["--mission-id", "verify_mission", "--to-phase", "mission_profile_selection"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "verify_mission"]); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/missions/verify_mission/mission-state.yaml", ".ai/missions/verify_mission/mission-journal.ndjson", ".ai/missions/verify_mission/mission-checkpoint.yaml"] },
    { name: "mission advance rejects corrupted journal before append", routeId: "advance_mission", script: "scripts/advance-mission.ts", category: "invalid_state", args: ["--mission-id", "corrupt_before_advance", "--to-phase", "mission_profile_selection"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "corrupt_before_advance"]); fs.appendFileSync(path.join(r, ".ai", "missions", "corrupt_before_advance", "mission-journal.ndjson"), "not-json\n", "utf8"); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_JOURNAL_LINE_UNPARSEABLE"] },
    { name: "transition legality validation passes next phase", routeId: "validate_transition_legality", script: "scripts/validate-transition-legality.ts", category: "valid_input", args: ["--mission-id", "transition_verify", "--to-phase", "mission_profile_selection"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "transition_verify"]); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-transition-legality.result.yaml"] },
    { name: "transition legality validation blocks skipped phase", routeId: "validate_transition_legality", script: "scripts/validate-transition-legality.ts", category: "operation_correctness", args: ["--mission-id", "transition_skip_verify", "--to-phase", "implementation"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "transition_skip_verify"]); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_TRANSITION_SKIPPED_PHASE_ORDER"], expectedWarningCodes: ["MISSION_TRANSITION_GATE_EVIDENCE_MISSING"], expectedOutputs: [".ai/validation/validate-transition-legality.result.yaml"] },
    { name: "transition legality observes missing gate evidence", routeId: "validate_transition_legality", script: "scripts/validate-transition-legality.ts", category: "operation_correctness", args: ["--mission-id", "missing_gate_observe", "--to-phase", "implementation"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "missing_gate_observe"]); advanceMissionToPhase(r, "missing_gate_observe", "pre_implementation_gate"); }, expectedExit: 0, expectedStatus: "pass", expectedWarningCodes: ["MISSION_TRANSITION_GATE_EVIDENCE_MISSING"], expectedOutputs: [".ai/validation/validate-transition-legality.result.yaml"] },
    { name: "transition legality observes missing handoff evidence", routeId: "validate_transition_legality", script: "scripts/validate-transition-legality.ts", category: "operation_correctness", args: ["--mission-id", "missing_handoff_observe", "--to-phase", "active_context_manifest"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "missing_handoff_observe"]); runScript(r, "scripts/advance-mission.ts", ["--mission-id", "missing_handoff_observe", "--to-phase", "mission_profile_selection"]); runScript(r, "scripts/advance-mission.ts", ["--mission-id", "missing_handoff_observe", "--to-phase", "mission_initialization"]); }, expectedExit: 0, expectedStatus: "pass", expectedWarningCodes: ["MISSION_TRANSITION_HANDOFF_EVIDENCE_MISSING"], expectedOutputs: [".ai/validation/validate-transition-legality.result.yaml"] },
    { name: "transition legality observes missing revision evidence", routeId: "validate_transition_legality", script: "scripts/validate-transition-legality.ts", category: "operation_correctness", args: ["--mission-id", "missing_revision_observe", "--to-phase", "mission_profile_selection", "--event", "revision_rerun_observed"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "missing_revision_observe"]); runScript(r, "scripts/advance-mission.ts", ["--mission-id", "missing_revision_observe", "--to-phase", "mission_profile_selection"]); runScript(r, "scripts/advance-mission.ts", ["--mission-id", "missing_revision_observe", "--to-phase", "mission_initialization"]); }, expectedExit: 0, expectedStatus: "pass", expectedWarningCodes: ["MISSION_TRANSITION_REVISION_EVIDENCE_MISSING"], expectedOutputs: [".ai/validation/validate-transition-legality.result.yaml"] },
    { name: "mission advance blocks illegal transition before mutation", routeId: "advance_mission", script: "scripts/advance-mission.ts", category: "operation_correctness", args: ["--mission-id", "illegal_observe", "--to-phase", "implementation"], preRun: r => { runScript(r, "scripts/initialize-mission.ts", ["--mission-id", "illegal_observe"]); }, expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["MISSION_TRANSITION_SKIPPED_PHASE_ORDER"], expectedWarningCodes: ["MISSION_TRANSITION_GATE_EVIDENCE_MISSING"] },
    { name: "claude execution plan generation writes plan", routeId: "generate_claude_execution_plan", script: "scripts/generate-claude-execution-plan.ts", category: "valid_input", expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/claude/execution-plan.yaml"] },
    { name: "claude execution plan validation fails missing plan", routeId: "validate_claude_execution_plan", script: "scripts/validate-claude-execution-plan.ts", category: "missing_input", expectedExit: 1, expectedStatus: "fail", expectedErrorCodes: ["CLAUDE_EXECUTION_PLAN_MISSING"] },
    { name: "claude execution plan validation passes generated plan", routeId: "validate_claude_execution_plan", script: "scripts/validate-claude-execution-plan.ts", category: "valid_input", preRun: r => { runScript(r, "scripts/generate-claude-execution-plan.ts"); }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/reports/claude-execution-plan-validation.yaml"] },
    { name: "claude native integration validation passes project files", routeId: "validate_claude_native_integration", script: "scripts/validate-claude-native-integration.ts", category: "valid_input", setup: r => {
      const projectRoot = path.resolve(r, "..");
      const agentTaxonomy = readYamlFile(path.join(r, "agents", "conventions.agent-taxonomy.yaml"));
      const agentIds = Object.keys((agentTaxonomy.sections?.agent_definitions ?? {}) as JsonMap);
      const slug = (value: string) => value.replaceAll("_", "-");
      const skills = ["start-mission", "run-alpha-cycle", "resume-mission", "activate-agent", "run-phase", "validate-phase", "run-gate", "prepare-handoff", "transition-phase", "revision-loop", "generate-artifact", "collect-report-evidence", "complete-mission"];
      const commands = ["start-mission", "run-alpha-cycle", "resume-mission", "activate-agent", "run-phase", "validate-phase", "transition-phase", "revision-loop", "complete-mission"];
      const coreRoutes = ["initialize_mission", "inspect_mission_state", "resume_mission", "advance_mission", "generate_mission_bundle", "generate_claude_execution_plan", "validate_claude_execution_plan", "generate_phase_bundle", "validate_phase_bundle", "validate_changed_files", "validate_phase_output", "validate_semantic_completeness", "run_gate_check", "validate_gate_result", "prepare_agent_handoff", "validate_handoff", "create_revision_task", "validate_revision_task", "collect_evidence", "validate_report_evidence", "generate_final_mission_report"];
      fs.writeFileSync(path.join(projectRoot, "CLAUDE.md"), coreRoutes.map(route => `npm --prefix conventions/scripts run invoke:route -- --route ${route}`).join("\n"), "utf8");
      for (const skill of skills) {
        fs.mkdirSync(path.join(projectRoot, ".claude", "skills", skill), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, ".claude", "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: test\n---\n${coreRoutes.join(" ")}\nnpm --prefix conventions/scripts run invoke:route -- --route validate_executor_routes`, "utf8");
      }
      fs.mkdirSync(path.join(projectRoot, ".claude", "commands"), { recursive: true });
      for (const command of commands) fs.writeFileSync(path.join(projectRoot, ".claude", "commands", `${command}.md`), `# /${command}\nnpm --prefix conventions/scripts run invoke:route -- --route validate_executor_routes`, "utf8");
      fs.mkdirSync(path.join(projectRoot, ".claude", "agents"), { recursive: true });
      for (const agentId of agentIds) fs.writeFileSync(path.join(projectRoot, ".claude", "agents", `${slug(agentId)}.md`), `---\nname: ${slug(agentId)}\ndescription: test\n---\nConvention agent id: ${agentId}\nnpm --prefix conventions/scripts run invoke:route -- --route validate_executor_routes`, "utf8");
      fs.writeFileSync(path.join(projectRoot, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "npm --prefix conventions/scripts run invoke:route -- --route validate_executor_routes" }] }], PostToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "npm --prefix conventions/scripts run invoke:route -- --route validate_changed_files" }] }], Stop: [{ hooks: [{ type: "command", command: "npm --prefix conventions/scripts run invoke:route -- --route collect_evidence" }] }], StopFailure: [{ hooks: [{ type: "command", command: "npm --prefix conventions/scripts run invoke:route -- --route collect_evidence" }] }] } }), "utf8");
    }, expectedExit: 0, expectedStatus: "pass", expectedOutputs: [".ai/validation/validate-claude-native-integration.result.yaml"], assert: (_r, run) => { const direct = run.result?.summary?.validation_result as JsonMap | undefined; if (!direct || direct.validation_id !== "validate-claude-native-integration" || direct.status !== "passed" || direct.blocking !== false || direct.source_script_id !== "validate-claude-native-integration") issues.push(issue("error", "SCRIPT_ASSERTION_FAILED", "Claude-native validator did not emit compatible universal validation_result summary.")); } },
  ];
}

const routes = readExecutorRoutes(root);
const liveTestNames = new Set([
  "executor routes valid input passes",
  "route invocation wrapper invokes known route",
  "mission resume validates checkpoint and appends event",
  "transition legality validation passes next phase",
  "transition legality validation blocks skipped phase",
  "transition legality observes missing gate evidence",
  "transition legality observes missing handoff evidence",
  "transition legality observes missing revision evidence",
  "mission advance blocks illegal transition before mutation",
  "route output validation passes standard result",
  "route output validation fails invalid issue entry",
  "route output validation fails invalid optional fields",
  "route invocation validation passes known route",
  "reference validation valid input passes",
  "changed files validation passes valid file",
  "runtime artifact topology compile valid input passes",
  "source artifact collection writes manifest",
  "mission mode policy resolves profile",
  "phase bundle generation passes known phase",
  "semantic completeness validation passes current conventions",
  "gate check writes pass result",
  "handoff preparation writes handoff packet",
  "revision task creation writes revision task",
  "revision loop analysis emits baseline fingerprint warning",
  "revision loop analysis warns repeated fingerprint",
  "evidence collection writes evidence index",
  "claude execution plan generation writes plan",
  "gate check blocks normalized validation result",
  "evidence collection indexes normalized validation result",
  "evidence collection indexes score decision observe result",
  "final mission report reads normalized blocking evidence",
  "final mission report summarizes observe score decision without blocking",
  "claude native integration validation passes project files",
]);
const declaredTests = process.env.TEST_FILTER ? testCases().filter(test => test.name.includes(process.env.TEST_FILTER!)) : testCases();
const tests = declaredTests.filter(test => liveTestNames.has(test.name));
const testResults: JsonMap[] = [];

for (const test of tests) {
  const fixtureRoot = makeFixture(test.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase());
  try {
    test.setup?.(fixtureRoot);
    test.preRun?.(fixtureRoot);
    const run = runScript(fixtureRoot, test.script, test.args ?? []);
    const allowedPatterns = routeAllowedWritePatterns(routes, test.routeId);
    const disallowedWrites = writtenFilesAreAllowed(run.writtenFiles, allowedPatterns);
    const codes = resultErrorCodes(run.result);
    const warningCodes = resultWarningCodes(run.result);
    const testRecord = {
      name: test.name,
      category: test.category,
      route_id: test.routeId,
      script: test.script,
      expected_exit: test.expectedExit,
      actual_exit: run.exitCode,
      expected_status: test.expectedStatus,
      actual_status: run.result?.status ?? null,
      error_codes: codes,
      warning_codes: warningCodes,
      written_files: run.writtenFiles,
      disallowed_writes: disallowedWrites,
    };
    testResults.push(testRecord);

    if (!routes.has(test.routeId)) {
      issues.push(issue("critical", "SCRIPT_TEST_ROUTE_UNKNOWN", `Test route is not declared: ${test.routeId}`, undefined, testRecord));
    }
    if (run.exitCode !== test.expectedExit) {
      issues.push(issue("error", "SCRIPT_EXIT_CODE_UNEXPECTED", `Script ${test.script} exited ${run.exitCode}; expected ${test.expectedExit}`, undefined, { ...testRecord, stderr: run.stderr, stdout: run.stdout }));
    }
    assertScriptResultShape(test, run);
    for (const expectedCode of test.expectedErrorCodes ?? []) {
      if (!codes.includes(expectedCode)) {
        issues.push(issue("error", "SCRIPT_EXPECTED_ERROR_CODE_MISSING", `Script ${test.script} did not emit expected error code ${expectedCode}`, undefined, testRecord));
      }
    }
    for (const expectedCode of test.expectedWarningCodes ?? []) {
      if (!warningCodes.includes(expectedCode)) {
        issues.push(issue("error", "SCRIPT_EXPECTED_WARNING_CODE_MISSING", `Script ${test.script} did not emit expected warning code ${expectedCode}`, undefined, testRecord));
      }
    }
    for (const expectedOutput of test.expectedOutputs ?? []) {
      if (!fs.existsSync(path.join(fixtureRoot, expectedOutput))) {
        issues.push(issue("error", "SCRIPT_EXPECTED_OUTPUT_MISSING", `Script ${test.script} did not write expected output ${expectedOutput}`, undefined, testRecord));
      }
    }
    test.assert?.(fixtureRoot, run);
    if (disallowedWrites.length) {
      issues.push(issue("error", "SCRIPT_WROTE_OUTSIDE_ALLOWED_PATHS", `Script ${test.script} wrote outside allowed paths`, undefined, { ...testRecord, allowedPatterns }));
    }
  } finally {
    // Fixture directories are intentionally left in the OS temp directory when verification runs.
    // This avoids platform-specific recursive delete hangs and preserves failing fixtures for inspection.
  }
}

const testedRoutes = new Set(declaredTests.map(test => test.routeId));
const liveTestedRoutes = new Set(tests.map(test => test.routeId));
const untestedRoutes = [...routes.keys()].filter(routeId => routeId !== "validate_script_execution" && !testedRoutes.has(routeId)).sort();
for (const routeId of untestedRoutes) {
  issues.push(issue("error", "SCRIPT_ROUTE_UNTESTED", `Executor route has no script verification test: ${routeId}`));
}

const routeCoverage: Record<string, any> = {};
for (const [routeId, route] of routes.entries()) {
  const routeTests = declaredTests.filter(test => test.routeId === routeId);
  const liveRouteTests = tests.filter(test => test.routeId === routeId);
  routeCoverage[routeId] = {
    script: route.script,
    executor_type: route.executor_type,
    declared_test_count: routeTests.length,
    live_test_count: liveRouteTests.length,
    declared_categories: [...new Set(routeTests.map(test => test.category))].sort(),
    live_categories: [...new Set(liveRouteTests.map(test => test.category))].sort(),
  };
}

const scriptCoverage: Record<string, any> = {};
for (const test of declaredTests) {
  scriptCoverage[test.script] ??= { test_count: 0, routes: new Set<string>(), categories: new Set<string>() };
  scriptCoverage[test.script].test_count += 1;
  scriptCoverage[test.script].routes.add(test.routeId);
  scriptCoverage[test.script].categories.add(test.category);
}
const normalizedScriptCoverage: Record<string, any> = {};
for (const [script, coverage] of Object.entries(scriptCoverage)) {
  normalizedScriptCoverage[script] = { test_count: coverage.test_count, routes: [...coverage.routes].sort(), categories: [...coverage.categories].sort() };
}

writeYamlFile(reportPath, {
  artifact: "script_verification_report",
  generated_by: SCRIPT_ID,
  coverage_model: "per_route_script_behavior_matrix",
  required_route_coverage: "every executor route except validate_script_execution must have declared coverage; selected representative cases are run live",
  declared_test_count: declaredTests.length,
  live_test_count: testResults.length,
  deferred_live_cases: declaredTests.filter(test => !liveTestNames.has(test.name)).map(test => test.name).sort(),
  failed_test_count: issues.filter(entry => entry.severity === "error" || entry.severity === "critical").length,
  route_coverage: routeCoverage,
  script_coverage: normalizedScriptCoverage,
  tests: testResults,
});

const finalErrors = issues.filter(entry => entry.severity === "error" || entry.severity === "critical");
const finalWarnings = issues.filter(entry => entry.severity === "warning");
const finalInfo = issues.filter(entry => entry.severity === "info");
const finalResult = {
  script_id: SCRIPT_ID,
  status: finalErrors.length ? "fail" : "pass",
  errors: finalErrors,
  warnings: finalWarnings,
  info: finalInfo,
  outputs: [".ai/reports/script-verification-report.yaml", ".ai/validation/verify-scripts.result.yaml"],
  summary: {
    live_test_count: testResults.length,
    declared_test_count: declaredTests.length,
    failed_test_count: finalErrors.length,
    declared_tested_route_count: testedRoutes.size,
    live_tested_route_count: liveTestedRoutes.size,
    untested_route_count: untestedRoutes.length,
  },
};
ensureDir(path.join(root, ".ai", "validation"));
fs.writeFileSync(path.join(root, ".ai", "validation", "verify-scripts.result.yaml"), JSON.stringify(finalResult, null, 2), "utf8");
if (process.env.SCRIPT_RESULT_STDOUT !== "suppress") console.log(JSON.stringify(finalResult, null, 2));
process.exit(finalErrors.length ? 1 : 0);
