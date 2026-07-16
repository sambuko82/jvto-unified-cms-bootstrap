import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const root = process.cwd();
const required = [
  'config/source-registry.yaml',
  'config/field-ownership.yaml',
  'config/board-rules.yaml',
  'config/visual-modes.yaml',
  'config/entity-types.yaml',
];

let failed = false;
for (const relative of required) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    console.error(`Missing required config: ${relative}`);
    failed = true;
    continue;
  }
  try {
    const parsed = yaml.parse(fs.readFileSync(full, 'utf8'));
    if (!parsed || parsed.version !== 1) {
      throw new Error('Expected version: 1');
    }
    console.log(`OK ${relative}`);
  } catch (error) {
    console.error(`Invalid ${relative}:`, error.message);
    failed = true;
  }
}

if (failed) process.exit(1);
