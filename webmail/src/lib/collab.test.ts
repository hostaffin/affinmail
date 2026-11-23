import { describe, expect, it } from 'vitest';
import {
  buildVacationSieve,
  changedTypes,
  toCalEvent,
  toContact,
  toJsContact,
  toJscEvent,
  type Contact,
} from './collab';

describe('JSContact <-> Contact mapping', () => {
  const raw = {
    id: 'c1',
    addressBookIds: { book: true as const },
    name: {
      components: [
        { kind: 'given', value: 'Alice' },
        { kind: 'surname', value: 'Roy' },
      ],
      isOrdered: true,
    },
    emails: { e1: { address: 'alice@affinmail.local' } },
    phones: { p1: { number: '+8801000000000' } },
    organizations: [{ name: 'Affin' }],
    titles: [{ name: 'Engineer' }],
    notes: { n1: { note: 'met at conference' } },
    kind: 'individual',
  };

  it('reads name components, emails and phones', () => {
    const contact = toContact(raw);
    expect(contact.id).toBe('c1');
    expect(contact.addressBookId).toBe('book');
    expect(contact.fullName).toBe('Alice Roy');
    expect(contact.givenName).toBe('Alice');
    expect(contact.surname).toBe('Roy');
    expect(contact.emails).toEqual(['alice@affinmail.local']);
    expect(contact.phones).toEqual(['+8801000000000']);
    expect(contact.organization).toBe('Affin');
    expect(contact.title).toBe('Engineer');
    expect(contact.notes).toBe('met at conference');
  });

  it('falls back to full name or email when components are missing', () => {
    expect(toContact({ name: { full: 'Bob Smith' } }).fullName).toBe('Bob Smith');
    expect(toContact({ emails: { e1: { address: 'x@y.z' } } }).fullName).toBe('x@y.z');
  });

  it('writes components + email dict back', () => {
    const contact: Contact = {
      id: 'c1',
      addressBookId: 'book',
      fullName: 'Alice Roy',
      givenName: 'Alice',
      surname: 'Roy',
      emails: ['alice@affinmail.local'],
      phones: ['123'],
      organization: 'Affin',
      title: 'Engineer',
      notes: 'hi',
    };
    const jsc = toJsContact(contact, 'book');
    expect(jsc.addressBookIds).toEqual({ book: true });
    expect(jsc.name?.components).toEqual([
      { kind: 'given', value: 'Alice' },
      { kind: 'surname', value: 'Roy' },
    ]);
    expect(jsc.emails?.e1.address).toBe('alice@affinmail.local');
    expect(jsc.phones?.p1.number).toBe('123');
    expect((jsc.organizations as Record<string, { name?: string }>).o1.name).toBe('Affin');
    expect(jsc.kind).toBe('individual');
  });
});

describe('JSCalendar <-> CalEvent mapping', () => {
  it('reads an event', () => {
    const event = toCalEvent({
      id: 'ev1',
      calendarIds: { cal: true },
      title: 'Standup',
      start: '2026-11-25T10:00:00',
      duration: 'PT30M',
      timeZone: 'Asia/Dhaka',
      locations: { l1: { name: 'Room 1' } },
      participants: { p1: { name: 'Bob', email: 'bob@affinmail.local' } },
      recurrenceRules: [{ frequency: 'weekly', interval: 1, count: 4 }],
    });
    expect(event.calendarId).toBe('cal');
    expect(event.start).toBe('2026-11-25T10:00:00');
    expect(event.duration).toBe('PT30M');
    expect(event.location).toBe('Room 1');
    expect(event.participants).toEqual([{ name: 'Bob', email: 'bob@affinmail.local' }]);
    expect(event.recurrence).toEqual({ frequency: 'weekly', interval: 1, count: 4, until: undefined });
  });

  it('writes an event with local time, duration and recurrence', () => {
    const jsc = toJscEvent({
      title: 'Standup',
      start: '2026-11-25T10:00:00',
      duration: 'PT1H',
      timeZone: 'Asia/Dhaka',
      participants: [{ email: 'bob@affinmail.local' }],
      recurrence: { frequency: 'weekly', count: 4 },
    });
    expect(jsc['@type']).toBe('Event');
    expect(jsc.start).toBe('2026-11-25T10:00:00');
    expect(jsc.duration).toBe('PT1H');
    expect(jsc.timeZone).toBe('Asia/Dhaka');
    expect(jsc.participants?.p1.email).toBe('bob@affinmail.local');
    expect(jsc.recurrenceRules?.[0].frequency).toBe('weekly');
    expect(jsc.recurrenceRules?.[0].count).toBe(4);
  });
});

describe('vacation sieve builder', () => {
  it('includes the vacation action and escapes quotes', () => {
    const script = buildVacationSieve({ isEnabled: true, subject: 'Away "soon"', textBody: 'Back later' });
    expect(script).toContain('require ["vacation"');
    expect(script).toContain('vacation :days 1');
    expect(script).toContain('Away \\"soon\\"');
    expect(script).not.toContain('# disabled');
  });

  it('comments the block out when disabled', () => {
    expect(buildVacationSieve({ isEnabled: false })).toContain('# disabled');
  });
});

describe('push payload parsing', () => {
  it('extracts changed type names across accounts', () => {
    expect(
      changedTypes({ changed: { a: { Email: '1', Mailbox: '2' }, b: { CalendarEvent: '3' } } })
    ).toEqual(['Email', 'Mailbox', 'CalendarEvent']);
    expect(changedTypes({})).toEqual([]);
  });
});
