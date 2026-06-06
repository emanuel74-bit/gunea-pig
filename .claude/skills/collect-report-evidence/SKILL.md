---
name: collect-report-evidence
description: Collect and validate route-backed evidence for phase and mission reports.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Collect Report Evidence


Run when phase output is ready, before handoff, before mission completion, or after a stop/failure:

1. `npm --prefix conventions/scripts run invoke:route -- --route collect_phase_report`
2. `npm --prefix conventions/scripts run invoke:route -- --route collect_evidence`
3. `npm --prefix conventions/scripts run invoke:route -- --route validate_report_evidence`

Reports must be evidence-backed. Do not write final report content manually.

