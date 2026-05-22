import path from "node:path";
import { finish, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "collect-phase-report";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const report = { artifact: "phase_report", generated_by: SCRIPT_ID, status: "collected", evidence_sources: [".ai/validation/**", ".ai/gates/**"] };
writeYamlFile(path.join(root, ".ai", "reports", "phase-report.yaml"), report);
finish(SCRIPT_ID, issues, [".ai/reports/phase-report.yaml"], { status: "collected" });
