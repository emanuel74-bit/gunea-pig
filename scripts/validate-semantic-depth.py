#!/usr/bin/env python3
import sys, yaml, re
from pathlib import Path
root = Path(sys.argv[1]) if len(sys.argv)>1 else Path('conventions')
errors=[]; warnings=[]
placeholder_patterns=[r'^\w+ concern\.$', r'^\w+ dependency relationship\.$', r'^\w+ consumer\.$', r'^\w+ design pattern\.$', r'^\w+ stable agreement across a boundary\.$']
for path in root.rglob('*.yaml'):
    try:
        data=yaml.safe_load(path.read_text())
    except Exception as e:
        errors.append(f'{path}: YAML parse failed: {e}'); continue
    if not isinstance(data, dict): continue
    sections=data.get('sections',{}) or {}
    has_canonical = 'canonical_restored_source' in sections or any(str(k).startswith('canonical_') for k in sections)
    def walk(obj, keypath=''):
        if isinstance(obj, dict):
            for k,v in obj.items(): walk(v, f'{keypath}.{k}' if keypath else str(k))
        elif isinstance(obj, list):
            for i,v in enumerate(obj): walk(v, f'{keypath}[{i}]')
        elif isinstance(obj, str) and keypath.endswith('definition'):
            for pat in placeholder_patterns:
                if re.match(pat, obj):
                    if has_canonical:
                        warnings.append(f'{path}: placeholder definition retained but canonical source exists at {keypath}: {obj}')
                    else:
                        errors.append(f'{path}: placeholder definition at {keypath}: {obj}')
    walk(sections)
print('semantic_depth_validation:')
print(f'  errors: {len(errors)}')
print(f'  warnings: {len(warnings)}')
if errors:
    print('errors:')
    for e in errors: print('  - '+e)
if warnings:
    print('warnings:')
    for w in warnings[:200]: print('  - '+w)
sys.exit(1 if errors else 0)
