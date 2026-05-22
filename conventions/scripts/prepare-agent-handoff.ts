import path from "node:path";
import { finish, resolveConventionsRoot, writeYamlFile, type Issue } from "./lib/common.js";

const SCRIPT_ID = "prepare-agent-handoff";
const root = resolveConventionsRoot();
const issues: Issue[] = [];
const handoff = { artifact: "agent_handoff_packet", generated_by: SCRIPT_ID, status: "prepared", required_evidence: [] };
writeYamlFile(path.join(root, ".ai", "handoffs", "agent-handoff-packet.yaml"), handoff);
finish(SCRIPT_ID, issues, [".ai/handoffs/agent-handoff-packet.yaml"], { status: "prepared" });
