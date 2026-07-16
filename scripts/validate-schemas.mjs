import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaDir = path.join(process.cwd(), 'schemas');
const files = fs.readdirSync(schemaDir).filter((name) => name.endsWith('.json'));
let failed = false;

for (const name of files) {
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, name), 'utf8'));
    ajv.compile(schema);
    console.log(`OK schemas/${name}`);
  } catch (error) {
    console.error(`Invalid schema ${name}:`, error.message);
    failed = true;
  }
}

if (failed) process.exit(1);
