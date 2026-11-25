import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  AtSign,
  BarChart3,
  Check,
  Copy,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MailCheck,
  Mailbox as MailboxIcon,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, listDomains, type Domain } from '../lib/adminApi';

/* ------------------------------------------------------------------ */
/* Types mirroring server/src/routes/client.rs (flat JSON, snake_case) */
/* ------------------------------------------------------------------ */

interface ClientMailbox {
  id: string;
  email: string;
  display_name?: string;
  domain_name?: string;
  quota_limit_mb?: number;
  quota_used_mb?: number;
  is_active?: boolean;
  is_suspended?: boolean;
  totp_enabled?: boolean;
  created_at?: string;
}

interface ClientAlias {
  id: string;
  source_email?: string;
  destination_email?: string;
  destinations?: string[];
  is_list?: boolean;
  created_at?: string;
}

interface DistributionList {
  id: string;
  address?: string;
  name?: string;
  members?: string[];
  post_policy?: string;
  created_at?: string;
}

interface PasswordPolicy {
  min_length?: number;
  require_upper?: boolean;
  require_number?: boolean;
  require_special?: boolean;
  expiry_days?: number;
}

interface SentReportEntry {
  email?: string;
  display_name?: string;
  sent_today?: number;
  sent_this_week?: number;
  sent_this_month?: number;
  bounces_today?: number;
  bounce_rate_pct?: number;
  delivery_success_pct?: number;
}

interface LoginEntry {
  ts?: string;
  ip?: string;
  protocol?: string;
  geo_country?: string | null;
  geo_city?: string | null;
  user_agent?: string;
  success?: boolean;
}

interface SessionEntry {
  id: string;
  protocol?: string;
  ip?: string;
  user_agent?: string | null;
  started_at?: string;
  idle_seconds?: number | null;
}

interface QuarantineEntry {
  id: string;
  sender?: string;
  subject?: string;
  spam_score?: number;
  received_at?: string;
  size_bytes?: number;
}

interface ListEntry {
  id: string;
  value?: string;
  created_at?: string;
}

interface AuditEntry {
  id: string;
  actor?: string;
  action?: string;
  target_type?: string;
  target_id?: string;
  details?: unknown;
  ip?: string;
  created_at?: string;
}

interface ClientPanelProps {
  userEmail: string;
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onBack: () => void;
}

type Section =
  | 'dashboard'
  | 'mailboxes'
  | 'aliases'
  | 'lists'
  | 'settings'
  | 'reports'
  | 'security';

/* ------------------------------------------------------------- utils */

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // The Rust API's ErrorResponse nests {error:{code,message}}; apiFetch stringifies
  // the object, so recover a readable fallback instead of "[object Object]".
  return !m || m === '[object Object]' ? 'The server rejected the request' : m;
}

function fmtMb(mb?: number | null): string {
  if (mb === null || mb === undefined) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function fmtBytes(bytes?: number | null): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtWhen(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const enc = encodeURIComponent;

/* Shared style tokens — same palette as SettingsView / DomainActivitySettings. */
const card = 'rounded-xl border border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] p-4';
const label = 'text-xs text-[#5E5E5E] dark:text-[#8E918F]';
const btnGhost =
  'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-40';
const btnPrimary =
  'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#0B57D0] hover:bg-[#0a4cb8] text-white text-xs font-medium transition-colors disabled:opacity-40';
const btnDanger =
  'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-red-200 dark:border-red-900/50 text-xs font-medium text-[#B3261E] dark:text-[#F28B82] hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors disabled:opacity-40';
const inputCls = 'input input-bordered input-sm w-full bg-white dark:bg-[#1E1F20]';

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    ok: 'bg-[#E6F4EA] text-[#137333] dark:bg-[#1E3329] dark:text-[#81C995]',
    warn: 'bg-[#FEF7E0] text-[#B06000] dark:bg-[#3C3226] dark:text-[#FDD663]',
    bad: 'bg-red-50 text-[#B3261E] dark:bg-red-900/20 dark:text-[#F28B82]',
    muted: 'bg-[#F1F3F4] text-[#5E5E5E] dark:bg-[#2D2F31] dark:text-[#9AA0A6]',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function CopyBtn({ text, onNotify }: { text: string; onNotify: ClientPanelProps['onNotify'] }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      aria-label="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          onNotify('Copy failed — select the text manually', 'error');
        }
      }}
      className="btn btn-ghost btn-xs h-7 min-h-7"
    >
      {done ? <Check className="w-3.5 h-3.5 stroke-[1.5]" /> : <Copy className="w-3.5 h-3.5 stroke-[1.5]" />}
    </button>
  );
}

function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
      <RefreshCw className="w-3.5 h-3.5 stroke-[1.5] animate-spin" />
      {text}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-xs text-[#5E5E5E] dark:text-[#8E918F]">{text}</p>;
}

function DomainSelect({
  domains,
  value,
  onChange,
}: {
  domains: Domain[];
  value: string;
  onChange: (d: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[#444746] dark:text-[#C4C7C5]">
      Domain
      <select
        className="select select-bordered select-sm max-w-56"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {domains.length === 0 && <option value="">No domains</option>}
        {domains.map((d) => (
          <option key={d.domain} value={d.domain}>
            {d.domain}
          </option>
        ))}
      </select>
    </label>
  );
}

/* --------------------------------------------------------- Dashboard */

interface DashboardData {
  mailbox_count?: number | null;
  mailbox_limit?: number | null;
  storage_used_mb?: number | null;
  storage_limit_mb?: number | null;
  emails_sent_today?: number | null;
  daily_limit?: number | null;
  security_score_pct?: number | null;
  dns_verified?: boolean | null;
}

const DashboardSection: React.FC<{
  domains: Domain[];
  onNotify: ClientPanelProps['onNotify'];
}> = ({ domains, onNotify }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiFetch<DashboardData>('/client/dashboard'));
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const used = data?.storage_used_mb ?? 0;
  const limit = data?.storage_limit_mb ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Overview</h3>
          <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            Workspace usage for your domains.
          </p>
        </div>
        <button onClick={() => void load()} className={btnGhost}>
          <RefreshCw className={`w-3.5 h-3.5 stroke-[1.5] ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className={card}>
              <div className={label}>Mailboxes</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                {data?.mailbox_count ?? 0}
                {data?.mailbox_limit ? ` / ${data.mailbox_limit}` : ''}
              </div>
            </div>
            <div className={card}>
              <div className={label}>Storage used</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                {fmtMb(data?.storage_used_mb)}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-2 flex-1 rounded-full bg-[#E0E2E7] dark:bg-[#333538]">
                  <div
                    className="h-2 rounded-full bg-[#0B57D0]"
                    style={{ width: `${pct}%` }}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <span className={label}>of {fmtMb(data?.storage_limit_mb)}</span>
              </div>
            </div>
            <div className={card}>
              <div className={label}>Emails sent today</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                {data?.emails_sent_today ?? '—'}
              </div>
              <div className={label}>{data?.daily_limit ? `Daily limit ${data.daily_limit}` : 'No daily limit reported'}</div>
            </div>
            <div className={card}>
              <div className={label}>Security score</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">
                {data?.security_score_pct ?? '—'}%
              </div>
            </div>
          </div>

          <div className={card}>
            <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Domains</h4>
            {domains.length === 0 ? (
              <Empty text="No domains yet. Domains appear here once they are added to the workspace." />
            ) : (
              <div className="mt-2 divide-y divide-[#F2F4F7] dark:divide-[#333538]">
                {domains.map((d) => (
                  <div key={d.domain} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Globe className="w-4 h-4 stroke-[1.5] text-[#0B57D0] shrink-0" />
                      <span className="text-sm text-[#1F1F1F] dark:text-[#E3E3E3] font-medium truncate">{d.domain}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={label}>
                        {d.mailboxCount ?? 0} mailbox{d.mailboxCount === 1 ? '' : 'es'}
                      </span>
                      {data?.dns_verified ? (
                        <Badge tone="ok">DNS verified</Badge>
                      ) : data?.dns_verified === false ? (
                        <Badge tone="warn">DNS pending</Badge>
                      ) : (
                        <Badge tone="muted">Unknown</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/* --------------------------------------------------------- Mailboxes */

const MailboxSection: React.FC<{
  domains: Domain[];
  onNotify: ClientPanelProps['onNotify'];
}> = ({ domains, onNotify }) => {
  const [domain, setDomain] = useState(domains[0]?.domain ?? '');
  const [rows, setRows] = useState<ClientMailbox[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // One form doubles as create (F-080) and edit display name / quota.
  const [editing, setEditing] = useState<ClientMailbox | null>(null);
  const [prefix, setPrefix] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [quotaMb, setQuotaMb] = useState('5120');
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (domains.length > 0 && !domains.some((d) => d.domain === domain)) {
      setDomain(domains[0].domain);
    }
  }, [domains, domain]);

  const load = useCallback(async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const r = await apiFetch<{ mailboxes?: ClientMailbox[] }>(`/client/domains/${enc(domain)}/mailboxes`);
      setRows(Array.isArray(r?.mailboxes) ? r.mailboxes : []);
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [domain, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (m: ClientMailbox) => {
    setEditing(m);
    setDisplayName(m.display_name ?? '');
    setQuotaMb(String(m.quota_limit_mb ?? 5120));
    setPassword('');
    setPrefix('');
  };

  const resetForm = () => {
    setEditing(null);
    setPrefix('');
    setDisplayName('');
    setPassword('');
    setQuotaMb('5120');
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (editing) {
        await apiFetch(`/client/mailboxes/${enc(editing.id)}`, {
          method: 'PUT',
          body: { display_name: displayName, quota_mb: Number(quotaMb) || 5120 },
        });
        onNotify('Mailbox updated', 'success');
      } else {
        if (!prefix.trim()) {
          onNotify('Enter a mailbox prefix', 'error');
          setBusy(false);
          return;
        }
        await apiFetch(`/client/domains/${enc(domain)}/mailboxes`, {
          method: 'POST',
          body: {
            email: `${prefix.trim()}@${domain}`,
            display_name: displayName || undefined,
            password: password || undefined,
            quota_mb: Number(quotaMb) || 5120,
          },
        });
        onNotify('Mailbox created', 'success');
      }
      resetForm();
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doResetPassword = async (m: ClientMailbox) => {
    if (!newPassword) {
      onNotify('Enter a new password', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(m.id)}/password`, {
        method: 'PUT',
        body: { password: newPassword },
      });
      onNotify(`Password reset for ${m.email}`, 'success');
      setResetId(null);
      setNewPassword('');
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (m: ClientMailbox) => {
    if (!confirm(`Delete mailbox ${m.email}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(m.id)}`, { method: 'DELETE' });
      onNotify(`Mailbox ${m.email} deleted`, 'success');
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Mailboxes</h3>
          <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            Create, edit and remove mailboxes on your domains.
          </p>
        </div>
        <DomainSelect domains={domains} value={domain} onChange={setDomain} />
      </div>

      <div className={card}>
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
          {editing ? `Edit ${editing.email}` : 'Create mailbox'}
        </h4>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {!editing && (
            <label className="form-control">
              <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Prefix</span>
              <input className={inputCls} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="alice" />
            </label>
          )}
          {!editing && (
            <label className="form-control">
              <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Domain</span>
              <input className={`${inputCls} opacity-70`} value={domain} readOnly />
            </label>
          )}
          <label className="form-control">
            <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Display name</span>
            <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alice Anderson" />
          </label>
          {!editing && (
            <label className="form-control">
              <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Password</span>
              <input
                type="password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Must satisfy the domain policy"
              />
            </label>
          )}
          <label className="form-control">
            <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Quota (MB)</span>
            <input type="number" min={64} className={inputCls} value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => void submit()} disabled={busy || !domain} className={btnPrimary}>
            {editing ? <Check className="w-3.5 h-3.5 stroke-[1.5]" /> : <Plus className="w-3.5 h-3.5 stroke-[1.5]" />}
            {editing ? 'Save changes' : 'Create mailbox'}
          </button>
          {editing && (
            <button onClick={resetForm} className={btnGhost}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              <th>Address</th>
              <th>Display name</th>
              <th>Quota used</th>
              <th>Status</th>
              <th>2FA</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <Loading />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <Empty text={domain ? `No mailboxes on ${domain} yet.` : 'Select a domain.'} />
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <React.Fragment key={m.id}>
                <tr className="text-sm text-[#444746] dark:text-[#C4C7C5]">
                  <td className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">{m.email}</td>
                  <td>{m.display_name || '—'}</td>
                  <td className="tabular-nums">
                    {fmtMb(m.quota_used_mb)} / {fmtMb(m.quota_limit_mb)}
                  </td>
                  <td>
                    {m.is_suspended ? (
                      <Badge tone="bad">Suspended</Badge>
                    ) : m.is_active ? (
                      <Badge tone="ok">Active</Badge>
                    ) : (
                      <Badge tone="muted">Disabled</Badge>
                    )}
                  </td>
                  <td>{m.totp_enabled ? <Badge tone="ok">On</Badge> : <Badge tone="muted">Off</Badge>}</td>
                  <td className="text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => startEdit(m)} className="btn btn-ghost btn-xs h-7 min-h-7" title="Edit">
                        <Pencil className="w-3.5 h-3.5 stroke-[1.5]" />
                      </button>
                      <button
                        onClick={() => {
                          setResetId(resetId === m.id ? null : m.id);
                          setNewPassword('');
                        }}
                        className="btn btn-ghost btn-xs h-7 min-h-7"
                        title="Reset password"
                      >
                        <KeyRound className="w-3.5 h-3.5 stroke-[1.5]" />
                      </button>
                      <button onClick={() => void doDelete(m)} className="btn btn-ghost btn-xs h-7 min-h-7 text-[#B3261E] dark:text-[#F28B82]" title="Delete">
                        <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                      </button>
                    </div>
                  </td>
                </tr>
                {resetId === m.id && (
                  <tr>
                    <td colSpan={6} className="bg-[#F8F9FA] dark:bg-[#26282A]">
                      <div className="flex flex-wrap items-center gap-2 py-1">
                        <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">New password for {m.email}:</span>
                        <input
                          type="password"
                          className={`${inputCls} max-w-xs`}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Must satisfy the domain policy"
                        />
                        <button onClick={() => void doResetPassword(m)} disabled={busy} className={btnPrimary}>
                          <Check className="w-3.5 h-3.5 stroke-[1.5]" />
                          Save password
                        </button>
                        <button onClick={() => setResetId(null)} className={btnGhost}>
                          <X className="w-3.5 h-3.5 stroke-[1.5]" />
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------- Aliases */

const AliasSection: React.FC<{
  domains: Domain[];
  onNotify: ClientPanelProps['onNotify'];
}> = ({ domains, onNotify }) => {
  const [domain, setDomain] = useState(domains[0]?.domain ?? '');
  const [rows, setRows] = useState<ClientAlias[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ClientAlias | null>(null);
  const [prefix, setPrefix] = useState('');
  const [targets, setTargets] = useState('');

  useEffect(() => {
    if (domains.length > 0 && !domains.some((d) => d.domain === domain)) {
      setDomain(domains[0].domain);
    }
  }, [domains, domain]);

  // The list endpoint returns every alias in state; keep only the selected
  // domain's rows so the table matches the selector.
  const load = useCallback(async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const r = await apiFetch<{ aliases?: ClientAlias[] }>(`/client/domains/${enc(domain)}/aliases`);
      const all = Array.isArray(r?.aliases) ? r.aliases : [];
      setRows(all.filter((a) => (a.source_email ?? '').toLowerCase().endsWith(`@${domain.toLowerCase()}`)));
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [domain, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (a: ClientAlias) => {
    setEditing(a);
    setPrefix((a.source_email ?? '').split('@')[0] ?? '');
    setTargets((a.destinations ?? [a.destination_email ?? '']).join(', '));
  };

  const resetForm = () => {
    setEditing(null);
    setPrefix('');
    setTargets('');
  };

  const submit = async () => {
    const list = targets.split(',').map((s) => s.trim()).filter(Boolean);
    if (!prefix.trim() || list.length === 0) {
      onNotify('Enter an alias prefix and at least one target', 'error');
      return;
    }
    setBusy(true);
    try {
      const source = `${prefix.trim()}@${domain}`;
      if (editing) {
        // No PUT alias endpoint in the API: edit = delete + recreate.
        await apiFetch(`/client/aliases/${enc(editing.id)}`, { method: 'DELETE' });
      }
      await apiFetch(`/client/domains/${enc(domain)}/aliases`, {
        method: 'POST',
        body: { source, destination: list[0], destinations: list },
      });
      onNotify(editing ? 'Alias updated' : 'Alias created', 'success');
      resetForm();
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
      await load(); // re-sync if the delete half of an edit succeeded
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (a: ClientAlias) => {
    if (!confirm(`Delete alias ${a.source_email}?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/client/aliases/${enc(a.id)}`, { method: 'DELETE' });
      onNotify(`Alias ${a.source_email} deleted`, 'success');
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Aliases</h3>
          <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            Forward one address to one or more mailboxes. Aliases do not consume mailbox slots.
          </p>
        </div>
        <DomainSelect domains={domains} value={domain} onChange={setDomain} />
      </div>

      <div className={card}>
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
          {editing ? `Edit ${editing.source_email}` : 'Create alias'}
        </h4>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="form-control">
            <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Alias prefix</span>
            <input className={inputCls} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="sales" />
          </label>
          <label className="form-control">
            <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Targets (comma-separated)</span>
            <input className={inputCls} value={targets} onChange={(e) => setTargets(e.target.value)} placeholder="alice@domain, bob@domain" />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => void submit()} disabled={busy || !domain} className={btnPrimary}>
            {editing ? <Check className="w-3.5 h-3.5 stroke-[1.5]" /> : <Plus className="w-3.5 h-3.5 stroke-[1.5]" />}
            {editing ? 'Save targets' : 'Create alias'}
          </button>
          {editing && (
            <button onClick={resetForm} className={btnGhost}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              <th>Alias</th>
              <th>Targets</th>
              <th>Created</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <Loading />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <Empty text={domain ? `No aliases on ${domain} yet.` : 'Select a domain.'} />
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="text-sm text-[#444746] dark:text-[#C4C7C5]">
                <td className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">{a.source_email}</td>
                <td className="font-mono text-xs break-all">
                  {(a.destinations && a.destinations.length > 0 ? a.destinations : [a.destination_email]).join(', ')}
                </td>
                <td className="text-xs">{fmtWhen(a.created_at)}</td>
                <td className="text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => startEdit(a)} className="btn btn-ghost btn-xs h-7 min-h-7" title="Edit targets">
                      <Pencil className="w-3.5 h-3.5 stroke-[1.5]" />
                    </button>
                    <button onClick={() => void doDelete(a)} className="btn btn-ghost btn-xs h-7 min-h-7 text-[#B3261E] dark:text-[#F28B82]" title="Delete">
                      <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---------------------------------------------- Distribution lists */

const ListSection: React.FC<{
  domains: Domain[];
  onNotify: ClientPanelProps['onNotify'];
}> = ({ domains, onNotify }) => {
  const [domain, setDomain] = useState(domains[0]?.domain ?? '');
  const [rows, setRows] = useState<DistributionList[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<DistributionList | null>(null);
  const [prefix, setPrefix] = useState('');
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [postPolicy, setPostPolicy] = useState('members');

  useEffect(() => {
    if (domains.length > 0 && !domains.some((d) => d.domain === domain)) {
      setDomain(domains[0].domain);
    }
  }, [domains, domain]);

  // GET returns a bare JSON array (no {lists} wrapper).
  const load = useCallback(async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const r = await apiFetch<DistributionList[] | { lists?: DistributionList[] }>(`/client/domains/${enc(domain)}/lists`);
      setRows(Array.isArray(r) ? r : Array.isArray(r?.lists) ? r.lists : []);
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [domain, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (l: DistributionList) => {
    setEditing(l);
    setPrefix((l.address ?? '').split('@')[0] ?? '');
    setName(l.name ?? '');
    setMembers((l.members ?? []).join('\n'));
    setPostPolicy(l.post_policy ?? 'members');
  };

  const resetForm = () => {
    setEditing(null);
    setPrefix('');
    setName('');
    setMembers('');
    setPostPolicy('members');
  };

  const submit = async () => {
    if (!name.trim()) {
      onNotify('Enter a list name', 'error');
      return;
    }
    const memberList = members.split('\n').map((s) => s.trim()).filter(Boolean);
    setBusy(true);
    try {
      if (editing) {
        await apiFetch(`/client/lists/${enc(editing.id)}`, {
          method: 'PATCH',
          body: { name: name.trim(), members: memberList, post_policy: postPolicy },
        });
        onNotify('List updated', 'success');
      } else {
        if (!prefix.trim()) {
          onNotify('Enter a list address prefix', 'error');
          setBusy(false);
          return;
        }
        await apiFetch(`/client/domains/${enc(domain)}/lists`, {
          method: 'POST',
          body: { address_prefix: prefix.trim(), name: name.trim(), members: memberList, post_policy: postPolicy },
        });
        onNotify('List created', 'success');
      }
      resetForm();
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (l: DistributionList) => {
    if (!confirm(`Delete distribution list ${l.address}?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/client/lists/${enc(l.id)}`, { method: 'DELETE' });
      onNotify(`List ${l.address} deleted`, 'success');
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Distribution lists</h3>
          <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            Team addresses that forward to one or more members.
          </p>
        </div>
        <DomainSelect domains={domains} value={domain} onChange={setDomain} />
      </div>

      <div className={card}>
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
          {editing ? `Edit ${editing.address}` : 'Create list'}
        </h4>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
          {!editing && (
            <label className="form-control">
              <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Address prefix</span>
              <input className={inputCls} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="team" />
              <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F] mt-1">
                Will be {prefix || 'team'}@{domain || 'your-domain'}
              </span>
            </label>
          )}
          <label className="form-control">
            <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering team" />
          </label>
          <label className="form-control">
            <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Who can post</span>
            <select className="select select-bordered select-sm w-full" value={postPolicy} onChange={(e) => setPostPolicy(e.target.value)}>
              <option value="members">Members only</option>
              <option value="anyone">Anyone</option>
              <option value="moderated">Moderated</option>
            </select>
          </label>
          <label className="form-control lg:col-span-3">
            <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Members (one email per line)</span>
            <textarea
              className="textarea textarea-bordered w-full text-sm font-mono"
              rows={4}
              value={members}
              onChange={(e) => setMembers(e.target.value)}
              placeholder={'alice@domain\nbob@domain\nexternal@example.org'}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => void submit()} disabled={busy || !domain} className={btnPrimary}>
            {editing ? <Check className="w-3.5 h-3.5 stroke-[1.5]" /> : <Plus className="w-3.5 h-3.5 stroke-[1.5]" />}
            {editing ? 'Save changes' : 'Create list'}
          </button>
          {editing && (
            <button onClick={resetForm} className={btnGhost}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              <th>Address</th>
              <th>Name</th>
              <th>Members</th>
              <th>Post policy</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <Loading />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <Empty text={domain ? `No distribution lists on ${domain} yet.` : 'Select a domain.'} />
                </td>
              </tr>
            )}
            {rows.map((l) => (
              <tr key={l.id} className="text-sm text-[#444746] dark:text-[#C4C7C5]">
                <td className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">{l.address}</td>
                <td>{l.name || '—'}</td>
                <td className="tabular-nums">{(l.members ?? []).length}</td>
                <td>
                  <Badge tone="muted">{l.post_policy || 'members'}</Badge>
                </td>
                <td className="text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => startEdit(l)} className="btn btn-ghost btn-xs h-7 min-h-7" title="Edit">
                      <Pencil className="w-3.5 h-3.5 stroke-[1.5]" />
                    </button>
                    <button onClick={() => void doDelete(l)} className="btn btn-ghost btn-xs h-7 min-h-7 text-[#B3261E] dark:text-[#F28B82]" title="Delete">
                      <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* --------------------------------------------------- Domain settings */

const SettingsSection: React.FC<{
  domains: Domain[];
  onNotify: ClientPanelProps['onNotify'];
}> = ({ domains, onNotify }) => {
  const [domain, setDomain] = useState(domains[0]?.domain ?? '');
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [minLength, setMinLength] = useState('10');
  const [reqUpper, setReqUpper] = useState(false);
  const [reqNumber, setReqNumber] = useState(false);
  const [reqSpecial, setReqSpecial] = useState(false);
  const [expiry, setExpiry] = useState('0');

  useEffect(() => {
    if (domains.length > 0 && !domains.some((d) => d.domain === domain)) {
      setDomain(domains[0].domain);
    }
  }, [domains, domain]);

  const load = useCallback(async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const p = await apiFetch<PasswordPolicy>(`/client/domains/${enc(domain)}/password-policy`);
      setPolicy(p ?? null);
      setMinLength(String(p?.min_length ?? 10));
      setReqUpper(Boolean(p?.require_upper));
      setReqNumber(Boolean(p?.require_number));
      setReqSpecial(Boolean(p?.require_special));
      setExpiry(String(p?.expiry_days ?? 0));
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [domain, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const ml = Math.min(32, Math.max(8, Number(minLength) || 8));
    setBusy(true);
    try {
      await apiFetch(`/client/domains/${enc(domain)}/password-policy`, {
        method: 'PUT',
        body: {
          min_length: ml,
          require_upper: reqUpper,
          require_number: reqNumber,
          require_special: reqSpecial,
          expiry_days: Number(expiry) || 0,
        },
      });
      onNotify('Password policy saved', 'success');
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Domain settings</h3>
          <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            Password rules and DNS status for your domain.
          </p>
        </div>
        <DomainSelect domains={domains} value={domain} onChange={setDomain} />
      </div>

      <div className={card}>
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Password policy</h4>
        <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
          Applied when mailboxes on <span className="font-medium">{domain || 'your domain'}</span> are created and when
          passwords are changed.
        </p>
        {loading && !policy ? (
          <Loading />
        ) : (
          <>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="form-control">
                <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Minimum length (8–32)</span>
                <input
                  type="number"
                  min={8}
                  max={32}
                  className={`${inputCls} max-w-32`}
                  value={minLength}
                  onChange={(e) => setMinLength(e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text text-xs text-[#5E5E5E] dark:text-[#8E918F]">Password expiry</span>
                <select className="select select-bordered select-sm w-full max-w-48" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                  <option value="0">Never expires</option>
                  <option value="30">Every 30 days</option>
                  <option value="60">Every 60 days</option>
                  <option value="90">Every 90 days</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-col gap-2 text-sm text-[#444746] dark:text-[#C4C7C5]">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox checkbox-sm" checked={reqUpper} onChange={(e) => setReqUpper(e.target.checked)} />
                Require an uppercase letter
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox checkbox-sm" checked={reqNumber} onChange={(e) => setReqNumber(e.target.checked)} />
                Require a number
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="checkbox checkbox-sm" checked={reqSpecial} onChange={(e) => setReqSpecial(e.target.checked)} />
                Require a special character
              </label>
            </div>
            <button onClick={() => void save()} disabled={busy || !domain} className={`${btnPrimary} mt-4`}>
              <Check className="w-3.5 h-3.5 stroke-[1.5]" />
              Save policy
            </button>
          </>
        )}
      </div>

      <div className={card}>
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">DNS setup &amp; verification</h4>
        <p className="mt-1 text-xs text-[#5E5E5E] dark:text-[#8E918F] leading-relaxed">
          DNS records for your domains — MX, SPF, DKIM and DMARC — are managed under{' '}
          <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Settings → DNS setup &amp; verify</span> in the
          webmail. Open Settings from the gear icon in the header, choose the domain, and follow the verification steps
          there. Verification status for each domain shows on the Dashboard.
        </p>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------- Reports */

interface DomainStats {
  totals?: { sent?: number; received?: number; delivered?: number; failed?: number; spam?: number; rate?: number | null };
  mailboxes?: number;
  storageBytes?: number;
  storageQuotaBytes?: number;
}

const ReportsSection: React.FC<{
  domains: Domain[];
  onNotify: ClientPanelProps['onNotify'];
}> = ({ domains, onNotify }) => {
  const [domain, setDomain] = useState(domains[0]?.domain ?? '');
  const [stats, setStats] = useState<DomainStats | null>(null);
  const [report, setReport] = useState<{ mailboxes?: SentReportEntry[]; totals?: { sent?: number; bounced?: number; successRatePct?: number | null } } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (domains.length > 0 && !domains.some((d) => d.domain === domain)) {
      setDomain(domains[0].domain);
    }
  }, [domains, domain]);

  const load = useCallback(async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const [s, r] = await Promise.allSettled([
        apiFetch<DomainStats>(`/client/domains/${enc(domain)}/stats`),
        apiFetch<{ mailboxes?: SentReportEntry[]; totals?: { sent?: number; bounced?: number; successRatePct?: number | null } }>(
          `/client/domains/${enc(domain)}/sent-report`
        ),
      ]);
      if (s.status === 'fulfilled') setStats(s.value ?? null);
      else {
        setStats(null);
        onNotify(errMsg(s.reason), 'error');
      }
      if (r.status === 'fulfilled') setReport(r.value ?? null);
      else {
        setReport(null);
        onNotify(errMsg(r.reason), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [domain, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = Array.isArray(report?.mailboxes) ? report.mailboxes : [];
  const totals = report?.totals ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Reports</h3>
          <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            Outbound volume and delivery health per mailbox on {domain || 'your domain'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DomainSelect domains={domains} value={domain} onChange={setDomain} />
          <button onClick={() => void load()} className={btnGhost}>
            <RefreshCw className={`w-3.5 h-3.5 stroke-[1.5] ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={card}>
            <div className={label}>Sent · 7 days</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">{stats.totals?.sent ?? 0}</div>
          </div>
          <div className={card}>
            <div className={label}>Delivered</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">{stats.totals?.delivered ?? 0}</div>
            <div className={label}>{stats.totals?.rate !== null && stats.totals?.rate !== undefined ? `${stats.totals.rate}% rate` : 'No deliveries yet'}</div>
          </div>
          <div className={card}>
            <div className={label}>Failed</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">{stats.totals?.failed ?? 0}</div>
          </div>
          <div className={card}>
            <div className={label}>Spam blocked</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">{stats.totals?.spam ?? 0}</div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              <th>Mailbox</th>
              <th>Sent today</th>
              <th>This week</th>
              <th>This month</th>
              <th>Bounces today</th>
              <th>Bounce rate</th>
              <th>Delivery rate</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <Loading />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <Empty text="No outbound activity recorded for this domain yet." />
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.email ?? i}`} className="text-sm text-[#444746] dark:text-[#C4C7C5]">
                <td className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">{r.email ?? '—'}</td>
                <td className="tabular-nums">{r.sent_today ?? 0}</td>
                <td className="tabular-nums">{r.sent_this_week ?? 0}</td>
                <td className="tabular-nums">{r.sent_this_month ?? 0}</td>
                <td className="tabular-nums">{r.bounces_today ?? 0}</td>
                <td className="tabular-nums">{r.bounce_rate_pct ?? 0}%</td>
                <td className="tabular-nums">{r.delivery_success_pct ?? 0}%</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="border-t-2 border-[#E0E2E7] dark:border-[#333538] text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                <td>Totals</td>
                <td colSpan={3} className="tabular-nums">{totals.sent ?? 0} sent</td>
                <td colSpan={3} className="tabular-nums">
                  {totals.bounced ?? 0} bounced
                  {totals.successRatePct !== null && totals.successRatePct !== undefined ? ` · ${totals.successRatePct}% success` : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------- Security */

const TwoFaCard: React.FC<{
  mailboxId: string;
  onNotify: ClientPanelProps['onNotify'];
  onChanged: () => void;
}> = ({ mailboxId, onNotify, onChanged }) => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<'idle' | 'setup' | 'recovery'>('idle');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ enabled?: boolean }>(`/client/mailboxes/${enc(mailboxId)}/2fa`);
      setEnabled(Boolean(r?.enabled));
    } catch (e) {
      onNotify(errMsg(e), 'error');
    }
  }, [mailboxId, onNotify]);

  useEffect(() => {
    setPhase('idle');
    setCode('');
    setCodes([]);
    setSecret('');
    setOtpauthUrl('');
    void load();
  }, [load]);

  const setup = async () => {
    setBusy(true);
    try {
      const r = await apiFetch<{ secret?: string; otpauth_url?: string }>(`/client/mailboxes/${enc(mailboxId)}/2fa/setup`, {
        method: 'POST',
      });
      setSecret(r?.secret ?? '');
      setOtpauthUrl(r?.otpauth_url ?? '');
      setPhase('setup');
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    if (!code.trim()) {
      onNotify('Enter the 6-digit code from your authenticator app', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await apiFetch<{ recovery_codes?: string[] }>(`/client/mailboxes/${enc(mailboxId)}/2fa/enable`, {
        method: 'POST',
        body: { code: code.trim() },
      });
      setCodes(Array.isArray(r?.recovery_codes) ? r.recovery_codes : []);
      setPhase('recovery');
      onNotify('2FA enabled — save your recovery codes now', 'success');
      onChanged();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!code.trim()) {
      onNotify('Enter a TOTP code or a recovery code', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(mailboxId)}/2fa/disable`, {
        method: 'POST',
        body: { code: code.trim() },
      });
      onNotify('2FA disabled', 'success');
      setPhase('idle');
      setCode('');
      onChanged();
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Two-factor authentication</h4>
        {enabled === null ? (
          <Badge tone="muted">…</Badge>
        ) : enabled ? (
          <Badge tone="ok">Enabled</Badge>
        ) : (
          <Badge tone="muted">Not enabled</Badge>
        )}
      </div>

      {phase === 'idle' && !enabled && (
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => void setup()} disabled={busy} className={btnPrimary}>
            <ShieldCheck className="w-3.5 h-3.5 stroke-[1.5]" />
            Set up 2FA
          </button>
          <span className={label}>Works with any TOTP app (Google Authenticator, Authy…).</span>
        </div>
      )}

      {phase === 'setup' && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center gap-1">
              <span className={label}>Secret key</span>
              <CopyBtn text={secret} onNotify={onNotify} />
            </div>
            <p className="mt-1 font-mono text-sm break-all text-[#1F1F1F] dark:text-[#E3E3E3]">{secret || '—'}</p>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <span className={label}>otpauth URL</span>
              <CopyBtn text={otpauthUrl} onNotify={onNotify} />
            </div>
            <p className="mt-1 font-mono text-xs break-all text-[#5E5E5E] dark:text-[#8E918F]">{otpauthUrl || '—'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputCls} max-w-40`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
            />
            <button onClick={() => void enable()} disabled={busy} className={btnPrimary}>
              <Check className="w-3.5 h-3.5 stroke-[1.5]" />
              Verify and enable
            </button>
            <button
              onClick={() => {
                setPhase('idle');
                setCode('');
              }}
              className={btnGhost}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'recovery' && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[#B06000] dark:text-[#FDD663]">
            Recovery codes are shown once. Copy them somewhere safe — they will not be shown again.
          </p>
          <div className="flex items-center gap-1">
            <CopyBtn text={codes.join('\n')} onNotify={onNotify} />
            <span className={label}>Copy all {codes.length} codes</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">
            {codes.map((c) => (
              <span key={c} className="rounded bg-[#F1F3F4] dark:bg-[#2D2F31] px-2 py-1">
                {c}
              </span>
            ))}
          </div>
          <button
            onClick={() => {
              setPhase('idle');
              setCode('');
            }}
            className={`${btnGhost} mt-1`}
          >
            Done
          </button>
        </div>
      )}

      {phase === 'idle' && enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} max-w-40`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="TOTP or recovery code"
          />
          <button onClick={() => void disable()} disabled={busy} className={btnDanger}>
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
            Disable 2FA
          </button>
        </div>
      )}
    </div>
  );
};

const ListEditor: React.FC<{
  title: string;
  mailboxId: string;
  kind: 'whitelist' | 'blacklist';
  onNotify: ClientPanelProps['onNotify'];
}> = ({ title, mailboxId, kind, onNotify }) => {
  const [rows, setRows] = useState<ListEntry[]>([]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ whitelist?: ListEntry[]; blacklist?: ListEntry[] }>(
        `/client/mailboxes/${enc(mailboxId)}/${kind}`
      );
      setRows(Array.isArray(kind === 'whitelist' ? r?.whitelist : r?.blacklist) ? ((kind === 'whitelist' ? r?.whitelist : r?.blacklist) as ListEntry[]) : []);
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [mailboxId, kind, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const v = value.trim().toLowerCase();
    if (!v) {
      onNotify('Enter an email or domain', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(mailboxId)}/${kind}`, { method: 'POST', body: { value: v } });
      setValue('');
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: ListEntry) => {
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(mailboxId)}/${kind}/${enc(entry.id)}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{title}</h4>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} max-w-xs`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sender@example.com or example.com"
        />
        <button onClick={() => void add()} disabled={busy} className={btnPrimary}>
          <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
          Add
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text={`Nothing ${kind}ed yet.`} />
      ) : (
        <div className="mt-2 divide-y divide-[#F2F4F7] dark:divide-[#333538]">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3] truncate">{r.value}</span>
              <button onClick={() => void remove(r)} disabled={busy} className="btn btn-ghost btn-xs h-7 min-h-7 text-[#B3261E] dark:text-[#F28B82]" title="Remove">
                <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SecuritySection: React.FC<{
  domains: Domain[];
  userEmail: string;
  onNotify: ClientPanelProps['onNotify'];
}> = ({ domains, onNotify }) => {
  const [allMailboxes, setAllMailboxes] = useState<ClientMailbox[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loadingList, setLoadingList] = useState(domains.length > 0);

  const [logins, setLogins] = useState<LoginEntry[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [quarantine, setQuarantine] = useState<QuarantineEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [secLoading, setSecLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Build the mailbox selector from every domain's mailbox list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (domains.length === 0) {
        setAllMailboxes([]);
        setLoadingList(false);
        return;
      }
      setLoadingList(true);
      const results = await Promise.allSettled(
        domains.map((d) => apiFetch<{ mailboxes?: ClientMailbox[] }>(`/client/domains/${enc(d.domain)}/mailboxes`))
      );
      if (cancelled) return;
      const list: ClientMailbox[] = [];
      results.forEach((r) => {
        if (r.status === 'fulfilled' && Array.isArray(r.value?.mailboxes)) list.push(...r.value.mailboxes);
      });
      setAllMailboxes(list);
      setLoadingList(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [domains]);

  const loadSecurity = useCallback(async () => {
    if (!selectedId) return;
    setSecLoading(true);
    const base = `/client/mailboxes/${enc(selectedId)}`;
    const [lh, ss, q] = await Promise.allSettled([
      apiFetch<{ logins?: LoginEntry[] }>(`${base}/login-history`),
      apiFetch<{ sessions?: SessionEntry[] }>(`${base}/sessions`),
      apiFetch<{ messages?: QuarantineEntry[] }>(`${base}/quarantine`),
    ]);
    setLogins(lh.status === 'fulfilled' ? (Array.isArray(lh.value?.logins) ? lh.value.logins : []) : []);
    setSessions(ss.status === 'fulfilled' ? (Array.isArray(ss.value?.sessions) ? ss.value.sessions : []) : []);
    setQuarantine(q.status === 'fulfilled' ? (Array.isArray(q.value?.messages) ? q.value.messages : []) : []);
    if (lh.status === 'rejected') onNotify(errMsg(lh.reason), 'error');
    if (ss.status === 'rejected') onNotify(errMsg(ss.reason), 'error');
    if (q.status === 'rejected') onNotify(errMsg(q.reason), 'error');
    setSecLoading(false);
  }, [selectedId, onNotify]);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  // Audit log is client-wide; load once when the section is shown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      try {
        const r = await apiFetch<{ entries?: AuditEntry[] }>('/client/audit-log');
        if (!cancelled) setAudit(Array.isArray(r?.entries) ? r.entries : []);
      } catch (e) {
        if (!cancelled) onNotify(errMsg(e), 'error');
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onNotify]);

  const revoke = async (sid: string) => {
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(selectedId)}/sessions/${enc(sid)}`, { method: 'DELETE' });
      onNotify('Session revoked', 'success');
      await loadSecurity();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    if (!confirm('Revoke every active session for this mailbox? Users will need to sign in again.')) return;
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(selectedId)}/sessions`, { method: 'POST' });
      onNotify('All sessions revoked', 'success');
      await loadSecurity();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const release = async (mid: string) => {
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(selectedId)}/quarantine/${enc(mid)}/release`, { method: 'POST' });
      onNotify('Message released', 'success');
      await loadSecurity();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteQuarantined = async (mid: string) => {
    if (!confirm('Delete this quarantined message permanently?')) return;
    setBusy(true);
    try {
      await apiFetch(`/client/mailboxes/${enc(selectedId)}/quarantine/${enc(mid)}`, { method: 'DELETE' });
      onNotify('Message deleted', 'success');
      await loadSecurity();
    } catch (e) {
      onNotify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const selected = allMailboxes.find((m) => m.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Security</h3>
          <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            Per-mailbox login history, sessions, quarantine, sender lists and 2FA.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-[#444746] dark:text-[#C4C7C5]">
          Mailbox
          <select
            className="select select-bordered select-sm max-w-64"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={loadingList}
          >
            <option value="">{loadingList ? 'Loading mailboxes…' : 'Select a mailbox'}</option>
            {allMailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selectedId ? (
        <Empty text="Select a mailbox to view its security details." />
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Login history — F-089 */}
            <div className={card}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Login history</h4>
                <span className={label}>Last 100 events</span>
              </div>
              {secLoading ? (
                <Loading />
              ) : logins.length === 0 ? (
                <Empty text="No logins recorded for this mailbox yet." />
              ) : (
                <div className="mt-2 divide-y divide-[#F2F4F7] dark:divide-[#333538] max-h-72 overflow-y-auto">
                  {logins.map((l, i) => (
                    <div key={`${l.ts ?? i}-${i}`} className="py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{fmtWhen(l.ts)}</span>
                        <Badge tone={l.success ? 'ok' : 'bad'}>{l.success ? 'Success' : 'Failed'}</Badge>
                        <Badge tone="muted">{l.protocol || 'Unknown'}</Badge>
                      </div>
                      <div className="mt-0.5 text-[#5E5E5E] dark:text-[#8E918F]">
                        {l.ip || '—'}
                        {l.geo_city || l.geo_country ? ` · ${[l.geo_city, l.geo_country].filter(Boolean).join(', ')}` : ''}
                        {l.user_agent ? ` · ${l.user_agent}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active sessions — F-090 */}
            <div className={card}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Active sessions</h4>
                {sessions.length > 0 && (
                  <button onClick={() => void revokeAll()} disabled={busy} className={btnGhost}>
                    <LogOut className="w-3.5 h-3.5 stroke-[1.5]" />
                    Revoke all
                  </button>
                )}
              </div>
              {secLoading ? (
                <Loading />
              ) : sessions.length === 0 ? (
                <Empty text="No active sessions for this mailbox." />
              ) : (
                <div className="mt-2 divide-y divide-[#F2F4F7] dark:divide-[#333538] max-h-72 overflow-y-auto">
                  {sessions.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone="muted">{s.protocol || 'session'}</Badge>
                          <span className="text-[#1F1F1F] dark:text-[#E3E3E3] font-medium">{s.ip || '—'}</span>
                        </div>
                        <div className="mt-0.5 text-[#5E5E5E] dark:text-[#8E918F]">
                          Started {fmtWhen(s.started_at)}
                          {s.idle_seconds !== null && s.idle_seconds !== undefined ? ` · idle ${Math.round(s.idle_seconds / 60)} min` : ''}
                          {s.user_agent ? ` · ${s.user_agent}` : ''}
                        </div>
                      </div>
                      <button onClick={() => void revoke(s.id)} disabled={busy} className={btnDanger}>
                        <LogOut className="w-3.5 h-3.5 stroke-[1.5]" />
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quarantine — F-091 */}
            <div className={card}>
              <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Quarantine</h4>
              {secLoading ? (
                <Loading />
              ) : quarantine.length === 0 ? (
                <Empty text="No messages in quarantine." />
              ) : (
                <div className="mt-2 divide-y divide-[#F2F4F7] dark:divide-[#333538] max-h-72 overflow-y-auto">
                  {quarantine.map((q) => (
                    <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">{q.subject || '(no subject)'}</div>
                        <div className="mt-0.5 text-[#5E5E5E] dark:text-[#8E918F]">
                          {q.sender || '—'} · score {q.spam_score ?? '—'} · {fmtWhen(q.received_at)} · {fmtBytes(q.size_bytes)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => void release(q.id)} disabled={busy} className={btnGhost}>
                          <MailCheck className="w-3.5 h-3.5 stroke-[1.5]" />
                          Release
                        </button>
                        <button onClick={() => void deleteQuarantined(q.id)} disabled={busy} className="btn btn-ghost btn-xs h-7 min-h-7 text-[#B3261E] dark:text-[#F28B82]" title="Delete permanently">
                          <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Whitelist / blacklist — F-092 */}
            <div className="space-y-4">
              <ListEditor title="Whitelist — always deliver" mailboxId={selectedId} kind="whitelist" onNotify={onNotify} />
              <ListEditor title="Blacklist — always reject" mailboxId={selectedId} kind="blacklist" onNotify={onNotify} />
            </div>
          </div>

          {/* 2FA — F-085 */}
          <TwoFaCard mailboxId={selectedId} onNotify={onNotify} onChanged={() => void loadSecurity()} />

          {/* Audit log — F-095 */}
          <div className={card}>
            <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Audit log</h4>
            <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              Recent actions taken on this workspace by client admins and the platform.
            </p>
            {auditLoading ? (
              <Loading />
            ) : audit.length === 0 ? (
              <Empty text="No audit entries yet." />
            ) : (
              <div className="mt-2 divide-y divide-[#F2F4F7] dark:divide-[#333538] max-h-80 overflow-y-auto">
                {audit.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{a.action || 'action'}</span>
                        <Badge tone="muted">{a.target_type || '—'}</Badge>
                      </div>
                      <div className="mt-0.5 text-[#5E5E5E] dark:text-[#8E918F] truncate">
                        {a.actor || '—'}
                        {a.target_id ? ` → ${a.target_id}` : ''}
                        {a.details ? ` · ${typeof a.details === 'string' ? a.details : JSON.stringify(a.details)}` : ''}
                        {a.ip ? ` · ${a.ip}` : ''}
                      </div>
                    </div>
                    <span className="text-[#5E5E5E] dark:text-[#8E918F] whitespace-nowrap">{fmtWhen(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------- Panel */

const NAV: { id: Section; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'mailboxes', label: 'Mailboxes', icon: MailboxIcon },
  { id: 'aliases', label: 'Aliases', icon: AtSign },
  { id: 'lists', label: 'Distribution lists', icon: Users },
  { id: 'settings', label: 'Domain settings', icon: KeyRound },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];

export const ClientPanel: React.FC<ClientPanelProps> = ({ userEmail, onNotify, onBack }) => {
  const [section, setSection] = useState<Section>('dashboard');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainsLoaded, setDomainsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listDomains();
        if (!cancelled) setDomains(Array.isArray(r?.domains) ? r.domains : []);
      } catch (e) {
        if (!cancelled) onNotify(errMsg(e), 'error');
      } finally {
        if (!cancelled) setDomainsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onNotify]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-base-100 text-base-content">
      {/* Left section nav */}
      <nav className="hidden md:flex w-56 shrink-0 flex-col border-r border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] p-3">
        <div className="flex items-center gap-2 px-2 py-2">
          <Globe className="w-5 h-5 stroke-[1.5] text-[#0B57D0]" />
          <span className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Domain panel</span>
        </div>
        <div className="mt-2 flex flex-col gap-0.5">
          {NAV.map(({ id, label: lbl, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                section === id
                  ? 'bg-[#E8F0FE] dark:bg-[#1E3329] text-[#0B57D0] dark:text-[#A8C7FA] font-medium'
                  : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <Icon className="w-4 h-4 stroke-[1.5] shrink-0" />
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="px-2 pb-1">
          <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F] truncate">{userEmail}</p>
        </div>
        <button onClick={onBack} className={`${btnGhost} mt-1 justify-start`}>
          <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
          Back to webmail
        </button>
      </nav>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center justify-between gap-2 px-3 py-2 border-b border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20]">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="w-4 h-4 stroke-[1.5] text-[#0B57D0] shrink-0" />
            <span className="text-sm font-semibold truncate">Domain panel</span>
          </div>
          <button onClick={onBack} className={btnGhost}>
            <ArrowLeft className="w-3.5 h-3.5 stroke-[1.5]" />
            Back
          </button>
        </div>
        {/* Mobile section switcher */}
        <div className="md:hidden flex gap-1 overflow-x-auto px-2 py-2 border-b border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20]">
          {NAV.map(({ id, label: lbl, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                section === id
                  ? 'bg-[#E8F0FE] dark:bg-[#1E3329] text-[#0B57D0] dark:text-[#A8C7FA] font-medium'
                  : 'text-[#444746] dark:text-[#C4C7C5]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 stroke-[1.5]" />
              {lbl}
            </button>
          ))}
        </div>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {!domainsLoaded ? (
            <Loading text="Loading domains…" />
          ) : (
            <>
              {section === 'dashboard' && <DashboardSection domains={domains} onNotify={onNotify} />}
              {section === 'mailboxes' && <MailboxSection domains={domains} onNotify={onNotify} />}
              {section === 'aliases' && <AliasSection domains={domains} onNotify={onNotify} />}
              {section === 'lists' && <ListSection domains={domains} onNotify={onNotify} />}
              {section === 'settings' && <SettingsSection domains={domains} onNotify={onNotify} />}
              {section === 'reports' && <ReportsSection domains={domains} onNotify={onNotify} />}
              {section === 'security' && <SecuritySection domains={domains} userEmail={userEmail} onNotify={onNotify} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
};
