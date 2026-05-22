import fs from "node:fs";
import path from "node:path";
import { finish, getArg, issue, readYamlFile, resolveConventionsRoot, type Issue } from "./lib/common.js";

const SCRIPT_ID = "validate-changed-files";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const changedArg = getArg("changed") ?? "";
const changedListPath = getArg("changed-file-list");
let changed = changedArg.split(",").map(v => v.trim()).filter(Boolean);
if (changedListPath && fs.existsSync(changedListPath)) {
  changed.push(...fs.readFileSync(changedListPath, "utf8").split(/\r?\n/).map(v => v.trim()).filter(Boolean));
}
changed = [...new Set(changed)];

if (changed.length === 0) {
  issues.push(issue("warning", "NO_CHANGED_FILES_PROVIDED", "No changed files were provided; result is informational only"));
}

for (const file of changed) {
  const abs = path.isAbsolute(file) ? file : path.join(root, file.replace(/^conventions\//, ""));
  if (!fs.existsSync(abs)) {
    issues.push(issue("error", "CHANGED_FILE_MISSING", `Changed file does not exist: ${file}`, file));
    continue;
  }
  if (file.endsWith(".yaml") || file.endsWith(".yml")) {
    try {
      readYamlFile(abs);
    } catch (error) {
      issues.push(issue("error", "CHANGED_YAML_PARSE_ERROR", `Changed YAML file failed to parse: ${file}`, file, String(error)));
    }
  }
}

const affectedSubsystems = [...new Set(changed.map(file => file.replace(/^conventions\//, "").split("/")[0]).filter(Boolean))];
finish(SCRIPT_ID, issues, [".ai/validation/validate-changed-files.result.yaml"], {
  changed_file_count: changed.length,
  affected_subsystems: affectedSubsystems,
  recommended_followup_routes: changed.length ? ["validate_executor_routes", "validate_references", "compile_authority_topology", "validate_authority_topology"] : [],
});
