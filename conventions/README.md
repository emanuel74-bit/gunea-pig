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
