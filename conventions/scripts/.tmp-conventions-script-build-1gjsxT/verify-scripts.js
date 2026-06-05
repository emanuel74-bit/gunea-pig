import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { ensureDir, globMatches, issue, readExecutorRoutes, readYamlFile, resolveConventionsRoot, writeYamlFile, } from "./lib/common.js";
const SCRIPT_ID = "verify-scripts";
const root = resolveConventionsRoot();
const issues = [];
const reportPath = path.join(root, ".ai", "reports", "script-verification-report.yaml");
const compiledScriptRoot = fs.mkdtempSync(path.join(root, "scripts", ".tmp-conventions-script-build-"));
const tsc = childProcess.spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", [
    "tsc",
    "--outDir",
    compiledScriptRoot,
    "--rootDir",
    ".",
    "--noEmit",
    "false",
], {
    cwd: path.join(root, "scripts"),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
});
if (tsc.status !== 0) {
    issues.push(issue("critical", "SCRIPT_BUILD_FAILED", "TypeScript script build failed before verification", undefined, { stdout: tsc.stdout, stderr: tsc.stderr }));
}
function copyDirectory(source, target) {
    fs.cpSync(source, target, {
        recursive: true,
        force: true,
        filter: (copiedPath) => {
            const base = path.basename(copiedPath);
            if (["node_modules", ".git", ".ai"].includes(base))
                return false;
            if (base === "package-lock.json")
                return false;
            return true;
        },
    });
}
function listFiles(base) {
    const out = new Set();
    function walk(dir) {
        if (!fs.existsSync(dir))
            return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (["node_modules", ".git"].includes(entry.name))
                    continue;
                walk(full);
            }
            else if (entry.isFile()) {
                out.add(path.relative(base, full).replace(/\\/g, "/"));
            }
        }
    }
    walk(base);
    return out;
}
function parseStdoutResult(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed)
        return undefined;
    try {
        const parsed = YAML.parse(trimmed);
        return parsed && typeof parsed === "object"
            ? parsed
            : undefined;
    }
    catch {
        return undefined;
    }
}
function runScript(fixtureRoot, scriptRel, args = []) {
    const before = listFiles(fixtureRoot);
    const compiledRel = scriptRel
        .replace(/^scripts\//, "")
        .replace(/\.ts$/, ".js");
    const scriptAbs = path.join(compiledScriptRoot, compiledRel);
    const child = childProcess.spawnSync(process.execPath, [scriptAbs, "--root", fixtureRoot, ...args], {
        cwd: path.join(root, "scripts"),
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 4,
        timeout: 60000,
        env: { ...process.env, SCRIPT_RESULT_STDOUT: "suppress" },
    });
    const after = listFiles(fixtureRoot);
    const writtenFiles = [...after].filter((file) => !before.has(file)).sort();
    const scriptId = path.basename(scriptRel).replace(/\.ts$/, "");
    const resultPath = path.join(fixtureRoot, ".ai", "validation", `${scriptId}.result.yaml`);
    const fileResult = fs.existsSync(resultPath)
        ? readYamlFile(resultPath)
        : undefined;
    return {
        exitCode: child.status,
        stdout: child.stdout ?? "",
        stderr: child.stderr ?? "",
        result: fileResult ?? parseStdoutResult(child.stdout ?? ""),
        writtenFiles,
    };
}
function makeFixture(name) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `conventions-script-verification-${name}-`));
    copyDirectory(root, base);
    return base;
}
function mutateYaml(filePath, mutator) {
    const doc = readYamlFile(filePath);
    mutator(doc);
    writeYamlFile(filePath, doc);
}
function addFixtureConvention(fixtureRoot, relPath, content) {
    writeYamlFile(path.join(fixtureRoot, relPath), content);
}
function resultErrorCodes(result) {
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    return errors
        .map((entry) => String(entry?.code ?? ""))
        .filter(Boolean);
}
function routeAllowedWritePatterns(routes, routeId) {
    const route = routes.get(routeId);
    const declared = Array.isArray(route?.allowed_write_paths)
        ? route.allowed_write_paths.map(String)
        : [];
    return [...new Set([...declared, ".ai/validation/**"])];
}
function writtenFilesAreAllowed(writtenFiles, allowedPatterns) {
    return writtenFiles.filter((file) => file.startsWith(".ai/") &&
        !allowedPatterns.some((pattern) => globMatches(pattern, file)));
}
function assertScriptResultShape(test, run) {
    const result = run.result;
    if (!result) {
        issues.push(issue("critical", "SCRIPT_RESULT_NOT_PARSEABLE", `Script ${test.script} did not print parseable YAML/JSON result`, undefined, { test: test.name, stdout: run.stdout, stderr: run.stderr }));
        return;
    }
    for (const field of ["script_id", "status", "errors", "warnings", "info"]) {
        if (!(field in result))
            issues.push(issue("error", "SCRIPT_RESULT_FIELD_MISSING", `Script result missing field ${field}`, undefined, { test: test.name, script: test.script }));
    }
    if (!Array.isArray(result.errors) ||
        !Array.isArray(result.warnings) ||
        !Array.isArray(result.info)) {
        issues.push(issue("error", "SCRIPT_RESULT_LIST_FIELD_INVALID", "Script result errors/warnings/info must be arrays", undefined, { test: test.name, script: test.script }));
    }
    if (result.status !== test.expectedStatus) {
        issues.push(issue("error", "SCRIPT_RESULT_STATUS_UNEXPECTED", `Script ${test.script} status ${result.status} did not match expected ${test.expectedStatus}`, undefined, { test: test.name }));
    }
}
function validConvention(name, ownedConcept, extra = {}) {
    return {
        version: "1.0",
        file: {
            name: path.basename(name),
            path: name,
            role: "test_fixture",
            executability: "policy",
        },
        ownership: { owns: [ownedConcept] },
        sections: {},
        ...extra,
    };
}
function mutateExecutorRoute(fixtureRoot, mutator) {
    mutateYaml(path.join(fixtureRoot, "executors", "conventions.executor-routes.yaml"), (doc) => mutator(doc.sections.executor_routes));
}
function writePhaseBundleFixture(fixtureRoot, mutator, writeManifest = true) {
    const bundlePath = path.join(fixtureRoot, ".ai", "bundles", "phases", "verify", "mission_profile_selection.bundle.yaml");
    const manifestPath = path.join(fixtureRoot, ".ai", "bundles", "phases", "verify", "mission_profile_selection.manifest.yaml");
    const generated = runScript(fixtureRoot, "scripts/generate-phase-bundle.ts", ["--mission-id", "verify", "--phase-id", "mission_profile_selection"]);
    if (generated.exitCode !== 0)
        throw new Error(`Could not generate base phase bundle for fixture: ${generated.stderr}`);
    const bundle = readYamlFile(bundlePath);
    mutator?.(bundle);
    writeYamlFile(bundlePath, bundle);
    if (!writeManifest && fs.existsSync(manifestPath))
        fs.rmSync(manifestPath);
}
function testCases() {
    return [
        // validate-executor-routes.ts
        {
            name: "executor routes valid input passes",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "valid_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/validation/validate-executor-routes.result.yaml",
            ],
        },
        {
            name: "executor route validation fails missing script",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "invalid_state",
            setup: (r) => mutateExecutorRoute(r, (routes) => {
                routes.validation.validate_executor_routes.script =
                    "scripts/missing-script.ts";
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["MISSING_SCRIPT_IMPLEMENTATION"],
        },
        {
            name: "executor route validation fails unknown local route",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "phases/conventions.unknown-route-fixture.yaml", validConvention("phases/conventions.unknown-route-fixture.yaml", "unknown_route_fixture", {
                sections: {
                    required_executor_routes: {
                        before_phase_start: [
                            "missing_unknown_route",
                        ],
                    },
                },
            })),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["UNKNOWN_LOCAL_ROUTE"],
        },
        {
            name: "executor route validation fails direct script reference",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "phases/conventions.direct-script-fixture.yaml", validConvention("phases/conventions.direct-script-fixture.yaml", "direct_script_fixture", {
                sections: {
                    required_executor_routes: {
                        before_phase_start: [
                            "scripts/validate-references.ts",
                        ],
                    },
                },
            })),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["DIRECT_SCRIPT_REFERENCE"],
        },
        {
            name: "executor route validation fails invalid route id",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "malformed_input",
            setup: (r) => mutateExecutorRoute(r, (routes) => {
                routes.validation.badroute = {
                    ...routes.validation.validate_executor_routes,
                };
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["INVALID_ROUTE_ID"],
        },
        {
            name: "executor route validation fails missing required field",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "malformed_input",
            setup: (r) => mutateExecutorRoute(r, (routes) => {
                delete routes.validation.validate_executor_routes
                    .failure_behavior;
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: [
                "ROUTE_MISSING_FIELD",
                "UNKNOWN_FAILURE_BEHAVIOR",
            ],
        },
        {
            name: "executor route validation fails unknown executor type",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "malformed_input",
            setup: (r) => mutateExecutorRoute(r, (routes) => {
                routes.validation.validate_executor_routes.executor_type =
                    "nonsense";
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: [
                "UNKNOWN_EXECUTOR_TYPE",
                "ROUTE_GROUP_TYPE_MISMATCH",
            ],
        },
        {
            name: "executor route validation fails forbidden blocking field",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "malformed_input",
            setup: (r) => mutateExecutorRoute(r, (routes) => {
                routes.validation.validate_executor_routes.blocking = true;
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["FORBIDDEN_BLOCKING_FIELD"],
        },
        {
            name: "executor route validation fails forbidden failure policy field",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "malformed_input",
            setup: (r) => mutateExecutorRoute(r, (routes) => {
                routes.validation.validate_executor_routes.failure_policy =
                    { behavior: "block" };
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["FORBIDDEN_FAILURE_POLICY"],
        },
        {
            name: "executor route validation fails unknown lifecycle hook",
            routeId: "validate_executor_routes",
            script: "scripts/validate-executor-routes.ts",
            category: "malformed_input",
            setup: (r) => mutateExecutorRoute(r, (routes) => {
                routes.validation.validate_executor_routes.lifecycle_hooks =
                    ["while_moon_is_full"];
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["UNKNOWN_LIFECYCLE_HOOK"],
        },
        // compile-authority-topology.ts / validate-authority-topology.ts
        {
            name: "authority topology compile valid input passes",
            routeId: "compile_authority_topology",
            script: "scripts/compile-authority-topology.ts",
            category: "valid_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/topologies/authority-topology.yaml",
                ".ai/reports/authority-conflict-report.yaml",
            ],
        },
        {
            name: "authority topology compile fails duplicate owner",
            routeId: "compile_authority_topology",
            script: "scripts/compile-authority-topology.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "core/conventions.duplicate-owner-fixture.yaml", validConvention("core/conventions.duplicate-owner-fixture.yaml", "central_executor_route_map")),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["DUPLICATE_CONCEPT_OWNER"],
        },
        {
            name: "authority topology compile fails unknown relationship key",
            routeId: "compile_authority_topology",
            script: "scripts/compile-authority-topology.ts",
            category: "malformed_input",
            setup: (r) => addFixtureConvention(r, "core/conventions.unknown-ownership-key-fixture.yaml", {
                version: "1.0",
                file: {
                    name: "conventions.unknown-ownership-key-fixture.yaml",
                    path: "core/conventions.unknown-ownership-key-fixture.yaml",
                    role: "test_fixture",
                    executability: "policy",
                },
                ownership: {
                    owns: ["unknown_ownership_key_fixture"],
                    stewards: ["other_concept"],
                },
                sections: {},
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["UNKNOWN_OWNERSHIP_RELATIONSHIP"],
        },
        {
            name: "authority topology compile fails malformed relationship list",
            routeId: "compile_authority_topology",
            script: "scripts/compile-authority-topology.ts",
            category: "malformed_input",
            setup: (r) => addFixtureConvention(r, "core/conventions.malformed-ownership-fixture.yaml", {
                version: "1.0",
                file: {
                    name: "conventions.malformed-ownership-fixture.yaml",
                    path: "core/conventions.malformed-ownership-fixture.yaml",
                    role: "test_fixture",
                    executability: "policy",
                },
                ownership: { owns: "not-a-list" },
                sections: {},
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["MALFORMED_OWNERSHIP_RELATIONSHIP"],
        },
        {
            name: "authority topology validation fails missing topology",
            routeId: "validate_authority_topology",
            script: "scripts/validate-authority-topology.ts",
            category: "missing_input",
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["AUTHORITY_TOPOLOGY_MISSING"],
        },
        {
            name: "authority topology validation passes after compile",
            routeId: "validate_authority_topology",
            script: "scripts/validate-authority-topology.ts",
            category: "valid_input",
            preRun: (r) => {
                runScript(r, "scripts/compile-authority-topology.ts");
            },
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "authority topology validation fails duplicate owner in topology",
            routeId: "validate_authority_topology",
            script: "scripts/validate-authority-topology.ts",
            category: "invalid_state",
            preRun: (r) => {
                runScript(r, "scripts/compile-authority-topology.ts");
                mutateYaml(path.join(r, ".ai", "topologies", "authority-topology.yaml"), (doc) => {
                    doc.concepts.__fixture_duplicate = {
                        owners: ["a.yaml", "b.yaml"],
                    };
                });
            },
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["DUPLICATE_CONCEPT_OWNER"],
        },
        // validate-references.ts
        {
            name: "reference validation valid input passes",
            routeId: "validate_references",
            script: "scripts/validate-references.ts",
            category: "valid_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/topologies/reference-topology.yaml",
                ".ai/validation/validate-references.result.yaml",
            ],
        },
        {
            name: "reference validation fails missing required dependency",
            routeId: "validate_references",
            script: "scripts/validate-references.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "core/conventions.missing-dependency-fixture.yaml", validConvention("core/conventions.missing-dependency-fixture.yaml", "missing_dependency_fixture", {
                dependencies: {
                    required_files: ["core/does-not-exist.yaml"],
                    optional_files: [],
                },
            })),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["MISSING_REQUIRED_DEPENDENCY"],
        },
        {
            name: "reference validation fails stale removed reference",
            routeId: "validate_references",
            script: "scripts/validate-references.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "core/conventions.stale-reference-fixture.yaml", validConvention("core/conventions.stale-reference-fixture.yaml", "stale_reference_fixture", {
                purpose: "mentions core/conventions.authority-registry.yaml as stale text",
            })),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["STALE_REMOVED_REFERENCE"],
        },
        {
            name: "reference validation fails unknown executor route reference",
            routeId: "validate_references",
            script: "scripts/validate-references.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "phases/conventions.unknown-route-reference-fixture.yaml", validConvention("phases/conventions.unknown-route-reference-fixture.yaml", "unknown_route_reference_fixture", {
                sections: {
                    required_executor_routes: {
                        before_phase_start: [
                            "unknown_route_from_reference_test",
                        ],
                    },
                },
            })),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["UNKNOWN_EXECUTOR_ROUTE_REFERENCE"],
        },
        // validate-changed-files.ts
        {
            name: "changed files validation passes valid file",
            routeId: "validate_changed_files",
            script: "scripts/validate-changed-files.ts",
            category: "valid_input",
            args: ["--changed", "core/conventions.core.yaml"],
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "changed files validation passes empty input as advisory",
            routeId: "validate_changed_files",
            script: "scripts/validate-changed-files.ts",
            category: "missing_input",
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "changed files validation fails missing file",
            routeId: "validate_changed_files",
            script: "scripts/validate-changed-files.ts",
            category: "invalid_state",
            args: ["--changed", "core/missing-file.yaml"],
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["CHANGED_FILE_MISSING"],
        },
        {
            name: "changed files validation fails malformed changed yaml",
            routeId: "validate_changed_files",
            script: "scripts/validate-changed-files.ts",
            category: "malformed_input",
            setup: (r) => fs.writeFileSync(path.join(r, "core", "conventions.malformed-yaml-fixture.yaml"), "version: [unterminated", "utf8"),
            args: ["--changed", "core/conventions.malformed-yaml-fixture.yaml"],
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["CHANGED_YAML_PARSE_ERROR"],
        },
        // runtime artifact compiler / validator
        {
            name: "runtime artifact topology compile valid input passes",
            routeId: "compile_runtime_artifact_topology",
            script: "scripts/compile-runtime-artifact-topology.ts",
            category: "valid_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/topologies/runtime-artifact-topology.yaml",
                ".ai/reports/artifact-conflict-report.yaml",
            ],
        },
        {
            name: "runtime artifact topology compile fails same path different id",
            routeId: "compile_runtime_artifact_topology",
            script: "scripts/compile-runtime-artifact-topology.ts",
            category: "invalid_state",
            setup: (r) => mutateYaml(path.join(r, "reports", "conventions.runtime-artifacts.yaml"), (doc) => {
                doc.sections.runtime_artifact_registry.push({
                    artifact_id: "duplicate_path_fixture",
                    path: ".ai/reports/00-mission-profile.yaml",
                    artifact_type: "report",
                    schema: "fixture",
                    producer: "fixture",
                    consumers: ["fixture"],
                    scope: "phase_runtime",
                    lifecycle: "generated_report_output",
                    write_mode: "single_writer",
                    required: true,
                });
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["RUNTIME_ARTIFACT_SAME_PATH_DIFFERENT_ID"],
        },
        {
            name: "runtime artifact validation fails without topology",
            routeId: "validate_runtime_artifacts",
            script: "scripts/validate-runtime-artifacts.ts",
            category: "missing_input",
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["RUNTIME_ARTIFACT_TOPOLOGY_MISSING"],
        },
        {
            name: "runtime artifact validation passes after compile",
            routeId: "validate_runtime_artifacts",
            script: "scripts/validate-runtime-artifacts.ts",
            category: "valid_input",
            preRun: (r) => {
                runScript(r, "scripts/compile-runtime-artifact-topology.ts");
            },
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "runtime artifact validation fails invalid topology path",
            routeId: "validate_runtime_artifacts",
            script: "scripts/validate-runtime-artifacts.ts",
            category: "invalid_state",
            preRun: (r) => {
                runScript(r, "scripts/compile-runtime-artifact-topology.ts");
                mutateYaml(path.join(r, ".ai", "topologies", "runtime-artifact-topology.yaml"), (doc) => {
                    doc.artifacts.invalid_path_fixture = {
                        path: "reports/not-ai.yaml",
                        artifact_type: "report",
                        schema: "fixture",
                        producer: "fixture",
                        producer_routes: ["collect_phase_report"],
                        consumers: [],
                        scope: "phase_runtime",
                        lifecycle: "generated_report_output",
                        write_mode: "single_writer",
                        required: true,
                    };
                });
            },
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["INVALID_RUNTIME_ARTIFACT_PATH"],
        },
        {
            name: "runtime artifact validation fails unnormalized topology path",
            routeId: "validate_runtime_artifacts",
            script: "scripts/validate-runtime-artifacts.ts",
            category: "malformed_input",
            preRun: (r) => {
                runScript(r, "scripts/compile-runtime-artifact-topology.ts");
                mutateYaml(path.join(r, ".ai", "topologies", "runtime-artifact-topology.yaml"), (doc) => {
                    doc.artifacts.unnormalized_path_fixture = {
                        path: ".ai/reports/drift.yaml;",
                        artifact_type: "report",
                        schema: "fixture",
                        producer: "fixture",
                        producer_routes: ["collect_phase_report"],
                        consumers: [],
                        scope: "phase_runtime",
                        lifecycle: "generated_report_output",
                        write_mode: "single_writer",
                        required: true,
                    };
                });
            },
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["UNNORMALIZED_ARTIFACT_PATH"],
        },
        // phase bundle generator / validator
        {
            name: "phase bundle generation passes known phase",
            routeId: "generate_phase_bundle",
            script: "scripts/generate-phase-bundle.ts",
            category: "valid_input",
            args: [
                "--mission-id",
                "verify",
                "--phase-id",
                "mission_profile_selection",
            ],
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/bundles/phases/verify/mission_profile_selection.bundle.yaml",
                ".ai/bundles/phases/verify/mission_profile_selection.manifest.yaml",
            ],
        },
        {
            name: "phase bundle generation fails unknown phase",
            routeId: "generate_phase_bundle",
            script: "scripts/generate-phase-bundle.ts",
            category: "invalid_state",
            args: [
                "--mission-id",
                "verify",
                "--phase-id",
                "unknown_phase_for_test",
            ],
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: [
                "PHASE_CONTRACT_MISSING",
                "PHASE_OWNERSHIP_MISSING",
            ],
        },
        {
            name: "phase bundle validation passes after generation",
            routeId: "validate_phase_bundle",
            script: "scripts/validate-phase-bundle.ts",
            category: "valid_input",
            args: [
                "--mission-id",
                "verify",
                "--phase-id",
                "mission_profile_selection",
            ],
            preRun: (r) => {
                runScript(r, "scripts/generate-phase-bundle.ts", [
                    "--mission-id",
                    "verify",
                    "--phase-id",
                    "mission_profile_selection",
                ]);
            },
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "phase bundle validation fails missing bundle",
            routeId: "validate_phase_bundle",
            script: "scripts/validate-phase-bundle.ts",
            category: "missing_input",
            args: [
                "--mission-id",
                "verify",
                "--phase-id",
                "mission_profile_selection",
            ],
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["PHASE_BUNDLE_MISSING"],
        },
        {
            name: "phase bundle validation fails unknown route",
            routeId: "validate_phase_bundle",
            script: "scripts/validate-phase-bundle.ts",
            category: "invalid_state",
            args: [
                "--mission-id",
                "verify",
                "--phase-id",
                "mission_profile_selection",
            ],
            preRun: (r) => writePhaseBundleFixture(r, (bundle) => {
                bundle.required_executor_routes.push("unknown_route_inside_bundle");
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: [
                "PHASE_BUNDLE_UNKNOWN_ROUTE",
                "PHASE_BUNDLE_MISSING_ROUTE_CONTRACT",
            ],
        },
        {
            name: "phase bundle validation fails full context dump",
            routeId: "validate_phase_bundle",
            script: "scripts/validate-phase-bundle.ts",
            category: "invalid_state",
            args: [
                "--mission-id",
                "verify",
                "--phase-id",
                "mission_profile_selection",
            ],
            preRun: (r) => writePhaseBundleFixture(r, (bundle) => {
                bundle.all_conventions = { forbidden: true };
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["PHASE_BUNDLE_CONTAINS_FULL_CONTEXT_DUMP"],
        },
        {
            name: "phase bundle validation fails weak agent context boundary",
            routeId: "validate_phase_bundle",
            script: "scripts/validate-phase-bundle.ts",
            category: "invalid_state",
            args: [
                "--mission-id",
                "verify",
                "--phase-id",
                "mission_profile_selection",
            ],
            preRun: (r) => writePhaseBundleFixture(r, (bundle) => {
                bundle.agent_consumption_model.agent_reads_full_topologies = true;
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["PHASE_BUNDLE_AGENT_CONTEXT_BOUNDARY_WEAK"],
        },
        {
            name: "phase bundle validation fails missing manifest",
            routeId: "validate_phase_bundle",
            script: "scripts/validate-phase-bundle.ts",
            category: "invalid_state",
            args: [
                "--mission-id",
                "verify",
                "--phase-id",
                "mission_profile_selection",
            ],
            preRun: (r) => writePhaseBundleFixture(r, undefined, false),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["PHASE_BUNDLE_MANIFEST_MISSING"],
        },
        // semantic completeness validator
        {
            name: "semantic completeness validation passes current conventions",
            routeId: "validate_semantic_completeness",
            script: "scripts/validate-semantic-completeness.ts",
            category: "valid_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/validation/validate-semantic-completeness.result.yaml",
                ".ai/reports/semantic-completeness-report.yaml",
            ],
        },
        {
            name: "semantic completeness validation fails placeholder content",
            routeId: "validate_semantic_completeness",
            script: "scripts/validate-semantic-completeness.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "phases/conventions.semantic-placeholder-fixture.yaml", validConvention("phases/conventions.semantic-placeholder-fixture.yaml", "semantic_placeholder_fixture", { sections: { executable_rule: "TODO" } })),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["SEMANTIC_PLACEHOLDER_TEXT"],
        },
        {
            name: "semantic completeness validation fails policy loaded vague phrase",
            routeId: "validate_semantic_completeness",
            script: "scripts/validate-semantic-completeness.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "phases/conventions.semantic-vague-fixture.yaml", validConvention("phases/conventions.semantic-vague-fixture.yaml", "semantic_vague_fixture", {
                sections: {
                    executable_rule: "someone should run validation",
                },
            })),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["SEMANTIC_VAGUE_EXECUTABLE_PHRASE"],
        },
        {
            name: "semantic completeness validation fails dynamically added policy phrase",
            routeId: "validate_semantic_completeness",
            script: "scripts/validate-semantic-completeness.ts",
            category: "invalid_state",
            setup: (r) => {
                mutateYaml(path.join(r, "core", "conventions.semantic-completeness.yaml"), (doc) => {
                    doc.sections.vague_content_policy.vague_execution_phrases.push("magic vague action");
                });
                addFixtureConvention(r, "phases/conventions.semantic-dynamic-policy-fixture.yaml", validConvention("phases/conventions.semantic-dynamic-policy-fixture.yaml", "semantic_dynamic_policy_fixture", { sections: { executable_rule: "magic vague action" } }));
            },
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["SEMANTIC_VAGUE_EXECUTABLE_PHRASE"],
        },
        {
            name: "semantic completeness validation fails decision without rejection",
            routeId: "validate_semantic_completeness",
            script: "scripts/validate-semantic-completeness.ts",
            category: "invalid_state",
            setup: (r) => addFixtureConvention(r, "phases/conventions.semantic-decision-fixture.yaml", validConvention("phases/conventions.semantic-decision-fixture.yaml", "semantic_decision_fixture", {
                sections: {
                    routing_decision: {
                        choose_when: ["input_present"],
                        decision: "use_path_a",
                    },
                },
            })),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["SEMANTIC_DECISION_REJECT_LOGIC_MISSING"],
        },
        {
            name: "semantic completeness validation fails weak phase output claim",
            routeId: "validate_semantic_completeness",
            script: "scripts/validate-semantic-completeness.ts",
            category: "missing_input",
            args: ["--phase-output", ".ai/phase/weak-output.yaml"],
            setup: (r) => writeYamlFile(path.join(r, ".ai", "phase", "weak-output.yaml"), {
                artifact: "phase_output",
                completion_claim: { completed_requirements: [] },
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["SEMANTIC_COMPLETION_EVIDENCE_FIELD_MISSING"],
        },
        // script placeholders / runtime action scripts are still route-backed and contract-checked.
        {
            name: "phase output validation passes advisory missing output",
            routeId: "validate_phase_output",
            script: "scripts/validate-phase-output.ts",
            category: "missing_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/validation/validate-phase-output.result.yaml",
            ],
        },
        {
            name: "phase output validation passes existing output",
            routeId: "validate_phase_output",
            script: "scripts/validate-phase-output.ts",
            category: "valid_input",
            setup: (r) => writeYamlFile(path.join(r, ".ai", "phase", "phase-output.yaml"), { artifact: "phase_output" }),
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "mission bundle generation passes",
            routeId: "generate_mission_bundle",
            script: "scripts/generate-mission-bundle.ts",
            category: "valid_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [".ai/bundles/mission-context-bundle.yaml"],
        },
        {
            name: "gate check fails missing gate id",
            routeId: "run_gate_check",
            script: "scripts/run-gate-check.ts",
            category: "missing_input",
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["GATE_ID_MISSING"],
        },
        {
            name: "gate check writes pass result",
            routeId: "run_gate_check",
            script: "scripts/run-gate-check.ts",
            category: "valid_input",
            args: ["--gate-id", "verify_gate"],
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [".ai/gates/verify_gate.gate-result.yaml"],
        },
        {
            name: "gate result validation passes valid result",
            routeId: "validate_gate_result",
            script: "scripts/validate-gate-result.ts",
            category: "valid_input",
            args: ["--gate-id", "verify_gate"],
            preRun: (r) => {
                runScript(r, "scripts/run-gate-check.ts", [
                    "--gate-id",
                    "verify_gate",
                ]);
            },
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "gate result validation fails missing result",
            routeId: "validate_gate_result",
            script: "scripts/validate-gate-result.ts",
            category: "missing_input",
            args: ["--gate-id", "missing_gate"],
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["GATE_RESULT_MISSING"],
        },
        {
            name: "gate result validation rejects manual result",
            routeId: "validate_gate_result",
            script: "scripts/validate-gate-result.ts",
            category: "invalid_state",
            args: ["--gate-result", ".ai/gates/manual.gate-result.yaml"],
            setup: (r) => writeYamlFile(path.join(r, ".ai", "gates", "manual.gate-result.yaml"), {
                artifact: "gate_result",
                gate_id: "manual",
                status: "pass",
                decision: "allow_transition",
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["GATE_RESULT_NOT_SCRIPT_PRODUCED"],
        },
        {
            name: "handoff preparation fails missing input",
            routeId: "prepare_agent_handoff",
            script: "scripts/prepare-agent-handoff.ts",
            category: "missing_input",
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: [
                "HANDOFF_SOURCE_OUTPUT_MISSING",
                "HANDOFF_TARGET_AGENT_MISSING",
            ],
        },
        {
            name: "handoff preparation writes handoff packet",
            routeId: "prepare_agent_handoff",
            script: "scripts/prepare-agent-handoff.ts",
            category: "valid_input",
            args: [
                "--source-output",
                ".ai/phase/source-output.yaml",
                "--target-agent",
                "builder_agent",
                "--handoff-id",
                "verify_handoff",
            ],
            setup: (r) => writeYamlFile(path.join(r, ".ai", "phase", "source-output.yaml"), { artifact: "phase_output", status: "complete" }),
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [".ai/handoffs/verify_handoff.yaml"],
        },
        {
            name: "handoff validation passes valid packet",
            routeId: "validate_handoff",
            script: "scripts/validate-handoff.ts",
            category: "valid_input",
            args: ["--handoff", ".ai/handoffs/verify_handoff.yaml"],
            preRun: (r) => {
                writeYamlFile(path.join(r, ".ai", "phase", "source-output.yaml"), { artifact: "phase_output", status: "complete" });
                runScript(r, "scripts/prepare-agent-handoff.ts", [
                    "--source-output",
                    ".ai/phase/source-output.yaml",
                    "--target-agent",
                    "builder_agent",
                    "--handoff-id",
                    "verify_handoff",
                ]);
            },
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "handoff validation fails missing packet",
            routeId: "validate_handoff",
            script: "scripts/validate-handoff.ts",
            category: "missing_input",
            args: ["--handoff", ".ai/handoffs/missing.yaml"],
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["HANDOFF_PACKET_MISSING"],
        },
        {
            name: "handoff validation rejects manual packet",
            routeId: "validate_handoff",
            script: "scripts/validate-handoff.ts",
            category: "invalid_state",
            args: ["--handoff", ".ai/handoffs/manual.yaml"],
            setup: (r) => {
                writeYamlFile(path.join(r, ".ai", "phase", "source-output.yaml"), { artifact: "phase_output", status: "complete" });
                writeYamlFile(path.join(r, ".ai", "handoffs", "manual.yaml"), {
                    artifact: "agent_handoff_packet",
                    status: "prepared",
                    source_output: ".ai/phase/source-output.yaml",
                    target_agent: "builder_agent",
                    evidence_refs: [".ai/phase/source-output.yaml"],
                });
            },
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["HANDOFF_NOT_SCRIPT_PRODUCED"],
        },
        {
            name: "revision task creation fails missing failure",
            routeId: "create_revision_task",
            script: "scripts/create-revision-task.ts",
            category: "missing_input",
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["REVISION_FAILURE_INPUT_MISSING"],
        },
        {
            name: "revision task creation writes revision task",
            routeId: "create_revision_task",
            script: "scripts/create-revision-task.ts",
            category: "valid_input",
            args: [
                "--failure",
                "verify_failure",
                "--revision-id",
                "verify_revision",
            ],
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [".ai/revisions/verify_revision.yaml"],
        },
        {
            name: "revision task validation passes valid task",
            routeId: "validate_revision_task",
            script: "scripts/validate-revision-task.ts",
            category: "valid_input",
            args: ["--revision-task", ".ai/revisions/verify_revision.yaml"],
            preRun: (r) => {
                runScript(r, "scripts/create-revision-task.ts", [
                    "--failure",
                    "verify_failure",
                    "--revision-id",
                    "verify_revision",
                ]);
            },
            expectedExit: 0,
            expectedStatus: "pass",
        },
        {
            name: "revision task validation fails missing task",
            routeId: "validate_revision_task",
            script: "scripts/validate-revision-task.ts",
            category: "missing_input",
            args: ["--revision-task", ".ai/revisions/missing.yaml"],
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["REVISION_TASK_MISSING"],
        },
        {
            name: "revision task validation rejects manual task",
            routeId: "validate_revision_task",
            script: "scripts/validate-revision-task.ts",
            category: "invalid_state",
            args: ["--revision-task", ".ai/revisions/manual.yaml"],
            setup: (r) => writeYamlFile(path.join(r, ".ai", "revisions", "manual.yaml"), {
                artifact: "revision_task",
                revision_id: "manual",
                status: "created",
                failure: "manual_failure",
                required_action: "resolve_blocking_failure_and_revalidate",
                validation_required_routes: [
                    "validate_revision_task",
                    "validate_changed_files",
                ],
            }),
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["REVISION_TASK_NOT_SCRIPT_PRODUCED"],
        },
        {
            name: "phase report collection writes report",
            routeId: "collect_phase_report",
            script: "scripts/collect-phase-report.ts",
            category: "valid_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [".ai/reports/phase-report.yaml"],
        },
        {
            name: "evidence collection writes evidence index",
            routeId: "collect_evidence",
            script: "scripts/collect-evidence.ts",
            category: "valid_input",
            preRun: (r) => {
                runScript(r, "scripts/validate-executor-routes.ts");
                runScript(r, "scripts/run-gate-check.ts", [
                    "--gate-id",
                    "evidence_gate",
                ]);
                runScript(r, "scripts/prepare-agent-handoff.ts", [
                    "--source-output",
                    ".ai/phase/source-output.yaml",
                    "--target-agent",
                    "builder_agent",
                    "--handoff-id",
                    "evidence_handoff",
                ]);
            },
            setup: (r) => writeYamlFile(path.join(r, ".ai", "phase", "source-output.yaml"), { artifact: "phase_output", status: "complete" }),
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/reports/evidence-index.yaml",
                ".ai/reports/evidence-collection-report.yaml",
            ],
        },
        {
            name: "report evidence validation fails missing evidence index",
            routeId: "validate_report_evidence",
            script: "scripts/validate-report-evidence.ts",
            category: "missing_input",
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["EVIDENCE_INDEX_MISSING"],
        },
        {
            name: "report evidence validation passes collected evidence",
            routeId: "validate_report_evidence",
            script: "scripts/validate-report-evidence.ts",
            category: "valid_input",
            preRun: (r) => {
                runScript(r, "scripts/validate-executor-routes.ts");
                runScript(r, "scripts/collect-evidence.ts");
            },
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [".ai/reports/report-evidence-validation.yaml"],
        },
        {
            name: "final mission report generation fails missing evidence",
            routeId: "generate_final_mission_report",
            script: "scripts/generate-final-mission-report.ts",
            category: "missing_input",
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["EVIDENCE_INDEX_MISSING"],
        },
        {
            name: "final mission report generation writes evidence backed report",
            routeId: "generate_final_mission_report",
            script: "scripts/generate-final-mission-report.ts",
            category: "valid_input",
            preRun: (r) => {
                runScript(r, "scripts/validate-executor-routes.ts");
                runScript(r, "scripts/collect-evidence.ts");
            },
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/reports/final-mission-report.yaml",
                ".ai/reports/mission-evidence-summary.yaml",
            ],
        },
        {
            name: "claude execution plan generation writes plan",
            routeId: "generate_claude_execution_plan",
            script: "scripts/generate-claude-execution-plan.ts",
            category: "valid_input",
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [".ai/claude/execution-plan.yaml"],
        },
        {
            name: "claude execution plan validation fails missing plan",
            routeId: "validate_claude_execution_plan",
            script: "scripts/validate-claude-execution-plan.ts",
            category: "missing_input",
            expectedExit: 1,
            expectedStatus: "fail",
            expectedErrorCodes: ["CLAUDE_EXECUTION_PLAN_MISSING"],
        },
        {
            name: "claude execution plan validation passes generated plan",
            routeId: "validate_claude_execution_plan",
            script: "scripts/validate-claude-execution-plan.ts",
            category: "valid_input",
            preRun: (r) => {
                runScript(r, "scripts/generate-claude-execution-plan.ts");
            },
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/reports/claude-execution-plan-validation.yaml",
            ],
        },
        {
            name: "claude native integration validation passes project files",
            routeId: "validate_claude_native_integration",
            script: "scripts/validate-claude-native-integration.ts",
            category: "valid_input",
            setup: (r) => {
                const projectRoot = path.resolve(r, "..");
                const agentTaxonomy = readYamlFile(path.join(r, "agents", "conventions.agent-taxonomy.yaml"));
                const agentIds = Object.keys((agentTaxonomy.sections?.agent_definitions ??
                    {}));
                const slug = (value) => value.replaceAll("_", "-");
                const skills = [
                    "start-mission",
                    "run-alpha-cycle",
                    "activate-agent",
                    "run-phase",
                    "validate-phase",
                    "run-gate",
                    "prepare-handoff",
                    "transition-phase",
                    "revision-loop",
                    "generate-artifact",
                    "collect-report-evidence",
                    "complete-mission",
                ];
                const commands = [
                    "start-mission",
                    "run-alpha-cycle",
                    "activate-agent",
                    "run-phase",
                    "validate-phase",
                    "transition-phase",
                    "revision-loop",
                    "complete-mission",
                ];
                const coreRoutes = [
                    "generate_claude_execution_plan",
                    "validate_claude_execution_plan",
                    "generate_phase_bundle",
                    "validate_phase_bundle",
                    "validate_changed_files",
                    "validate_phase_output",
                    "validate_semantic_completeness",
                    "run_gate_check",
                    "validate_gate_result",
                    "prepare_agent_handoff",
                    "validate_handoff",
                    "create_revision_task",
                    "validate_revision_task",
                    "collect_evidence",
                    "validate_report_evidence",
                    "generate_final_mission_report",
                ];
                fs.writeFileSync(path.join(projectRoot, "CLAUDE.md"), coreRoutes
                    .map((route) => `npm --prefix conventions/scripts run executor -- --route ${route}`)
                    .join("\n"), "utf8");
                for (const skill of skills) {
                    fs.mkdirSync(path.join(projectRoot, ".claude", "skills", skill), { recursive: true });
                    fs.writeFileSync(path.join(projectRoot, ".claude", "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: test\n---\n${coreRoutes.join(" ")}\nnpm --prefix conventions/scripts run executor -- --route validate_executor_routes`, "utf8");
                }
                fs.mkdirSync(path.join(projectRoot, ".claude", "commands"), {
                    recursive: true,
                });
                for (const command of commands)
                    fs.writeFileSync(path.join(projectRoot, ".claude", "commands", `${command}.md`), `# /${command}\nnpm --prefix conventions/scripts run executor -- --route validate_executor_routes`, "utf8");
                fs.mkdirSync(path.join(projectRoot, ".claude", "agents"), {
                    recursive: true,
                });
                for (const agentId of agentIds)
                    fs.writeFileSync(path.join(projectRoot, ".claude", "agents", `${slug(agentId)}.md`), `---\nname: ${slug(agentId)}\ndescription: test\n---\nConvention agent id: ${agentId}\nnpm --prefix conventions/scripts run executor -- --route validate_executor_routes`, "utf8");
                fs.writeFileSync(path.join(projectRoot, ".claude", "settings.json"), JSON.stringify({
                    hooks: {
                        SessionStart: [
                            {
                                hooks: [
                                    {
                                        type: "command",
                                        command: "npm --prefix conventions/scripts run executor -- --route validate_executor_routes",
                                    },
                                ],
                            },
                        ],
                        PostToolUse: [
                            {
                                matcher: "Write|Edit",
                                hooks: [
                                    {
                                        type: "command",
                                        command: "npm --prefix conventions/scripts run executor -- --route validate_changed_files",
                                    },
                                ],
                            },
                        ],
                        Stop: [
                            {
                                hooks: [
                                    {
                                        type: "command",
                                        command: "npm --prefix conventions/scripts run executor -- --route collect_evidence",
                                    },
                                ],
                            },
                        ],
                        StopFailure: [
                            {
                                hooks: [
                                    {
                                        type: "command",
                                        command: "npm --prefix conventions/scripts run executor -- --route collect_evidence",
                                    },
                                ],
                            },
                        ],
                    },
                }), "utf8");
            },
            expectedExit: 0,
            expectedStatus: "pass",
            expectedOutputs: [
                ".ai/validation/validate-claude-native-integration.result.yaml",
            ],
        },
    ];
}
const routes = readExecutorRoutes(root);
const liveTestNames = new Set([
    "executor routes valid input passes",
    "reference validation valid input passes",
    "changed files validation passes valid file",
    "runtime artifact topology compile valid input passes",
    "phase bundle generation passes known phase",
    "semantic completeness validation passes current conventions",
    "gate check writes pass result",
    "handoff preparation writes handoff packet",
    "revision task creation writes revision task",
    "evidence collection writes evidence index",
    "claude execution plan generation writes plan",
    "claude native integration validation passes project files",
]);
const declaredTests = process.env.TEST_FILTER
    ? testCases().filter((test) => test.name.includes(process.env.TEST_FILTER))
    : testCases();
const tests = declaredTests.filter((test) => liveTestNames.has(test.name));
const testResults = [];
for (const test of tests) {
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
            category: test.category,
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
    }
    finally {
        // Fixture directories are intentionally left in the OS temp directory when verification runs.
        // This avoids platform-specific recursive delete hangs and preserves failing fixtures for inspection.
    }
}
const testedRoutes = new Set(declaredTests.map((test) => test.routeId));
const liveTestedRoutes = new Set(tests.map((test) => test.routeId));
const untestedRoutes = [...routes.keys()]
    .filter((routeId) => routeId !== "validate_script_execution" &&
    !testedRoutes.has(routeId))
    .sort();
for (const routeId of untestedRoutes) {
    issues.push(issue("error", "SCRIPT_ROUTE_UNTESTED", `Executor route has no script verification test: ${routeId}`));
}
const routeCoverage = {};
for (const [routeId, route] of routes.entries()) {
    const routeTests = declaredTests.filter((test) => test.routeId === routeId);
    const liveRouteTests = tests.filter((test) => test.routeId === routeId);
    routeCoverage[routeId] = {
        script: route.script,
        executor_type: route.executor_type,
        declared_test_count: routeTests.length,
        live_test_count: liveRouteTests.length,
        declared_categories: [
            ...new Set(routeTests.map((test) => test.category)),
        ].sort(),
        live_categories: [
            ...new Set(liveRouteTests.map((test) => test.category)),
        ].sort(),
    };
}
const scriptCoverage = {};
for (const test of declaredTests) {
    scriptCoverage[test.script] ??= {
        test_count: 0,
        routes: new Set(),
        categories: new Set(),
    };
    scriptCoverage[test.script].test_count += 1;
    scriptCoverage[test.script].routes.add(test.routeId);
    scriptCoverage[test.script].categories.add(test.category);
}
const normalizedScriptCoverage = {};
for (const [script, coverage] of Object.entries(scriptCoverage)) {
    normalizedScriptCoverage[script] = {
        test_count: coverage.test_count,
        routes: [...coverage.routes].sort(),
        categories: [...coverage.categories].sort(),
    };
}
writeYamlFile(reportPath, {
    artifact: "script_verification_report",
    generated_by: SCRIPT_ID,
    coverage_model: "per_route_script_behavior_matrix",
    required_route_coverage: "every executor route except validate_script_execution must have declared coverage; selected representative cases are run live",
    declared_test_count: declaredTests.length,
    live_test_count: testResults.length,
    deferred_live_cases: declaredTests
        .filter((test) => !liveTestNames.has(test.name))
        .map((test) => test.name)
        .sort(),
    failed_test_count: issues.filter((entry) => entry.severity === "error" || entry.severity === "critical").length,
    route_coverage: routeCoverage,
    script_coverage: normalizedScriptCoverage,
    tests: testResults,
});
const finalErrors = issues.filter((entry) => entry.severity === "error" || entry.severity === "critical");
const finalWarnings = issues.filter((entry) => entry.severity === "warning");
const finalInfo = issues.filter((entry) => entry.severity === "info");
const finalResult = {
    script_id: SCRIPT_ID,
    status: finalErrors.length ? "fail" : "pass",
    errors: finalErrors,
    warnings: finalWarnings,
    info: finalInfo,
    outputs: [
        ".ai/reports/script-verification-report.yaml",
        ".ai/validation/verify-scripts.result.yaml",
    ],
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
if (process.env.SCRIPT_RESULT_STDOUT !== "suppress")
    console.log(JSON.stringify(finalResult, null, 2));
process.exit(finalErrors.length ? 1 : 0);
