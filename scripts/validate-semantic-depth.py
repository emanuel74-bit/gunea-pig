#!/usr/bin/env python3
import sys, yaml, pathlib, re
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'conventions')
errors=[]; warnings=[]

def thin(s, key=''):
    if not isinstance(s,str): return True
    ss=s.strip().lower()
    if len(ss)<28: return True
    if key and ss in {f'{key} role', f'{key} artifact role.', f'{key} artifact role', f'{key} concern.', f'{key} concern'}: return True
    if 'vocabulary value.' in ss and len(ss)<80: return True
    return False

for path in root.rglob('*.yaml'):
    try:
        data=yaml.safe_load(path.read_text())
    except Exception as e:
        errors.append(f'{path}: YAML parse error: {e}')
        continue
    if not isinstance(data,dict): continue
    sections=data.get('sections')
    if not isinstance(sections,dict): continue
    for key,val in sections.items():
        if key.endswith('_enum') and isinstance(val,dict) and isinstance(val.get('allowed'),list):
            stem=key[:-5]
            allowed=val['allowed']
            candidates=[stem+'_definitions', stem+'_definition', stem+'s', stem+'_values']
            defs=None; defs_name=None
            for c in candidates:
                if isinstance(sections.get(c),dict): defs=sections[c]; defs_name=c; break
            if defs is None:
                errors.append(f'{path}: {key} has no active definitions map for {len(allowed)} allowed values')
                continue
            for item in allowed:
                rec=defs.get(item)
                if not isinstance(rec,dict):
                    errors.append(f'{path}: {key}.{item} missing object in {defs_name}')
                    continue
                if thin(rec.get('definition'), str(item)):
                    errors.append(f'{path}: {key}.{item} has missing/thin definition in {defs_name}')
                semantic_fields={'choose_when','reject_when','detection_signals','signals','use_when','must','forbidden','validation_rules','required_evidence'}
                if not any(f in rec for f in semantic_fields):
                    errors.append(f'{path}: {key}.{item} lacks executable semantic fields in {defs_name}')

print(yaml.safe_dump({'semantic_depth_errors': errors, 'semantic_depth_warnings': warnings, 'status': 'passed' if not errors else 'failed'}, sort_keys=False))
sys.exit(1 if errors else 0)
