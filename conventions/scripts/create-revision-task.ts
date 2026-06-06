import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { finish, getArg, issue, readYamlFile, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "create-revision-task";
const root = resolveConventionsRoot();
const failure = getArg("failure");
const failureResult = getArg("failure-result");
const revisionId = (getArg("revision-id") ?? "revision-task").replace(/[^a-zA-Z0-9_.-]+/g, "_");
const issues: Issue[] = [];
let failureSummary: any = {};

function stableStringify(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: any): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

if (!failure && !failureResult) {
  issues.push(issue("error", "REVISION_FAILURE_INPUT_MISSING", "Revision task creation requires --failure or --failure-result."));
}
if (failureResult) {
  if (!fs.existsSync(path.join(root, failureResult))) {
    issues.push(issue("error", "REVISION_FAILURE_RESULT_MISSING", "Failure result artifact does not exist.", failureResult));
  } else {
    try {
      const parsed = readYamlFile(path.join(root, failureResult));
      failureSummary = { status: parsed.status ?? null, script_id: parsed.script_id ?? null, errors: Array.isArray(parsed.errors) ? parsed.errors.map((e: any) => e.code).filter(Boolean) : [] };
    } catch (error) {
      issues.push(issue("error", "REVISION_FAILURE_RESULT_UNREADABLE", "Failure result could not be parsed.", failureResult, { error: String(error) }));
    }
  }
}

const status = issues.some(i => i.severity === "error" || i.severity === "critical") ? "invalid" : "created";
const outputRel = `.ai/revisions/${revisionId}.yaml`;
const task = {
  artifact: "revision_task",
  generated_by: SCRIPT_ID,
  revision_id: revisionId,
  status,
  failure: failure ?? null,
  failure_result: failureResult ?? null,
  failure_summary: failureSummary,
  failure_fingerprint: fingerprint({ failure: failure ?? null, failure_result: failureResult ?? null, failure_summary: failureSummary }),
  retry_control: { rollout_mode: "observe", enforcement: "disabled", analyzer_route: "analyze_revision_loop" },
  required_action: "resolve_blocking_failure_and_revalidate",
  validation_required_routes: ["validate_revision_task", "validate_changed_files"],
};
writeYamlFile(path.join(root, outputRel), task);
finish(SCRIPT_ID, issues, [outputRel], { status, revision_id: revisionId });
