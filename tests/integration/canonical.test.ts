import { describe, expect, it } from 'vitest';
import { normalizeSlug, resolveCanonicalKey, payloadHash } from '../../src/integration/canonical.js';

describe('canonical key resolution', () => {
  it('normalizes every JVTO package slug form to one slug', () => {
    expect(normalizeSlug('bromo-1d1n')).toBe('bromo-1d1n');
    expect(normalizeSlug('bali/bromo-ijen-3d2n')).toBe('bromo-ijen-3d2n');
    expect(normalizeSlug('tours/from-surabaya/bromo-1d1n')).toBe('bromo-1d1n');
    expect(normalizeSlug('SUB-3D2N-BROMO-IJEN')).toBe('sub-3d2n-bromo-ijen');
    expect(normalizeSlug('/#agung-sambuko')).toBe('agung-sambuko');
    expect(normalizeSlug('Kawah Ijen')).toBe('kawah-ijen');
  });

  it('trusts an explicit canonicalKey', () => {
    expect(resolveCanonicalKey('package', 'anything', 'package:bromo-1d1n')).toBe('package:bromo-1d1n');
  });

  it('derives <type>:<slug> when no explicit key or alias', () => {
    expect(resolveCanonicalKey('destination', 'mount-bromo', null)).toBe('destination:mount-bromo');
  });

  it('resolves cross-form aliases to the same canonical key', () => {
    const aliases = { 'bali/bromo-ijen-3d2n': 'package:bromo-ijen-3d2n' };
    expect(resolveCanonicalKey('package', 'bali/bromo-ijen-3d2n', null, aliases)).toBe(
      'package:bromo-ijen-3d2n',
    );
  });

  it('hashes payloads independent of key order', () => {
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});
