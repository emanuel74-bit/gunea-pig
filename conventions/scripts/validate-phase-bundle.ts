import fs from "node:fs";
import path from "node:path";
import { finish, issue, readYamlFile, resolveConventionsRoot, type Issue } from "./lib/common.js";

const SCRIPT_ID = "validate-phase-bundle";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const bundlePath = path.join(root, ".ai", "bundles", "phase-context-bundle.yaml");
if (!fs.existsSync(bundlePath)) {
  issues.push(issue("critical", "PHASE_BUNDLE_MISSING", "Phase bundle is missing; run generate_phase_bundle first"));
} else {
  const bundle = readYamlFile(bundlePath);
  if (!Array.isArray(bundle.required_executor_routes)) issues.push(issue("error", "PHASE_BUNDLE_MISSING_ROUTES", "Phase bundle must include required_executor_routes"));
  if (JSON.stringify(bundle).includes("full_convention_package")) issues.push(issue("error", "PHASE_BUNDLE_OVERLOAD", "Phase bundle must not include full convention package"));
}
finish(SCRIPT_ID, issues, [".ai/validation/validate-phase-bundle.result.yaml"], { bundle_present: fs.existsSync(bundlePath) });
