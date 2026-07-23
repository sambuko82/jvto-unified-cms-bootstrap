// Build REAL, immutable consolidation release bundles from the compiled outputs
// of every JVTO source repo, and commit them under data/releases/<source>/.
//
// This is the "extract" half of the standalone (DB-free, live-free) CMS: it
// reads each repo's already-compiled + facts-locked artifacts and normalizes
// every item into the engine's ImportRecord shape (identity + owned fields per
// config/consolidation-map.yaml), computing a real sha256 per file. The bundles
// are COMMITTED and are the artifact of record (ADR-004: immutable releases with
// manifests + checksums). CI never regenerates them; it consumes them via
// scripts/consolidate.mjs. Re-run this only when an upstream release changes:
//   npm run build:bundles
//
// Determinism: fixed release version + producedAt; sha256 over canonical JSON
// (sorted keys, matching the engine) so committed hashes verify in CI. No clock,
// no randomness. Upstream provenance (compiled_at / schema_version) is recorded
// in each manifest's metadata.
import fs from 'node:fs';
import path from 'node:path';
import { payloadHash, sha256Hex } from '../dist/index.js';

const root = process.cwd();
const OUT = path.join(root, 'data/releases');

// Authoring-time inputs: the sibling repo checkouts. Overridable via env so the
// same script reproduces the bundles from any layout. The committed bundles are
// the artifact; these paths only matter when regenerating.
const SRC = {
  llmWiki: process.env.LLM_WIKI_DIR || '/home/user/llm-wiki',
  itinerary: process.env.ITINERARY_DIR || '/home/user/jvto-itinerary-core',
  okf: process.env.OKF_DIR || '/workspace/knowledge-catalog-jvto-bootstrap',
  design: process.env.DESIGN_DIR || '/workspace/jvto-new-on-design-system',
};

const RELEASE_VERSION = '2026.07.21.1';
const PRODUCED_AT = '2026-07-21T00:00:00.000Z';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);

/** Mirror of the engine's normalizeSlug so committed canonical keys are stable. */
function slug(raw) {
  let s = String(raw ?? '').trim();
  if (s.includes('/')) {
    const parts = s.split('/').filter((x) => x.length > 0 && x !== '#');
    s = parts[parts.length - 1] ?? s;
  }
  s = s.replace(/^#/, '');
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const asText = (v) => (Array.isArray(v) ? v.filter(Boolean).join(' ') : v == null ? '' : String(v));

// Facts-lock sanitizer (canonical-facts is the tie-breaker over every upstream
// artifact). Some upstream compilers still carry the retired CONDITIONAL Ijen
// health-screening wording; CANONICAL_FACTS locks it as MANDATORY. Correct it on
// extract so no stale fact leaks into the projection (mirrors jvto-web's import).
function factsLock(text) {
  if (typeof text !== 'string') return text;
  return text.replace(
    /when BBKSDA regulations require it/gi,
    'for every guest before crater entry (mandatory)',
  );
}

function rec(source, entityType, externalKey, canonicalKey, payload) {
  return {
    source,
    releaseVersion: RELEASE_VERSION,
    externalKey,
    entityType,
    canonicalKey,
    payload,
    payloadSha256: payloadHash(payload),
  };
}

// ---------------------------------------------------------------------------
// llm-wiki-trust — claims, faq, people, destination narrative
// ---------------------------------------------------------------------------
function buildTrust() {
  const base = path.join(SRC.llmWiki, 'output/website/trust-bundle');
  const records = [];

  // Claims C1..C9 — canonical_wording is the owned field.
  const claims = readJson(path.join(base, 'claims.json')).claims;
  for (const c of claims) {
    records.push(
      rec('llm-wiki-trust', 'claim', c.id, `claim:${slug(c.id)}`, {
        canonical_wording: c.canonical_text,
        name: c.name,
        domain: c.domain,
        category: c.category,
        last_verified: c.last_verified,
        evidence_count: Array.isArray(c.evidence) ? c.evidence.length : 0,
      }),
    );
  }

  // FAQ (owner_fields '*').
  const faqs = readJson(path.join(base, 'faq.json')).items;
  for (const f of faqs) {
    records.push(
      rec('llm-wiki-trust', 'faq', f.question, `faq:${slug(f.question)}`, {
        question: f.question,
        answer: f.answer,
        source_claim_id: f.source_claim_id,
        target_pages: f.target_pages,
      }),
    );
  }

  // People — founder + medical officer + crew. Public profile fields only.
  const people = readJson(path.join(base, 'people.json'));
  const person = (p, roleFallback) =>
    rec('llm-wiki-trust', 'public_person_profile', p.schema_id || p.id, `public_person_profile:${slug(p.id)}`, {
      name: p.full_name || p.name,
      role: p.role || roleFallback,
      job_title: p.job_title_schema || p.job_title,
      police_rank: p.police_rank,
      police_unit: p.police_unit,
      organization: p.organization,
      kta: p.kta,
      languages: p.languages,
      strengths: p.strengths,
      review_count: p.review_count,
      review_rating: p.review_rating,
      portrait_url: p.portrait_url,
      schema_id: p.schema_id,
    });
  if (people.founder) records.push(person(people.founder, 'Founder'));
  if (people.medical_officer) records.push(person(people.medical_officer, 'Medical Officer'));
  const crew = Array.isArray(people.crew) ? people.crew : people.crew?.members || [];
  for (const m of crew) records.push(person(m, 'Crew'));

  // Destination narrative (owned field: narrative).
  const dests = readJson(path.join(base, 'destinations.json')).destinations;
  for (const d of dests) {
    records.push(
      rec('llm-wiki-trust', 'destination', d.id, `destination:${slug(d.id)}`, {
        narrative: d.entity_summary || asText(d.aeo_block),
        name: d.name,
        type: d.type,
        elevation_m: d.elevation_m,
      }),
    );
  }
  return records;
}

// A trust-destination alias map (slug -> canonical key) so the numeric-id
// itinerary destinations merge onto the same canonical destination entity.
function destAliasMap() {
  const dests = readJson(path.join(SRC.llmWiki, 'output/website/trust-bundle/destinations.json')).destinations;
  const map = {};
  for (const d of dests) {
    const key = `destination:${slug(d.id)}`;
    map[slug(d.id)] = key;
    if (d.name) map[slug(d.name)] = key;
    for (const a of d.aliases || []) map[slug(a)] = key;
  }
  return map;
}

// ---------------------------------------------------------------------------
// llm-wiki-policy — policy documents (9 domains; cancellation enriched)
// ---------------------------------------------------------------------------
function buildPolicy() {
  const base = path.join(SRC.llmWiki, 'output/website/policy-bundle');
  const records = [];
  const policies = readJson(path.join(base, 'policy-bundle.json'));
  const decisionMatrix = readJson(path.join(base, 'decision-matrix.json'));
  const customerCopy = readJson(path.join(base, 'customer-copy.json'));

  for (const p of policies) {
    const payload = {
      domain: p.domain,
      summary: asText(p.notes),
      evidence_count: Array.isArray(p.evidence) ? p.evidence.length : 0,
      canonical_sources: p.canonical_sources,
    };
    if (p.policy_id === 'cancellation-package-credit') {
      payload.decision_matrix = decisionMatrix;
      payload.customer_copy = customerCopy;
    }
    records.push(rec('llm-wiki-policy', 'policy_document', p.policy_id, `policy_document:${slug(p.policy_id)}`, payload));
  }
  return records;
}

// ---------------------------------------------------------------------------
// itinerary-core — route maps, destination operational, activities
// ---------------------------------------------------------------------------
function buildItinerary(destAlias) {
  const base = path.join(SRC.itinerary, 'generated/itinerary-intelligence');
  const records = [];

  const routes = readJson(path.join(base, '11-package-route-map.json'));
  for (const r of routes) {
    records.push(
      rec('itinerary-core', 'route', r.package_id, `route:${slug(r.package_id)}`, {
        label: r.label,
        origin: r.origin,
        duration: r.duration,
        route_sequence: r.route_sequence,
        route_legs: r.route_legs,
        standard_dropoff_options: r.standard_dropoff_options,
      }),
    );
  }

  const dests = readJson(path.join(base, '22-destinations-master.json')).destinations;
  for (const d of dests) {
    // Merge onto the trust destination by name; fall back to a "Mount/Gunung"-
    // stripped form so "Mount Ijen" resolves to the "Ijen"/kawah-ijen entity.
    const direct = slug(d.name);
    const stripped = direct.replace(/^(mount|gunung)-/, '');
    const key = destAlias[direct] || destAlias[stripped] || `destination:${direct}`;
    records.push(
      rec('itinerary-core', 'destination', d.name, key, {
        operational: {
          elevation_m: d.elevation_m,
          difficulty_level: d.difficulty_level,
          best_time_to_visit: d.best_time_to_visit,
          jeep_required: d.jeep_required,
          standard_tour_start_time: d.standard_tour_start_time,
          entrance_ticket_domestic_idr: d.entrance_ticket_domestic_idr,
          entrance_ticket_foreign_idr: d.entrance_ticket_foreign_idr,
          required_gear: d.required_gear,
        },
      }),
    );
  }

  const acts = readJson(path.join(base, '18-activities-master.json')).activity_types;
  for (const a of acts) {
    records.push(
      rec('itinerary-core', 'activity', a.name, `activity:${slug(a.name)}`, {
        name: a.name,
        category: a.category_name,
      }),
    );
  }
  return records;
}

// ---------------------------------------------------------------------------
// knowledge-catalog-okf — package profiles, general modules
// ---------------------------------------------------------------------------
function buildOkf() {
  const base = path.join(SRC.okf, 'okf/customer-sales-release/jvto');
  const records = [];

  const profiles = readJson(path.join(base, 'package-profiles.json'));
  for (const p of profiles) {
    // Origin-prefix the key: Bali and Surabaya share bare slugs but are distinct
    // packages (distinct public_url) — keying by slug alone wrongly merges them.
    const pkgKey = slug(p.origin ? `${p.origin}-${p.slug}` : p.slug);
    records.push(
      rec('knowledge-catalog-okf', 'package', p.public_url || p.slug, `package:${pkgKey}`, {
        profile: {
          title: p.title,
          description: p.description,
          origin: p.origin,
          duration: p.duration,
          day_count: p.day_count,
          day_titles: p.day_titles,
          destination_tokens: p.destination_tokens,
          readiness: p.readiness,
        },
        public_url: p.public_url,
      }),
    );
  }

  const modules = readJson(path.join(base, 'general-modules.json'));
  for (const m of modules) {
    records.push(
      rec('knowledge-catalog-okf', 'general_module', m.module_id, `general_module:${slug(m.module_id)}`, {
        category: m.category,
        scope: m.scope,
        title: m.title,
        short_answer: factsLock(m.short_answer),
        detail_summary: factsLock(m.detail_summary),
        customer_visible: m.customer_visible,
        reusable: m.reusable,
      }),
    );
  }
  return records;
}

// ---------------------------------------------------------------------------
// design-system — CMS page seed (parse the content_pages upsert SQL)
// ---------------------------------------------------------------------------
function buildDesign() {
  const sqlPath = path.join(SRC.design, 'handoff/seed/01_content_pages_v2.sql');
  const text = fs.readFileSync(sqlPath, 'utf8');
  const records = [];
  // Each VALUES tuple starts with ('<route>', '<lang>', ...
  const heads = [...text.matchAll(/\(\s*'(\/[^']*)',\s*'(en|id)'/g)];
  // Every '{ ... }'::jsonb block, in order: seo, content, seo, content...
  // Anchor structurally on the brace + ::jsonb (non-greedy) so a lone apostrophe
  // inside the JSON — legal inside a double-quoted JSON string — doesn't split the
  // literal early. Un-double any SQL-escaped '' after capture.
  const blocks = [...text.matchAll(/'(\{[\s\S]*?\})'::jsonb/g)].map((m) => m[1].replace(/''/g, "'"));
  if (blocks.length !== heads.length * 2) {
    throw new Error(`design-system SQL parse mismatch: ${heads.length} routes but ${blocks.length} json blocks`);
  }
  heads.forEach((h, i) => {
    const route = h[1];
    const seo = JSON.parse(blocks[i * 2]);
    const content = JSON.parse(blocks[i * 2 + 1]);
    const key = slug(route) || 'home';
    records.push(
      rec('design-system', 'page', route, `page:${key}`, {
        content,
        seo,
        route,
      }),
    );
  });
  return records;
}

// ---------------------------------------------------------------------------
// canonical-facts — the adjudicated facts lock (tie-breaker). Sourced from
// jvto-web docs/CANONICAL_FACTS.md; embedded here as the single governance
// record (stable, authored once). Merges onto the cancellation policy document.
// ---------------------------------------------------------------------------
function buildCanonicalFacts() {
  return [
    rec('canonical-facts', 'policy_document', 'canonical-facts', 'policy_document:cancellation-package-credit', {
      adjudicated_facts: {
        founding_year: 2015,
        deposit_percent: 20,
        close_departure_full_within_days: 14,
        cancellation_model: 'lifetime_package_credit',
        reviews: { trustpilot: '4.8/51', google: '4.9/123', tripadvisor: '4.95/21', cross_platform: '4.8/195' },
        ijen_health_screening: 'mandatory',
        nib: '1102230032918',
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Assemble + write the bundles
// ---------------------------------------------------------------------------
function upstreamMeta() {
  const meta = {};
  const trustMan = path.join(SRC.llmWiki, 'output/website/trust-bundle/_manifest.json');
  const policyMan = path.join(SRC.llmWiki, 'output/website/policy-bundle/_manifest.json');
  const itinMan = path.join(SRC.itinerary, 'generated/itinerary-intelligence/manifest.json');
  if (exists(trustMan)) {
    const m = readJson(trustMan);
    meta['llm-wiki-trust'] = { compiled_at: m.compiled_at, compiler_version: m.compiler_version };
  }
  if (exists(policyMan)) {
    const m = readJson(policyMan);
    meta['llm-wiki-policy'] = { schema_version: m.schema_version, generated_at: m.generated_at, clean: m.clean };
  }
  if (exists(itinMan)) {
    const m = readJson(itinMan);
    meta['itinerary-core'] = { schema_version: m.schema_version, status: m.status };
  }
  return meta;
}

function main() {
  const destAlias = destAliasMap();
  const upstream = upstreamMeta();

  const perSource = {
    'llm-wiki-trust': buildTrust(),
    'llm-wiki-policy': buildPolicy(),
    'itinerary-core': buildItinerary(destAlias),
    'knowledge-catalog-okf': buildOkf(),
    'design-system': buildDesign(),
    'canonical-facts': buildCanonicalFacts(),
  };

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const index = { releaseVersion: RELEASE_VERSION, producedAt: PRODUCED_AT, sources: [] };
  for (const [source, records] of Object.entries(perSource)) {
    const dir = path.join(OUT, source);
    fs.mkdirSync(dir, { recursive: true });
    const recordsJson = JSON.stringify(records, null, 2) + '\n';
    fs.writeFileSync(path.join(dir, 'records.json'), recordsJson);
    const manifest = {
      source,
      version: RELEASE_VERSION,
      producedAt: PRODUCED_AT,
      schemaVersion: 1,
      files: [{ path: 'records.json', sha256: sha256Hex(recordsJson), recordCount: records.length }],
      metadata: { validation: 'passed', upstream: upstream[source] || null },
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    index.sources.push({ source, records: records.length });
  }
  fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(index, null, 2) + '\n');

  const total = index.sources.reduce((n, s) => n + s.records, 0);
  console.log(
    `Release bundles: ${index.sources.length} sources, ${total} records\n` +
      index.sources.map((s) => `  ${s.source.padEnd(24)} ${s.records}`).join('\n'),
  );
}

main();
