/**
 * Minimal JMAP client for Stalwart (RFC 8620/8621).
 * Credentials live only in sessionStorage; nothing is persisted beyond the tab.
 */

const AUTH_KEY = 'affinmail.auth';

const USING = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
  'urn:ietf:params:jmap:submission',
  'urn:ietf:params:jmap:quota',
];

export const MAX_ATTACHMENT_MB = 25;

export interface JmapAddress {
  name?: string | null;
  email: string;
}

export interface JmapSession {
  username: string;
  apiUrl: string;
  uploadUrl: string;
  downloadUrl: string;
  accounts: Record<string, { name: string; accountCapabilities: Record<string, unknown> }>;
  primaryAccounts: Record<string, string>;
  capabilities: Record<string, unknown>;
}

export interface JmapMailbox {
  id: string;
  name: string;
  role: string | null;
  parentId: string | null;
  totalEmails: number;
  unreadEmails: number;
}

export interface JmapEmail {
  id: string;
  threadId: string;
  subject: string | null;
  from: JmapAddress[] | null;
  to: JmapAddress[] | null;
  cc: JmapAddress[] | null;
  receivedAt: string;
  keywords: Record<string, true>;
  mailboxIds: Record<string, true>;
  preview: string;
  hasAttachment: boolean;
  attachments?: Array<{ blobId: string; type: string; name: string; size: number }>;
  bodyValues?: Record<string, { value: string; isTruncated?: boolean }>;
  textBody?: Array<{ partId: string; type: string }>;
  htmlBody?: Array<{ partId: string; type: string }>;
}

export interface JmapQuota {
  usedBytes: number;
  limitBytes: number;
}

export interface Credentials {
  email: string;
  basic: string; // base64(email:password)
}

export class JmapError extends Error {
  status: number;
  type?: string;
  constructor(message: string, status = 0, type?: string) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

let cachedSession: JmapSession | null = null;
let cachedIdentityId: string | null = null;

function encodeBasic(email: string, password: string): string {
  const bytes = new TextEncoder().encode(`${email}:${password}`);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function getAuth(): Credentials | null {
  const raw = sessionStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Credentials;
    return parsed.email && parsed.basic ? parsed : null;
  } catch {
    return null;
  }
}

function authHeader(): string {
  const auth = getAuth();
  if (!auth) throw new JmapError('Not signed in', 401);
  return `Basic ${auth.basic}`;
}

export function logout(): void {
  sessionStorage.removeItem(AUTH_KEY);
  cachedSession = null;
  cachedIdentityId = null;
}

/** Use session URLs only when same-origin; otherwise fall back to the same path locally/proxied. */
function endpoint(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin ? parsed.toString() : parsed.pathname + parsed.search;
  } catch {
    return fallback;
  }
}

function parseResponses(payload: any): any[] {
  const responses = payload?.methodResponses ?? [];
  return responses.map((r: any[]) => {
    if (r[0] === 'error') {
      throw new JmapError(r[1]?.description || r[1]?.type || 'JMAP error', 400, r[1]?.type);
    }
    return r;
  });
}

export async function getSession(): Promise<JmapSession> {
  if (cachedSession) return cachedSession;
  const res = await fetch('/jmap/session', {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new JmapError(res.status === 401 ? 'Invalid email or password' : `Session failed (${res.status})`, res.status);
  }
  cachedSession = (await res.json()) as JmapSession;
  return cachedSession;
}

export async function login(email: string, password: string): Promise<JmapSession> {
  const basic = encodeBasic(email.trim(), password);
  sessionStorage.setItem(AUTH_KEY, JSON.stringify({ email: email.trim(), basic }));
  try {
    cachedSession = null;
    cachedIdentityId = null;
    return await getSession();
  } catch (err) {
    logout();
    throw err;
  }
}

export function accountId(session: JmapSession): string {
  return session.primaryAccounts?.['urn:ietf:params:jmap:mail'] ?? Object.keys(session.accounts)[0];
}

export async function request(methodCalls: unknown[][]): Promise<any[]> {
  const session = await getSession();
  const res = await fetch(endpoint(session.apiUrl, '/jmap/'), {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ using: USING, methodCalls }),
  });
  if (!res.ok) {
    throw new JmapError(res.status === 401 ? 'Session expired' : `JMAP request failed (${res.status})`, res.status);
  }
  return parseResponses(await res.json());
}

/** Mailbox/get, plus lazy creation of an Archive mailbox when the server has none. */
export async function listMailboxes(): Promise<JmapMailbox[]> {
  const session = await getSession();
  const id = accountId(session);
  const [, getRes] = await request([['Mailbox/get', { accountId: id }, '0']]);
  let list = (getRes[1].list ?? []) as JmapMailbox[];
  if (!list.some((m) => m.role === 'archive')) {
    try {
      await request([
        ['Mailbox/set', { accountId: id, create: { archive: { name: 'Archive', role: 'archive' } } }, '0'],
      ]);
      const [, refreshed] = await request([['Mailbox/get', { accountId: id }, '0']]);
      list = (refreshed[1].list ?? []) as JmapMailbox[];
    } catch {
      // Archive is a convenience; if the server refuses, actions falling back to it just fail.
    }
  }
  return list;
}

export interface EmailQuery {
  mailboxId?: string;
  keyword?: string;
  text?: string;
  from?: string;
  to?: string;
  subject?: string;
  limit?: number;
}

const EMAIL_PROPERTIES = [
  'id',
  'threadId',
  'subject',
  'from',
  'to',
  'cc',
  'receivedAt',
  'keywords',
  'mailboxIds',
  'preview',
  'hasAttachment',
  'attachments',
];

export function buildFilter(q: EmailQuery): unknown {
  const conditions: unknown[] = [];
  if (q.mailboxId) conditions.push({ inMailbox: q.mailboxId });
  if (q.keyword) conditions.push({ hasKeyword: q.keyword });
  if (q.text) conditions.push({ text: q.text });
  if (q.from) conditions.push({ from: q.from });
  if (q.to) conditions.push({ to: q.to });
  if (q.subject) conditions.push({ subject: q.subject });
  if (conditions.length === 0) return null;
  return conditions.length === 1 ? conditions[0] : { operator: 'AND', conditions };
}

export async function queryEmails(q: EmailQuery = {}): Promise<JmapEmail[]> {
  const session = await getSession();
  const id = accountId(session);
  const filter = buildFilter(q);
  const queryArgs: Record<string, unknown> = {
    accountId: id,
    collapseThreads: true,
    sort: [{ property: 'receivedAt', isAscending: false }],
    limit: q.limit ?? 100,
  };
  if (filter) queryArgs.filter = filter;
  const [, getRes] = await request([
    ['Email/query', queryArgs, '0'],
    [
      'Email/get',
      {
        accountId: id,
        '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' },
        properties: EMAIL_PROPERTIES,
      },
      '1',
    ],
  ]);
  return (getRes[1].list ?? []) as JmapEmail[];
}

export async function getEmails(ids: string[]): Promise<JmapEmail[]> {
  if (ids.length === 0) return [];
  const session = await getSession();
  const [, getRes] = await request([
    [
      'Email/get',
      {
        accountId: accountId(session),
        ids,
        properties: [...EMAIL_PROPERTIES, 'bodyValues', 'textBody', 'htmlBody'],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
      },
      '0',
    ],
  ]);
  return (getRes[1].list ?? []) as JmapEmail[];
}

export function searchEmails(query: string): Promise<JmapEmail[]> {
  return queryEmails({ text: query.trim() || undefined });
}

/** All emails of a thread, oldest first, with body values (real conversation view). */
export async function getThreadEmails(threadId: string): Promise<JmapEmail[]> {
  const session = await getSession();
  const id = accountId(session);
  const [, getRes] = await request([
    ['Thread/get', { accountId: id, ids: [threadId] }, '0'],
    [
      'Email/get',
      {
        accountId: id,
        '#ids': { resultOf: '0', name: 'Thread/get', path: '/list/*/emailIds' },
        properties: [...EMAIL_PROPERTIES, 'bodyValues', 'textBody', 'htmlBody'],
        fetchTextBodyValues: true,
        fetchHTMLBodyValues: true,
      },
      '1',
    ],
  ]);
  const list = (getRes[1].list ?? []) as JmapEmail[];
  return list.slice().sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
}

/**
 * Email/set update patch, keyed by JMAP property path. Paths matter: sending a whole
 * `keywords` object replaces the set and would drop $draft/$flagged, so we always
 * patch individual members (`keywords/$seen`).
 */
export type EmailPatch = Record<string, true | null>;

export function keywords(changes: Record<string, boolean>): EmailPatch {
  const patch: EmailPatch = {};
  for (const [name, on] of Object.entries(changes)) patch[`keywords/${name}`] = on ? true : null;
  return patch;
}

/** Move to `target` and drop any other memberships listed in `from`. */
export function moveTo(target: string, from: string[] = []): EmailPatch {
  const patch: EmailPatch = { [`mailboxIds/${target}`]: true };
  for (const id of from) if (id !== target) patch[`mailboxIds/${id}`] = null;
  return patch;
}

export async function setEmail(emailId: string, patch: EmailPatch): Promise<void> {
  const session = await getSession();
  const [, res] = await request([['Email/set', { accountId: accountId(session), update: { [emailId]: patch } }, '0']]);
  const failure = res[1].notUpdated?.[emailId];
  if (failure) throw new JmapError(failure.description || 'Update rejected', 400, failure.type);
}

/** Quota/get; Stalwart returns an empty list when quotas are not enforced → null (widget hidden). */
export async function getQuota(): Promise<JmapQuota | null> {
  const session = await getSession();
  try {
    const [, res] = await request([['Quota/get', { accountId: accountId(session) }, '0']]);
    const quota = (res[1].list ?? [])[0];
    if (!quota || !quota.limit) return null;
    const used = quota.used ?? Math.max(0, (quota.limit ?? 0) - (quota.free ?? 0));
    return { usedBytes: used, limitBytes: quota.limit };
  } catch {
    return null;
  }
}

export interface UploadedBlob {
  blobId: string;
  type: string;
  size: number;
}

export async function uploadBlob(file: File): Promise<UploadedBlob> {
  const session = await getSession();
  const id = accountId(session);
  const substitution = (session.uploadUrl || `/jmap/upload/{accountId}/`).replace('{accountId}', id);
  const base = endpoint(substitution, `/jmap/upload/${id}/`);
  const res = await fetch(`${base.replace(/\/?$/, '/')}${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new JmapError(`Upload failed (${res.status})`, res.status);
  return (await res.json()) as UploadedBlob;
}

/** Download an attachment blob; link hrefs can't carry Basic auth, so fetch then save. */
export async function downloadBlob(blobId: string, name: string): Promise<void> {
  const session = await getSession();
  const id = accountId(session);
  const raw = (session.downloadUrl || '/jmap/download/{accountId}/{blobId}/{name}?accept={type}')
    .replace('{accountId}', id)
    .replace('{blobId}', encodeURIComponent(blobId))
    .replace('{name}', encodeURIComponent(name))
    .replace('{type}', 'application/octet-stream');
  const url = endpoint(raw, `/jmap/download/${id}/${encodeURIComponent(blobId)}/${encodeURIComponent(name)}`);
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new JmapError(`Download failed (${res.status})`, res.status);
  const objectUrl = URL.createObjectURL(await res.blob());
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

async function getIdentityId(): Promise<string> {
  if (cachedIdentityId) return cachedIdentityId;
  const session = await getSession();
  const [, res] = await request([['Identity/get', { accountId: accountId(session) }, '0']]);
  const identity = (res[1].list ?? [])[0];
  if (!identity?.id) throw new JmapError('No sending identity configured');
  cachedIdentityId = identity.id as string;
  return cachedIdentityId;
}

export interface ComposePayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments?: File[];
}

function addressList(raw?: string[]): JmapAddress[] {
  return (raw ?? []).map((e) => ({ email: e.trim() })).filter((a) => a.email);
}

async function buildEmailBody(payload: ComposePayload) {
  const attachments = [];
  for (const file of payload.attachments ?? []) {
    const blob = await uploadBlob(file);
    // Stalwart rejects an attachment carrying both partId and blobId; blob-only is correct for uploads.
    attachments.push({
      blobId: blob.blobId,
      size: blob.size,
      name: file.name,
      type: blob.type || file.type || 'application/octet-stream',
      disposition: 'attachment' as const,
    });
  }
  const fromEmail = (await getSession()).username;
  return {
    from: [{ name: fromEmail.split('@')[0], email: fromEmail }],
    to: addressList(payload.to),
    cc: addressList(payload.cc),
    bcc: addressList(payload.bcc),
    subject: payload.subject,
    bodyValues: { body: { value: payload.body } },
    textBody: [{ partId: 'body', type: 'text/plain' }],
    attachments,
  };
}

async function roleMailboxId(role: string): Promise<string> {
  const mailboxes = await listMailboxes();
  const found = mailboxes.find((m) => m.role === role);
  if (!found) throw new JmapError(`Mailbox with role "${role}" not found`);
  return found.id;
}

/** Send through JMAP: create in Drafts, submit, then move to Sent via onSuccessUpdateEmail. */
export async function createAndSubmit(payload: ComposePayload): Promise<string> {
  const session = await getSession();
  const id = accountId(session);
  const identityId = await getIdentityId();
  const draftsId = await roleMailboxId('drafts');
  const sentId = await roleMailboxId('sent');

  const email = await buildEmailBody(payload);
  const rcptTo = [...addressList(payload.to), ...addressList(payload.cc), ...addressList(payload.bcc)];

  const [, createRes] = await request([
    [
      'Email/set',
      {
        accountId: id,
        create: { draft: { ...email, mailboxIds: { [draftsId]: true }, keywords: { $draft: true } } },
      },
      '0',
    ],
  ]);
  const createdId = createRes[1].created?.draft?.id as string | undefined;
  if (!createdId) {
    const failure = createRes[1].notCreated?.draft;
    throw new JmapError(failure?.description || 'Could not create message', 400, failure?.type);
  }

  const [, submitRes] = await request([
    [
      'EmailSubmission/set',
      {
        accountId: id,
        create: {
          submit: {
            emailId: createdId,
            identityId,
            envelope: {
              mailFrom: { email: session.username },
              rcptTo: rcptTo.length > 0 ? rcptTo : [{ email: session.username }],
            },
          },
        },
        onSuccessUpdateEmail: {
          '#submit': {
            [`mailboxIds/${sentId}`]: true,
            [`mailboxIds/${draftsId}`]: null,
            'keywords/$draft': null,
          },
        },
      },
      '1',
    ],
  ]);
  const submitFailure = submitRes[1].notCreated?.submit;
  if (submitFailure) {
    throw new JmapError(submitFailure.description || 'Message submission failed', 400, submitFailure.type);
  }
  return createdId;
}

export async function discardDraft(draftId: string): Promise<void> {
  const session = await getSession();
  const [, res] = await request([['Email/set', { accountId: accountId(session), destroy: [draftId] }, '0']]);
  if (res[1].notDestroyed?.[draftId]) throw new JmapError('Could not discard draft');
}

/** Persist (or update) a draft server-side so it survives a reload. */
export async function saveDraft(payload: ComposePayload, draftId?: string): Promise<string> {
  const session = await getSession();
  const id = accountId(session);
  const draftsId = await roleMailboxId('drafts');
  const email = await buildEmailBody(payload);

  if (draftId) {
    // Stalwart rejects bodyValues on Email/set update, so replace the draft object.
    try {
      await request([['Email/set', { accountId: id, destroy: [draftId] }, '0']]);
    } catch {
      // Draft already gone; creating a fresh one is still correct.
    }
  }

  const [, res] = await request([
    [
      'Email/set',
      {
        accountId: id,
        create: { draft: { ...email, mailboxIds: { [draftsId]: true }, keywords: { $draft: true, $seen: true } } },
      },
      '0',
    ],
  ]);
  const createdId = res[1].created?.draft?.id as string | undefined;
  if (!createdId) {
    const failure = res[1].notCreated?.draft;
    throw new JmapError(failure?.description || 'Could not save draft', 400, failure?.type);
  }
  return createdId;
}
