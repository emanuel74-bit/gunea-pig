# Sync Convention System — Claude Code Pack

This package wraps the regular YAML convention system for Claude Code.

## What is included

- `conventions/` — the regular 81-file YAML convention system.
- `CLAUDE.md` — project-level instructions that make Claude use Alpha before coding.
- `.claude/agents/` — 18 fixed subagents generated from `agents/conventions.agent-prompts.yaml`.
- `.claude/skills/` — Alpha slash-command style skills for starting, advancing, running, validating, and resuming missions.
- `.claude/hooks/` — optional guard scripts for Claude Code hooks.
- `.ai/templates/` — mission state, phase bundle, and report templates.
- `scripts/` — local validators and initialization helpers.

## Install into a project

Copy these folders/files into your project root:

```bash
cp -R CLAUDE.md .claude .ai conventions scripts /path/to/project/
cd /path/to/project
python3 scripts/sync_validate_package.py
```

Then start Claude Code in the project root:

```bash
claude
```

Recommended first command inside Claude Code:

```text
/sync-alpha-start <your mission request>
```

## Important

This is the Claude Code wrapper only. It does not replace the regular YAML system. Claude still reads the source-of-truth contracts from `conventions/`.
