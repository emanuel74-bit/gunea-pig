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
  args?: string[];
  setup?: (fixtureRoot: string) => void;
  preRun?: (fixtureRoot: string) => void;
  expectedExit: number;
  expectedStatus: "pass" | "fail";
  expectedErrorCodes?: string[];
  expectedOutputs?: string[];
}

function copyDirectory(source: string, target: string): void {
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (["node_modules", ".git", ".ai"].includes(entry.name)) continue;
    if (entry.name === "package-lock.json") continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
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
    maxBuffer: 1024 * 1024 * 2,
    timeout: 20000,
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

function testCases(): TestCase[] {
  return [
    {
      name: "valid executor routes pass",
      routeId: "validate_executor_routes",
      script: "scripts/validate-executor-routes.ts",
      expectedExit: 0,
      expectedStatus: "pass",
      expectedOutputs: [".ai/validation/validate-executor-routes.result.yaml"],
    },
    {
      name: "executor route validation fails missing script",
      routeId: "validate_executor_routes",
      script: "scripts/validate-executor-routes.ts",
      setup: fixtureRoot => mutateYaml(path.join(fixtureRoot, "executors", "conventions.executor-routes.yaml"), doc => {
        doc.sections.executor_routes.validation.validate_executor_routes.script = "scripts/missing-script.ts";
      }),
      expectedExit: 1,
      expectedStatus: "fail",
      expectedErrorCodes: ["MISSING_SCRIPT_IMPLEMENTATION"],
    },
    {
      name: "executor route validation fails unknown local route",
      routeId: "validate_executor_routes",
      script: "scripts/validate-executor-routes.ts",
      setup: fixtureRoot => addFixtureConvention(fixtureRoot, "phases/conventions.unknown-route-fixture.yaml", {
        version: "1.0",
        file: { name: "conventions.unknown-route-fixture.yaml", path: "phases/conventions.unknown-route-fixture.yaml", role: "test_fixture", executability: "policy" },
        ownership: { owns: ["unknown_route_fixture"] },
        sections: { required_executor_routes: { before_phase_start: ["missing_unknown_route"] } },
      }),
      expectedExit: 1,
      expectedStatus: "fail",
      expectedErrorCodes: ["UNKNOWN_LOCAL_ROUTE"],
    },
    {
      name: "authority topology compile passes",
      routeId: "compile_authority_topology",
      script: "scripts/compile-authority-topology.ts",
      expectedExit: 0,
      expectedStatus: "pass",
      expectedOutputs: [".ai/topologies/authority-topology.yaml", ".ai/reports/authority-conflict-report.yaml"],
    },
    {
      name: "authority topology compile fails duplicate owner",
      routeId: "compile_authority_topology",
      script: "scripts/compile-authority-topology.ts",
      setup: fixtureRoot => addFixtureConvention(fixtureRoot, "core/conventions.duplicate-owner-fixture.yaml", {
        version: "1.0",
        file: { name: "conventions.duplicate-owner-fixture.yaml", path: "core/conventions.duplicate-owner-fixture.yaml", role: "test_fixture", executability: "policy" },
        ownership: { owns: ["central_executor_route_map"] },
        sections: {},
      }),
      expectedExit: 1,
      expectedStatus: "fail",
      expectedErrorCodes: ["DUPLICATE_CONCEPT_OWNER"],
    },
    {
      name: "reference validation passes",
      routeId: "validate_references",
      script: "scripts/validate-references.ts",
      expectedExit: 0,
      expectedStatus: "pass",
      expectedOutputs: [".ai/topologies/reference-topology.yaml", ".ai/validation/validate-references.result.yaml"],
    },
    {
      name: "reference validation fails missing required dependency",
      routeId: "validate_references",
      script: "scripts/validate-references.ts",
      setup: fixtureRoot => addFixtureConvention(fixtureRoot, "core/conventions.missing-dependency-fixture.yaml", {
        version: "1.0",
        file: { name: "conventions.missing-dependency-fixture.yaml", path: "core/conventions.missing-dependency-fixture.yaml", role: "test_fixture", executability: "policy" },
        ownership: { owns: ["missing_dependency_fixture"] },
        dependencies: { required_files: ["core/does-not-exist.yaml"], optional_files: [] },
        sections: {},
      }),
      expectedExit: 1,
      expectedStatus: "fail",
      expectedErrorCodes: ["MISSING_REQUIRED_DEPENDENCY"],
    },
    {
      name: "changed files validation passes valid file",
      routeId: "validate_changed_files",
      script: "scripts/validate-changed-files.ts",
      args: ["--changed", "core/conventions.core.yaml"],
      expectedExit: 0,
      expectedStatus: "pass",
    },
    {
      name: "changed files validation fails missing file",
      routeId: "validate_changed_files",
      script: "scripts/validate-changed-files.ts",
      args: ["--changed", "core/missing-file.yaml"],
      expectedExit: 1,
      expectedStatus: "fail",
      expectedErrorCodes: ["CHANGED_FILE_MISSING"],
    },
    {
      name: "runtime artifact topology compile passes",
      routeId: "compile_runtime_artifact_topology",
      script: "scripts/compile-runtime-artifact-topology.ts",
      expectedExit: 0,
      expectedStatus: "pass",
      expectedOutputs: [".ai/topologies/runtime-artifact-topology.yaml", ".ai/reports/artifact-conflict-report.yaml"],
    },
    {
      name: "runtime artifact validation fails without topology",
      routeId: "validate_runtime_artifacts",
      script: "scripts/validate-runtime-artifacts.ts",
      expectedExit: 1,
      expectedStatus: "fail",
      expectedErrorCodes: ["RUNTIME_ARTIFACT_TOPOLOGY_MISSING"],
    },
    {
      name: "phase bundle generation passes known phase",
      routeId: "generate_phase_bundle",
      script: "scripts/generate-phase-bundle.ts",
      args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"],
      expectedExit: 0,
      expectedStatus: "pass",
      expectedOutputs: [".ai/bundles/phases/verify/mission_profile_selection.bundle.yaml", ".ai/bundles/phases/verify/mission_profile_selection.manifest.yaml"],
    },
    {
      name: "phase bundle generation fails unknown phase",
      routeId: "generate_phase_bundle",
      script: "scripts/generate-phase-bundle.ts",
      args: ["--mission-id", "verify", "--phase-id", "unknown_phase_for_test"],
      expectedExit: 1,
      expectedStatus: "fail",
      expectedErrorCodes: ["PHASE_CONTRACT_MISSING", "PHASE_OWNERSHIP_MISSING"],
    },
    {
      name: "phase bundle validation passes after generation",
      routeId: "validate_phase_bundle",
      script: "scripts/validate-phase-bundle.ts",
      args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"],
      preRun: fixtureRoot => { runScript(fixtureRoot, "scripts/generate-phase-bundle.ts", ["--mission-id", "verify", "--phase-id", "mission_profile_selection"]); },
      expectedExit: 0,
      expectedStatus: "pass",
    },
    {
      name: "phase bundle validation fails missing bundle",
      routeId: "validate_phase_bundle",
      script: "scripts/validate-phase-bundle.ts",
      args: ["--mission-id", "verify", "--phase-id", "mission_profile_selection"],
      expectedExit: 1,
      expectedStatus: "fail",
      expectedErrorCodes: ["PHASE_BUNDLE_MISSING"],
    },
  ];
}

const routes = readExecutorRoutes(root);
const testResults: JsonMap[] = [];

for (const test of testCases()) {
  const fixtureRoot = makeFixture(test.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase());
  try {
    test.setup?.(fixtureRoot);
    test.preRun?.(fixtureRoot);
    const run = runScript(fixtureRoot, test.script, test.args ?? []);
    const allowedPatterns = routeAllowedWritePatterns(routes, test.routeId);
    const disallowedWrites = writtenFilesAreAllowed(run.writtenFiles, allowedPatterns);
    const codes = resultErrorCodes(run.result);
    const testRecord = {
      name: test.name,
      route_id: test.routeId,
      script: test.script,
      expected_exit: test.expectedExit,
      actual_exit: run.exitCode,
      expected_status: test.expectedStatus,
      actual_status: run.result?.status ?? null,
      error_codes: codes,
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
    for (const expectedOutput of test.expectedOutputs ?? []) {
      if (!fs.existsSync(path.join(fixtureRoot, expectedOutput))) {
        issues.push(issue("error", "SCRIPT_EXPECTED_OUTPUT_MISSING", `Script ${test.script} did not write expected output ${expectedOutput}`, undefined, testRecord));
      }
    }
    if (disallowedWrites.length) {
      issues.push(issue("error", "SCRIPT_WROTE_OUTSIDE_ALLOWED_PATHS", `Script ${test.script} wrote outside allowed paths`, undefined, { ...testRecord, allowedPatterns }));
    }
  } finally {
    // Fixture directories are intentionally left in the OS temp directory when verification runs.
    // This avoids platform-specific recursive delete hangs and preserves failing fixtures for inspection.
  }
}

writeYamlFile(reportPath, {
  artifact: "script_verification_report",
  generated_by: SCRIPT_ID,
  test_count: testResults.length,
  failed_test_count: issues.filter(entry => entry.severity === "error" || entry.severity === "critical").length,
  tests: testResults,
});

finish(SCRIPT_ID, issues, [".ai/reports/script-verification-report.yaml", ".ai/validation/verify-scripts.result.yaml"], {
  test_count: testResults.length,
  failed_test_count: issues.filter(entry => entry.severity === "error" || entry.severity === "critical").length,
});
