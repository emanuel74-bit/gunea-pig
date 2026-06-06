---
name: transition-phase
description: Perform the complete transition chain: phase evidence, gate, handoff, next bundle, or revision fallback.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Transition Phase


Use after `validate-phase` passes.

Transition ladder:

1. Invoke `run-gate`.
2. If gate is blocked, invoke `revision-loop` and stop transition.
3. Invoke `prepare-handoff`.
4. Run `npm --prefix conventions/scripts run executor -- --route advance_mission` to record the observed transition proposal.
5. Run `npm --prefix conventions/scripts run executor -- --route inspect_mission_state`.
6. Run `npm --prefix conventions/scripts run executor -- --route generate_phase_bundle` for the next phase.
7. Run `npm --prefix conventions/scripts run executor -- --route validate_phase_bundle`.
8. Invoke `run-alpha-cycle` for the next phase.

Do not manually mark a phase complete or advance phase state. Completion depends on script-produced validation, gate, handoff, mission-controller observation, and bundle artifacts.

