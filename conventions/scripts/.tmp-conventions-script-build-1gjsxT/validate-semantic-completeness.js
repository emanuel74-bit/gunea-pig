import fs from "node:fs";
import path from "node:path";
import { asArray, conventionYamlFiles, ensureDir, finish, getArg, issue, readYamlFile, rel, resolveConventionsRoot, writeYamlFile, } from "./lib/common.js";
const SCRIPT_ID = "validate-semantic-completeness";
const root = resolveConventionsRoot();
const issues = [];
function uniqueStrings(values) {
    return [...new Set(values.filter(value => typeof value === "string").map(value => value.trim()).filter(Boolean))];
}
function loadSemanticPolicy() {
    const fallbackForbidden = ["as appropriate", "when needed", "where relevant", "use best practices", "handle logic", "manage things", "defined elsewhere", "defined in step", "source: Step", "TBD", "TODO", "placeholder"];
    const policyPath = path.join(root, "core", "conventions.semantic-completeness.yaml");
    const doc = fs.existsSync(policyPath) ? readYamlFile(policyPath) : {};
    const policy = doc?.sections?.vague_content_policy ?? {};
    const forbidden = uniqueStrings([...(Array.isArray(policy.forbidden_in_executable_sections) ? policy.forbidden_in_executable_sections : []), ...fallbackForbidden]);
    const categoryValues = [
        ...(Array.isArray(policy.vague_delegation_phrases) ? policy.vague_delegation_phrases : []),
        ...(Array.isArray(policy.vague_completeness_phrases) ? policy.vague_completeness_phrases : []),
        ...(Array.isArray(policy.vague_authority_phrases) ? policy.vague_authority_phrases : []),
        ...(Array.isArray(policy.vague_execution_phrases) ? policy.vague_execution_phrases : []),
        ...(Array.isArray(policy.vague_output_phrases) ? policy.vague_output_phrases : []),
    ];
    const exactForbidden = forbidden.filter(value => /^[A-Z0-9_-]+$/.test(value) || ["placeholder"].includes(value.toLowerCase()));
    const forbiddenPhrases = uniqueStrings([...forbidden.filter(value => !exactForbidden.includes(value)), ...categoryValues]);
    const warningPhrases = uniqueStrings(Array.isArray(policy.warning_only_phrases) ? policy.warning_only_phrases : []);
    const executablePathSignals = uniqueStrings(Array.isArray(policy.executable_path_signals) ? policy.executable_path_signals : [
        "rules",
        "rule",
        "must",
        "must_not",
        "required",
        "forbidden",
        "validation",
        "fail_conditions",
        "required_checks",
        "required_executor_routes",
        "executor_routes",
        "lifecycle_hooks",
        "pipeline",
        "algorithm",
        "decision",
        "gate",
        "handoff",
        "revision",
        "outputs",
        "inputs",
        "dependencies",
        "enforcement",
        "contract",
        "completion_contract",
    ]);
    const contextAllowanceKeys = uniqueStrings(Array.isArray(policy.context_allowance_keys) ? policy.context_allowance_keys : [
        "recommended",
        "warning",
        "message",
        "definition",
        "purpose",
        "description",
        "examples",
        "non_examples",
        "positive_signals",
        "negative_signals",
        "risk_signals",
        "notes",
    ]);
    return { exactForbidden, forbiddenPhrases, warningPhrases, executablePathSignals, contextAllowanceKeys };
}
const semanticPolicy = loadSemanticPolicy();
function walk(node, visitor, pathParts = [], parent) {
    visitor(node, pathParts, parent);
    if (Array.isArray(node))
        node.forEach((item, index) => walk(item, visitor, [...pathParts, String(index)], node));
    else if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node))
            walk(value, visitor, [...pathParts, key], node);
    }
}
function pathIsPolicyDefinition(file, pathParts) {
    return file === "core/conventions.semantic-completeness.yaml" && pathParts.includes("vague_content_policy");
}
function pathHasSignal(pathParts, signals) {
    const lowered = pathParts.map(part => part.toLowerCase());
    return lowered.some(part => signals.some(signal => part === signal || part.includes(signal)));
}
function isAllowedContext(pathParts) {
    return pathHasSignal(pathParts, semanticPolicy.contextAllowanceKeys);
}
function isExecutablePath(pathParts) {
    return pathHasSignal(pathParts, semanticPolicy.executablePathSignals);
}
function hasStructuredConditionContext(parent) {
    if (!parent || typeof parent !== "object" || Array.isArray(parent))
        return false;
    const keys = Object.keys(parent).map(key => key.toLowerCase());
    return keys.some(key => ["applies_when", "pass_when", "fail_when", "choose_when", "reject_when", "condition", "fail_condition", "required_executor_routes", "evidence_refs", "validation_refs", "artifact", "path", "schema", "producer"].includes(key));
}
function containsPhrase(text, phrase) {
    const normalizedText = text.toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedPhrase = phrase.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalizedPhrase)
        return false;
    if (/^[a-z0-9_-]+$/i.test(normalizedPhrase)) {
        return new RegExp(`\\b${normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalizedText);
    }
    return normalizedText.includes(normalizedPhrase);
}
function checkForbiddenText(file, doc) {
    walk(doc, (value, pathParts, parent) => {
        if (typeof value !== "string")
            return;
        if (pathIsPolicyDefinition(file, pathParts))
            return;
        const trimmed = value.trim();
        const lowered = trimmed.toLowerCase();
        const path = pathParts.join(".");
        for (const token of semanticPolicy.exactForbidden) {
            if (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(trimmed)) {
                issues.push(issue("error", "SEMANTIC_PLACEHOLDER_TEXT", `Placeholder token is forbidden in executable convention content: ${token}`, file, { path, value: trimmed }));
                return;
            }
        }
        for (const phrase of semanticPolicy.forbiddenPhrases) {
            if (!containsPhrase(lowered, phrase))
                continue;
            const executable = isExecutablePath(pathParts);
            const routeBackedScriptReference = containsPhrase(lowered, phrase) && phrase.toLowerCase().includes("script") && lowered.includes("executor route");
            const allowed = routeBackedScriptReference || isAllowedContext(pathParts) || hasStructuredConditionContext(parent);
            if (executable && !allowed) {
                issues.push(issue("error", "SEMANTIC_VAGUE_EXECUTABLE_PHRASE", `Vague executable phrase must be replaced with explicit conditions/evidence: ${phrase}`, file, { path, value: trimmed }));
            }
            else if (!allowed) {
                issues.push(issue("warning", "SEMANTIC_VAGUE_PHRASE", `Potentially vague phrase detected outside executable enforcement path: ${phrase}`, file, { path, value: trimmed }));
            }
        }
        for (const phrase of semanticPolicy.warningPhrases) {
            if (containsPhrase(lowered, phrase) && !isAllowedContext(pathParts)) {
                issues.push(issue("warning", "SEMANTIC_WEAK_WORDING", `Weak wording should be made explicit when possible: ${phrase}`, file, { path, value: trimmed }));
            }
        }
    });
}
function checkValidationShape(file, doc) {
    const failConditions = doc?.validation?.fail_conditions;
    if (Array.isArray(failConditions)) {
        for (const [index, item] of failConditions.entries()) {
            if (!item || typeof item !== "object")
                continue;
            for (const field of ["condition", "message", "severity"]) {
                if (!(field in item))
                    issues.push(issue("error", "SEMANTIC_FAIL_CONDITION_INCOMPLETE", `Validation fail condition is missing ${field}`, file, { index, item }));
            }
        }
    }
    const requiredChecks = doc?.validation?.required_checks;
    if (Array.isArray(requiredChecks)) {
        for (const [index, item] of requiredChecks.entries()) {
            if (!item || typeof item !== "object")
                continue;
            for (const field of ["id", "check"]) {
                if (!(field in item))
                    issues.push(issue("error", "SEMANTIC_REQUIRED_CHECK_INCOMPLETE", `Validation required check is missing ${field}`, file, { index, item }));
            }
        }
    }
}
function checkDecisionCompleteness(file, doc) {
    walk(doc, (value, pathParts) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
            return;
        const keys = Object.keys(value);
        const hasPositiveDecision = keys.some(key => ["choose_when", "pass_when", "use_when"].includes(key));
        const hasNegativeDecision = keys.some(key => ["reject_when", "fail_when", "avoid_when", "must_not_use_when", "fail_condition", "violation"].includes(key));
        const decisionPath = pathHasSignal(pathParts, ["decision", "selector", "selection", "gate", "validator", "validation"]);
        if (decisionPath && hasPositiveDecision && !hasNegativeDecision) {
            issues.push(issue("error", "SEMANTIC_DECISION_REJECT_LOGIC_MISSING", "Decision/validation object has positive selection logic but no rejection/failure logic", file, { path: pathParts.join("."), keys }));
        }
    });
}
function checkExecutorRoutePresent() {
    const routesFile = readYamlFile(path.join(root, "executors", "conventions.executor-routes.yaml"));
    const validationRoutes = routesFile?.sections?.executor_routes?.validation ?? {};
    const route = validationRoutes.validate_semantic_completeness;
    if (!route) {
        issues.push(issue("critical", "SEMANTIC_ROUTE_MISSING", "validate_semantic_completeness executor route is required"));
        return;
    }
    if (route.script !== "scripts/validate-semantic-completeness.ts") {
        issues.push(issue("error", "SEMANTIC_ROUTE_SCRIPT_MISMATCH", "validate_semantic_completeness must resolve to scripts/validate-semantic-completeness.ts", "executors/conventions.executor-routes.yaml"));
    }
    if (route.failure_behavior !== "block") {
        issues.push(issue("error", "SEMANTIC_ROUTE_NOT_BLOCKING", "Semantic completeness validation must block on failure", "executors/conventions.executor-routes.yaml"));
    }
}
function checkPhaseBundle() {
    const bundleArg = getArg("phase-bundle");
    if (!bundleArg)
        return;
    const bundlePath = path.resolve(bundleArg);
    if (!fs.existsSync(bundlePath)) {
        issues.push(issue("error", "SEMANTIC_PHASE_BUNDLE_MISSING", "Phase bundle passed to semantic validation does not exist", undefined, { path: bundleArg }));
        return;
    }
    const bundle = readYamlFile(bundlePath);
    for (const field of ["completion_contract", "required_outputs", "required_executor_routes"]) {
        if (!(field in bundle))
            issues.push(issue("error", "SEMANTIC_PHASE_BUNDLE_FIELD_MISSING", `Phase bundle missing semantic field ${field}`, path.relative(root, bundlePath).replace(/\\/g, "/")));
    }
    const routes = asArray(bundle.required_executor_routes);
    if (!routes.includes("validate_semantic_completeness")) {
        issues.push(issue("error", "SEMANTIC_PHASE_BUNDLE_ROUTE_MISSING", "Phase bundle must include validate_semantic_completeness in required_executor_routes", path.relative(root, bundlePath).replace(/\\/g, "/")));
    }
}
function checkPhaseOutput() {
    const outputArg = getArg("phase-output");
    if (!outputArg)
        return;
    const outputPath = path.resolve(outputArg);
    if (!fs.existsSync(outputPath)) {
        issues.push(issue("error", "SEMANTIC_PHASE_OUTPUT_MISSING", "Phase output passed to semantic validation does not exist", undefined, { path: outputArg }));
        return;
    }
    const output = readYamlFile(outputPath);
    const claim = output.semantic_completion ?? output.completion_claim ?? output.completion;
    if (!claim || typeof claim !== "object") {
        issues.push(issue("error", "SEMANTIC_COMPLETION_CLAIM_MISSING", "Phase output must include semantic_completion/completion_claim evidence when checked", path.relative(root, outputPath).replace(/\\/g, "/")));
        return;
    }
    for (const field of ["completed_requirements", "evidence_refs", "validation_refs", "known_gaps"]) {
        if (!(field in claim))
            issues.push(issue("error", "SEMANTIC_COMPLETION_EVIDENCE_FIELD_MISSING", `Completion claim missing ${field}`, path.relative(root, outputPath).replace(/\\/g, "/")));
    }
}
checkExecutorRoutePresent();
for (const filePath of conventionYamlFiles(root)) {
    const file = rel(root, filePath);
    if (file.startsWith(".ai/"))
        continue;
    const doc = readYamlFile(filePath);
    checkForbiddenText(file, doc);
    checkValidationShape(file, doc);
    checkDecisionCompleteness(file, doc);
}
checkPhaseBundle();
checkPhaseOutput();
const reportPath = path.join(root, ".ai", "reports", "semantic-completeness-report.yaml");
ensureDir(path.dirname(reportPath));
writeYamlFile(reportPath, {
    artifact: "semantic_completeness_report",
    generated_by: SCRIPT_ID,
    checked_convention_files: conventionYamlFiles(root).filter(file => !rel(root, file).startsWith(".ai/")).length,
    policy_driven: true,
    forbidden_phrase_count: semanticPolicy.forbiddenPhrases.length,
    exact_forbidden_count: semanticPolicy.exactForbidden.length,
    warning_phrase_count: semanticPolicy.warningPhrases.length,
    route_backed: true,
    phase_bundle_checked: Boolean(getArg("phase-bundle")),
    phase_output_checked: Boolean(getArg("phase-output")),
    error_count: issues.filter(entry => entry.severity === "error" || entry.severity === "critical").length,
    warning_count: issues.filter(entry => entry.severity === "warning").length,
});
finish(SCRIPT_ID, issues, [".ai/reports/semantic-completeness-report.yaml", ".ai/validation/validate-semantic-completeness.result.yaml"], {
    checked_convention_files: conventionYamlFiles(root).length,
    policy_driven: true,
    forbidden_phrase_count: semanticPolicy.forbiddenPhrases.length,
    exact_forbidden_count: semanticPolicy.exactForbidden.length,
    warning_phrase_count: semanticPolicy.warningPhrases.length,
    phase_bundle_checked: Boolean(getArg("phase-bundle")),
    phase_output_checked: Boolean(getArg("phase-output")),
});
