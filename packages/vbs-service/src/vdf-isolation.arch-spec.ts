import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';

function getAllTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.arch-spec.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('VDF isolation architecture constraint', () => {
  it('only VdfCliAdapter imports child_process', () => {
    const srcDir = path.join(__dirname);
    const allFiles = getAllTsFiles(srcDir);

    const ALLOWED_FILE = 'vdf-cli.adapter.ts';

    const violations = allFiles.filter((file) => {
      if (file.endsWith(ALLOWED_FILE)) return false;
      const content = readFileSync(file, 'utf-8');
      return content.includes("from 'child_process'") || content.includes('require("child_process")') || content.includes("require('child_process')");
    });

    if (violations.length > 0) {
      console.error('child_process imported outside vdf-cli.adapter.ts:\n', violations.join('\n'));
    }

    expect(violations).toHaveLength(0);
  });
});
