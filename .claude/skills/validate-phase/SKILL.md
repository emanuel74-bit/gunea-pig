---
name: validate-phase
description: Run the full route-backed validation and evidence ladder for phase output before any gate or handoff.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Validate Phase


Run in declared order:

1. `npm --prefix conventions/scripts run invoke:route -- --route validate_changed_files`
2. `npm --prefix conventions/scripts run invoke:route -- --route validate_phase_output`
3. `npm --prefix conventions/scripts run invoke:route -- --route validate_semantic_completeness`
4. `npm --prefix conventions/scripts run invoke:route -- --route collect_phase_report`
5. `npm --prefix conventions/scripts run invoke:route -- --route collect_evidence`
6. `npm --prefix conventions/scripts run invoke:route -- --route validate_report_evidence`

If any blocking route fails, invoke `revision-loop` instead of continuing to transition.

