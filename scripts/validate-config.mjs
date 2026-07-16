import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';

const root = process.cwd();
const required = [
  'config/source-registry.yaml',
  'config/field-ownership.yaml',
  'config/board-rules.yaml',
  'config/visual-modes.yaml',
  'config/entity-types.yaml',
  'config/consolidation-map.yaml',
];

let failed = false;
const load = (rel) => yaml.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

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

// ---- Coherence cross-checks (consolidation map vs registries) ----
if (!failed) {
  try {
    const registry = load('config/source-registry.yaml');
    const ownership = load('config/field-ownership.yaml');
    const entityTypes = load('config/entity-types.yaml');
    const map = load('config/consolidation-map.yaml');

    // Schema-validate the consolidation map instance.
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const mapSchema = JSON.parse(
      fs.readFileSync(path.join(root, 'schemas/consolidation-map.schema.json'), 'utf8'),
    );
    const validate = ajv.compile(mapSchema);
    if (!validate(map)) {
      throw new Error('consolidation-map.yaml: ' + ajv.errorsText(validate.errors));
    }

    const sourceCodes = new Set(registry.sources.map((s) => s.code));
    const typeSet = new Set(entityTypes.entity_types);
    const ownedBy = new Set(
      ownership.rules.map((r) => `${r.entity_type}::${r.field_path}::${r.owner_source}`),
    );

    if (!sourceCodes.has(map.tie_breaker)) {
      throw new Error(`consolidation-map tie_breaker '${map.tie_breaker}' is not a registered source`);
    }

    for (const m of map.mappings) {
      if (!sourceCodes.has(m.source)) {
        throw new Error(`mapping source '${m.source}' is not in source-registry`);
      }
      if (!typeSet.has(m.entity_type)) {
        throw new Error(`mapping entity_type '${m.entity_type}' is not a declared entity type`);
      }
      for (const field of m.owner_fields) {
        const exact = ownedBy.has(`${m.entity_type}::${field}::${m.source}`);
        const wild = ownedBy.has(`${m.entity_type}::*::${m.source}`);
        if (!exact && !wild) {
          throw new Error(
            `mapping ${m.source} -> ${m.entity_type}.${field} has no matching field-ownership rule`,
          );
        }
      }
    }
    console.log('OK consolidation coherence (sources, entity types, field ownership)');
  } catch (error) {
    console.error('Consolidation coherence check failed:', error.message);
    failed = true;
  }
}

if (failed) process.exit(1);
