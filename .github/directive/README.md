# Upgraded 51-file conventions system

This package contains the normalized 51-file YAML convention system.

## Included subsystems

- core
- agent
- architecture
- roles
- patterns
- actions
- risk
- boundaries
- contracts
- dependencies
- testing
- planning
- execution
- refactoring

## Key updates in this package

- Adds the refactoring subsystem with strategy taxonomy, strategy selection, and behavior preservation requirements.
- Adds draft role pass and final role assignment model.
- Refactoring consumes artifact actions and global vocabularies; it does not own planning, execution, final risk, contracts, dependencies, or orchestration.
- All YAML files follow the universal file-contract top-level shape.
- Structured fail conditions are present in every YAML file.


## Internal rule-section normalization

All loose `sections.rules` prose lists were converted into typed rule groups such as `absolute_rules`, `priority_rules`, or advisory schemas according to `core/conventions.file-contract.yaml`.

## Reusable agent prompt

Attach `USE_CONVENTIONS_SYSTEM.prompt.md` with this package when giving a task to an AI coding/design agent. The prompt instructs the agent to use the YAML convention system without loading every file by default, follow core routing/orchestration, and produce the required decisions before implementation.

