---
name: generate-artifact
description: Generate only route-backed artifacts and distinguish agent phase outputs from script-produced runtime artifacts.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Generate Artifact


Use this skill whenever an artifact is needed.

Rules:

- Phase agents may produce declared phase outputs from the validated bundle.
- Scripts produce runtime/control artifacts: bundles, topologies, gate results, handoff packets, revision tasks, evidence indexes, and final reports.
- To generate a script-produced artifact, invoke the corresponding executor route rather than writing it manually.

Common artifact routes:

- `npm --prefix conventions/scripts run invoke:route -- --route generate_phase_bundle`
- `npm --prefix conventions/scripts run invoke:route -- --route compile_authority_topology`
- `npm --prefix conventions/scripts run invoke:route -- --route compile_runtime_artifact_topology`
- `npm --prefix conventions/scripts run invoke:route -- --route run_gate_check`
- `npm --prefix conventions/scripts run invoke:route -- --route prepare_agent_handoff`
- `npm --prefix conventions/scripts run invoke:route -- --route create_revision_task`
- `npm --prefix conventions/scripts run invoke:route -- --route collect_evidence`
- `npm --prefix conventions/scripts run invoke:route -- --route generate_final_mission_report`

