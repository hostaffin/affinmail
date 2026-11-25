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

/** The Rust API returns snake_case domain rows; normalize them onto the
 *  camelCase Domain contract the panels consume. */
function normalizeDomain(d: Record<string, unknown>): Domain {
  const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v) : (v as number);
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  return {
    domain: (d.domain_name as string) ?? (d.domain as string) ?? '',
    maxMailboxes: num(d.max_mailboxes ?? d.maxMailboxes) ?? 0,
    diskQuotaMb: num(d.disk_quota_mb ?? d.diskQuotaMb) ?? 0,
    maxAttachmentMb: num(d.max_attachment_size_mb ?? d.max_attachment_mb ?? d.maxAttachmentMb) ?? 0,
    hostaffinServiceId: num(d.hostaffin_service_id ?? d.hostaffinServiceId),
    dkimSelector: (d.dkim_selector as string) ?? (d.dkimSelector as string) ?? '',
    dkimPublicKey: (d.dkim_public_key as string) ?? (d.dkimPublicKey as string) ?? '',
    stalwartDomainId:
      (d.stalwart_domain_id as string) ?? (d.account_id as string) ?? (d.stalwartDomainId as string) ?? null,
    isActive:
      typeof d.status === 'string' ? d.status === 'active' : ((d.isActive as boolean) ?? true),
    assignedIpId: (d.assigned_ip_id as string) ?? (d.assignedIpId as string) ?? null,
    mailboxCount: num(d.mailbox_count ?? d.mailboxCount),
    catchAllAddress: (d.catch_all_address as string) ?? (d.catchAllAddress as string) ?? null,
    createdAt: (d.created_at as string) ?? (d.createdAt as string) ?? '',
  };
}

export const listDomains = async (): Promise<{ domains: Domain[]; count: number }> => {
  const r = await apiFetch<{ domains?: Record<string, unknown>[]; count?: number }>('/domains');
  const domains = Array.isArray(r?.domains) ? r.domains.map(normalizeDomain) : [];
  return { domains, count: r?.count ?? domains.length };
};

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
    tls?: { version: string; connections: number }[];
    rblEvents?: { ip: string; provider: string; listedAt: string; lastSeen: string; checks: number }[];
  };
  warmups?: {
    id: string;
    domain: string;
    ip: string;
    day: number;
    dailyLimit: number;
    sentToday: number;
    completed: boolean;
    updatedAt: string;
  }[];
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

/* ------------------------------------------- Module A + B extensions */

export interface ServerNode {
  id: string;
  hostname: string;
  primaryIp: string;
  location: string;
  role: string;
  status: string;
  group: string;
  isLocal: boolean;
  remoteConfigured: boolean;
  health: {
    services: { stalwart: boolean; redis: boolean; postgres: boolean };
    diskTotal: number;
    diskFree: number;
    load: number[];
    uptimeSec: number;
  } | null;
}

export const listServers = () =>
  apiFetch<{ servers: ServerNode[]; count: number }>('/servers');

export const createServer = (body: {
  hostname: string;
  primary_ip: string;
  location?: string;
  role?: string;
  group?: string;
}) => apiFetch<{ server: ServerNode; note: string }>('/servers', { method: 'POST', body });

export const setServerStatus = (id: string, status: string) =>
  apiFetch<{ server: ServerNode }>(`/servers/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    body: { status },
  });

export interface Warmup {
  id: string;
  domain: string;
  ip: string;
  day: number;
  dailyLimit: number;
  sentToday: number;
  completed: boolean;
  paused?: boolean;
  throttledNow?: boolean;
  updatedAt?: string;
}

export const listWarmups = () => apiFetch<{ warmups: Warmup[]; count: number }>('/warmup');

export const startWarmup = (body: {
  domain: string;
  ip_address: string;
  plan?: 'conservative' | 'standard' | 'aggressive';
}) => apiFetch<Record<string, unknown>>('/warmup/start', { method: 'POST', body });

export const pauseWarmup = (id: string) =>
  apiFetch<{ paused: boolean }>(`/warmup/${encodeURIComponent(id)}/pause`, { method: 'POST' });

export const resumeWarmup = (id: string) =>
  apiFetch<{ paused: boolean }>(`/warmup/${encodeURIComponent(id)}/resume`, { method: 'POST' });

export interface RotationPool {
  pool: string;
  poolName: string;
  ips: string[];
  strategy: string;
  note?: string;
}

export const getRotation = () => apiFetch<{ pools: RotationPool[] }>('/rotation');

export const setRotation = (body: { pool?: string; strategy: string }) =>
  apiFetch<RotationPool & { status: string; note: string }>('/rotation', { method: 'POST', body });

export const pickRotation = (body: { sender_domain: string; pool?: string; strategy?: string }) =>
  apiFetch<{ senderDomain: string; ip: string; strategy: string }>('/rotation/pick', {
    method: 'POST',
    body,
  });

export interface IpDetail {
  ip: string;
  type: string;
  rdns: string;
  blacklisted: boolean;
  score: number;
  allocations: number;
  maxAllocations: number;
  domains: number;
  listedNow: number;
}

export const listIps = () => apiFetch<{ ips: IpDetail[]; count: number }>('/ips');

export const assignIpToDomain = (domain: string, ip_address: string) =>
  apiFetch<{ status: string; domain: string; ipAddress: string; previousDomainsOnIp: number }>(
    '/ippools/assign',
    { method: 'PUT', body: { domain, ip_address } }
  );

export interface RdnsInfo {
  ip: string;
  rdns: string;
  forwardConfirmed: boolean;
  resolvedA: string | null;
  providerApi: string;
  note?: string;
  warning?: string | null;
}

export const getRdns = (ip: string) =>
  apiFetch<RdnsInfo>(`/ips/${encodeURIComponent(ip)}/rdns`);

export const setRdns = (ip: string, rdns: string) =>
  apiFetch<RdnsInfo & { status: string }>(`/ips/${encodeURIComponent(ip)}/rdns`, {
    method: 'PUT',
    body: { rdns },
  });

export interface BlacklistIp {
  ip: string;
  listed: boolean;
  lists: string[];
  checkedWithin: string;
}

export interface BlacklistEvent {
  ip: string;
  provider: string;
  listed: boolean;
  at: string;
}

export const getBlacklist = () =>
  apiFetch<{ ips: BlacklistIp[]; events: BlacklistEvent[]; configured: boolean }>('/blacklist');

export interface LoginEventRow {
  ts: string;
  username: string;
  ip: string;
  user_agent: string;
  method: string;
  success: boolean;
}

export interface AdminSessionRow {
  token: string;
  username: string;
  ip: string;
  created_at: string;
}

export const getLoginLog = () =>
  apiFetch<{ logins: LoginEventRow[]; sessions: AdminSessionRow[]; geo: string; note: string }>(
    '/admin/logins'
  );

export const revokeSession = (token: string) =>
  apiFetch<{ revoked: boolean }>('/admin/logins/revoke', { method: 'POST', body: { token } });

export interface NotifItem {
  id: string;
  kind: string;
  severity: string;
  title: string;
  detail: string;
  createdAt: string;
  read: boolean;
}

export interface NotifRules {
  queue_warn: number;
  disk_warn_pct: number;
  uptime_warn_pct: number;
  backup_stale_days: number;
  email_to: string;
  webhook_url: string;
}

export const getNotifications = () =>
  apiFetch<{
    notifications: NotifItem[];
    unread: number;
    delivery: string;
    rules: NotifRules;
  }>('/notifications');

export const setNotifRules = (body: Partial<NotifRules>) =>
  apiFetch<{ rules: NotifRules }>('/notifications/rules', { method: 'PUT', body });

export const markNotifRead = (id: string) =>
  apiFetch<{ status: string }>('/notifications/read', { method: 'POST', body: { id } });

export const dismissNotif = (id: string) =>
  apiFetch<{ dismissed: boolean }>('/notifications/dismiss', { method: 'POST', body: { id } });

export interface RateLimits {
  server: { limitPerHour: number; sentToday: number; utilizationPct: number };
  isps: { isp: string; limitPerHour: number; sentToday: number; utilizationPct: number }[];
  enforcement: string;
  note: string;
}

export const getRateLimits = () => apiFetch<RateLimits>('/ratelimits');

export interface MtaTemplate {
  id: string;
  name: string;
  description: string;
  variables: string[];
}

export interface MtaVersionInfo {
  id: number;
  node_id: string;
  template_id: string;
  file: string;
  size_bytes: number;
  created_at: string;
}

export const getMtaTemplates = () =>
  apiFetch<{ templates: MtaTemplate[]; versions: MtaVersionInfo[] }>('/mta/templates');

export const applyMtaTemplate = (body: {
  template: string;
  node?: string;
  hostname?: string;
}) =>
  apiFetch<{
    template: string;
    rendered: string;
    diff: string[];
    rollbackVersion: number;
    applied: boolean;
    note: string;
  }>('/mta/templates/apply', { method: 'POST', body });

export interface MigrationJobRow {
  id: string;
  domain: string;
  source_node: string;
  target_node: string;
  status: string;
  note: string;
  steps: { name: string; status: string }[];
  created_at: string;
}

export const listMigrations = () =>
  apiFetch<{ migrations: MigrationJobRow[]; count: number }>('/migrations');

export const createMigration = (body: {
  domain: string;
  target_node: string;
  source_node?: string;
}) =>
  apiFetch<{ migration: MigrationJobRow }>('/migrations', { method: 'POST', body });

/* ------------------------------------------------------- F-058 API keys */

export interface ApiKeyRow {
  id: string;
  name: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  is_active: boolean;
}

export interface ApiUsageRow {
  key_id: string;
  total_calls: number;
  calls_today: number;
  calls_this_month: number;
  error_count: number;
  rate_limit_hits: number;
  avg_latency_ms: number;
  last_call_at: string | null;
  top_endpoints: [string, number][];
}

export const listApiKeys = () => apiFetch<ApiKeyRow[]>('/api-keys');

export const createApiKey = (body: { name: string; scopes: string[] }) =>
  apiFetch<ApiKeyRow>('/api-keys', { method: 'POST', body });

export const deleteApiKey = (id: string) =>
  apiFetch<{ deleted: string }>(`/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const rotateApiKey = (id: string, body?: { new_name?: string; new_scopes?: string[] }) =>
  apiFetch<ApiKeyRow>(`/api-keys/${encodeURIComponent(id)}/rotate`, { method: 'POST', body });

export const getApiKeyUsage = (id: string) =>
  apiFetch<ApiUsageRow>(`/api-keys/${encodeURIComponent(id)}/usage`);

/* ------------------------------------------------------ F-066 batch jobs */

export interface BatchJobRow {
  job_id: string;
  status: string;
  job_type: string;
  total: number;
  processed: number;
  created_at: string;
  completed_at: string | null;
}

export const batchCreateMailboxes = (body: {
  domain_name: string;
  emails: string[];
  display_name?: string;
  quota_limit_mb?: number;
}) =>
  apiFetch<{ job_id: string; created: number; errors: string[]; total: number }>('/batch/mailboxes', {
    method: 'POST',
    body,
  });

export const batchSuspend = (account_ids: string[]) =>
  apiFetch<{ job_id: string; suspended: number; errors: string[]; total: number }>('/batch/suspend', {
    method: 'POST',
    body: { account_ids },
  });

export const batchDnsCheck = (domains: string[]) =>
  apiFetch<{ job_id: string; results: Record<string, unknown>; total: number }>('/batch/dns-check', {
    method: 'POST',
    body: { domains },
  });

export const getBatchJob = (id: string) =>
  apiFetch<BatchJobRow>(`/jobs/${encodeURIComponent(id)}`);

// ---- Mail security (F-035..F-046) ----
export interface DkimKeyRow {
  id: string | null;
  domain: string;
  selector: string;
  algorithm: string;
  stage: string;
  createdAt: string | null;
  publicKey: string;
  dnsHost: string;
  dnsRecord: string;
  dnsStatus: string;
}
export interface SecurityDkim {
  source: string;
  stalwartReachable: boolean;
  keys: DkimKeyRow[];
  note: string;
}
export const getSecurityDkim = () => apiFetch<SecurityDkim>('/security/dkim');
export const rotateSecurityDkim = (domain: string) =>
  apiFetch<Record<string, unknown>>('/security/dkim/rotate', { method: 'POST', body: { domain } });

export interface SecurityDmarc {
  domain: string;
  record: string | null;
  dnsHost: string;
  policy: string | null;
  rua: string | null;
  found: boolean;
  dnsReachable: boolean;
  wizard: Record<string, string>;
  note: string;
}
export const getSecurityDmarc = (domain: string) =>
  apiFetch<SecurityDmarc>(`/security/dmarc/${encodeURIComponent(domain)}`);
export const getSecurityDmarcReports = () =>
  apiFetch<Record<string, unknown>>('/security/dmarc-reports');

export interface SecurityMtaSts {
  domain: string;
  stalwartPolicy: unknown;
  dnsTxtHost: string;
  dnsTxt: string[] | null;
  dnsWellKnown: string;
  recordTemplate: string;
  note: string;
}
export const getSecurityMtaSts = (domain: string) =>
  apiFetch<SecurityMtaSts>(`/security/mta-sts/${encodeURIComponent(domain)}`);

export interface SecurityTlsRpt {
  domain: string;
  dnsTxtHost: string;
  dnsTxt: string[] | null;
  recordTemplate: string;
  reportsReceived: unknown;
  note: string;
}
export const getSecurityTlsRpt = (domain: string) =>
  apiFetch<SecurityTlsRpt>(`/security/tls-rpt/${encodeURIComponent(domain)}`);

export interface SecurityLive {
  live: boolean;
  settings?: unknown;
  note: string;
}
export const getSecurityArc = () => apiFetch<SecurityLive>('/security/arc');

export interface SecurityCert {
  listener: string;
  subject: string | null;
  issuer: string | null;
  validity: string[];
  source: string;
}
export interface SecurityCerts {
  certificates: SecurityCert[];
  stalwartCertificateCount: unknown;
  provisioner: string;
  note: string;
}
export const getSecurityCertificates = () => apiFetch<SecurityCerts>('/security/certificates');

export interface SecuritySpam extends SecurityLive {
  dnsblCount: unknown;
  ruleCount: unknown;
  quarantine: string;
}
export const getSecuritySpam = () => apiFetch<SecuritySpam>('/security/spam');

export interface SecurityBruteforce extends SecurityLive {
  blockedIps: unknown;
  whitelistedIps: unknown;
}
export const getSecurityBruteforce = () => apiFetch<SecurityBruteforce>('/security/bruteforce');
