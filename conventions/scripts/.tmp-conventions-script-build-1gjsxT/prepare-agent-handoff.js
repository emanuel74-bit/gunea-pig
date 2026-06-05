import fs from "node:fs";
import path from "node:path";
import { finish, getArg, issue, readYamlFile, resolveConventionsRoot, writeYamlFile } from "./lib/common.js";
const SCRIPT_ID = "prepare-agent-handoff";
const root = resolveConventionsRoot();
const sourceOutput = getArg("source-output");
const targetAgent = getArg("target-agent");
const handoffId = (getArg("handoff-id") ?? `${targetAgent ?? "target"}-handoff`).replace(/[^a-zA-Z0-9_.-]+/g, "_");
const issues = [];
let sourceArtifact = null;
if (!sourceOutput) {
    issues.push(issue("error", "HANDOFF_SOURCE_OUTPUT_MISSING", "Handoff preparation requires --source-output."));
}
else if (!fs.existsSync(path.join(root, sourceOutput))) {
    issues.push(issue("error", "HANDOFF_SOURCE_OUTPUT_NOT_FOUND", "Source phase output for handoff does not exist.", sourceOutput));
}
else {
    try {
        sourceArtifact = readYamlFile(path.join(root, sourceOutput));
    }
    catch (error) {
        issues.push(issue("error", "HANDOFF_SOURCE_OUTPUT_UNREADABLE", "Source phase output could not be parsed.", sourceOutput, { error: String(error) }));
    }
}
if (!targetAgent) {
    issues.push(issue("error", "HANDOFF_TARGET_AGENT_MISSING", "Handoff preparation requires --target-agent."));
}
const status = issues.some(i => i.severity === "error" || i.severity === "critical") ? "invalid" : "prepared";
const outputRel = `.ai/handoffs/${handoffId}.yaml`;
const handoff = {
    artifact: "agent_handoff_packet",
    generated_by: SCRIPT_ID,
    handoff_id: handoffId,
    status,
    source_output: sourceOutput ?? null,
    target_agent: targetAgent ?? null,
    evidence_refs: sourceOutput ? [sourceOutput] : [],
    source_summary: sourceArtifact?.artifact ? { artifact: sourceArtifact.artifact, status: sourceArtifact.status ?? null } : {},
};
writeYamlFile(path.join(root, outputRel), handoff);
finish(SCRIPT_ID, issues, [outputRel], { status, handoff_id: handoffId, target_agent: targetAgent ?? null });
