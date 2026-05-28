---
name: validate-phase
description: Run route-backed validation for changed files, phase outputs, semantic completeness, gates, and handoff readiness.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Validate Phase


Use this skill before declaring phase completion.

Run, in declared order:
1. `npm --prefix conventions/scripts run executor -- --route validate_changed_files`
2. `npm --prefix conventions/scripts run executor -- --route validate_phase_output`
3. `npm --prefix conventions/scripts run executor -- --route validate_semantic_completeness`
4. `npm --prefix conventions/scripts run executor -- --route run_gate_check`
5. `npm --prefix conventions/scripts run executor -- --route validate_gate_result`

Stop on any blocking failure. Do not manually mark a gate as passed or failed.

