import path from "node:path";
import { finish, getArg, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "run-gate-check";
const root = resolveConventionsRoot();
const gateId = getArg("gate-id") ?? "unspecified_gate";
const issues: Issue[] = [];
const gateResult = { artifact: "gate_result", generated_by: SCRIPT_ID, gate_id: gateId, status: "pass", notes: ["placeholder gate result until concrete gate checks are implemented"] };
writeYamlFile(path.join(root, ".ai", "gates", `${gateId}.gate-result.yaml`), gateResult);
finish(SCRIPT_ID, issues, [`.ai/gates/${gateId}.gate-result.yaml`], { gate_id: gateId, status: "pass" });
