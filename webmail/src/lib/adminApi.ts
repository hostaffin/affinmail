// Thin client for the AffinMail admin REST API (api/public/index.php).
// Token lives in sessionStorage only; never baked into the bundle.

const BASE = '/api/v1';
const TOKEN_KEY = 'affinmail_admin_token';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

interface FetchOpts {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

/** Calls the API, unwraps {status:'success',data}, throws Error(server message) otherwise. */
export async function apiFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok || payload?.status === 'error') {
    if (res.status === 401) clearToken();
    throw new Error(payload?.error || `HTTP ${res.status}`);
  }
  // Envelope-agnostic: the PHP API wrapped payloads in {data}, the Rust
  // backend returns them at the top level.
  return (payload?.data ?? payload) as T;
}

/* ---------------------------------------------------------------- types */

export interface Health {
  service: string;
  version: string;
  checks: { postgres: boolean; redis: boolean; stalwart: boolean };
}

export interface Domain {
  domain: string;
  maxMailboxes: number;
  diskQuotaMb: number;
  maxAttachmentMb: number;
  hostaffinServiceId: number | null;
  dkimSelector: string;
  dkimPublicKey: string;
  stalwartDomainId: string | null;
  isActive: boolean;
  assignedIpId: string | null;
  mailboxCount: number | null;
  catchAllAddress?: string | null;
  createdAt: string;
}

export interface Mailbox {
  id: string;
  email: string;
  displayName: string;
  quotaLimitMb: number;
  quotaUsedBytes: number;
  hourlyRateLimit: number;
  outboundRoute: string;
  status: string;
  domain: string | null;
  stalwartAccountId: string | null;
  createdAt: string;
}

export interface IpPool {
  id: string;
  ip_address: string;
  ip_version: number;
  pool_type: string;
  rdns_hostname: string;
  is_active: boolean;
  is_blacklisted: boolean;
  current_allocations: number;
  max_allocations: number;
  reputation_score: number;
  createdAt: string;
}

export interface StorageStatus {
  storage_type: string;
  local_path: string;
  used_bytes: number;
  total_bytes: number;
  free_bytes: number;
}

export interface BackupResult {
  file: string;
  path: string;
  size_bytes: number;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
  selector?: string;
  algorithm?: string;
}

export interface DnsResult {
  domain: string;
  records: DnsRecord[];
}

/* ---------------------------------------------------------------- helpers */

export const health = async (): Promise<Health> => {
  // Rust /health reports flat status strings instead of a checks object.
  const r = await apiFetch<Health & { database?: string; redis?: string; stalwart?: string; engine?: string; runtime?: string }>('/health');
  if (r?.checks) return r;
  return {
    service: r?.engine ?? 'AffinMail API',
    version: r?.runtime ?? '',
    checks: {
      postgres: r?.database === 'connected',
      redis: r?.redis === 'connected',
      stalwart: r?.stalwart === 'online',
    },
  };
};

export const listDomains = () => apiFetch<{ domains: Domain[]; count: number }>('/domains');

export const createDomain = (body: {
  domain: string;
  maxMailboxes?: number;
  diskQuotaMb?: number;
  maxAttachmentMb?: number;
}) => apiFetch<Domain>('/domains', { method: 'POST', body });

export const deleteDomain = (domain: string) =>
  apiFetch<{ deleted: string }>(`/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });

export const getDomainDns = (domain: string) =>
  apiFetch<DnsResult>(`/domains/${encodeURIComponent(domain)}/dns`);

export const listMailboxes = (domain?: string) =>
  apiFetch<{ mailboxes: Mailbox[]; count: number }>(
    domain ? `/mailboxes?domain=${encodeURIComponent(domain)}` : '/mailboxes'
  );

export const createMailbox = (body: {
  email: string;
  password: string;
  displayName?: string;
  quotaLimitMb?: number;
  hourlyRateLimit?: number;
  outboundRoute?: string;
}) => apiFetch<Mailbox>('/mailboxes', { method: 'POST', body });

export const setMailboxStatus = (email: string, status: 'active' | 'suspended') =>
  apiFetch<Mailbox>(`/mailboxes/${encodeURIComponent(email)}/status`, {
    method: 'PUT',
    body: { status },
  });

export const deleteMailbox = (email: string) =>
  apiFetch<{ deleted: string }>(`/mailboxes/${encodeURIComponent(email)}`, { method: 'DELETE' });

export const listIpPools = async (): Promise<{ ipPools: IpPool[]; count: number }> => {
  // Rust backend names the list ip_pools; the PHP API used ipPools.
  const r = await apiFetch<{ ipPools?: IpPool[]; ip_pools?: IpPool[]; count?: number }>('/ip-pools');
  const ipPools = r.ipPools ?? r.ip_pools ?? [];
  return { ipPools, count: r.count ?? ipPools.length };
};

export const createIpPool = (body: {
  ip_address: string;
  pool_type?: 'shared' | 'dedicated';
  rdns_hostname: string;
  max_allocations?: number;
}) => apiFetch<IpPool>('/ip-pools', { method: 'POST', body });

export const assignIpPool = (domain: string, ipAddress: string) =>
  apiFetch<{ domain: string; ipAddress: string }>('/ippools/assign', {
    method: 'POST',
    body: { domain, ip_address: ipAddress },
  });

export const getStorage = () => apiFetch<StorageStatus>('/storage');

export const triggerBackup = () =>
  apiFetch<BackupResult>('/system/backup', { method: 'POST' });

export const restartSystem = () =>
  apiFetch<{ restarting: string }>('/system/restart', { method: 'POST' });

/** Probe a candidate token against a cheap authenticated route. */
export async function validateToken(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/domains`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status === 200;
}

/* ------------------------------------------------- panel auth & SSO */

/** Sign in with the mail server's administrator (root) credentials. */
export async function adminLogin(
  username: string,
  password: string
): Promise<{ token: string; username: string }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || payload?.status === 'error') {
    throw new Error(payload?.error || `HTTP ${res.status}`);
  }
  const data = (payload.data ?? payload) as { token: string; username: string };
  setToken(data.token);
  return data;
}

export async function adminLogout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // session may already be gone; local sign-out proceeds regardless
  }
  clearToken();
}

/** Mint a one-time SSO link that opens the webmail as the given mailbox. */
export const createSsoLink = (email: string) =>
  apiFetch<{ ssoUrl: string; expiresAt: string }>('/auth/sso-token', {
    method: 'POST',
    body: { email },
  });

export const setMailboxQuota = (email: string, quotaLimitMb: number) =>
  apiFetch<Mailbox>(`/mailboxes/${encodeURIComponent(email)}/quota`, {
    method: 'PATCH',
    body: { quotaLimitMb },
  });

export const setMailboxPassword = (email: string, password: string) =>
  apiFetch<Mailbox | { email: string; passwordUpdated: boolean }>(
    `/mailboxes/${encodeURIComponent(email)}/password`,
    { method: 'PUT', body: { password } }
  );

/* ------------------------------------------------------------- aliases */

export interface Alias {
  id: string;
  source_address: string;
  destination_address: string;
  domain: string;
  isActive: boolean;
  createdAt: string;
}

export const listAliases = () => apiFetch<{ aliases: Alias[]; count: number }>('/aliases');

export const createAlias = (source: string, destination: string) =>
  apiFetch<Alias>('/aliases', { method: 'POST', body: { source, destination } });

export const deleteAlias = (id: string) =>
  apiFetch<{ deleted: string }>(`/aliases/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ------------------------------------------------------------- mail queue */

export interface QueuedMessage {
  id: string;
  [key: string]: unknown;
}

export const getQueue = async (): Promise<{ messages: QueuedMessage[]; count: number }> => {
  // Rust backend names the list queue; the PHP API used messages.
  const r = await apiFetch<{ messages?: QueuedMessage[]; queue?: QueuedMessage[]; count?: number }>('/queue');
  const messages = r.messages ?? r.queue ?? [];
  return { messages, count: r.count ?? messages.length };
};

export const deleteQueuedMessage = (id: string) =>
  apiFetch<{ deleted: string }>(`/queue/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const retryQueuedMessage = (id: string) =>
  apiFetch<{ retried: string }>(`/queue/${encodeURIComponent(id)}/retry`, { method: 'POST' });

/* ------------------------------------------------------- deliverability */

export interface DnsCheck {
  type: string;
  name: string;
  host: string;
  expected: string;
  published: boolean;
  found: string | null;
}

export interface DkimSignatureInfo {
  id: string | null;
  selector: string | null;
  algorithm: string;
  stage: string | null;
}

export interface Deliverability {
  domain: string;
  records: DnsRecord[];
  checks: DnsCheck[];
  signatures: DkimSignatureInfo[];
  catchAllAddress: string | null;
}

export const getDeliverability = (domain: string) =>
  apiFetch<Deliverability>(`/domains/${encodeURIComponent(domain)}/deliverability`);

export const setCatchAll = (domain: string, email: string | null) =>
  apiFetch<{ domain: string; catchAllAddress: string | null }>(
    `/domains/${encodeURIComponent(domain)}/catch-all`,
    { method: 'PUT', body: { email } }
  );

export const rotateDkim = (domain: string) =>
  apiFetch<{ domain: string; selector: string; record: DnsRecord }>(
    `/domains/${encodeURIComponent(domain)}/dkim-rotate`,
    { method: 'POST' }
  );

/* ---------------------------------------------------- tracking and logs */

export const trackMail = (q: string, hours: number) =>
  apiFetch<{ query: string; hours: number; count: number; lines: string[] }>(
    `/mail/track?q=${encodeURIComponent(q)}&hours=${hours}`
  );

export const getSystemLogs = (lines = 50) =>
  apiFetch<{ service: string; count: number; lines: string[] }>(`/system/logs?lines=${lines}`);

/* ------------------------------------------------------------- overview */

export interface DomainStorage {
  domain: string;
  mailboxes: number;
  usedBytes: number;
  quotaMb: number;
}

export interface TopMailbox {
  email: string;
  domain: string;
  usedBytes: number;
  quotaMb: number;
}

export interface MailDay {
  day: string;
  queued: number;
  delivered: number;
  failed: number;
  deferred: number;
  spam: number;
  rate: number | null;
}

export interface IpReputation {
  ip: string;
  score: number;
  blacklisted: boolean;
  listedNow: number;
  lastChecked: string | null;
}

export interface AdminStats {
  history: {
    mailDaily: MailDay[];
    queueSeries: { ts: string; queue: number | null; svc?: (number | null)[] }[];
    repSeries: { ts: string; score: number }[];
    uptime24h: Record<string, number | null>;
    ips: IpReputation[];
  };
  byDomain: DomainStorage[];
  topMailboxes: TopMailbox[];
  recentMailboxes: { email: string; domain: string; createdAt: string }[];
  recentDomains: { domain: string; createdAt: string }[];
  newMailboxes7d: number;
  queue: { count: number; items: QueuedMessage[] };
  server: {
    diskTotal: number;
    diskFree: number;
    memTotalKb: number;
    memAvailKb: number;
    load: number[];
    uptimeSec: number;
  };
  lastBackup: { file: string; sizeBytes: number; at: string } | null;
}

export const getStats = async (): Promise<AdminStats> => {
  // The Rust backend's /stats returns a different shape ({overview}); merge
  // over empty defaults so the Overview renders instead of crashing.
  const raw = await apiFetch<Partial<AdminStats>>('/stats');
  return {
    byDomain: [],
    topMailboxes: [],
    recentMailboxes: [],
    recentDomains: [],
    newMailboxes7d: 0,
    queue: { count: 0, items: [] },
    server: { diskTotal: 0, diskFree: 0, memTotalKb: 0, memAvailKb: 0, load: [0, 0, 0], uptimeSec: 0 },
    lastBackup: null,
    history: { mailDaily: [], queueSeries: [], repSeries: [], uptime24h: {}, ips: [] },
    ...raw,
  };
};
