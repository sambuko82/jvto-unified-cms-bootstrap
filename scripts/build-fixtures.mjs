// Generate deterministic consolidation fixtures (release manifests + import
// records) that mirror the real compiled outputs of every JVTO repo, plus a
// golden publication manifest. Fixtures are committed; CI consumes them and
// never regenerates. Regenerate with `npm run build:fixtures` after editing.
//
// Determinism: fixed producedAt/publishedAt, sha256 over canonical JSON (sorted
// keys) — matching the engine so committed hashes verify in CI.
import fs from 'node:fs';
import path from 'node:path';
import { payloadHash, sha256Hex, canonicalJson, runConsolidation } from '../dist/index.js';
import yaml from 'yaml';

const root = process.cwd();
const outDir = path.join(root, 'examples/consolidation');
const PRODUCED_AT = '2026-07-16T00:00:00.000Z';
const RELEASE_VERSION = '2026.07.16.1';

// ---- Records per source (payloads mirror the real compiled artifacts) ----
const sources = {
  'llm-wiki-trust': [
    rec('claim', 'C1', 'claim:c1', {
      canonical_wording:
        'JVTO is led by Bripka Agung Sambuko, an active officer of the Indonesian Tourist Police (Ditpamobvit East Java).',
      pillar: 'police-led',
      evidence: [{ id: 'E001', type: 'document', proof_ids: ['P001'] }],
    }),
    rec('faq', 'faq-cancellation', 'faq:faq-cancellation', {
      question: 'What is your cancellation policy?',
      answer:
        'A full cancellation at least 48 hours before Day 1 converts to 100% Lifetime Package Credit; partial cancellations refund cash on the cancelled seats.',
      source_claim_id: 'C6',
    }),
    rec('public_person_profile', '/#agung-sambuko', 'public_person_profile:agung-sambuko', {
      name: 'Agung "Mr. Sam" Sambuko',
      schema_id: '/#agung-sambuko',
      job_title: 'Active Tourist Police Officer, Ditpamobvit East Java',
    }),
    rec('destination', 'kawah-ijen', 'destination:kawah-ijen', {
      narrative:
        'Active stratovolcano at 2,386 m with the world’s largest acidic crater lake and the pre-dawn blue fire phenomenon.',
    }),
  ],
  'llm-wiki-policy': [
    rec('policy_document', 'cancellation-package-credit', 'policy_document:cancellation-package-credit', {
      decision_matrix: {
        schema_version: 'cancellation-policy/v2.0',
        policy_version: '2026-07',
        cutoff_hours: 48,
        rules: {
          full_voluntary_gte_48h: { outcome: 'lifetime_package_credit', refund_percent: 0 },
          full_voluntary_lt_48h: { outcome: 'forfeit', refund_percent: 0 },
          partial_gte_48h: { outcome: 'cash_refund', refund_percent: 100 },
          partial_lt_48h: { outcome: 'cash_refund', refund_percent: 50 },
        },
        package_credit_locks: {
          never_cash: true,
          same_package_pax_price: true,
          splittable: false,
          transfers_allowed: 1,
        },
        flight_disruption: { recovery_fee_percent: 50 },
      },
      customer_copy: {
        package_guarantee_summary:
          'Cancel your full booking at least 48 hours before Day 1 and keep 100% as Lifetime Package Credit.',
      },
      payment_methods: {
        gateway: 'Xendit',
        deposit_percent: 20,
        close_departure_full_within_days: 14,
        instant: { instruments: ['card', 'qris'], fee: 'shown at Xendit checkout', asean_qris: true },
        transfer: { instruments: ['wise', 'bank_transfer'], surcharge: false },
        office_cash: {
          currency: 'IDR',
          before_day1: true,
          approved_in_writing: true,
          guest_pre_converts_idr: true,
          money_changer: 'not recommended, no partnership, no rate guarantee',
        },
      },
    }),
  ],
  'itinerary-core': [
    rec('package', 'bali/bromo-ijen-3d2n', 'package:bromo-ijen-3d2n', {
      route_sequence: ['gilimanuk-ferry', 'ijen-night-hike', 'bromo-sunrise', 'madakaripura'],
      public_url: '/tours/from-bali/bromo-ijen-3d2n',
      origin: 'bali',
      duration: '3D2N',
    }),
    rec('destination', 'mount-bromo', 'destination:mount-bromo', {
      operational: { elevation_m: 2329, difficulty: 'moderate', jeep_required: true },
    }),
    rec('route', 'surabaya-airport-to-bromo-area', 'route:surabaya-airport-to-bromo-area', {
      feasibility: 'validated',
      distance_km: 95,
      drive_time_min: 180,
    }),
  ],
  'knowledge-catalog-okf': [
    rec('package', 'bali/bromo-ijen-3d2n', 'package:bromo-ijen-3d2n', {
      profile: {
        title: 'Bromo & Ijen 3D2N from Bali',
        day_titles: [
          { day: 1, title: 'Bali pickup → Ijen base', meals: ['D'] },
          { day: 2, title: 'Ijen blue fire → Bromo', meals: ['B', 'L', 'D'] },
          { day: 3, title: 'Bromo sunrise → Madakaripura', meals: ['B'] },
        ],
      },
      module_refs: ['policy_booking_paths', 'policy_cancellation_package_credit', 'destination_ijen'],
    }),
    rec('general_module', 'policy_anti_fraud', 'general_module:policy-anti-fraud', {
      category: 'policy',
      scope: 'global',
      title: 'Anti-fraud & payment security',
      short_answer:
        'Pay only via the official website (Xendit), listed bank accounts, or a confirmed payment link. JVTO never asks for card/CVV/OTP over chat.',
      customer_visible: true,
    }),
  ],
  'design-system': [
    rec('page', '/', 'page:home', {
      content: { h1: 'Tourist Police-led private volcano tours', eyebrow: 'JVTO' },
      route: '/',
    }),
    rec('page', '/travel-guide/booking-information', 'page:travel-guide-booking-information', {
      content: { h1: 'Booking information', lede: 'A 20% deposit locks your vehicle and crew.' },
      route: '/travel-guide/booking-information',
    }),
  ],
  'canonical-facts': [
    rec('policy_document', 'canonical-facts', 'policy_document:cancellation-package-credit', {
      adjudicated_facts: {
        founding_year: 2015,
        deposit_percent: 20,
        cancellation_model: 'lifetime_package_credit',
        reviews: { trustpilot: '4.8/51', google: '4.9/123', tripadvisor: '4.95/21', cross_platform: '4.8/195' },
        ijen_health_screening: 'mandatory',
      },
    }),
  ],
};

function rec(entityType, externalKey, canonicalKey, payload) {
  return {
    source: '',
    releaseVersion: RELEASE_VERSION,
    externalKey,
    entityType,
    canonicalKey,
    payload,
    payloadSha256: payloadHash(payload),
  };
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const bundles = [];
for (const [source, records] of Object.entries(sources)) {
  const withSource = records.map((r) => ({ ...r, source }));
  const dir = path.join(outDir, source);
  fs.mkdirSync(dir, { recursive: true });
  const recordsJson = JSON.stringify(withSource, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, 'records.json'), recordsJson);
  const manifest = {
    source,
    version: RELEASE_VERSION,
    producedAt: PRODUCED_AT,
    schemaVersion: 1,
    files: [{ path: 'records.json', sha256: sha256Hex(recordsJson), recordCount: withSource.length }],
    metadata: { validation: 'passed' },
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  bundles.push({ manifest, files: { 'records.json': recordsJson }, records: withSource });
}

// ---- Golden publication manifest (deterministic ids/timestamps) ----
const registry = yaml.parse(fs.readFileSync(path.join(root, 'config/source-registry.yaml'), 'utf8'));
const ownership = yaml.parse(fs.readFileSync(path.join(root, 'config/field-ownership.yaml'), 'utf8'));
const authorityBySource = Object.fromEntries(registry.sources.map((s) => [s.code, s.authority_rank]));
const rules = ownership.rules.map((r) => ({
  entityType: r.entity_type,
  fieldPath: r.field_path,
  ownerSource: r.owner_source,
  writePolicy: r.write_policy,
  conflictPolicy: r.conflict_policy,
}));

const result = runConsolidation({
  bundles,
  rules,
  authorityBySource,
  actorId: 'fixture-actor',
  approverIds: ['fixture-approver'],
  publicationId: '00000000-0000-4000-8000-000000000001',
  publishedAt: PRODUCED_AT,
});

fs.writeFileSync(
  path.join(outDir, 'expected-publication.json'),
  JSON.stringify(result.publication, null, 2) + '\n',
);
fs.writeFileSync(
  path.join(outDir, 'expected-entities.json'),
  canonicalJson(result.entities.map((e) => ({ canonicalKey: e.canonicalKey, entityType: e.entityType, fields: Object.keys(e.fields).sort() }))) + '\n',
);

console.log(
  `Fixtures: ${bundles.length} sources, ${bundles.reduce((n, b) => n + b.records.length, 0)} records, ` +
    `${result.entities.length} entities, publication.passed=${result.publication.validation.passed}, ` +
    `conflicts=${result.conflicts.length}`,
);
