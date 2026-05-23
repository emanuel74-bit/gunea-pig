import fs from "node:fs";
import path from "node:path";
import {
  asArray,
  conventionYamlFiles,
  ensureDir,
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

const SCRIPT_ID = "validate-semantic-completeness";
const root = resolveConventionsRoot();
const issues: Issue[] = [];

const forbiddenExact = new Set(["TODO", "TBD", "placeholder"]);
const vaguePhrases = ["as appropriate", "where relevant", "use best practices", "handle logic", "manage things", "defined elsewhere"];

function walk(node: any, visitor: (value: any, pathParts: string[]) => void, pathParts: string[] = []): void {
  visitor(node, pathParts);
  if (Array.isArray(node)) node.forEach((item, index) => walk(item, visitor, [...pathParts, String(index)]));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) walk(value, visitor, [...pathParts, key]);
  }
}

function pathIsPolicyDefinition(file: string, pathParts: string[]): boolean {
  return file === "core/conventions.semantic-completeness.yaml" && pathParts.includes("vague_content_policy");
}

function checkForbiddenText(file: string, doc: JsonMap): void {
  walk(doc, (value, pathParts) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (pathIsPolicyDefinition(file, pathParts)) return;
    if (forbiddenExact.has(trimmed)) {
      issues.push(issue("error", "SEMANTIC_PLACEHOLDER_TEXT", `Placeholder text is forbidden in executable convention content: ${trimmed}`, file, { path: pathParts.join(".") }));
      return;
    }
    const lowered = trimmed.toLowerCase();
    for (const phrase of vaguePhrases) {
      if (lowered === phrase || lowered.includes(` ${phrase} `)) {
        const hasStructuredContext = pathParts.some(part => ["recommended", "warning", "message", "definition", "purpose"].includes(part));
        if (!hasStructuredContext) {
          issues.push(issue("warning", "SEMANTIC_VAGUE_PHRASE", `Potentially vague executable phrase detected: ${phrase}`, file, { path: pathParts.join(".") }));
        }
      }
    }
  });
}

function checkValidationShape(file: string, doc: JsonMap): void {
  const failConditions = doc?.validation?.fail_conditions;
  if (Array.isArray(failConditions)) {
    for (const [index, item] of failConditions.entries()) {
      if (!item || typeof item !== "object") continue;
      for (const field of ["condition", "message", "severity"]) {
        if (!(field in item)) issues.push(issue("error", "SEMANTIC_FAIL_CONDITION_INCOMPLETE", `Validation fail condition is missing ${field}`, file, { index, item }));
      }
    }
  }

  const requiredChecks = doc?.validation?.required_checks;
  if (Array.isArray(requiredChecks)) {
    for (const [index, item] of requiredChecks.entries()) {
      if (!item || typeof item !== "object") continue;
      for (const field of ["id", "check"]) {
        if (!(field in item)) issues.push(issue("error", "SEMANTIC_REQUIRED_CHECK_INCOMPLETE", `Validation required check is missing ${field}`, file, { index, item }));
      }
    }
  }
}

function checkExecutorRoutePresent(): void {
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

function checkPhaseBundle(): void {
  const bundleArg = getArg("phase-bundle");
  if (!bundleArg) return;
  const bundlePath = path.resolve(bundleArg);
  if (!fs.existsSync(bundlePath)) {
    issues.push(issue("error", "SEMANTIC_PHASE_BUNDLE_MISSING", "Phase bundle passed to semantic validation does not exist", undefined, { path: bundleArg }));
    return;
  }
  const bundle = readYamlFile(bundlePath);
  for (const field of ["completion_contract", "required_outputs", "required_executor_routes"]) {
    if (!(field in bundle)) issues.push(issue("error", "SEMANTIC_PHASE_BUNDLE_FIELD_MISSING", `Phase bundle missing semantic field ${field}`, path.relative(root, bundlePath).replace(/\\/g, "/")));
  }
  const routes = asArray(bundle.required_executor_routes);
  if (!routes.includes("validate_semantic_completeness")) {
    issues.push(issue("error", "SEMANTIC_PHASE_BUNDLE_ROUTE_MISSING", "Phase bundle must include validate_semantic_completeness in required_executor_routes", path.relative(root, bundlePath).replace(/\\/g, "/")));
  }
}

function checkPhaseOutput(): void {
  const outputArg = getArg("phase-output");
  if (!outputArg) return;
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
    if (!(field in claim)) issues.push(issue("error", "SEMANTIC_COMPLETION_EVIDENCE_FIELD_MISSING", `Completion claim missing ${field}`, path.relative(root, outputPath).replace(/\\/g, "/")));
  }
}

checkExecutorRoutePresent();
for (const filePath of conventionYamlFiles(root)) {
  const file = rel(root, filePath);
  if (file.startsWith(".ai/")) continue;
  const doc = readYamlFile(filePath);
  checkForbiddenText(file, doc);
  checkValidationShape(file, doc);
}
checkPhaseBundle();
checkPhaseOutput();

const reportPath = path.join(root, ".ai", "reports", "semantic-completeness-report.yaml");
ensureDir(path.dirname(reportPath));
writeYamlFile(reportPath, {
  artifact: "semantic_completeness_report",
  generated_by: SCRIPT_ID,
  checked_convention_files: conventionYamlFiles(root).filter(file => !rel(root, file).startsWith(".ai/")).length,
  route_backed: true,
  phase_bundle_checked: Boolean(getArg("phase-bundle")),
  phase_output_checked: Boolean(getArg("phase-output")),
  error_count: issues.filter(entry => entry.severity === "error" || entry.severity === "critical").length,
  warning_count: issues.filter(entry => entry.severity === "warning").length,
});

finish(SCRIPT_ID, issues, [".ai/reports/semantic-completeness-report.yaml", ".ai/validation/validate-semantic-completeness.result.yaml"], {
  checked_convention_files: conventionYamlFiles(root).length,
  phase_bundle_checked: Boolean(getArg("phase-bundle")),
  phase_output_checked: Boolean(getArg("phase-output")),
});
