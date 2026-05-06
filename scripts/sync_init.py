#!/usr/bin/env python3
from pathlib import Path
for p in ['.ai/reports','.ai/phase-bundles','.ai/logs']:
    Path(p).mkdir(parents=True, exist_ok=True)
print('Sync Alpha directories initialized.')
