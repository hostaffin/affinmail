import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildFilter, keywords, moveTo, resolveEndpoint } from './jmap';

describe('JMAP query/filter building', () => {
  it('omits filter when empty', () => {
    expect(buildFilter({})).toBeNull();
  });

  it('unwraps a single condition', () => {
    expect(buildFilter({ mailboxId: 'a' })).toEqual({ inMailbox: 'a' });
  });

  it('ANDs multiple conditions', () => {
    expect(buildFilter({ mailboxId: 'a', keyword: '$flagged', text: 'x' })).toEqual({
      operator: 'AND',
      conditions: [{ inMailbox: 'a' }, { hasKeyword: '$flagged' }, { text: 'x' }],
    });
  });
});

describe('Email/set path patches', () => {
  it('patches keywords by path so other keywords survive', () => {
    expect(keywords({ $seen: true, $snoozed: false })).toEqual({
      'keywords/$seen': true,
      'keywords/$snoozed': null,
    });
  });

  it('moves without re-adding the target twice', () => {
    expect(moveTo('e', ['a', 'e'])).toEqual({ 'mailboxIds/e': true, 'mailboxIds/a': null });
  });

  it('removes all listed memberships when moving with no overlap', () => {
    expect(moveTo('b', ['a', 'c'])).toEqual({
      'mailboxIds/b': true,
      'mailboxIds/a': null,
      'mailboxIds/c': null,
    });
  });

  it('handles an empty source list', () => {
    expect(moveTo('inbox')).toEqual({ 'mailboxIds/inbox': true });
    expect(moveTo('inbox', [])).toEqual({ 'mailboxIds/inbox': true });
  });

  it('adds every keyword and maps false to a null removal', () => {
    expect(keywords({ $flagged: true, $seen: true, $snoozed: false })).toEqual({
      'keywords/$flagged': true,
      'keywords/$seen': true,
      'keywords/$snoozed': null,
    });
  });

  it('returns an empty patch for no keyword changes', () => {
    expect(keywords({})).toEqual({});
  });
});

describe('resolveEndpoint', () => {
  const origin = 'http://localhost:4173';
  vi.stubGlobal('window', { location: { origin } });
  afterAll(() => vi.unstubAllGlobals());

  it('falls back when the session URL is missing', () => {
    expect(resolveEndpoint(undefined, '/jmap/')).toBe('/jmap/');
  });

  it('keeps a same-origin URL absolute', () => {
    expect(resolveEndpoint(`${origin}/jmap/`, '/jmap/')).toBe(`${origin}/jmap/`);
  });

  it('reduces a cross-origin URL to its path so it routes through our proxy', () => {
    expect(resolveEndpoint('https://mail.example.com/jmap/?x=1', '/jmap/')).toBe('/jmap/?x=1');
  });

  it('falls back on an unparseable URL', () => {
    expect(resolveEndpoint('http://[::1', '/jmap/')).toBe('/jmap/');
  });
});
