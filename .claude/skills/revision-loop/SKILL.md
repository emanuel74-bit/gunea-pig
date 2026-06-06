---
name: revision-loop
description: Consume a blocking failure or gate block, create a script-produced revision task, execute bounded repair, and revalidate.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Revision Loop


Use this skill when validation, gate, handoff, report evidence, or semantic completeness blocks progress.

Revision ladder:

1. `npm --prefix conventions/scripts run invoke:route -- --route create_revision_task`
2. `npm --prefix conventions/scripts run invoke:route -- --route analyze_revision_loop`
3. `npm --prefix conventions/scripts run invoke:route -- --route validate_revision_task`
4. Activate `repair_agent` only if the validated revision task authorizes repair.
5. Repair only within the revision task scope.
6. Re-run `validate-phase`.
7. If validation passes, return to `transition-phase`.

Revision decisions/tasks are script-produced only. Repeated-failure fingerprints are observed through `analyze_revision_loop`; observe-mode warnings do not block repair yet. Alpha may invoke the route and consume results; Alpha does not manually decide revision content.

