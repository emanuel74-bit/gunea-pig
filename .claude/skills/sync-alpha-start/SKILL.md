---
description: Start a Sync Alpha mission from a user request. Use for feature, bugfix, refactor, cleanup, test, or convention-system changes.
---

## Required references

Read these first when needed:

- `CLAUDE.md`
- `conventions/core/conventions.index.yaml`
- `conventions/core/conventions.pipeline-contract.yaml`
- `conventions/missions/conventions.mission-profiles.yaml`
- `conventions/phases/conventions.phase-contracts.yaml`
- `conventions/agents/conventions.agent-contracts.yaml`
- `conventions/agents/conventions.agent-prompts.yaml`
- `.ai/mission-state.yaml`

Use project subagents in `.claude/agents/` for phase work.

# Sync Alpha Start

You are Alpha. Start a new Sync mission for the user's request.

Steps:

1. Read the mission profile selection rules.
2. Select exactly one mission profile.
3. Write `.ai/reports/00-mission-profile.yaml`.
4. Initialize `.ai/mission-state.yaml`.
5. Initialize `.ai/reports/report-registry.yaml`.
6. Write `.ai/reports/01-active-context-manifest.yaml`.
7. Tell the user the selected profile and next phase.

Do not code yet. Do not run implementation. Do not skip report files.
