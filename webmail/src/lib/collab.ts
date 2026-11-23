/**
 * Collaboration JMAP layer: calendars, contacts, Sieve, vacation and state push.
 * Everything goes through jmap.request(); no admin API, no extra credentials.
 */
import {
  accountId,
  authHeaderValue,
  fetchBlobText,
  getSession,
  request,
  resolveEndpoint,
  uploadTextBlob,
} from './jmap';

export const CALENDAR_USING = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:calendars',
];

export const CONTACTS_USING = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:contacts',
];

const SIEVE_USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:sieve'];
const VACATION_USING = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:vacationresponse'];
const PRINCIPAL_USING = ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'];

function failFrom(kind: string, failure: { description?: string; type?: string } | undefined): Error {
  return new Error(failure?.description || `${kind} rejected${failure?.type ? ` (${failure.type})` : ''}`);
}

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------

export interface CalCalendar {
  id: string;
  name: string;
  color?: string;
  isDefault?: boolean;
}

export interface EventParticipant {
  name?: string;
  email: string;
}

export interface EventRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  count?: number;
  until?: string;
}

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  /** Local date-time "2026-11-25T10:00:00", or a date "2026-11-25" when allDay. */
  start: string;
  /** ISO 8601 duration, e.g. "PT1H". */
  duration: string;
  timeZone?: string;
  allDay?: boolean;
  location?: string;
  participants: EventParticipant[];
  recurrence?: EventRecurrence;
}

export interface CalEventInput extends Omit<CalEvent, 'id' | 'calendarId'> {
  calendarId?: string;
}

interface JscEvent {
  id?: string;
  calendarIds?: Record<string, true>;
  title?: string;
  description?: string;
  start?: string;
  duration?: string;
  timeZone?: string;
  showWithoutTime?: boolean;
  status?: string;
  locations?: Record<string, { '@type'?: string; name?: string }>;
  participants?: Record<
    string,
    {
      '@type'?: string;
      name?: string;
      email?: string;
      roles?: Record<string, true>;
      participationStatus?: string;
    }
  >;
  recurrenceRules?: Array<{
    '@type'?: string;
    frequency?: string;
    interval?: number;
    count?: number;
    until?: string;
  }>;
  '@type'?: string;
}

export function toCalEvent(raw: JscEvent): CalEvent {
  const participants = Object.values(raw.participants ?? {})
    .filter((p) => p?.email)
    .map((p) => ({ name: p.name, email: p.email as string }));
  const location = Object.values(raw.locations ?? {})[0]?.name;
  const rule = raw.recurrenceRules?.[0];
  return {
    id: raw.id ?? '',
    calendarId: Object.keys(raw.calendarIds ?? {})[0] ?? '',
    title: raw.title || '(no title)',
    description: raw.description,
    start: raw.start ?? '',
    duration: raw.duration || 'PT1H',
    timeZone: raw.timeZone,
    allDay: Boolean(raw.showWithoutTime),
    location,
    participants,
    recurrence:
      rule && rule.frequency
        ? {
            frequency: rule.frequency as EventRecurrence['frequency'],
            interval: rule.interval,
            count: rule.count,
            until: rule.until,
          }
        : undefined,
  };
}

export function toJscEvent(input: CalEventInput): JscEvent {
  const participants: NonNullable<JscEvent['participants']> = {};
  input.participants.forEach((p, i) => {
    participants[`p${i + 1}`] = {
      '@type': 'Participant',
      name: p.name,
      email: p.email,
      roles: { attendee: true },
      participationStatus: 'needs-action',
    };
  });
  return {
    '@type': 'Event',
    title: input.title,
    start: input.start,
    duration: input.duration,
    timeZone: input.allDay ? undefined : input.timeZone,
    showWithoutTime: input.allDay || undefined,
    description: input.description || undefined,
    locations: input.location ? { l1: { '@type': 'Location', name: input.location } } : undefined,
    participants: Object.keys(participants).length > 0 ? participants : undefined,
    recurrenceRules: input.recurrence
      ? [
          {
            '@type': 'RecurrenceRule',
            frequency: input.recurrence.frequency,
            interval: input.recurrence.interval ?? 1,
            count: input.recurrence.count,
            until: input.recurrence.until,
          },
        ]
      : undefined,
    status: 'confirmed',
  };
}

export async function listCalendars(): Promise<CalCalendar[]> {
  const id = accountId(await getSession());
  const [res] = await request([['Calendar/get', { accountId: id }, '0']], CALENDAR_USING);
  return (res[1].list ?? [])
    .map((c: any) => ({
      id: c.id,
      name: c.name || 'Calendar',
      color: c.color,
      isDefault: Boolean(c.isDefault),
    }))
    .sort((a: CalCalendar, b: CalCalendar) => Number(b.isDefault) - Number(a.isDefault));
}

export async function defaultCalendarId(): Promise<string> {
  const calendars = await listCalendars();
  const found = calendars.find((c) => c.isDefault) ?? calendars[0];
  if (!found) throw new Error('No calendar available on this account');
  return found.id;
}

async function fetchEvents(): Promise<JscEvent[]> {
  const id = accountId(await getSession());
  const [, getRes] = await request(
    [
      ['CalendarEvent/query', { accountId: id }, '0'],
      [
        'CalendarEvent/get',
        {
          accountId: id,
          '#ids': { resultOf: '0', name: 'CalendarEvent/query', path: '/ids' },
          properties: [
            'id',
            'calendarIds',
            'title',
            'description',
            'start',
            'duration',
            'timeZone',
            'showWithoutTime',
            'locations',
            'participants',
            'recurrenceRules',
          ],
        },
        '1',
      ],
    ],
    CALENDAR_USING
  );
  return (getRes[1].list ?? []) as JscEvent[];
}

/** Stalwart rejects `inCalendars`, so calendars are always filtered client-side. */
export async function queryEvents(calendarId?: string, range?: { start: Date; end: Date }): Promise<CalEvent[]> {
  let events = (await fetchEvents()).map(toCalEvent);
  if (calendarId) events = events.filter((e) => !e.calendarId || e.calendarId === calendarId);
  if (range) {
    const from = range.start.getTime();
    const to = range.end.getTime();
    events = events.filter((e) => {
      const t = new Date(e.start).getTime();
      return Number.isNaN(t) ? true : t >= from && t <= to;
    });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export async function createEvent(input: CalEventInput): Promise<string> {
  const id = accountId(await getSession());
  const calendarId = input.calendarId || (await defaultCalendarId());
  const patch = { ...toJscEvent(input), calendarIds: { [calendarId]: true } };
  const [res] = await request(
    [['CalendarEvent/set', { accountId: id, create: { e1: patch } }, '0']],
    CALENDAR_USING
  );
  const created = res[1].created?.e1?.id as string | undefined;
  if (!created) throw failFrom('Event', res[1].notCreated?.e1);
  return created;
}

export async function updateEvent(eventId: string, patch: Partial<CalEventInput>): Promise<void> {
  const id = accountId(await getSession());
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.start !== undefined) update.start = patch.start;
  if (patch.duration !== undefined) update.duration = patch.duration;
  if (patch.description !== undefined) update.description = patch.description || null;
  if (patch.timeZone !== undefined) update.timeZone = patch.timeZone || null;
  if (patch.allDay !== undefined) update.showWithoutTime = patch.allDay;
  if (patch.location !== undefined) {
    update.locations = patch.location ? { l1: { '@type': 'Location', name: patch.location } } : null;
  }
  if (patch.participants !== undefined) {
    const participants: Record<string, EventParticipant & { '@type': string }> = {};
    patch.participants.forEach((p, i) => {
      participants[`p${i + 1}`] = { '@type': 'Participant', name: p.name, email: p.email };
    });
    update.participants = participants;
  }
  if (patch.recurrence !== undefined) {
    update.recurrenceRules = patch.recurrence
      ? [
          {
            '@type': 'RecurrenceRule',
            frequency: patch.recurrence.frequency,
            interval: patch.recurrence.interval ?? 1,
            count: patch.recurrence.count,
            until: patch.recurrence.until,
          },
        ]
      : null;
  }
  if (patch.calendarId) update.calendarIds = { [patch.calendarId]: true };
  if (Object.keys(update).length === 0) return;

  const [res] = await request(
    [['CalendarEvent/set', { accountId: id, update: { [eventId]: update } }, '0']],
    CALENDAR_USING
  );
  if (res[1].notUpdated?.[eventId]) throw failFrom('Event update', res[1].notUpdated[eventId]);
}

export async function deleteEvent(eventId: string): Promise<void> {
  const id = accountId(await getSession());
  const [res] = await request(
    [['CalendarEvent/set', { accountId: id, destroy: [eventId] }, '0']],
    CALENDAR_USING
  );
  if (res[1].notDestroyed?.[eventId]) throw failFrom('Event delete', res[1].notDestroyed[eventId]);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface AddressBook {
  id: string;
  name: string;
}

export interface Contact {
  id: string;
  addressBookId: string;
  fullName: string;
  givenName?: string;
  surname?: string;
  emails: string[];
  phones: string[];
  organization?: string;
  title?: string;
  notes?: string;
}

interface JsContact {
  '@type'?: string;
  id?: string;
  addressBookIds?: Record<string, true>;
  name?: {
    components?: Array<{ kind: string; value: string }>;
    full?: string;
    isOrdered?: boolean;
  };
  emails?: Record<string, { address?: string }>;
  phones?: Record<string, { number?: string }>;
  organizations?: Array<{ name?: string }> | Record<string, { name?: string }>;
  titles?: Array<{ name?: string; kind?: string }> | Record<string, { name?: string; kind?: string }>;
  notes?: Record<string, { note?: string }>;
  kind?: string;
}

export function toContact(raw: JsContact): Contact {
  const components = raw.name?.components ?? [];
  const givenName = components.find((c) => c.kind === 'given')?.value;
  const surname = components.find((c) => c.kind === 'surname')?.value;
  const fullName =
    raw.name?.full ||
    components.map((c) => c.value).join(' ').trim() ||
    [givenName, surname].filter(Boolean).join(' ') ||
    (raw.emails ? Object.values(raw.emails)[0]?.address : '') ||
    'Unnamed contact';
  const orgList = Array.isArray(raw.organizations)
    ? raw.organizations
    : Object.values((raw.organizations ?? {}) as Record<string, { name?: string }>);
  const titleList = Array.isArray(raw.titles)
    ? raw.titles
    : Object.values((raw.titles ?? {}) as Record<string, { name?: string }>);
  const notes = Object.values(raw.notes ?? {})
    .map((n) => n.note)
    .filter(Boolean)
    .join('\n');

  return {
    id: raw.id ?? '',
    addressBookId: Object.keys(raw.addressBookIds ?? {})[0] ?? '',
    fullName,
    givenName,
    surname,
    emails: Object.values(raw.emails ?? {})
      .map((e) => e.address)
      .filter((e): e is string => Boolean(e)),
    phones: Object.values(raw.phones ?? {})
      .map((p) => p.number)
      .filter((p): p is string => Boolean(p)),
    organization: orgList[0]?.name,
    title: titleList[0]?.name,
    notes: notes || undefined,
  };
}

export function toJsContact(contact: Omit<Contact, 'id' | 'addressBookId'>, addressBookId: string): JsContact {
  const emails: Record<string, { address: string; contexts: Record<string, true> }> = {};
  contact.emails.forEach((address, i) => {
    emails[`e${i + 1}`] = { address, contexts: { private: true } };
  });
  const phones: Record<string, { number: string; contexts: Record<string, true> }> = {};
  contact.phones.forEach((number, i) => {
    phones[`p${i + 1}`] = { number, contexts: { private: true } };
  });
  return {
    '@type': 'Card',
    kind: 'individual',
    addressBookIds: { [addressBookId]: true },
    name: {
      components: [
        ...(contact.givenName ? [{ kind: 'given', value: contact.givenName }] : []),
        ...(contact.surname ? [{ kind: 'surname', value: contact.surname }] : []),
        ...(!contact.givenName && !contact.surname && contact.fullName
          ? [{ kind: 'given', value: contact.fullName }]
          : []),
      ],
      isOrdered: true,
      full: contact.fullName,
    },
    emails: Object.keys(emails).length > 0 ? emails : undefined,
    phones: Object.keys(phones).length > 0 ? phones : undefined,
    organizations: contact.organization ? { o1: { name: contact.organization } } : undefined,
    titles: contact.title ? { t1: { name: contact.title, kind: 'title' } } : undefined,
    notes: contact.notes ? { n1: { note: contact.notes } } : undefined,
  };
}

export async function listAddressBooks(): Promise<AddressBook[]> {
  const id = accountId(await getSession());
  const [res] = await request([['AddressBook/get', { accountId: id }, '0']], CONTACTS_USING);
  return (res[1].list ?? []).map((b: any) => ({ id: b.id, name: b.name || 'Contacts' }));
}

export async function defaultAddressBookId(): Promise<string> {
  const books = await listAddressBooks();
  const found = books.find((b) => b.id.includes('default')) ?? books[0];
  if (!found) throw new Error('No address book available on this account');
  return found.id;
}

/**
 * Stalwart's ContactCard text filter only matches some fields (an email-only term
 * returns nothing), so the fetch is unfiltered and the query is matched locally.
 * ponytail: O(n) over the whole address book; move back to a server filter if books grow huge.
 */
export async function queryContacts(search?: string): Promise<Contact[]> {
  const id = accountId(await getSession());
  const [, getRes] = await request(
    [
      ['ContactCard/query', { accountId: id }, '0'],
      [
        'ContactCard/get',
        {
          accountId: id,
          '#ids': { resultOf: '0', name: 'ContactCard/query', path: '/ids' },
        },
        '1',
      ],
    ],
    CONTACTS_USING
  );
  const all = ((getRes[1].list ?? []) as JsContact[]).map(toContact);
  const term = search?.trim().toLowerCase();
  const matched = term
    ? all.filter(
        (c) =>
          c.fullName.toLowerCase().includes(term) ||
          c.emails.some((e) => e.toLowerCase().includes(term)) ||
          (c.organization ?? '').toLowerCase().includes(term) ||
          (c.notes ?? '').toLowerCase().includes(term)
      )
    : all;
  return matched.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function createContact(
  contact: Omit<Contact, 'id' | 'addressBookId'> & { addressBookId?: string }
): Promise<string> {
  const id = accountId(await getSession());
  const addressBookId = contact.addressBookId || (await defaultAddressBookId());
  const { addressBookId: _ignored, ...rest } = contact;
  const [res] = await request(
    [['ContactCard/set', { accountId: id, create: { c1: toJsContact(rest, addressBookId) } }, '0']],
    CONTACTS_USING
  );
  const created = res[1].created?.c1?.id as string | undefined;
  if (!created) throw failFrom('Contact', res[1].notCreated?.c1);
  return created;
}

export async function updateContact(contact: Contact): Promise<void> {
  const id = accountId(await getSession());
  const patch = toJsContact(contact, contact.addressBookId || (await defaultAddressBookId()));
  // Stalwart keeps old values when a property is omitted, so cleared fields must be nulled.
  const clearing: Record<string, null> = {};
  if (!contact.phones.length) clearing.phones = null;
  if (!contact.organization) clearing.organizations = null;
  if (!contact.title) clearing.titles = null;
  if (!contact.notes) clearing.notes = null;
  if (!contact.emails.length) clearing.emails = null;
  const [res] = await request(
    [
      [
        'ContactCard/set',
        { accountId: id, update: { [contact.id]: { ...patch, ...clearing } } },
        '0',
      ],
    ],
    CONTACTS_USING
  );
  if (res[1].notUpdated?.[contact.id]) throw failFrom('Contact update', res[1].notUpdated[contact.id]);
}

export async function deleteContact(id: string): Promise<void> {
  const account = accountId(await getSession());
  const [res] = await request(
    [['ContactCard/set', { accountId: account, destroy: [id] }, '0']],
    CONTACTS_USING
  );
  if (res[1].notDestroyed?.[id]) throw failFrom('Contact delete', res[1].notDestroyed[id]);
}

/** Autocomplete: catches every failure so a broken contacts server never blocks compose. */
export async function searchContacts(q: string): Promise<Contact[]> {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  try {
    return (await queryContacts(term)).filter((c) => c.emails.length > 0).slice(0, 8);
  } catch {
    return [];
  }
}

export async function findContactByEmail(email: string): Promise<Contact | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  try {
    const found = await queryContacts(target);
    return found.find((c) => c.emails.some((e) => e.toLowerCase() === target)) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sieve
// ---------------------------------------------------------------------------

export interface SieveScript {
  id: string;
  name: string;
  isActive: boolean;
}

interface RawSieveScript {
  id: string;
  name?: string;
  isActive?: boolean;
  blobId?: string;
}

async function rawSieveScripts(): Promise<RawSieveScript[]> {
  const id = accountId(await getSession());
  const [res] = await request([['SieveScript/get', { accountId: id }, '0']], SIEVE_USING);
  return (res[1].list ?? []) as RawSieveScript[];
}

export async function listSieveScripts(): Promise<SieveScript[]> {
  return (await rawSieveScripts()).map((s) => ({
    id: s.id,
    name: s.name || 'script',
    isActive: Boolean(s.isActive),
  }));
}

export async function getSieveScript(id: string): Promise<string> {
  const script = (await rawSieveScripts()).find((s) => s.id === id);
  if (!script?.blobId) throw new Error('Script has no stored content');
  return fetchBlobText(script.blobId, `${script.name || 'script'}.sieve`);
}

export async function saveSieveScript(name: string, content: string, id?: string): Promise<string> {
  const account = accountId(await getSession());
  const blob = await uploadTextBlob(`${name}.sieve`, content);
  const script = { name, blobId: blob.blobId };
  const [res] = await request(
    [
      [
        'SieveScript/set',
        id ? { accountId: account, update: { [id]: script } } : { accountId: account, create: { s1: script } },
        '0',
      ],
    ],
    SIEVE_USING
  );
  if (id) {
    if (res[1].notUpdated?.[id]) throw failFrom('Filter update', res[1].notUpdated[id]);
    return id;
  }
  const created = res[1].created?.s1?.id as string | undefined;
  if (!created) throw failFrom('Filter', res[1].notCreated?.s1);
  return created;
}

export async function deleteSieveScript(id: string): Promise<void> {
  const account = accountId(await getSession());
  // Stalwart refuses to delete the active script; deactivate first.
  try {
    await request([['SieveScript/set', { accountId: account, update: { [id]: { isActive: false } } }, '0']], SIEVE_USING);
  } catch {
    // Already inactive or unsupported; the destroy below decides.
  }
  const [res] = await request(
    [['SieveScript/set', { accountId: account, destroy: [id] }, '0']],
    SIEVE_USING
  );
  if (res[1].notDestroyed?.[id]) throw failFrom('Filter delete', res[1].notDestroyed[id]);
}

export async function setActiveSieveScript(id: string): Promise<void> {
  const account = accountId(await getSession());
  const [res] = await request(
    [['SieveScript/set', { accountId: account, update: { [id]: { isActive: true } } }, '0']],
    SIEVE_USING
  );
  if (res[1].notUpdated?.[id]) throw failFrom('Filter activation', res[1].notUpdated[id]);
}

// ---------------------------------------------------------------------------
// Vacation
// ---------------------------------------------------------------------------

export interface VacationSettings {
  isEnabled: boolean;
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  fromDate?: string;
  toDate?: string;
}

export async function getVacation(): Promise<VacationSettings> {
  const id = accountId(await getSession());
  const [res] = await request(
    [['VacationResponse/get', { accountId: id, ids: ['singleton'] }, '0']],
    VACATION_USING
  );
  const v = (res[1].list ?? [])[0] ?? {};
  return {
    isEnabled: Boolean(v.isEnabled),
    subject: v.subject || '',
    textBody: v.textBody || '',
    htmlBody: v.htmlBody || '',
    fromDate: v.fromDate,
    toDate: v.toDate,
  };
}

export async function setVacation(settings: VacationSettings): Promise<void> {
  const id = accountId(await getSession());
  const patch = {
    isEnabled: settings.isEnabled,
    subject: settings.subject || null,
    textBody: settings.textBody || null,
    htmlBody: settings.htmlBody || settings.textBody || null,
    fromDate: settings.fromDate || null,
    toDate: settings.toDate || null,
  };
  const [res] = await request(
    [
      [
        'VacationResponse/set',
        { accountId: id, update: { singleton: patch } },
        '0',
      ],
    ],
    VACATION_USING
  );
  if (res[1].notUpdated?.singleton) throw failFrom('Vacation responder', res[1].notUpdated.singleton);
}

/** Sieve source mirroring the vacation settings; kept simple so Stalwart always parses it. */
export function buildVacationSieve(settings: VacationSettings): string {
  const active = settings.isEnabled ? '' : '# disabled\n';
  const subject = (settings.subject || 'Out of office').replace(/["\\]/g, '\\$&');
  const message = (settings.textBody || 'I am currently out of the office.').replace(/["\\]/g, '\\$&');
  const dates: string[] = [];
  if (settings.fromDate) dates.push(`currentdate :value "ge" "date" "${settings.fromDate.slice(0, 10)}"`);
  if (settings.toDate) dates.push(`currentdate :value "le" "date" "${settings.toDate.slice(0, 10)}"`);
  const action = `vacation :days 1 :subject "${subject}" "${message}";`;
  if (!settings.isEnabled) {
    // A bare Sieve block without a test is invalid, and a leading comment alone
    // would leave the vacation action live — emit no action at all when disabled.
    return `require ["vacation", "date", "variables", "relational"];\n\n${active}# vacation responder disabled\n`;
  }
  if (dates.length === 0) {
    return `require ["vacation", "date", "variables", "relational"];\n\n${action}\n`;
  }
  return `require ["vacation", "date", "variables", "relational"];\n\nif allof(\n    ${dates.join(',\n    ')}\n) {\n    ${action}\n}\n`;
}

// ---------------------------------------------------------------------------
// Settings / identity
// ---------------------------------------------------------------------------

export interface IdentityInfo {
  id: string;
  name: string;
  email: string;
}

export async function getIdentity(): Promise<IdentityInfo | null> {
  const id = accountId(await getSession());
  const [res] = await request([['Identity/get', { accountId: id }, '0']]);
  const identity = (res[1].list ?? [])[0];
  if (!identity) return null;
  return { id: identity.id, name: identity.name || '', email: identity.email || '' };
}

export async function updateIdentityName(name: string): Promise<void> {
  const identity = await getIdentity();
  if (!identity) throw new Error('No sending identity configured');
  const id = accountId(await getSession());
  const [res] = await request([
    ['Identity/set', { accountId: id, update: { [identity.id]: { name } } }, '0'],
  ]);
  if (res[1].notUpdated?.[identity.id]) throw failFrom('Profile update', res[1].notUpdated[identity.id]);
}

/**
 * JMAP has no standard password change; Stalwart exposes the principal's secret on
 * Principal/set behind urn:stalwart:jmap. Surface the server's answer verbatim.
 */
export async function changePassword(newPassword: string): Promise<void> {
  const session = await getSession();
  const principalId =
    session.primaryAccounts?.['urn:stalwart:jmap'] ||
    session.primaryAccounts?.['urn:ietf:params:jmap:mail'] ||
    accountId(session);
  const [res] = await request(
    [
      [
        'Principal/set',
        { accountId: principalId, update: { [principalId]: { secret: newPassword } } },
        '0',
      ],
    ],
    PRINCIPAL_USING
  );
  const failure = res[1].notUpdated?.[principalId];
  if (failure) throw failFrom('Password change', failure);
}

// ---------------------------------------------------------------------------
// Push (SSE)
// ---------------------------------------------------------------------------

export interface StateChangePayload {
  '@type'?: string;
  changed?: Record<string, Record<string, string>>;
}

/** Extract the union of changed type names from a StateChange payload. */
export function changedTypes(payload: StateChangePayload): string[] {
  const types = new Set<string>();
  Object.values(payload.changed ?? {}).forEach((perAccount) => {
    Object.keys(perAccount ?? {}).forEach((type) => types.add(type));
  });
  return Array.from(types);
}

const PUSH_TYPES = ['Email', 'Mailbox', 'CalendarEvent', 'ContactCard', 'Thread'];
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30000;

/**
 * Live updates over the JMAP event-source endpoint. Native EventSource cannot set an
 * Authorization header, so the SSE stream is read manually from fetch().
 * Returns an unsubscribe function that aborts the stream and stops reconnecting.
 */
export function subscribeStateChanges(onChange: (types: string[]) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let retryMs = RECONNECT_MIN_MS;

  const buildUrl = (eventSourceUrl: string): string => {
    const base = resolveEndpoint(eventSourceUrl, '/jmap/eventsource/');
    const url = new URL(base, window.location.origin);
    url.searchParams.set('types', PUSH_TYPES.join(','));
    url.searchParams.set('closeafter', 'state');
    url.searchParams.set('ping', '30');
    return url.toString();
  };

  const dispatch = (block: string) => {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!data) return;
    try {
      const types = changedTypes(JSON.parse(data) as StateChangePayload);
      if (types.length > 0) onChange(types);
    } catch {
      // Ignore malformed keep-alive frames.
    }
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    controller = new AbortController();
    try {
      const session = await getSession();
      const eventSourceUrl = (session as { eventSourceUrl?: string }).eventSourceUrl || '/jmap/eventsource/';
      const res = await fetch(buildUrl(eventSourceUrl), {
        headers: { Authorization: authHeaderValue(), Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Push stream failed (${res.status})`);
      retryMs = RECONNECT_MIN_MS;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf('\n\n');
        while (split !== -1) {
          dispatch(buffer.slice(0, split));
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Network hiccup or abort: fall through to the backoff below.
    }
    if (stopped) return;
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    setTimeout(() => void connect(), wait);
  };

  void connect();

  return () => {
    stopped = true;
    controller?.abort();
  };
}
