#!/usr/bin/env python3
"""Optional Claude Code guard hook for the Sync Convention System.

Default mode is advisory. Set SYNC_ALPHA_ENFORCE=1 to deny obviously unsafe writes.
"""
import json, os, sys, pathlib, re

def deny(reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}))
    sys.exit(0)

def allow():
    sys.exit(0)

try:
    payload=json.load(sys.stdin)
except Exception:
    allow()

enforce=os.environ.get('SYNC_ALPHA_ENFORCE')=='1'
tool=payload.get('tool_name','')
ti=payload.get('tool_input',{}) or {}

# Always block destructive shell commands, even in advisory mode.
if tool == 'Bash':
    cmd=ti.get('command','')
    dangerous=[r'rm\s+-rf\s+/', r'git\s+reset\s+--hard', r'git\s+clean\s+-fdx', r':\(\)\s*\{\s*:\|:&\s*\};:']
    if any(re.search(p, cmd) for p in dangerous):
        deny('Blocked dangerous shell command by Sync Alpha guard.')
    allow()

if not enforce:
    allow()

# In enforce mode, block editing convention source except through convention_system_edit profile.
path=ti.get('file_path') or ti.get('path') or ''
mission=pathlib.Path('.ai/mission-state.yaml')
selected=''
if mission.exists():
    txt=mission.read_text(errors='ignore')
    m=re.search(r'^selected_profile:\s*["']?([^"'
]+)', txt, re.M)
    if m: selected=m.group(1).strip()

if path.startswith('conventions/') and selected != 'convention_system_edit':
    deny('Editing conventions/ requires selected_profile: convention_system_edit.')

# Source edits require implementation allowance unless writing .ai reports/templates.
if tool in {'Edit','MultiEdit','Write'}:
    if path.startswith('.ai/') or path.startswith('.claude/'):
        allow()
    if selected and 'implementation_allowed: true' not in (mission.read_text(errors='ignore') if mission.exists() else ''):
        deny('Source edit blocked until pre_implementation_gate sets implementation_allowed: true.')

allow()
