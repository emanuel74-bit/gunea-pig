import fs from "node:fs";
import path from "node:path";
import { finish, issue, readExecutorRoutes, readYamlFile, resolveConventionsRoot, type Issue } from "./lib/common.js";

const SCRIPT_ID = "validate-claude-native-integration";
const root = resolveConventionsRoot();
const projectRoot = path.resolve(root, "..");
const issues: Issue[] = [];
const routes = readExecutorRoutes(root);

const requiredFiles = [
  "CLAUDE.md",
  ".claude/settings.json",
  ".claude/skills/start-mission/SKILL.md",
  ".claude/skills/run-phase/SKILL.md",
  ".claude/skills/validate-phase/SKILL.md",
  ".claude/skills/complete-mission/SKILL.md",
  ".claude/agents/alpha.md",
  ".claude/agents/phase-agent.md",
  ".claude/agents/reviewer.md",
];

for (const relPath of requiredFiles) {
  if (!fs.existsSync(path.join(projectRoot, relPath))) {
    issues.push(issue("error", "CLAUDE_PROJECT_FILE_MISSING", `Missing Claude Code project file: ${relPath}`, relPath));
  }
}

const routeWrapperPattern = /npm\s+--prefix\s+conventions\/scripts\s+run\s+executor\s+--\s+--route\s+([a-zA-Z0-9_.-]+)/g;
const directScriptPattern = /(tsx|node|npm\s+run)\s+[^\n]*scripts\/[a-zA-Z0-9_.-]+\.ts/g;

function scanText(relPath: string): string {
  const abs = path.join(projectRoot, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
}

for (const relPath of requiredFiles) {
  const text = scanText(relPath);
  if (!text) continue;

  for (const match of text.matchAll(routeWrapperPattern)) {
    const routeId = match[1];
    if (!routes.has(routeId)) {
      issues.push(issue("error", "UNKNOWN_ROUTE_IN_CLAUDE_FILE", `Claude project file references unknown executor route: ${routeId}`, relPath));
    }
  }

  for (const match of text.matchAll(directScriptPattern)) {
    const snippet = match[0];
    if (!snippet.includes("run-executor-route.ts")) {
      issues.push(issue("error", "DIRECT_SCRIPT_INVOCATION_IN_CLAUDE_FILE", `Claude project file invokes a script directly instead of executor route wrapper: ${snippet}`, relPath));
    }
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
  } catch (error) {
    issues.push(issue("error", "CLAUDE_SETTINGS_INVALID_JSON", "Claude settings.json failed to parse", ".claude/settings.json", String(error)));
  }
}

finish(SCRIPT_ID, issues, [".ai/validation/validate-claude-native-integration.result.yaml"], {
  required_file_count: requiredFiles.length,
  route_count: routes.size,
});
