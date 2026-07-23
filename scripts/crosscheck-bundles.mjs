// Cross-check the built release bundles (data/releases/*) against jvto-web's
// already-synced + facts-lock-sanitized copies under src/data/*. Both are meant
// to be the SAME compiled SSOT; this catches drift between the upstream source
// (what we extracted) and the copy the previous CMS already carries.
//
// Reporting tool, run at authoring time (needs a jvto-web checkout). Exits 1 on
// any field mismatch so drift is loud. Point at a checkout via JVTO_WEB_DIR.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const WEB = process.env.JVTO_WEB_DIR || '/home/user/jvto-web';
const DATA = path.join(WEB, 'src/data');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const bundle = (source) => readJson(path.join(root, 'data/releases', source, 'records.json'));
const norm = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

let mismatches = 0;
let checked = 0;
const drift = [];

function compare(label, id, field, mine, theirs) {
  checked++;
  if (norm(mine) !== norm(theirs)) {
    mismatches++;
    drift.push({ label, id, field, mine: norm(mine).slice(0, 80), theirs: norm(theirs).slice(0, 80) });
  }
}

// --- claims: canonical_wording vs src/data claims[].canonical_text (by id) ---
{
  const mine = bundle('llm-wiki-trust').filter((r) => r.entityType === 'claim');
  const theirs = readJson(path.join(DATA, 'trust-bundle/claims.json')).claims;
  const byId = Object.fromEntries(theirs.map((c) => [c.id.toLowerCase(), c]));
  for (const r of mine) {
    const id = r.canonicalKey.split(':')[1];
    const t = byId[id];
    if (t) compare('claim', id, 'canonical_wording', r.payload.canonical_wording, t.canonical_text);
  }
}

// --- faq: answer vs src/data faq items (by question) ---
{
  const mine = bundle('llm-wiki-trust').filter((r) => r.entityType === 'faq');
  const theirs = (readJson(path.join(DATA, 'trust-bundle/faq.json')).items || []);
  const byQ = Object.fromEntries(theirs.map((f) => [norm(f.question), f]));
  for (const r of mine) {
    const t = byQ[norm(r.payload.question)];
    if (t) compare('faq', norm(r.payload.question).slice(0, 30), 'answer', r.payload.answer, t.answer);
  }
}

// --- packages: profile.title vs src/data okf profiles (by slug) ---
{
  const mine = bundle('knowledge-catalog-okf').filter((r) => r.entityType === 'package');
  const theirs = readJson(path.join(DATA, 'okf/package-profiles.json'));
  const byUrl = Object.fromEntries(theirs.map((p) => [p.public_url, p]));
  for (const r of mine) {
    const t = byUrl[r.payload.public_url];
    if (t) compare('package', r.payload.public_url, 'title', r.payload.profile.title, t.title);
  }
}

// --- general modules: short_answer vs src/data (by module_id) ---
{
  const mine = bundle('knowledge-catalog-okf').filter((r) => r.entityType === 'general_module');
  const theirs = readJson(path.join(DATA, 'okf/general-modules.json'));
  const byId = Object.fromEntries(theirs.map((m) => [m.module_id, m]));
  for (const r of mine) {
    const id = r.externalKey;
    const t = byId[id];
    if (t) compare('general_module', id, 'short_answer', r.payload.short_answer, t.short_answer);
  }
}

// --- policy: decision matrix policy_version ---
{
  const mine = bundle('llm-wiki-policy').find((r) => r.canonicalKey === 'policy_document:cancellation-package-credit');
  const theirs = readJson(path.join(DATA, 'policy-bundle/decision-matrix.json'));
  if (mine?.payload.decision_matrix) {
    compare('policy', 'cancellation', 'policy_version', mine.payload.decision_matrix.policy_version, theirs.policy_version);
  }
}

console.log(`Cross-check: ${checked} fields compared, ${mismatches} mismatch(es).`);
if (mismatches) {
  console.error('DRIFT between upstream bundle and jvto-web src/data:');
  for (const d of drift) console.error(`  [${d.label}] ${d.id}.${d.field}\n    bundle:  ${d.mine}\n    src/data:${d.theirs}`);
  process.exit(1);
}
console.log('PASS — built bundles match jvto-web src/data (no drift).');
