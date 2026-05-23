import fs from "node:fs";
import path from "node:path";
import {
  asArray,
  getArg,
  issue,
  normalizeRelPath,
  readExecutorRoutes,
  readYamlFile,
  resolveConventionsRoot,
  type Issue,
  finish,
} from "./lib/common.js";

const SCRIPT_ID = "validate-phase-bundle";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const missionId = normalizeSegment(getArg("mission-id") ?? "mission");
const phaseId = getArg("phase-id") ?? "mission_profile_selection";
const bundleArg = getArg("bundle");
const bundleRelPath = bundleArg
  ? normalizeRelPath(bundleArg)
  : `.ai/bundles/phases/${missionId}/${phaseId}.bundle.yaml`;
const bundlePath = path.join(root, bundleRelPath);
const manifestRelPath = bundleRelPath.replace(/\.bundle\.ya?ml$/, ".manifest.yaml");
const manifestPath = path.join(root, manifestRelPath);

function normalizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]/g, "_") || "mission";
}

function hasForbiddenDumpKey(node: any): boolean {
  if (Array.isArray(node)) return node.some(hasForbiddenDumpKey);
  if (!node || typeof node !== "object") return false;
  for (const key of Object.keys(node)) {
    if (["all_conventions", "full_convention_package", "full_topology", "all_topologies"].includes(key)) return true;
    if (hasForbiddenDumpKey(node[key])) return true;
  }
  return false;
}

function requireArray(bundle: any, field: string): string[] {
  const value = bundle?.[field];
  if (!Array.isArray(value)) {
    issues.push(issue("error", "PHASE_BUNDLE_FIELD_NOT_ARRAY", `Phase bundle field ${field} must be an array`));
    return [];
  }
  return asArray(value);
}

const routes = readExecutorRoutes(root);
if (!fs.existsSync(bundlePath)) {
  issues.push(issue("critical", "PHASE_BUNDLE_MISSING", `Phase bundle is missing: ${bundleRelPath}; run generate_phase_bundle first`));
  finish(SCRIPT_ID, issues, [".ai/validation/validate-phase-bundle.result.yaml"], { bundle_present: false, bundle: bundleRelPath });
}

const bundle = readYamlFile(bundlePath);
const requiredScalarFields = ["artifact", "generated_by", "mission_id", "phase_id", "owner_agent", "scope"];
for (const field of requiredScalarFields) {
  if (typeof bundle[field] !== "string" || !bundle[field]) {
    issues.push(issue("error", "PHASE_BUNDLE_MISSING_FIELD", `Phase bundle missing required scalar field: ${field}`));
  }
}

if (bundle.artifact !== "phase_context_bundle") {
  issues.push(issue("error", "PHASE_BUNDLE_WRONG_ARTIFACT", "Phase bundle artifact must be phase_context_bundle"));
}

const requiredRoutes = requireArray(bundle, "required_executor_routes");
const allowedConventionRefs = requireArray(bundle, "allowed_convention_refs");
const requiredOutputs = requireArray(bundle, "required_outputs");
const allowedWriteScope = requireArray(bundle, "allowed_write_scope");
requireArray(bundle, "forbidden_write_scope");
requireArray(bundle, "must_do");
requireArray(bundle, "must_not_do");

for (const routeId of requiredRoutes) {
  if (!routes.has(routeId)) {
    issues.push(issue("critical", "PHASE_BUNDLE_UNKNOWN_ROUTE", `Phase bundle references unknown executor route: ${routeId}`));
  }
  if (!bundle.route_contracts || typeof bundle.route_contracts !== "object" || !bundle.route_contracts[routeId]) {
    issues.push(issue("error", "PHASE_BUNDLE_MISSING_ROUTE_CONTRACT", `Phase bundle missing route contract slice for: ${routeId}`));
  }
}

for (const requiredRoute of ["generate_phase_bundle", "validate_phase_bundle", "validate_phase_output"]) {
  if (!requiredRoutes.includes(requiredRoute)) {
    issues.push(issue("error", "PHASE_BUNDLE_MISSING_REQUIRED_ROUTE", `Phase bundle must include ${requiredRoute}`));
  }
}

if (!bundle.selected_records?.phase_contract) {
  issues.push(issue("critical", "PHASE_BUNDLE_MISSING_PHASE_CONTRACT", "Phase bundle must include selected phase contract record"));
}
if (!bundle.selected_records?.phase_ownership) {
  issues.push(issue("critical", "PHASE_BUNDLE_MISSING_PHASE_OWNERSHIP", "Phase bundle must include selected phase ownership record"));
}

if (requiredOutputs.length === 0) {
  issues.push(issue("error", "PHASE_BUNDLE_MISSING_REQUIRED_OUTPUTS", "Phase bundle must declare required outputs"));
}
if (allowedWriteScope.length === 0) {
  issues.push(issue("error", "PHASE_BUNDLE_MISSING_WRITE_SCOPE", "Phase bundle must declare allowed_write_scope"));
}

const outputNotAllowed = requiredOutputs.filter(output => !allowedWriteScope.includes(output) && !allowedWriteScope.some(scope => scope.endsWith("/**") && output.startsWith(scope.slice(0, -3))));
if (outputNotAllowed.length) {
  issues.push(issue("error", "PHASE_BUNDLE_OUTPUT_OUTSIDE_WRITE_SCOPE", "Required outputs must be inside allowed_write_scope", undefined, { outputNotAllowed }));
}

if (allowedConventionRefs.length > 40) {
  issues.push(issue("warning", "PHASE_BUNDLE_LARGE_CONVENTION_REF_SET", "Phase bundle references many convention files; check context minimization", undefined, { count: allowedConventionRefs.length }));
}

if (hasForbiddenDumpKey(bundle)) {
  issues.push(issue("critical", "PHASE_BUNDLE_CONTAINS_FULL_CONTEXT_DUMP", "Phase bundle must not contain full convention or topology dumps"));
}

const consumption = bundle.agent_consumption_model ?? {};
if (consumption.agent_reads_full_topologies !== false || consumption.agent_scans_full_convention_system !== false) {
  issues.push(issue("error", "PHASE_BUNDLE_AGENT_CONTEXT_BOUNDARY_WEAK", "Bundle must explicitly forbid agents from reading full topologies or scanning the full convention system"));
}

if (!fs.existsSync(manifestPath)) {
  issues.push(issue("error", "PHASE_BUNDLE_MANIFEST_MISSING", `Phase bundle manifest is missing: ${manifestRelPath}`));
}

finish(SCRIPT_ID, issues, [".ai/validation/validate-phase-bundle.result.yaml"], {
  bundle_present: true,
  bundle: bundleRelPath,
  required_route_count: requiredRoutes.length,
  allowed_convention_ref_count: allowedConventionRefs.length,
  required_output_count: requiredOutputs.length,
  manifest_present: fs.existsSync(manifestPath),
});
