import { describe, expect, it } from 'vitest';
import { buildFilter, keywords, moveTo } from './jmap';

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
});
