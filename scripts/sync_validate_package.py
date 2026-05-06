#!/usr/bin/env python3
import sys, json
from pathlib import Path
try:
    import yaml
except Exception as e:
    print('PyYAML is required: python3 -m pip install pyyaml', file=sys.stderr)
    sys.exit(2)

root=Path(__file__).resolve().parents[1]
conv=root/'conventions'
errors=[]
warnings=[]
required_top=['version','file','purpose','ownership','activation','inputs','outputs','dependencies','sections','validation']
count=0
for f in sorted(conv.rglob('*.yaml')):
    if f.name in {'PACKAGE_MANIFEST.yaml','VALIDATION_REPORT.yaml'}:
        continue
    count += 1
    try:
        data=yaml.safe_load(f.read_text())
    except Exception as e:
        errors.append(f'{f.relative_to(root)}: YAML parse error: {e}')
        continue
    if not isinstance(data, dict):
        errors.append(f'{f.relative_to(root)}: root must be mapping')
        continue
    for k in required_top:
        if k not in data:
            errors.append(f'{f.relative_to(root)}: missing top-level {k}')
    file_meta=data.get('file',{})
    for k in ['name','path','role','executability']:
        if k not in file_meta:
            errors.append(f'{f.relative_to(root)}: missing file.{k}')

# Coverage checks
try:
    phase_tax=yaml.safe_load((conv/'phases/conventions.phase-taxonomy.yaml').read_text())['sections']['phase_enum']['allowed']
    phase_contracts=yaml.safe_load((conv/'phases/conventions.phase-contracts.yaml').read_text())['sections']['phase_contract_registry']
    phase_contract_ids=[p['phase_id'] for p in phase_contracts]
    if set(phase_tax)!=set(phase_contract_ids):
        errors.append('phase taxonomy and phase contract registry mismatch')
except Exception as e:
    errors.append(f'phase coverage check failed: {e}')
try:
    agents=yaml.safe_load((conv/'agents/conventions.agent-taxonomy.yaml').read_text())['sections']['agent_enum']['allowed']
    contracts=yaml.safe_load((conv/'agents/conventions.agent-contracts.yaml').read_text())['sections']['agent_contract_registry']
    prompts=yaml.safe_load((conv/'agents/conventions.agent-prompts.yaml').read_text())['sections']['prompt_registry']
    perms=yaml.safe_load((conv/'agents/conventions.agent-permissions.yaml').read_text())['sections']['agent_permission_profiles']
    if set(agents)!=set(c['agent_id'] for c in contracts): errors.append('agent taxonomy and contracts mismatch')
    if set(agents)!=set(p['agent_id'] for p in prompts): errors.append('agent taxonomy and prompts mismatch')
    if set(agents)!=set(perms.keys()): errors.append('agent taxonomy and permissions mismatch')
except Exception as e:
    errors.append(f'agent coverage check failed: {e}')

report={'yaml_files_checked':count,'errors':errors,'warnings':warnings,'status':'passed' if not errors else 'failed'}
out=root/'VALIDATION_REPORT_CLAUDE.yaml'
out.write_text(yaml.safe_dump(report, sort_keys=False))
print(yaml.safe_dump(report, sort_keys=False))
sys.exit(1 if errors else 0)
