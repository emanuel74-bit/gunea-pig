import path from "node:path";
import { finish, getArg, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "create-revision-task";
const root = resolveConventionsRoot();
const failure = getArg("failure") ?? "unspecified_failure";
const issues: Issue[] = [];
const task = { artifact: "revision_task", generated_by: SCRIPT_ID, failure, status: "created", required_action: "inspect failure and apply deterministic remediation" };
writeYamlFile(path.join(root, ".ai", "revisions", "revision-task.yaml"), task);
finish(SCRIPT_ID, issues, [".ai/revisions/revision-task.yaml"], { status: "created" });
