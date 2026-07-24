// src/resolvePage.ts — the headless resolver.
//
// resolvePage(route): find the page (following redirects) -> load ordered
// page_sections (via the page_render view) -> hydrate entity_refs from the
// entities table -> strip private fields (reused from the integration engine) ->
// run the facts-lock scan -> attach JSON-LD per page_type.
//
// Returns exactly { page, seo, sections, jsonld }.

import { query } from './db.js';
import { isPrivateField } from './integration/project.js';

// ── Public shapes ─────────────────────────────────────────────────────────────

export interface Entity {
  entity_type: string;
  canonical_key: string;
  slug: string | null;
  title: string | null;
  data: Record<string, unknown>;
  source: string | null;
  editable: boolean;
}

export interface HydratedSection {
  type: string;
  variant: string | null;
  content: Record<string, unknown>;
  entities: Entity[]; // hydrated, in entity_refs order
}

export interface ResolvedPage {
  page: {
    route: string;
    file_group: string;
    sort_order: number;
    cluster: string | null;
    page_type: string;
    visual_mode: string | null;
    hub_route: string | null;
    title: string | null;
    h1: string | null;
  };
  seo: Record<string, unknown>; // pages.seo jsonb — { title } in the current seed
  sections: HydratedSection[];
  jsonld: Record<string, unknown>;
}

// ── DB row shapes (jsonb arrives already parsed by pg — never JSON.parse) ──────

interface PageRenderRow {
  route: string;
  file_group: string;
  sort_order: number;
  cluster: string | null;
  page_type: string;
  visual_mode: string | null;
  hub_route: string | null;
  title: string | null;
  h1: string | null;
  seo: Record<string, unknown> | null;
  sections: Array<{
    sort_order: number;
    type: string;
    variant: string | null;
    content: Record<string, unknown> | null;
    entity_refs: string[];
    asset_refs: string[];
  }> | null;
}

export interface EntityRow {
  entity_type: string;
  canonical_key: string;
  slug: string | null;
  title: string | null;
  data: Record<string, unknown> | null;
  source: string | null;
  editable: boolean;
}

// ── Route normalization ───────────────────────────────────────────────────────

/**
 * Normalize a request path to the stored `route` form: leading slash, collapsed
 * duplicate slashes, no trailing slash (except root). Keeps the FULL multi-segment
 * path — do NOT use normalizeSlug here (it collapses to the last segment).
 */
export function normalizeRoute(raw: string): string {
  let r = raw.trim();
  if (!r.startsWith('/')) r = '/' + r;
  r = r.replace(/\/{2,}/g, '/');
  if (r.length > 1) r = r.replace(/\/+$/, '');
  return r;
}

// ── Page lookup with redirect-following ───────────────────────────────────────

async function followToPage(route: string): Promise<PageRenderRow | null> {
  const seen = new Set<string>();
  let current = route;
  for (let hop = 0; hop < 10; hop++) {
    if (seen.has(current)) return null; // redirect cycle
    seen.add(current);

    const page = await query<PageRenderRow>('SELECT * FROM page_render WHERE route = $1', [current]);
    const row = page.rows[0];
    if (row) return row;

    const redirect = await query<{ to_path: string }>(
      'SELECT to_path FROM redirects WHERE from_path = $1',
      [current],
    );
    const next = redirect.rows[0];
    if (!next) return null; // no page and no redirect
    current = normalizeRoute(next.to_path);
  }
  return null; // exceeded hop budget
}

// ── Private-field strip (reuse integration engine; shallow, mirrors project.ts) ─

function stripPrivate(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!isPrivateField(key)) out[key] = value;
  }
  return out;
}

/** Map a DB entity row to a public Entity (private fields stripped). Reused by server.ts. */
export function toPublicEntity(row: EntityRow): Entity {
  return {
    entity_type: row.entity_type,
    canonical_key: row.canonical_key,
    slug: row.slug,
    title: row.title,
    data: stripPrivate(row.data ?? {}),
    source: row.source,
    editable: row.editable,
  };
}

// ── Facts-lock scan ───────────────────────────────────────────────────────────
//
// Scan the customer-VISIBLE display corpus against governance_facts.forbidden_values.
// Governance/technical fields (summary, adjudicated_facts, decision_matrix, contact
// facts, …) are deliberately EXCLUDED: the clean seed legitimately references
// forbidden strings there as meta (e.g. cancellation_naming notes it "supersedes the
// retired 'Travel Credit'"). Only what a visitor actually reads is enforced.

const DISPLAY_FIELDS = [
  'title',
  'name',
  'question',
  'answer',
  'short_answer',
  'narrative',
  'headline',
  'excerpt',
  'canonical_wording',
];

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  }
}

export function buildScanCorpus(
  page: ResolvedPage['page'],
  seo: Record<string, unknown>,
  sections: HydratedSection[],
): string[] {
  const corpus: string[] = [];
  for (const v of [page.title, page.h1, seo['title']]) {
    if (typeof v === 'string') corpus.push(v);
  }
  for (const section of sections) {
    collectStrings(section.content, corpus);
    for (const entity of section.entities) {
      if (typeof entity.title === 'string') corpus.push(entity.title);
      for (const field of DISPLAY_FIELDS) {
        const val = entity.data[field];
        if (typeof val === 'string') corpus.push(val);
      }
      // customer-facing prose block, if present
      const cc = entity.data['customer_copy'];
      if (cc && typeof cc === 'object') collectStrings(cc, corpus);
    }
  }
  return corpus;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Return the forbidden terms that appear in the corpus (empty = clean). */
export function findFactsLockViolations(corpus: string[], forbidden: string[]): string[] {
  const hits: string[] = [];
  for (const term of forbidden) {
    if (!term) continue;
    const alnumOnly = /^[a-z0-9]+$/i.test(term);
    const re = alnumOnly
      ? new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i')
      : new RegExp(escapeRegExp(term), 'i');
    for (const text of corpus) {
      if (re.test(text)) {
        hits.push(`${term} :: ${text.slice(0, 80)}`);
        break;
      }
    }
  }
  return hits;
}

/** Load and flatten governance_facts.forbidden_values into a single denylist. */
export async function loadForbiddenValues(): Promise<string[]> {
  const { rows } = await query<{ value: Record<string, string[]> }>(
    "SELECT value FROM governance_facts WHERE key = 'forbidden_values'",
  );
  const value = rows[0]?.value ?? {};
  const flat = Object.values(value).flat().filter((t): t is string => typeof t === 'string');
  return [...new Set(flat)];
}

// ── JSON-LD builders (schema.org, one shape per page_type) ─────────────────────

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

const PROVIDER = { '@type': 'TravelAgency', name: 'Java Volcano Tour Operator' };

function destinationName(d: Entity): string {
  return asString(d.data['name']) ?? d.title ?? d.canonical_key;
}

function buildJsonLd(
  page: ResolvedPage['page'],
  entities: Entity[],
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@id': `${page.route}#page`,
  };
  const byType = (t: string): Entity[] => entities.filter((e) => e.entity_type === t);
  const name = page.title ?? page.h1 ?? page.route;

  switch (page.page_type) {
    case 'tour': {
      const pkg = byType('package')[0];
      const destinations = byType('destination');
      const profile = asObject(pkg?.data['profile']);
      const jsonld: Record<string, unknown> = {
        ...base,
        '@type': 'TouristTrip',
        name: pkg?.title ?? name,
        url: page.route,
        touristType: 'Private volcano tour',
        provider: PROVIDER,
      };
      const description = asString(profile?.['description']);
      if (description) jsonld['description'] = description;
      const dayTitles = asArray(profile?.['day_titles']);
      if (dayTitles && dayTitles.length > 0) {
        jsonld['itinerary'] = {
          '@type': 'ItemList',
          numberOfItems: dayTitles.length,
          itemListElement: dayTitles.map((d, i) => {
            const o = asObject(d);
            const day = typeof o?.['day'] === 'number' ? (o['day'] as number) : i + 1;
            return { '@type': 'ListItem', position: day, name: asString(o?.['title']) ?? `Day ${day}` };
          }),
        };
      }
      if (destinations.length > 0) {
        jsonld['subjectOf'] = destinations.map((d) => {
          const attraction: Record<string, unknown> = { '@type': 'TouristAttraction', name: destinationName(d) };
          if (d.slug) attraction['url'] = `/destinations/${d.slug}`;
          return attraction;
        });
      }
      return jsonld;
    }

    case 'destination': {
      const dest = byType('destination')[0];
      const jsonld: Record<string, unknown> = {
        ...base,
        '@type': 'TouristAttraction',
        name: dest ? destinationName(dest) : name,
        touristType: 'Volcano / nature',
      };
      const narrative = asString(dest?.data['narrative']);
      if (narrative) jsonld['description'] = narrative;
      const elevation = dest?.data['elevation_m'];
      if (typeof elevation === 'number') {
        jsonld['geo'] = { '@type': 'GeoCoordinates', elevation };
      }
      return jsonld;
    }

    case 'faq': {
      const faqs = byType('faq');
      const mainEntity: Array<Record<string, unknown>> = [];
      for (const f of faqs) {
        const q = asString(f.data['question']) ?? f.title;
        const a = asString(f.data['answer']) ?? asString(f.data['short_answer']);
        if (q && a) {
          mainEntity.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
        }
      }
      return { ...base, '@type': 'FAQPage', name, mainEntity };
    }

    case 'homepage':
      return {
        ...base,
        '@type': 'WebSite',
        name,
        url: '/',
        publisher: PROVIDER,
      };

    case 'hub': {
      const packages = byType('package');
      const jsonld: Record<string, unknown> = { ...base, '@type': 'CollectionPage', name };
      if (packages.length > 0) {
        jsonld['hasPart'] = packages.map((p) => {
          const part: Record<string, unknown> = { '@type': 'TouristTrip', name: p.title ?? p.canonical_key };
          const url = asString(p.data['public_url']);
          if (url) part['url'] = url;
          return part;
        });
      }
      return jsonld;
    }

    case 'travel_guide': {
      // Health/screening guides are medical protocol pages (existing precedent).
      if (/ijen-health|health-screening/.test(page.route)) {
        return {
          ...base,
          '@type': 'MedicalWebPage',
          name,
          about: { '@type': 'MedicalCondition', name: 'Altitude and sulfur-gas exposure' },
          audience: { '@type': 'MedicalAudience', audienceType: 'Patient' },
        };
      }
      return { ...base, '@type': 'Article', headline: name };
    }

    case 'narrative':
      return { ...base, '@type': 'Article', headline: name };

    case 'blog':
      return { ...base, '@type': 'BlogPosting', headline: name };

    case 'contact':
      return { ...base, '@type': 'ContactPage', name, about: PROVIDER };

    case 'verify':
    case 'policy':
    default:
      return { ...base, '@type': 'WebPage', name };
  }
}

// ── Resolver ──────────────────────────────────────────────────────────────────

export async function resolvePage(route: string): Promise<ResolvedPage | null> {
  const target = await followToPage(normalizeRoute(route));
  if (!target) return null;

  const rawSections = (target.sections ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  // Hydrate every entity_ref across the page's sections in a single query.
  const refKeys = [...new Set(rawSections.flatMap((s) => s.entity_refs))];
  const entityMap = new Map<string, Entity>();
  if (refKeys.length > 0) {
    const { rows } = await query<EntityRow>(
      `SELECT entity_type, canonical_key, slug, title, data, source, editable
         FROM entities WHERE canonical_key = ANY($1)`,
      [refKeys],
    );
    for (const row of rows) entityMap.set(row.canonical_key, toPublicEntity(row));
  }

  const sections: HydratedSection[] = rawSections.map((s) => {
    const entities = s.entity_refs.map((key) => {
      const entity = entityMap.get(key);
      if (!entity) {
        throw new Error(`Dangling entity_ref on ${target.route}: "${key}" resolves to no entity`);
      }
      return entity;
    });
    return { type: s.type, variant: s.variant, content: s.content ?? {}, entities };
  });

  const page: ResolvedPage['page'] = {
    route: target.route,
    file_group: target.file_group,
    sort_order: target.sort_order,
    cluster: target.cluster,
    page_type: target.page_type,
    visual_mode: target.visual_mode,
    hub_route: target.hub_route,
    title: target.title,
    h1: target.h1,
  };
  const seo: Record<string, unknown> = target.seo ?? {};

  // Facts-lock governance scan (monitor, non-fatal — the read API stays up).
  const violations = findFactsLockViolations(
    buildScanCorpus(page, seo, sections),
    await loadForbiddenValues(),
  );
  if (violations.length > 0) {
    console.warn(`[facts-lock] ${target.route}: ${violations.join(' | ')}`);
  }

  const jsonld = buildJsonLd(page, [...entityMap.values()]);

  return { page, seo, sections, jsonld };
}
