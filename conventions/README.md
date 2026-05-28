# Sync Conventions System — Regular YAML Package

Generated from the accepted Autonomous Agent Activator milestone. This package now includes a Claude Code execution harness that uses phase bundles, centralized executor routes, and script-produced runtime artifacts for deterministic mission execution.


## Phase 8 Claude Code Harness
Claude Code must execute missions through validated mission/phase bundles and central executor routes. It must not call scripts directly, manually author transition artifacts, or mark missions complete without script-generated report evidence.


## Phase 8.1 — Native Claude Code Integration

This package includes project-level Claude Code integration files:

- `CLAUDE.md`
- `.claude/settings.json`
- `.claude/skills/start-mission/SKILL.md`
- `.claude/skills/run-phase/SKILL.md`
- `.claude/skills/validate-phase/SKILL.md`
- `.claude/skills/complete-mission/SKILL.md`
- `.claude/agents/alpha.md`
- `.claude/agents/phase-agent.md`
- `.claude/agents/reviewer.md`

Claude Code should invoke runtime automation through executor routes only:

`npm --prefix conventions/scripts run executor -- --route <route_id>`

## Phase 8.2 — Claude Native Workflow Engine

Claude Code integration is now workflow-native rather than folder-discovery based:

- every convention agent in `agents/conventions.agent-taxonomy.yaml` has a matching `.claude/agents/<agent>.md` subagent;
- Alpha orchestration is exposed through `run-alpha-cycle` and `activate-agent` skills;
- gates, handoffs, revisions, reports, phase bundles, validation, and artifact generation are exposed through route-backed workflow skills;
- `claude-code/conventions.claude-subsystem-engagement.yaml` maps workflow lanes to every convention subsystem so Claude knows where to look and what to activate without scanning the full package;
- transition and report artifacts remain script-produced only.
