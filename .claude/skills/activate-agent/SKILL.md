---
name: activate-agent
description: Activate the correct Claude subagent from the validated phase bundle owner_agent field.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Activate Agent


Use this skill after Alpha identifies the phase owner.

Activation algorithm:

1. Read the validated phase bundle.
2. Extract `owner_agent`.
3. Match `owner_agent` to the native Claude subagent file below.
4. If Claude Code supports subagent delegation, delegate the phase task to that subagent.
5. If delegation is unavailable, load only the matched subagent file plus the phase bundle and follow that subagent contract.
6. If no matching subagent exists, stop and report native integration failure.

Agent map:

- `alpha_controller` → `.claude/agents/alpha-controller.md`
- `behavior_agent` → `.claude/agents/behavior-agent.md`
- `reconnaissance_agent` → `.claude/agents/reconnaissance-agent.md`
- `classification_agent` → `.claude/agents/classification-agent.md`
- `architecture_agent` → `.claude/agents/architecture-agent.md`
- `role_agent` → `.claude/agents/role-agent.md`
- `pattern_agent` → `.claude/agents/pattern-agent.md`
- `artifact_action_agent` → `.claude/agents/artifact-action-agent.md`
- `refactor_strategy_agent` → `.claude/agents/refactor-strategy-agent.md`
- `impact_agent` → `.claude/agents/impact-agent.md`
- `structure_agent` → `.claude/agents/structure-agent.md`
- `testing_agent` → `.claude/agents/testing-agent.md`
- `execution_planning_agent` → `.claude/agents/execution-planning-agent.md`
- `pre_implementation_gate_agent` → `.claude/agents/pre-implementation-gate-agent.md`
- `implementation_agent` → `.claude/agents/implementation-agent.md`
- `validation_agent` → `.claude/agents/validation-agent.md`
- `failure_analysis_agent` → `.claude/agents/failure-analysis-agent.md`
- `repair_agent` → `.claude/agents/repair-agent.md`

Do not use generic phase-agent behavior when a specific agent exists.

