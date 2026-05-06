#!/usr/bin/env python3
import json, sys, pathlib, datetime, os
kind = sys.argv[1] if len(sys.argv) > 1 else 'event'
try:
    payload=json.load(sys.stdin)
except Exception:
    payload={}
logdir=pathlib.Path('.ai/logs')
logdir.mkdir(parents=True, exist_ok=True)
with (logdir/'subagents.jsonl').open('a') as f:
    f.write(json.dumps({'time': datetime.datetime.utcnow().isoformat()+'Z', 'event': kind, 'payload': payload})+'
')
sys.exit(0)
