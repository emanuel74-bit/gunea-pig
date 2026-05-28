---
name: prepare-handoff
description: Prepare and validate a script-produced handoff packet for the next phase agent.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Prepare Handoff


Run in order:

1. `npm --prefix conventions/scripts run executor -- --route prepare_agent_handoff`
2. `npm --prefix conventions/scripts run executor -- --route validate_handoff`

Handoff packets are script-produced only. Target agents may consume only validated handoff packets.

