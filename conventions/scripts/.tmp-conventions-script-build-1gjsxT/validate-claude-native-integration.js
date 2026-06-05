import fs from "node:fs";
import path from "node:path";
import { finish, issue, readExecutorRoutes, readYamlFile, resolveConventionsRoot } from "./lib/common.js";
const SCRIPT_ID = "validate-claude-native-integration";
const root = resolveConventionsRoot();
const projectRoot = path.resolve(root, "..");
const issues = [];
const routes = readExecutorRoutes(root);
const agentTaxonomy = readYamlFile(path.join(root, "agents", "conventions.agent-taxonomy.yaml"));
const agentDefinitions = (agentTaxonomy?.sections?.agent_definitions ?? {});
const agentIds = Object.keys(agentDefinitions);
const slug = (value) => value.replaceAll("_", "-");
const requiredSkills = [
    "start-mission",
    "run-alpha-cycle",
    "activate-agent",
    "run-phase",
    "validate-phase",
    "run-gate",
    "prepare-handoff",
    "transition-phase",
    "revision-loop",
    "generate-artifact",
    "collect-report-evidence",
    "complete-mission",
];
const requiredCommands = [
    "start-mission",
    "run-alpha-cycle",
    "activate-agent",
    "run-phase",
    "validate-phase",
    "transition-phase",
    "revision-loop",
    "complete-mission",
];
const requiredConventionFiles = [
    "claude-code/conventions.claude-code.yaml",
    "claude-code/conventions.claude-native-integration.yaml",
    "claude-code/conventions.claude-project-files.yaml",
    "claude-code/conventions.claude-native-workflow-engine.yaml",
    "claude-code/conventions.claude-agent-activation-map.yaml",
    "claude-code/conventions.claude-subsystem-engagement.yaml",
];
const requiredFiles = [
    "CLAUDE.md",
    ".claude/settings.json",
    ...requiredSkills.map((skill) => `.claude/skills/${skill}/SKILL.md`),
    ...requiredCommands.map((command) => `.claude/commands/${command}.md`),
    ...agentIds.map((agentId) => `.claude/agents/${slug(agentId)}.md`),
    ...requiredConventionFiles.map((file) => `conventions/${file}`),
];
function projectFilePath(relPath) {
    const direct = path.join(projectRoot, relPath);
    if (fs.existsSync(direct))
        return direct;
    if (relPath.startsWith("conventions/")) {
        const underRoot = path.join(root, relPath.slice("conventions/".length));
        if (fs.existsSync(underRoot))
            return underRoot;
    }
    return direct;
}
for (const relPath of requiredFiles) {
    if (!fs.existsSync(projectFilePath(relPath))) {
        issues.push(issue("error", "CLAUDE_PROJECT_FILE_MISSING", `Missing Claude Code project file: ${relPath}`, relPath));
    }
}
const routeWrapperPattern = /npm\s+--prefix\s+conventions\/scripts\s+run\s+executor\s+--\s+--route\s+([a-zA-Z0-9_.-]+)/g;
const directScriptPattern = /(tsx|node|npx\s+tsx)\s+[^\n]*scripts\/[a-zA-Z0-9_.-]+\.ts/g;
function scanText(relPath) {
    const abs = projectFilePath(relPath);
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
}
for (const relPath of requiredFiles) {
    const text = scanText(relPath);
    if (!text)
        continue;
    for (const match of text.matchAll(routeWrapperPattern)) {
        const routeId = match[1];
        if (!routes.has(routeId)) {
            issues.push(issue("error", "UNKNOWN_ROUTE_IN_CLAUDE_FILE", `Claude project file references unknown executor route: ${routeId}`, relPath));
        }
    }
    for (const match of text.matchAll(directScriptPattern)) {
        issues.push(issue("error", "DIRECT_SCRIPT_INVOCATION_IN_CLAUDE_FILE", `Claude project file invokes a script directly instead of executor route wrapper: ${match[0]}`, relPath));
    }
}
const settingsPath = path.join(projectRoot, ".claude", "settings.json");
if (fs.existsSync(settingsPath)) {
    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        const hooks = settings.hooks ?? {};
        const requiredEvents = ["SessionStart", "PostToolUse", "Stop", "StopFailure"];
        for (const eventName of requiredEvents) {
            if (!Array.isArray(hooks[eventName])) {
                issues.push(issue("error", "CLAUDE_HOOK_EVENT_MISSING", `Missing Claude Code hook event: ${eventName}`, ".claude/settings.json"));
            }
        }
        const settingsText = fs.readFileSync(settingsPath, "utf8");
        if (!settingsText.includes("npm --prefix conventions/scripts run executor -- --route")) {
            issues.push(issue("error", "CLAUDE_HOOKS_NOT_ROUTE_BACKED", "Claude hooks must invoke executor route wrapper", ".claude/settings.json"));
        }
    }
    catch (error) {
        issues.push(issue("error", "CLAUDE_SETTINGS_INVALID_JSON", "Claude settings.json failed to parse", ".claude/settings.json", String(error)));
    }
}
const activationMap = readYamlFile(path.join(root, "claude-code", "conventions.claude-agent-activation-map.yaml"));
const nativeAgents = (activationMap?.sections?.native_agents ?? {});
for (const agentId of agentIds) {
    const record = nativeAgents[agentId];
    if (!record) {
        issues.push(issue("error", "AGENT_NOT_IN_NATIVE_ACTIVATION_MAP", `Agent ${agentId} is missing from native activation map`, "claude-code/conventions.claude-agent-activation-map.yaml"));
        continue;
    }
    const file = record.claude_agent_file;
    if (!file || !fs.existsSync(path.join(projectRoot, file))) {
        issues.push(issue("error", "NATIVE_AGENT_FILE_MISSING", `Agent ${agentId} maps to missing Claude subagent file: ${file}`, file ?? ""));
    }
}
const engagement = readYamlFile(path.join(root, "claude-code", "conventions.claude-subsystem-engagement.yaml"));
const lanes = (engagement?.sections?.workflow_lanes ?? {});
const mappedSubsystems = new Set();
const mappedAgents = new Set();
for (const [laneId, lane] of Object.entries(lanes)) {
    for (const subsystem of lane.subsystems ?? [])
        mappedSubsystems.add(subsystem);
    for (const routeId of lane.routes ?? []) {
        if (!routes.has(routeId)) {
            issues.push(issue("error", "UNKNOWN_WORKFLOW_ROUTE", `Workflow lane ${laneId} references unknown executor route: ${routeId}`, "claude-code/conventions.claude-subsystem-engagement.yaml"));
        }
    }
    for (const agentId of lane.agents ?? []) {
        mappedAgents.add(agentId);
        if (!agentIds.includes(agentId)) {
            issues.push(issue("error", "UNKNOWN_WORKFLOW_AGENT", `Workflow lane ${laneId} references unknown agent: ${agentId}`, "claude-code/conventions.claude-subsystem-engagement.yaml"));
        }
    }
}
const conventionSubsystems = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "scripts" && name !== ".ai");
for (const subsystem of conventionSubsystems) {
    if (!mappedSubsystems.has(subsystem)) {
        issues.push(issue("error", "UNMAPPED_CLAUDE_SUBSYSTEM", `Claude subsystem engagement map does not cover subsystem: ${subsystem}`, "claude-code/conventions.claude-subsystem-engagement.yaml"));
    }
}
for (const agentId of agentIds) {
    if (!mappedAgents.has(agentId)) {
        issues.push(issue("warning", "AGENT_NOT_MAPPED_TO_WORKFLOW_LANE", `Agent ${agentId} has native subagent file but is not referenced in workflow lane map`, "claude-code/conventions.claude-subsystem-engagement.yaml"));
    }
}
const requiredRouteMentions = [
    "generate_claude_execution_plan",
    "validate_claude_execution_plan",
    "generate_phase_bundle",
    "validate_phase_bundle",
    "validate_changed_files",
    "validate_phase_output",
    "validate_semantic_completeness",
    "run_gate_check",
    "validate_gate_result",
    "prepare_agent_handoff",
    "validate_handoff",
    "create_revision_task",
    "validate_revision_task",
    "collect_evidence",
    "validate_report_evidence",
    "generate_final_mission_report",
];
const allClaudeText = requiredFiles.map((file) => scanText(file)).join("\n");
for (const routeId of requiredRouteMentions) {
    if (!allClaudeText.includes(routeId)) {
        issues.push(issue("error", "CORE_ROUTE_NOT_EXPOSED_TO_CLAUDE", `Core route ${routeId} is not exposed in Claude-native files`, "claude-code/conventions.claude-native-workflow-engine.yaml"));
    }
}
finish(SCRIPT_ID, issues, [".ai/validation/validate-claude-native-integration.result.yaml"], {
    required_file_count: requiredFiles.length,
    native_agent_count: agentIds.length,
    required_skill_count: requiredSkills.length,
    route_count: routes.size,
    mapped_subsystem_count: mappedSubsystems.size,
});
