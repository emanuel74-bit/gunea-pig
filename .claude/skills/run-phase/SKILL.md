---
name: run-phase
description: Execute the current phase through the activated native subagent from the validated phase bundle.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Run Phase


Use this skill only after `activate-agent` selected the correct native agent.

Phase execution rules:

1. Read the validated phase bundle.
2. Read the activated subagent file for the owner agent.
3. Engage only subsystem slices listed in the bundle and `claude-code/conventions.claude-subsystem-engagement.yaml`.
4. Produce only declared phase outputs.
5. Do not write transition artifacts manually.
6. When work is complete, invoke `validate-phase`.

Required route-backed checks after phase output:

1. `npm --prefix conventions/scripts run invoke:route -- --route validate_changed_files`
2. `npm --prefix conventions/scripts run invoke:route -- --route validate_phase_output`
3. `npm --prefix conventions/scripts run invoke:route -- --route validate_semantic_completeness`

