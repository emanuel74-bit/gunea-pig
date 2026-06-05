import fs from "node:fs";
import path from "node:path";
import { finish, getArg, issue, resolveConventionsRoot } from "./lib/common.js";
const SCRIPT_ID = "validate-phase-output";
const root = resolveConventionsRoot();
const phaseOutput = getArg("phase-output") ?? path.join(root, ".ai", "phase", "phase-output.yaml");
const issues = [];
if (!fs.existsSync(phaseOutput)) {
    issues.push(issue("warning", "PHASE_OUTPUT_NOT_PROVIDED", "No phase output artifact was provided; validation is advisory until phase output exists"));
}
finish(SCRIPT_ID, issues, [".ai/validation/validate-phase-output.result.yaml"], { phase_output_present: fs.existsSync(phaseOutput) });
