import React, { useCallback, useEffect, useState } from 'react';
import {
  Globe,
  Users,
  HardDrive,
  ShieldCheck,
  Activity,
  Plus,
  Database,
  ArrowRight,
  Sun,
  Moon,
  CheckCircle,
  AlertTriangle,
  RotateCw,
  Layers,
  Terminal,
  Menu,
  X,
  LogIn,
  KeyRound,
  Gauge,
  Forward,
  ListOrdered,
  Route,
  Copy,
  Search,
  Trash2,
  Play,
  Power,
  Inbox,
  ScrollText,
} from 'lucide-react';
import { AffinMailLogo } from './AffinMailLogo';
import {
  type Domain,
  type Mailbox,
  type IpPool,
  type StorageStatus,
  type Health,
  getToken,
  clearToken,
  adminLogin,
  adminLogout,
  createSsoLink,
  setMailboxQuota,
  setMailboxPassword,
  type Alias,
  listAliases,
  createAlias,
  deleteAlias,
  type QueuedMessage,
  getQueue,
  deleteQueuedMessage,
  retryQueuedMessage,
  type Deliverability,
  getDeliverability,
  setCatchAll,
  rotateDkim,
  trackMail,
  getSystemLogs,
  health as apiHealth,
  listDomains,
  createDomain,
  deleteDomain,
  listMailboxes,
  createMailbox,
  setMailboxStatus,
  deleteMailbox,
  listIpPools,
  createIpPool,
  assignIpPool,
  getStorage,
  triggerBackup,
  restartSystem,
} from '../lib/adminApi';

interface AdminPanelProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSwitchToWebmail: () => void;
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type AdminTab =
  | 'dashboard'
  | 'domains'
  | 'mailboxes'
  | 'aliases'
  | 'queue'
  | 'track'
  | 'ippools'
  | 'storage'
  | 'system';

interface DomainRow {
  id: string;
  name: string;
  mailboxesCount: number;
  diskUsed: string;
  diskLimit: string;
  ipType: string;
  assignedIp: string | null;
  dkimStatus: string;
  status: string;
}

interface MailboxRow {
  id: string;
  email: string;
  domain: string;
  quota: string;
  quotaMb: number;
  used: string;
  route: string;
  status: string;
  isServerOnly: boolean;
}

interface IpPoolRow {
  id: string;
  ip: string;
  type: string;
  rdns: string;
  domainsCount: number;
  rblClean: boolean;
  warmupDay: number;
}

function fmtBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function qStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function queueSender(item: QueuedMessage): string {
  const env = item.envelope as { mailFrom?: unknown } | undefined;
  return qStr(item.mailFrom) || qStr(item.from) || qStr(env?.mailFrom) || '—';
}

function queueRecipients(item: QueuedMessage): string {
  const raw = (item.recipients ?? item.rcpts ?? item.rcptTo ?? item.recipient) as unknown;
  const one = (v: unknown): string =>
    typeof v === 'string'
      ? v
      : v && typeof v === 'object'
        ? qStr((v as { email?: unknown }).email) || qStr((v as { address?: unknown }).address)
        : '';
  if (Array.isArray(raw)) return raw.map(one).filter(Boolean).join(', ') || '—';
  return one(raw) || '—';
}

function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg === 'unauthorized' || msg.includes('401');
}

/* ---------------------------------------------------------- shared bits */
/* WHM visual system: flat bordered panels, 1px gray rules, small radii,
   13px data text, compact 28-32px controls. No shadows, no pastel fills. */

const PANEL = 'border border-gray-300 bg-white dark:border-[#374151] dark:bg-[#111827]';
const PANEL_HD =
  'flex flex-wrap items-center justify-between gap-2 border-b border-gray-300 bg-gray-100 px-3 py-1.5 min-h-9 dark:border-[#374151] dark:bg-[#0f172a]';
const INPUT =
  'h-8 w-full rounded border border-gray-300 bg-white px-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-[#0B57D0] focus:outline-none focus:ring-1 focus:ring-[#0B57D0] dark:border-[#4b5563] dark:bg-[#0f172a] dark:text-gray-100 dark:placeholder:text-gray-500';
const LABEL = 'block text-[12px] font-semibold text-gray-700 dark:text-gray-300 mb-1';
const MUTED = 'text-gray-500 dark:text-gray-400';

type BtnVariant = 'primary' | 'outline' | 'ghost' | 'danger';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-[#0B57D0] hover:bg-[#0842A0] text-white border-[#0B57D0]',
  outline:
    'bg-white hover:bg-gray-50 text-gray-700 border-gray-300 dark:bg-[#111827] dark:hover:bg-[#1f2937] dark:text-gray-200 dark:border-[#4b5563]',
  ghost:
    'bg-transparent hover:bg-gray-100 text-gray-600 border-transparent dark:hover:bg-[#1f2937] dark:text-gray-300',
  danger:
    'bg-transparent hover:bg-red-50 text-red-700 border-transparent dark:hover:bg-red-950/40 dark:text-red-400',
};
const btn = (variant: BtnVariant = 'outline', size: 'sm' | 'xs' = 'sm'): string =>
  `inline-flex items-center justify-center gap-1.5 rounded border font-medium whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none ${
    size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-6 px-2 text-[12px]'
  } ${BTN[variant]}`;
const btnIcon = (variant: BtnVariant = 'ghost'): string =>
  `inline-flex items-center justify-center h-6 w-6 rounded border shrink-0 disabled:opacity-50 ${BTN[variant]}`;

const BADGE = 'inline-flex items-center gap-1 rounded-sm border px-1.5 h-5 text-[11px] font-medium';
const BADGE_OK = `${BADGE} border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300`;
const BADGE_WARN = `${BADGE} border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300`;
const BADGE_BAD = `${BADGE} border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300`;
const BADGE_NEUTRAL = `${BADGE} border-gray-300 bg-gray-100 text-gray-700 dark:border-[#4b5563] dark:bg-[#1f2937] dark:text-gray-300`;

const PageHeader: React.FC<{
  title: string;
  description?: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <div className="flex flex-col gap-2 border-b border-gray-300 pb-2 sm:flex-row sm:items-end sm:justify-between dark:border-[#374151]">
    <div className="min-w-0">
      <h1 className="text-[20px] font-semibold leading-tight text-gray-900 dark:text-gray-100">{title}</h1>
      {description && <p className={`text-[12px] mt-0.5 ${MUTED}`}>{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-1.5 shrink-0">{actions}</div>}
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode; actions?: React.ReactNode }> = ({
  children,
  actions,
}) => (
  <div className={PANEL_HD}>
    <h2 className="text-[12px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
      {children}
    </h2>
    {actions}
  </div>
);

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
}> = ({ icon, title, description }) => (
  <div className={`flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center ${MUTED}`}>
    <span className="text-gray-400 dark:text-gray-500">{icon}</span>
    <p className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{title}</p>
    {description && <p className="text-[12px] max-w-sm">{description}</p>}
  </div>
);

const SkeletonRows: React.FC<{ cols: number; rows?: number }> = ({ cols, rows = 6 }) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r} className="border-t border-gray-200 dark:border-[#374151]">
        <td colSpan={cols} className="px-3 py-2">
          <div className="h-3 w-full animate-pulse rounded-sm bg-gray-200 dark:bg-[#1f2937]" />
        </td>
      </tr>
    ))}
  </>
);

const AdminModal: React.FC<{
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ title, description, onClose, children, wide = false }) => (
  <div
    className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div
      className={`my-auto w-full ${wide ? 'max-w-3xl' : 'max-w-md'} rounded border border-gray-300 bg-white shadow-sm dark:border-[#374151] dark:bg-[#111827]`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-gray-300 px-3 py-2 dark:border-[#374151]">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          {description && <p className={`text-[12px] mt-0.5 ${MUTED}`}>{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className={btnIcon('ghost')}
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="max-h-[80dvh] overflow-y-auto p-3">{children}</div>
    </div>
  </div>
);

const StatusBadge: React.FC<{ active: boolean }> = ({ active }) => (
  <span className={active ? BADGE_OK : BADGE_BAD}>{active ? 'Active' : 'Suspended'}</span>
);

/* Dense table: rows stay rows at every width; narrow screens scroll the panel. */
const T = {
  row: 'border-t border-gray-200 even:bg-gray-50 hover:bg-[#eef3fb] dark:border-[#374151] dark:even:bg-[#0f172a] dark:hover:bg-[#1f2937]',
  primary: '',
  cell: '',
  actions: 'text-right',
};
const TABLE =
  'w-full min-w-[640px] border-collapse text-left text-[13px] text-gray-800 dark:text-gray-200';
const TH = 'whitespace-nowrap bg-gray-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-[#0f172a] dark:text-gray-400';
const TD = 'px-3 py-1.5 align-middle';
const CODE = 'font-mono text-[12px] tabular-nums';

export const AdminPanel: React.FC<AdminPanelProps> = ({
  theme,
  onToggleTheme,
  onSwitchToWebmail,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Auth gate
  const [authed, setAuthed] = useState(() => !!getToken());
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  // Data
  const [loading, setLoading] = useState(false);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxRow[]>([]);
  const [mailboxFilter, setMailboxFilter] = useState('');
  const [ipPools, setIpPools] = useState<IpPoolRow[]>([]);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [healthData, setHealthData] = useState<Health | null>(null);

  // Modals
  const [showAddDomainModal, setShowAddDomainModal] = useState(false);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainIp, setNewDomainIp] = useState('');

  const [selectedDnsDomain, setSelectedDnsDomain] = useState<string | null>(null);
  const [deliv, setDeliv] = useState<Deliverability | null>(null);
  const [delivLoading, setDelivLoading] = useState(false);
  const [catchAllInput, setCatchAllInput] = useState('');

  const [showAddMailboxModal, setShowAddMailboxModal] = useState(false);
  const [newMailboxUser, setNewMailboxUser] = useState('');
  const [newMailboxDomain, setNewMailboxDomain] = useState('');
  const [newMailboxPass, setNewMailboxPass] = useState('');
  const [newMailboxQuota, setNewMailboxQuota] = useState('5120');

  const [showAddIpModal, setShowAddIpModal] = useState(false);
  const [newIpAddress, setNewIpAddress] = useState('');
  const [newIpRdns, setNewIpRdns] = useState('');
  const [newIpType, setNewIpType] = useState<'shared' | 'dedicated'>('shared');

  const logout = useCallback((msg?: string) => {
    void adminLogout();
    clearToken();
    setAuthed(false);
    setDomains([]);
    setMailboxes([]);
    setIpPools([]);
    setStorage(null);
    setHealthData(null);
    if (msg) onNotify(msg, 'error');
  }, [onNotify]);

  const fail = useCallback((e: unknown) => {
    if (isAuthError(e)) {
      logout('Session expired — sign in again');
    } else {
      onNotify(e instanceof Error ? e.message : 'Request failed', 'error');
    }
  }, [logout, onNotify]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [d, m, ip, st, h] = await Promise.all([
        listDomains(),
        listMailboxes(),
        listIpPools(),
        getStorage(),
        apiHealth(),
      ]);
      const poolById = new Map(ip.ipPools.map((p) => [p.id, p]));
      setDomains(
        d.domains.map((dom: Domain): DomainRow => {
          const pool = dom.assignedIpId ? poolById.get(dom.assignedIpId) : undefined;
          return {
            id: dom.domain,
            name: dom.domain,
            mailboxesCount: dom.mailboxCount ?? 0,
            diskUsed: '—',
            diskLimit: fmtBytes(dom.diskQuotaMb * 1024 * 1024),
            ipType: pool?.pool_type ?? 'shared',
            assignedIp: pool?.ip_address ?? null,
            dkimStatus: dom.dkimPublicKey ? 'active' : 'missing',
            status: dom.isActive ? 'active' : 'inactive',
          };
        })
      );
      setMailboxes(
        m.mailboxes.map((mb: Mailbox): MailboxRow => ({
          id: mb.id,
          email: mb.email,
          domain: mb.domain ?? mb.email.split('@')[1] ?? '',
          quota: mb.quotaLimitMb > 0 ? `${mb.quotaLimitMb} MB` : 'Unlimited',
          quotaMb: mb.quotaLimitMb,
          isServerOnly: mb.id.startsWith('stalwart:'),
          used: fmtBytes(mb.quotaUsedBytes),
          route: mb.outboundRoute,
          status: mb.status,
        }))
      );
      setIpPools(
        ip.ipPools.map((p: IpPool): IpPoolRow => ({
          id: p.id,
          ip: p.ip_address,
          type: p.pool_type,
          rdns: p.rdns_hostname,
          domainsCount: p.current_allocations,
          rblClean: !p.is_blacklisted,
          warmupDay: 0,
        }))
      );
      setStorage(st);
      setHealthData(h);
      setNewMailboxDomain((prev) => prev || d.domains[0]?.domain || '');
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    if (authed) void loadData();
  }, [authed, loadData]);

  useEffect(() => {
    if (!selectedDnsDomain) return;
    let cancelled = false;
    setDelivLoading(true);
    setDeliv(null);
    getDeliverability(selectedDnsDomain)
      .then((r) => {
        if (!cancelled) {
          setDeliv(r);
          setCatchAllInput(r.catchAllAddress ?? '');
        }
      })
      .catch((e) => {
        if (!cancelled) fail(e);
      })
      .finally(() => {
        if (!cancelled) setDelivLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDnsDomain, fail]);

  const handleLogin = async () => {
    const username = usernameInput.trim();
    if (!username || !passwordInput) {
      setAuthError('Enter the server administrator username and password');
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    try {
      await adminLogin(username, passwordInput);
      setPasswordInput('');
      setAuthed(true);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCreateDomain = async () => {
    if (!newDomainName.trim()) {
      onNotify('Enter a valid domain name', 'error');
      return;
    }
    const name = newDomainName.toLowerCase().trim();
    try {
      await createDomain({ domain: name });
      if (newDomainIp) {
        await assignIpPool(name, newDomainIp);
      }
      setNewDomainName('');
      setNewDomainIp('');
      setShowAddDomainModal(false);
      onNotify(`Domain ${name} provisioned with 2048-bit DKIM keys`, 'success');
      await loadData();
    } catch (e) {
      fail(e);
    }
  };

  const handleDeleteDomain = async (name: string) => {
    if (!confirm(`Delete domain ${name}? This removes its mailboxes.`)) return;
    try {
      await deleteDomain(name);
      onNotify(`Domain ${name} removed`, 'info');
      await loadData();
    } catch (e) {
      fail(e);
    }
  };

  const handleAssignIp = async (name: string) => {
    if (ipPools.length === 0) {
      onNotify('No IP pools available', 'error');
      return;
    }
    const ip = prompt(`Assign which IP to ${name}?\nAvailable: ${ipPools.map((p) => p.ip).join(', ')}`);
    if (!ip) return;
    try {
      await assignIpPool(name, ip.trim());
      onNotify(`IP ${ip.trim()} assigned to ${name}`, 'success');
      await loadData();
    } catch (e) {
      fail(e);
    }
  };

  const handleCreateMailbox = async () => {
    if (!newMailboxUser.trim() || !newMailboxPass.trim() || !newMailboxDomain) {
      onNotify('Username, domain, and password are required', 'error');
      return;
    }
    const fullEmail = `${newMailboxUser.trim()}@${newMailboxDomain}`;
    try {
      await createMailbox({
        email: fullEmail,
        password: newMailboxPass,
        quotaLimitMb: Number(newMailboxQuota) || 5120,
        outboundRoute: 'direct',
      });
      setNewMailboxUser('');
      setNewMailboxPass('');
      setShowAddMailboxModal(false);
      onNotify(`Mailbox ${fullEmail} created`, 'success');
      await loadData();
    } catch (e) {
      fail(e);
    }
  };

  const handleToggleMailboxStatus = async (mb: MailboxRow) => {
    if (mb.isServerOnly) {
      onNotify('This mailbox is managed on the mail server itself', 'error');
      return;
    }
    const next = mb.status === 'active' ? 'suspended' : 'active';
    try {
      await setMailboxStatus(mb.email, next);
      onNotify(`Mailbox ${mb.email} ${next}`, 'info');
      await loadData();
    } catch (e) {
      fail(e);
    }
  };

  const handleDeleteMailbox = async (mb: MailboxRow) => {
    if (mb.isServerOnly) {
      onNotify('This mailbox is managed on the mail server itself', 'error');
      return;
    }
    if (!confirm(`Delete mailbox ${mb.email}?`)) return;
    try {
      await deleteMailbox(mb.email);
      onNotify(`Mailbox ${mb.email} deleted`, 'info');
      await loadData();
    } catch (e) {
      fail(e);
    }
  };

  const handleCreateIpPool = async () => {
    if (!newIpAddress.trim() || !newIpRdns.trim()) {
      onNotify('IP address and rDNS hostname are required', 'error');
      return;
    }
    try {
      await createIpPool({
        ip_address: newIpAddress.trim(),
        pool_type: newIpType,
        rdns_hostname: newIpRdns.trim(),
      });
      setNewIpAddress('');
      setNewIpRdns('');
      setShowAddIpModal(false);
      onNotify(`Outbound IP ${newIpAddress.trim()} bound`, 'success');
      await loadData();
    } catch (e) {
      fail(e);
    }
  };

  // Aliases
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [newAliasSource, setNewAliasSource] = useState('');
  const [newAliasDest, setNewAliasDest] = useState('');

  const loadAliases = useCallback(async () => {
    try {
      const r = await listAliases();
      setAliases(r.aliases);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'aliases') void loadAliases();
  }, [authed, activeTab, loadAliases]);

  const handleCreateAlias = async () => {
    const source = newAliasSource.trim().toLowerCase();
    const destination = newAliasDest.trim().toLowerCase();
    if (!source || !destination) {
      onNotify('Source and destination addresses are required', 'error');
      return;
    }
    try {
      await createAlias(source, destination);
      setNewAliasSource('');
      setNewAliasDest('');
      onNotify(`Alias ${source} → ${destination} created`, 'success');
      await loadAliases();
    } catch (e) {
      fail(e);
    }
  };

  const handleDeleteAlias = async (a: Alias) => {
    if (!confirm(`Delete alias ${a.source_address}?`)) return;
    try {
      await deleteAlias(a.id);
      onNotify('Alias removed', 'info');
      await loadAliases();
    } catch (e) {
      fail(e);
    }
  };

  // Mail queue
  const [queueItems, setQueueItems] = useState<QueuedMessage[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const r = await getQueue();
      setQueueItems(r.messages);
    } catch (e) {
      fail(e);
    } finally {
      setQueueLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    if (authed) void loadQueue();
  }, [authed, loadQueue]);

  const handleQueueDelete = async (item: QueuedMessage) => {
    if (!confirm(`Remove queued message ${item.id} from the queue?`)) return;
    try {
      await deleteQueuedMessage(item.id);
      onNotify('Queued message removed', 'info');
      await loadQueue();
    } catch (e) {
      fail(e);
    }
  };

  const handleQueueRetry = async (item: QueuedMessage) => {
    try {
      await retryQueuedMessage(item.id);
      onNotify('Queued message rescheduled for immediate delivery', 'success');
      await loadQueue();
    } catch (e) {
      fail(e);
    }
  };

  // Track delivery
  const [trackQuery, setTrackQuery] = useState('');
  const [trackHours, setTrackHours] = useState(24);
  const [trackLines, setTrackLines] = useState<string[] | null>(null);
  const [trackBusy, setTrackBusy] = useState(false);

  const handleTrackSearch = async () => {
    const q = trackQuery.trim();
    if (q.length < 3) {
      onNotify('Enter at least 3 characters to search the mail log', 'error');
      return;
    }
    setTrackBusy(true);
    try {
      const r = await trackMail(q, trackHours);
      setTrackLines(r.lines);
    } catch (e) {
      fail(e);
    } finally {
      setTrackBusy(false);
    }
  };

  // Mail server log (System tab)
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const r = await getSystemLogs(50);
      setLogLines(r.lines);
    } catch (e) {
      fail(e);
    } finally {
      setLogsLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'system') void loadLogs();
  }, [authed, activeTab, loadLogs]);

  // Deliverability actions (DNS modal)
  const refreshDeliv = async () => {
    if (!selectedDnsDomain) return;
    try {
      const r = await getDeliverability(selectedDnsDomain);
      setDeliv(r);
      setCatchAllInput(r.catchAllAddress ?? '');
    } catch (e) {
      fail(e);
    }
  };

  const handleRotateDkim = async () => {
    if (!selectedDnsDomain) return;
    if (!confirm(`Rotate the DKIM key for ${selectedDnsDomain}? A new DNS record must be published for the new selector.`)) return;
    try {
      const r = await rotateDkim(selectedDnsDomain);
      onNotify(`New DKIM selector ${r.selector} created — publish its DNS record`, 'success');
      await refreshDeliv();
    } catch (e) {
      fail(e);
    }
  };

  const handleSaveCatchAll = async () => {
    if (!selectedDnsDomain) return;
    try {
      const r = await setCatchAll(selectedDnsDomain, catchAllInput === '' ? null : catchAllInput);
      onNotify(
        r.catchAllAddress ? `Catch-all for ${selectedDnsDomain} now delivers to ${r.catchAllAddress}` : `Catch-all for ${selectedDnsDomain} removed`,
        'success'
      );
      await refreshDeliv();
    } catch (e) {
      fail(e);
    }
  };

  // Mailbox SSO + password + quota
  const [passwordTarget, setPasswordTarget] = useState<MailboxRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [quotaTarget, setQuotaTarget] = useState<MailboxRow | null>(null);
  const [newQuota, setNewQuota] = useState('');
  const handleOpenMailbox = async (mb: MailboxRow) => {
    try {
      const r = await createSsoLink(mb.email);
      window.open(r.ssoUrl, '_blank', 'noopener');
      onNotify(`Opening ${mb.email} in a new tab`, 'info');
    } catch (e) {
      fail(e);
    }
  };

  const handleResetPassword = async () => {
    if (!passwordTarget) return;
    if (newPassword.length < 8) {
      onNotify('Password must be at least 8 characters', 'error');
      return;
    }
    try {
      await setMailboxPassword(passwordTarget.email, newPassword);
      onNotify(`Password updated for ${passwordTarget.email}`, 'success');
      setPasswordTarget(null);
      setNewPassword('');
    } catch (e) {
      fail(e);
    }
  };

  const handleSaveQuota = async () => {
    if (!quotaTarget) return;
    const mb = Number(newQuota);
    if (!Number.isFinite(mb) || mb < 1) {
      onNotify('Enter a quota of at least 1 MB', 'error');
      return;
    }
    try {
      await setMailboxQuota(quotaTarget.email, mb);
      onNotify(`Quota for ${quotaTarget.email} set to ${mb} MB`, 'success');
      setQuotaTarget(null);
      await loadData();
    } catch (e) {
      fail(e);
    }
  };

  const handleBackup = async () => {
    try {
      onNotify('Creating database backup…', 'info');
      const r = await triggerBackup();
      onNotify(`Backup ${r.file} (${fmtBytes(r.size_bytes)}) saved`, 'success');
    } catch (e) {
      fail(e);
    }
  };

  const handleRestart = async () => {
    if (!confirm('Restart stalwart.service? Mail delivery pauses for a few seconds.')) return;
    try {
      const r = await restartSystem();
      onNotify(`Restarting ${r.restarting}`, 'info');
    } catch (e) {
      fail(e);
    }
  };

  /* ---------------------------------------------------------------- auth gate */

  if (!authed) {
    return (
      <div className="flex min-h-dvh h-dvh w-full flex-col overflow-y-auto bg-[#111827] text-gray-100">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#374151] bg-[#1f2937] px-3">
          <div className="flex items-center gap-2">
            <AffinMailLogo variant="icon" size="xs" withTile />
            <span className="text-[12px] font-semibold uppercase tracking-wide text-gray-300">
              AffinMail server administration
            </span>
          </div>
          <button
            onClick={onToggleTheme}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#374151] text-gray-300 hover:bg-[#374151]"
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          </button>
        </div>

        <main className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-md border border-gray-300 bg-white shadow-sm dark:border-[#374151] dark:bg-[#111827]">
            <div className="flex items-center gap-2 border-b border-gray-300 bg-gray-100 px-3 py-2 dark:border-[#374151] dark:bg-[#0f172a]">
              <ShieldCheck className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <h1 className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                Administrator sign in
              </h1>
            </div>

            <form
              className="space-y-3 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleLogin();
              }}
            >
              <div>
                <label className={LABEL} htmlFor="admin-username">
                  Username
                </label>
                <input
                  id="admin-username"
                  type="text"
                  autoComplete="username"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className={`${INPUT} font-mono ${authError ? 'border-red-500' : ''}`}
                  aria-invalid={!!authError}
                  autoFocus
                />
              </div>

              <div>
                <label className={LABEL} htmlFor="admin-password">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className={`${INPUT} ${authError ? 'border-red-500' : ''}`}
                  aria-invalid={!!authError}
                />
              </div>

              {authError && (
                <div
                  className="flex items-start gap-1.5 rounded-sm border border-red-300 bg-red-50 px-2 py-1.5 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
                  <span className="min-w-0 break-words">{authError}</span>
                </div>
              )}

              <button type="submit" disabled={authBusy} className={`${btn('primary')} w-full h-8`}>
                {authBusy ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Signing in…
                  </>
                ) : (
                  <>
                    <LogIn className="w-3.5 h-3.5" />
                    Sign in
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onSwitchToWebmail}
                className="w-full border-t border-gray-200 pt-2 text-center text-[12px] text-gray-500 hover:text-[#0B57D0] dark:border-[#374151] dark:text-gray-400"
              >
                Back to webmail
              </button>
            </form>
          </div>
        </main>

        <footer className="shrink-0 px-3 py-2 text-center text-[11px] text-gray-500">
          AffinMail core · Secure administrator session
        </footer>
      </div>
    );
  }

  /* ---------------------------------------------------------------- panel */

  const storageUsed = storage ? fmtBytes(storage.used_bytes) : '—';
  const checks = healthData?.checks;
  const healthyCount = checks ? [checks.postgres, checks.redis, checks.stalwart].filter(Boolean).length : 0;

  const mailboxFilterTerm = mailboxFilter.trim().toLowerCase();
  const filteredMailboxes = mailboxFilterTerm
    ? mailboxes.filter(
        (mb) =>
          mb.email.toLowerCase().includes(mailboxFilterTerm) ||
          mb.domain.toLowerCase().includes(mailboxFilterTerm)
      )
    : mailboxes;

  const navGroups: Array<{
    label: string;
    items: Array<{ id: AdminTab; label: string; icon: React.ReactNode; trailing?: React.ReactNode }>;
  }> = [
    {
      label: 'Operations',
      items: [
        { id: 'dashboard', label: 'Overview', icon: <Activity className="w-4 h-4" /> },
        {
          id: 'domains',
          label: 'Virtual domains',
          icon: <Globe className="w-4 h-4" />,
          trailing: <span className={`${BADGE_NEUTRAL} tabular-nums`}>{domains.length}</span>,
        },
        {
          id: 'mailboxes',
          label: 'Mailboxes',
          icon: <Users className="w-4 h-4" />,
          trailing: <span className={`${BADGE_NEUTRAL} tabular-nums`}>{mailboxes.length}</span>,
        },
        {
          id: 'aliases',
          label: 'Aliases',
          icon: <Forward className="w-4 h-4" />,
          trailing: <span className={`${BADGE_NEUTRAL} tabular-nums`}>{aliases.length}</span>,
        },
        {
          id: 'queue',
          label: 'Mail queue',
          icon: <ListOrdered className="w-4 h-4" />,
          trailing: (
            <span className={`${queueItems.length > 0 ? BADGE_WARN : BADGE_NEUTRAL} tabular-nums`}>
              {queueItems.length}
            </span>
          ),
        },
        { id: 'track', label: 'Track delivery', icon: <Route className="w-4 h-4" /> },
      ],
    },
    {
      label: 'Infrastructure',
      items: [
        { id: 'ippools', label: 'IP pools', icon: <Layers className="w-4 h-4" /> },
        { id: 'storage', label: 'Storage engine', icon: <HardDrive className="w-4 h-4" /> },
        { id: 'system', label: 'System controls', icon: <Terminal className="w-4 h-4" /> },
      ],
    },
  ];

  const activeLabel = navGroups.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label ?? 'Overview';

  const sidebar = (
    <>
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[#374151] bg-[#1f2937] px-3 lg:hidden">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-gray-300">Navigation</span>
        <button
          type="button"
          onClick={() => setIsMobileNavOpen(false)}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#374151] text-gray-300 hover:bg-[#374151]"
          aria-label="Close navigation"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2" aria-label="Admin sections">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-3">
            <p className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${MUTED}`}>
              {group.label}
            </p>
            <ul>
              {group.items.map((item) => {
                const active = activeTab === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        if (window.innerWidth < 1024) setIsMobileNavOpen(false);
                      }}
                      className={`flex h-8 w-full items-center gap-2 border-l-2 px-3 text-[13px] ${
                        active
                          ? 'border-l-[#0B57D0] bg-[#e8eefb] font-semibold text-[#0B57D0] dark:border-l-[#A8C7FA] dark:bg-[#1f2b3f] dark:text-[#A8C7FA]'
                          : 'border-l-transparent text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#1f2937]'
                      }`}
                      aria-current={active ? 'page' : undefined}
                    >
                      <span className={active ? '' : 'text-gray-400 dark:text-gray-500'}>{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                      {item.trailing && <span className="ml-auto">{item.trailing}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-1.5 border-t border-gray-300 p-2 dark:border-[#374151]">
        <div className="space-y-1 border border-gray-300 bg-gray-50 px-2 py-1.5 text-[11px] dark:border-[#374151] dark:bg-[#0f172a]">
          <div className="flex items-center justify-between gap-2 font-semibold text-gray-700 dark:text-gray-200">
            <span>AffinMail core</span>
            <span className={`${CODE} text-gray-500 dark:text-gray-400`}>{healthData?.version ?? '—'}</span>
          </div>
          <p className={MUTED}>Stalwart · PostgreSQL 16 · Redis 7</p>
          <div
            className={`flex items-center gap-1.5 font-medium ${
              healthyCount === 3
                ? 'text-green-700 dark:text-green-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {healthyCount} of 3 services up
          </div>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className={`${btn('ghost', 'sm')} w-full justify-start`}
        >
          <Power className="w-3.5 h-3.5" />
          Sign out
        </button>
      </div>
    </>
  );

  const navBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-gray-300 hover:bg-white/10';

  return (
    <div className="drawer lg:drawer-open h-dvh w-full bg-gray-200 text-gray-900 dark:bg-[#0b1220] dark:text-gray-100">
      <input
        id="admin-nav"
        type="checkbox"
        className="drawer-toggle"
        checked={isMobileNavOpen}
        onChange={(e) => setIsMobileNavOpen(e.target.checked)}
        aria-label="Toggle admin navigation"
      />

      <div className="drawer-content flex flex-col h-dvh min-w-0 overflow-hidden">
        {/* Master header — WHM chrome */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[#374151] bg-[#1f2937] px-2 text-gray-100 sm:px-3">
          <div className="flex-none lg:hidden">
            <label htmlFor="admin-nav" className={navBtn} aria-label="Open navigation">
              <Menu className="w-4 h-4" />
            </label>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <AffinMailLogo variant="icon" size="xs" withTile />
            <span className="text-[13px] font-semibold tracking-tight text-white">AffinMail</span>
            <div className="hidden h-4 w-px shrink-0 bg-[#4b5563] sm:block" />
            <span className="truncate text-[13px] text-gray-400">{activeLabel}</span>
          </div>

          <div className="flex flex-none items-center gap-1 sm:gap-1.5">
            <div
              className={`hidden items-center gap-1.5 text-[11px] font-medium md:inline-flex ${
                healthyCount === 3 ? 'text-green-400' : 'text-amber-400'
              }`}
              title={`${healthyCount} of 3 services healthy`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {healthyCount === 3 ? 'Healthy' : 'Degraded'}
            </div>

            <button
              onClick={() => void loadData()}
              className={navBtn}
              title="Refresh cluster data"
              aria-label="Refresh cluster data"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onToggleTheme}
              className={navBtn}
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            <button onClick={onSwitchToWebmail} className={`${navBtn} w-auto gap-1 px-2`} title="Open client webmail">
              <span className="hidden sm:inline text-[12px]">Webmail</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button onClick={() => logout()} className={`${navBtn} w-auto gap-1 px-2`} title="Sign out">
              <Power className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[12px]">Sign out</span>
            </button>
          </div>
        </header>

        {/* Loading hairline */}
        {loading && (
          <div className="relative h-0.5 w-full overflow-hidden bg-[#0B57D0]/20 shrink-0">
            <span className="animate-gmail-progress" />
          </div>
        )}

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-gray-200 dark:bg-[#0b1220]">
          <div className="w-full space-y-3 p-3 sm:p-4">
            {/* ===================== TAB 1: DASHBOARD ===================== */}
            {activeTab === 'dashboard' && (
              <>
                <PageHeader
                  title="System overview"
                  description="Virtual domains, mailboxes, storage, and cluster health at a glance."
                  actions={
                    <>
                      <button onClick={() => setShowAddDomainModal(true)} className={btn('primary')}>
                        <Plus className="w-3.5 h-3.5" />
                        Add domain
                      </button>
                      <button onClick={() => setShowAddMailboxModal(true)} className={btn('outline')}>
                        <Plus className="w-3.5 h-3.5" />
                        Create mailbox
                      </button>
                    </>
                  }
                />

                {/* Metric strip */}
                <div className={`grid grid-cols-2 divide-gray-300 md:grid-cols-4 md:divide-x dark:divide-[#374151] ${PANEL}`}>
                  {[
                    {
                      label: 'Virtual domains',
                      value: domains.length,
                      sub: `${domains.filter((d) => d.dkimStatus === 'active').length} DKIM signed`,
                      icon: <Globe className="w-3.5 h-3.5" />,
                    },
                    {
                      label: 'Mailboxes',
                      value: mailboxes.length,
                      sub: `${mailboxes.filter((m) => m.status === 'active').length} active`,
                      icon: <Users className="w-3.5 h-3.5" />,
                    },
                    {
                      label: 'Cluster storage',
                      value: storageUsed,
                      sub: `Engine: ${storage?.storage_type ?? '—'}`,
                      icon: <HardDrive className="w-3.5 h-3.5" />,
                    },
                    {
                      label: 'Service health',
                      value: `${healthyCount} / 3`,
                      sub: healthyCount === 3 ? 'All services up' : 'Service degraded',
                      icon: <ShieldCheck className="w-3.5 h-3.5" />,
                      bad: healthyCount !== 3,
                    },
                  ].map((m) => (
                    <div key={m.label} className="px-3 py-2">
                      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>
                        {m.icon}
                        {m.label}
                      </div>
                      <div className="mt-0.5 text-[18px] font-semibold tabular-nums leading-tight text-gray-900 dark:text-gray-100">
                        {m.value}
                      </div>
                      <div
                        className={`text-[11px] ${
                          'bad' in m && m.bad ? 'text-amber-700 dark:text-amber-400' : MUTED
                        }`}
                      >
                        {m.sub}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className={PANEL}>
                    <SectionTitle
                      actions={
                        <span className={`${BADGE_NEUTRAL} tabular-nums`}>{healthyCount} / 3</span>
                      }
                    >
                      Service checks
                    </SectionTitle>
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Service</th>
                          <th className={TH}>State</th>
                          <th className={`${TH} text-right`}>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['postgres', 'redis', 'stalwart'] as const).map((svc) => {
                          const up = healthData?.checks[svc];
                          return (
                            <tr key={svc} className={T.row}>
                              <td className={`${TD} font-medium capitalize`}>{svc}</td>
                              <td className={TD}>
                                <span className={up ? BADGE_OK : BADGE_BAD}>{up ? 'Up' : 'Down'}</span>
                              </td>
                              <td className={`${TD} ${CODE} text-right ${MUTED}`}>
                                {up ? 'responding' : 'no response'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className={`border-t border-gray-300 px-3 py-1.5 text-[11px] dark:border-[#374151] ${MUTED} ${CODE}`}>
                      {healthData?.service ?? 'api'} {healthData?.version ?? ''}
                    </div>
                  </div>

                  <div className={PANEL}>
                    <SectionTitle>Cluster protocols</SectionTitle>
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Port</th>
                          <th className={TH}>Service</th>
                          <th className={`${TH} text-right`}>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['2087', 'Admin console'],
                          ['2083 / 443', 'Client webmail'],
                          ['25 · 465 · 587', 'SMTP submission'],
                          ['993 · 4190', 'IMAP and Sieve'],
                        ].map(([port, label]) => (
                          <tr key={port} className={T.row}>
                            <td className={`${TD} ${CODE} font-medium`}>{port}</td>
                            <td className={`${TD} ${MUTED}`}>{label}</td>
                            <td className={`${TD} text-right`}>
                              <span className={BADGE_OK}>Listening</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB 2: DOMAINS ===================== */}
            {activeTab === 'domains' && (
              <>
                <PageHeader
                  title="Virtual domains"
                  description="DKIM signing, storage quotas, and dedicated egress IPs."
                  actions={
                    <button onClick={() => setShowAddDomainModal(true)} className={btn('primary')}>
                      <Plus className="w-3.5 h-3.5" />
                      Add domain
                    </button>
                  }
                />

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle actions={<span className={`${BADGE_NEUTRAL} tabular-nums`}>{domains.length} domains</span>}>
                    Domains
                  </SectionTitle>
                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Domain</th>
                          <th className={`${TH} hidden sm:table-cell`}>Mailboxes</th>
                          <th className={`${TH} hidden lg:table-cell`}>Disk used / limit</th>
                          <th className={`${TH} hidden md:table-cell`}>Outbound IP</th>
                          <th className={TH}>DKIM</th>
                          <th className={`${TH} text-right`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {domains.map((dom) => (
                          <tr key={dom.id} className={T.row}>
                            <td className={`${TD} font-medium ${T.primary}`}>
                              {dom.name}
                            </td>
                            <td className={`${TD} hidden sm:table-cell tabular-nums ${MUTED}`}>
                              {dom.mailboxesCount}
                            </td>
                            <td className={`${TD} hidden lg:table-cell ${CODE} ${MUTED}`}>
                              {dom.diskUsed} / {dom.diskLimit}
                            </td>
                            <td className={`${TD} hidden md:table-cell`}>
                              {dom.assignedIp ? (
                                <span className={`${BADGE_NEUTRAL} ${CODE}`}>
                                  {dom.ipType === 'dedicated' ? 'Dedicated' : 'Shared'} · {dom.assignedIp}
                                </span>
                              ) : (
                                <span className={`text-[12px] ${MUTED}`}>Unassigned</span>
                              )}
                            </td>
                            <td className={TD}>
                              {dom.dkimStatus === 'active' ? (
                                <span className={BADGE_OK}>Signed</span>
                              ) : (
                                <span className={BADGE_WARN}>Missing</span>
                              )}
                            </td>
                            <td className={T.actions}>
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => setSelectedDnsDomain(dom.name)}
                                  className={btn('outline', 'xs')}
                                >
                                  Deliverability
                                </button>
                                <button
                                  onClick={() => void handleAssignIp(dom.name)}
                                  className={`${btn('outline', 'xs')} hidden sm:inline-flex`}
                                >
                                  Assign IP
                                </button>
                                <button
                                  onClick={() => void handleDeleteDomain(dom.name)}
                                  className={btnIcon('danger')}
                                  title={`Delete ${dom.name}`}
                                  aria-label={`Delete ${dom.name}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {domains.length === 0 && loading && <SkeletonRows cols={6} />}
                        {domains.length === 0 && !loading && (
                          <tr>
                            <td colSpan={6}>
                              <EmptyState
                                icon={<Globe className="w-5 h-5" />}
                                title="No virtual domains yet"
                                description="Add your first domain to start provisioning mailboxes."
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB 3: MAILBOXES ===================== */}
            {activeTab === 'mailboxes' && (
              <>
                <PageHeader
                  title="Mailboxes and quotas"
                  description="Accounts, storage quotas, and outbound routing."
                />

                <div className={`${PANEL} overflow-hidden`}>
                  <div className={`${PANEL_HD} gap-2`}>
                    <div className="flex items-center gap-2">
                      <label htmlFor="mailbox-filter" className="sr-only">
                        Filter mailboxes
                      </label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-1.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-gray-400" />
                        <input
                          id="mailbox-filter"
                          type="search"
                          value={mailboxFilter}
                          onChange={(e) => setMailboxFilter(e.target.value)}
                          placeholder="Filter mailboxes"
                          className={`${INPUT} h-7 w-32 pl-6 sm:w-56`}
                        />
                      </div>
                      <span className={`hidden text-[11px] sm:inline ${MUTED}`}>
                        {filteredMailboxes.length} of {mailboxes.length}
                      </span>
                    </div>
                    <button onClick={() => setShowAddMailboxModal(true)} className={btn('primary')}>
                      <Plus className="w-3.5 h-3.5" />
                      Create mailbox
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Email address</th>
                          <th className={`${TH} hidden md:table-cell`}>Domain</th>
                          <th className={TH}>Quota used / limit</th>
                          <th className={`${TH} hidden lg:table-cell`}>Route</th>
                          <th className={TH}>Status</th>
                          <th className={`${TH} text-right`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMailboxes.map((mb) => (
                          <tr key={mb.id} className={T.row}>
                            <td className={`${TD} ${CODE} font-medium ${T.primary}`}>{mb.email}</td>
                            <td className={`${TD} hidden md:table-cell ${MUTED}`}>{mb.domain}</td>
                            <td className={`${TD} ${CODE} ${MUTED} ${T.cell}`}>
                              {mb.used} / {mb.quota}
                            </td>
                            <td className={`${TD} hidden lg:table-cell`}>
                              <span className={`${BADGE_NEUTRAL} ${CODE}`}>{mb.route}</span>
                            </td>
                            <td className={T.cell}>
                              <StatusBadge active={mb.status === 'active'} />
                            </td>
                            <td className={T.actions}>
                              <div className="flex items-center justify-end gap-0.5">
                                <button
                                  onClick={() => void handleOpenMailbox(mb)}
                                  className={`${btn('primary', 'xs')} gap-1`}
                                  title={`Open ${mb.email} in webmail (SSO)`}
                                >
                                  <LogIn className="w-3 h-3" />
                                  <span className="hidden sm:inline">Open</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setPasswordTarget(mb);
                                    setNewPassword('');
                                  }}
                                  className={btnIcon('ghost')}
                                  title="Set a new password"
                                  aria-label={`Set password for ${mb.email}`}
                                >
                                  <KeyRound className="w-3.5 h-3.5" />
                                </button>
                                {!mb.isServerOnly && (
                                  <button
                                    onClick={() => {
                                      setQuotaTarget(mb);
                                      setNewQuota(String(mb.quotaMb || 5120));
                                    }}
                                    className={btnIcon('ghost')}
                                    title="Change storage quota"
                                    aria-label={`Change quota for ${mb.email}`}
                                  >
                                    <Gauge className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {!mb.isServerOnly && (
                                  <button
                                    onClick={() => void handleToggleMailboxStatus(mb)}
                                    className={btnIcon('ghost')}
                                    title={mb.status === 'active' ? 'Suspend mailbox' : 'Enable mailbox'}
                                    aria-label={
                                      mb.status === 'active'
                                        ? `Suspend ${mb.email}`
                                        : `Enable ${mb.email}`
                                    }
                                  >
                                    <Power
                                      className={`w-3.5 h-3.5 ${
                                        mb.status === 'active' ? '' : 'text-amber-600 dark:text-amber-400'
                                      }`}
                                    />
                                  </button>
                                )}
                                {!mb.isServerOnly && (
                                  <button
                                    onClick={() => void handleDeleteMailbox(mb)}
                                    className={btnIcon('danger')}
                                    title="Delete mailbox"
                                    aria-label={`Delete ${mb.email}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {mb.isServerOnly && (
                                  <span className={`${BADGE_NEUTRAL} ml-1`}>server</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {mailboxes.length === 0 && loading && <SkeletonRows cols={6} />}
                        {mailboxes.length === 0 && !loading && (
                          <tr>
                            <td colSpan={6}>
                              <EmptyState
                                icon={<Inbox className="w-5 h-5" />}
                                title="No mailboxes yet"
                                description="Create a mailbox on one of your virtual domains."
                              />
                            </td>
                          </tr>
                        )}
                        {mailboxes.length > 0 && filteredMailboxes.length === 0 && (
                          <tr>
                            <td colSpan={6}>
                              <EmptyState
                                icon={<Search className="w-5 h-5" />}
                                title="No matching mailboxes"
                                description="Clear the filter to see every account."
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB: ALIASES ===================== */}
            {activeTab === 'aliases' && (
              <>
                <PageHeader
                  title="Aliases and forwarding"
                  description="An alias delivers mail for one address into another mailbox on this server."
                />

                <div className={PANEL}>
                  <SectionTitle>Create alias</SectionTitle>
                  <form
                    className="grid grid-cols-1 items-end gap-2 p-2 sm:grid-cols-[1fr_1fr_auto]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleCreateAlias();
                    }}
                  >
                    <div className="w-full">
                      <label className={LABEL} htmlFor="alias-source">
                        Alias address
                      </label>
                      <input
                        id="alias-source"
                        type="email"
                        placeholder="sales@example.com"
                        value={newAliasSource}
                        onChange={(e) => setNewAliasSource(e.target.value)}
                        className={`${INPUT} font-mono`}
                      />
                    </div>
                    <div className="w-full">
                      <label className={LABEL} htmlFor="alias-dest">
                        Delivers to mailbox
                      </label>
                      <input
                        id="alias-dest"
                        type="email"
                        placeholder="owner@example.com"
                        value={newAliasDest}
                        onChange={(e) => setNewAliasDest(e.target.value)}
                        className={`${INPUT} font-mono`}
                      />
                    </div>
                    <button type="submit" className={btn('primary')}>
                      <Plus className="w-3.5 h-3.5" />
                      Add alias
                    </button>
                  </form>
                </div>

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle actions={<span className={`${BADGE_NEUTRAL} tabular-nums`}>{aliases.length} aliases</span>}>
                    Aliases
                  </SectionTitle>
                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Alias address</th>
                          <th className={TH}>Delivers to</th>
                          <th className={TH}>Status</th>
                          <th className={`${TH} text-right`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aliases.map((a) => (
                          <tr key={a.id} className={T.row}>
                            <td className={`${TD} ${CODE} font-medium ${T.primary}`}>
                              {a.source_address}
                            </td>
                            <td className={`${TD} hidden sm:table-cell ${CODE} ${MUTED}`}>
                              {a.destination_address}
                            </td>
                            <td className={T.cell}>
                              <StatusBadge active={a.isActive} />
                            </td>
                            <td className={T.actions}>
                              <button
                                onClick={() => void handleDeleteAlias(a)}
                                className={btnIcon('danger')}
                                title={`Delete alias ${a.source_address}`}
                                aria-label={`Delete alias ${a.source_address}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {aliases.length === 0 && (
                          <tr>
                            <td colSpan={4}>
                              <EmptyState
                                icon={<Forward className="w-5 h-5" />}
                                title="No aliases yet"
                                description="Forward an address to an existing mailbox with the form above."
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB 4: MAIL QUEUE ===================== */}
            {activeTab === 'queue' && (
              <>
                <PageHeader
                  title="Mail queue"
                  description="Messages waiting for delivery or retry."
                />

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle
                    actions={
                      <button
                        onClick={() => void loadQueue()}
                        className={btn('outline', 'xs')}
                        disabled={queueLoading}
                      >
                        <RotateCw className={`w-3 h-3 ${queueLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    }
                  >
                    <span className="inline-flex items-center gap-2">
                      Queued messages
                      <span className={`${queueItems.length > 0 ? BADGE_WARN : BADGE_NEUTRAL} tabular-nums`}>
                        {queueItems.length}
                      </span>
                    </span>
                  </SectionTitle>
                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Message ID</th>
                          <th className={`${TH} hidden lg:table-cell`}>From</th>
                          <th className={`${TH} hidden md:table-cell`}>To</th>
                          <th className={`${TH} hidden xl:table-cell`}>Size</th>
                          <th className={`${TH} hidden sm:table-cell`}>Next attempt</th>
                          <th className={`${TH} text-right`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queueItems.map((item) => (
                          <tr key={item.id} className={T.row}>
                            <td className={`${TD} ${CODE} ${MUTED} ${T.primary}`}>
                              <span className="block max-w-[220px] truncate" title={item.id}>
                                {item.id}
                              </span>
                            </td>
                            <td className={`${TD} hidden lg:table-cell ${CODE} ${MUTED}`}>
                              {queueSender(item)}
                            </td>
                            <td className={`${TD} hidden md:table-cell ${CODE} ${MUTED}`}>
                              {queueRecipients(item)}
                            </td>
                            <td className={`${TD} hidden xl:table-cell ${CODE} ${MUTED}`}>
                              {typeof item.size === 'number' ? fmtBytes(item.size) : '—'}
                            </td>
                            <td className={`${TD} hidden sm:table-cell ${CODE} ${MUTED}`}>
                              {qStr(item.nextRetry) || qStr(item.nextDelivery) || qStr(item.scheduledAt) || '—'}
                            </td>
                            <td className={T.actions}>
                              <div className="flex items-center justify-end gap-0.5">
                                <button
                                  onClick={() => void handleQueueRetry(item)}
                                  className={btnIcon('ghost')}
                                  title="Retry now"
                                  aria-label={`Retry message ${item.id}`}
                                >
                                  <Play className="w-3.5 h-3.5 text-[#0B57D0] dark:text-[#A8C7FA]" />
                                </button>
                                <button
                                  onClick={() => void handleQueueDelete(item)}
                                  className={btnIcon('danger')}
                                  title="Remove from queue"
                                  aria-label={`Remove message ${item.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {queueItems.length === 0 && !queueLoading && (
                          <tr>
                            <td colSpan={6}>
                              <EmptyState
                                icon={<ListOrdered className="w-5 h-5" />}
                                title="The mail queue is empty"
                                description="All messages have been delivered."
                              />
                            </td>
                          </tr>
                        )}
                        {queueLoading && queueItems.length === 0 && <SkeletonRows cols={6} />}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB: TRACK DELIVERY ===================== */}
            {activeTab === 'track' && (
              <>
                <PageHeader
                  title="Track delivery"
                  description="Search the mail server log by sender, recipient, or message ID."
                />

                <div className={PANEL}>
                  <SectionTitle>Log search</SectionTitle>
                  <form
                    className="flex flex-col gap-2 p-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleTrackSearch();
                    }}
                  >
                    <input
                      type="text"
                      value={trackQuery}
                      onChange={(e) => setTrackQuery(e.target.value)}
                      placeholder="e.g. alice@affinmail.local"
                      aria-label="Delivery search query"
                      className={`${INPUT} font-mono sm:flex-1`}
                    />
                    <select
                      value={trackHours}
                      onChange={(e) => setTrackHours(Number(e.target.value))}
                      aria-label="Search period"
                      className={`${INPUT} sm:w-40`}
                    >
                      <option value={24}>Last 24 hours</option>
                      <option value={48}>Last 48 hours</option>
                      <option value={168}>Last 7 days</option>
                    </select>
                    <button type="submit" disabled={trackBusy} className={btn('primary')}>
                      {trackBusy ? (
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      Search
                    </button>
                  </form>
                </div>

                <div className={PANEL}>
                  <SectionTitle
                    actions={
                      trackLines !== null ? (
                        <span className={`${BADGE_NEUTRAL} tabular-nums`}>{trackLines.length} lines</span>
                      ) : undefined
                    }
                  >
                    Results
                  </SectionTitle>
                  <div className="p-2">
                    {trackLines === null && (
                      <EmptyState
                        icon={<Search className="w-5 h-5" />}
                        title="No search yet"
                        description="Results appear here as raw log lines, newest last."
                      />
                    )}
                    {trackLines !== null && trackLines.length === 0 && (
                      <EmptyState
                        icon={<Inbox className="w-5 h-5" />}
                        title="No matching log lines"
                        description="Try a different address, message ID, or wider period."
                      />
                    )}
                    {trackLines !== null && trackLines.length > 0 && (
                      <div className="max-h-[480px] overflow-y-auto overflow-x-hidden rounded-sm border border-gray-300 bg-gray-50 p-2 dark:border-[#374151] dark:bg-[#0f172a]">
                        <div className={`${CODE} space-y-0.5`}>
                          {trackLines.map((line, i) => (
                            <p key={i} className="text-gray-700 break-all dark:text-gray-300">
                              {line}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB 5: IP POOLS ===================== */}
            {activeTab === 'ippools' && (
              <>
                <PageHeader
                  title="IP pools and egress routing"
                  description="Dedicated and shared outbound IP addresses."
                  actions={
                    <button onClick={() => setShowAddIpModal(true)} className={btn('primary')}>
                      <Plus className="w-3.5 h-3.5" />
                      Bind outbound IP
                    </button>
                  }
                />

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle actions={<span className={`${BADGE_NEUTRAL} tabular-nums`}>{ipPools.length} addresses</span>}>
                    Outbound addresses
                  </SectionTitle>
                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>IP address</th>
                          <th className={TH}>rDNS hostname</th>
                          <th className={TH}>Pool</th>
                          <th className={`${TH} text-right`}>Domains</th>
                          <th className={TH}>RBL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ipPools.map((pool) => (
                          <tr key={pool.id} className={T.row}>
                            <td className={`${TD} ${CODE} font-medium`}>{pool.ip}</td>
                            <td className={`${TD} ${CODE} ${MUTED} break-all`}>{pool.rdns}</td>
                            <td className={TD}>
                              <span className={`${BADGE_NEUTRAL} capitalize`}>{pool.type}</span>
                            </td>
                            <td className={`${TD} text-right ${CODE}`}>{pool.domainsCount}</td>
                            <td className={TD}>
                              {pool.rblClean ? (
                                <span className={BADGE_OK}>
                                  <CheckCircle className="w-3 h-3" />
                                  Clean
                                </span>
                              ) : (
                                <span className={BADGE_BAD}>
                                  <AlertTriangle className="w-3 h-3" />
                                  Blacklisted
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {ipPools.length === 0 && loading && <SkeletonRows cols={5} />}
                        {ipPools.length === 0 && !loading && (
                          <tr>
                            <td colSpan={5}>
                              <EmptyState
                                icon={<Layers className="w-5 h-5" />}
                                title="No outbound IPs bound yet"
                                description="Bind an IP to control the egress address used for your domains."
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB 6: STORAGE ===================== */}
            {activeTab === 'storage' && (
              <>
                <PageHeader
                  title="Storage engine"
                  description="Live blob storage status reported by the admin API."
                />

                <div className={`grid grid-cols-1 divide-gray-300 sm:grid-cols-3 sm:divide-x dark:divide-[#374151] ${PANEL}`}>
                  {[
                    ['Used', storage ? fmtBytes(storage.used_bytes) : '—'],
                    ['Free', storage ? fmtBytes(storage.free_bytes) : '—'],
                    ['Total', storage ? fmtBytes(storage.total_bytes) : '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="px-3 py-2">
                      <div className={`text-[11px] font-semibold uppercase tracking-wide ${MUTED}`}>{label}</div>
                      <div className={`text-[16px] font-semibold ${CODE} text-gray-900 dark:text-gray-100`}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className={PANEL}>
                  <SectionTitle>Capacity</SectionTitle>
                  <div className="space-y-1.5 p-2">
                    {storage && storage.total_bytes > 0 ? (
                      <>
                        <div className="h-2 w-full overflow-hidden rounded-sm border border-gray-300 bg-gray-100 dark:border-[#374151] dark:bg-[#0f172a]">
                          <div
                            className="h-full bg-[#0B57D0] dark:bg-[#A8C7FA]"
                            style={{
                              width: `${Math.min(100, Math.round((storage.used_bytes / storage.total_bytes) * 100))}%`,
                            }}
                          />
                        </div>
                        <p className={`text-right text-[11px] ${MUTED} tabular-nums`}>
                          {Math.round((storage.used_bytes / storage.total_bytes) * 100)}% used
                        </p>
                      </>
                    ) : (
                      <p className={`text-[12px] ${MUTED}`}>Capacity information unavailable.</p>
                    )}
                  </div>
                  <table className={TABLE}>
                    <tbody>
                      <tr className={T.row}>
                        <td className={`${TD} w-48 font-medium`}>Backend</td>
                        <td className={`${TD} ${CODE} ${MUTED}`}>{storage?.storage_type ?? '—'}</td>
                      </tr>
                      <tr className={T.row}>
                        <td className={`${TD} font-medium`}>Path</td>
                        <td className={`${TD} ${CODE} ${MUTED} break-all`}>{storage?.local_path ?? '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ===================== TAB 7: SYSTEM ===================== */}
            {activeTab === 'system' && (
              <>
                <PageHeader
                  title="System controls"
                  description="Cluster service orchestration and maintenance."
                />

                <div className={PANEL}>
                  <SectionTitle>Cluster operations</SectionTitle>
                  <div className="flex flex-wrap gap-1.5 p-2">
                    <button onClick={() => void handleBackup()} className={btn('outline')}>
                      <Database className="w-3.5 h-3.5" />
                      Create database backup
                    </button>
                    <button onClick={() => void handleRestart()} className={btn('danger')}>
                      <RotateCw className="w-3.5 h-3.5" />
                      Restart mail service
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className={PANEL}>
                    <SectionTitle
                      actions={
                        <span className={`${healthyCount === 3 ? BADGE_OK : BADGE_WARN} tabular-nums`}>
                          {healthyCount} / 3 healthy
                        </span>
                      }
                    >
                      Service checks
                    </SectionTitle>
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Service</th>
                          <th className={TH}>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['postgres', 'redis', 'stalwart'] as const).map((svc) => (
                          <tr key={svc} className={T.row}>
                            <td className={`${TD} ${CODE}`}>{svc}</td>
                            <td className={TD}>
                              <span className={healthData?.checks[svc] ? BADGE_OK : BADGE_BAD}>
                                {healthData?.checks[svc] ? 'up' : 'down'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className={PANEL}>
                    <SectionTitle
                      actions={
                        <span className={`${BADGE_NEUTRAL} ${CODE} max-w-full truncate`}>
                          /usr/local/bin/affinmail
                        </span>
                      }
                    >
                      CLI management
                    </SectionTitle>
                    <div className={`${CODE} space-y-0.5 overflow-x-auto border-t border-gray-200 bg-gray-50 p-2 dark:border-[#374151] dark:bg-[#0f172a]`}>
                      {['status', 'restart', 'update', 'backup', 'logs stalwart'].map((cmd) => (
                        <p key={cmd} className="whitespace-nowrap text-gray-700 dark:text-gray-300">
                          <span className="select-none text-gray-400">$ </span>
                          affinmail {cmd}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={PANEL}>
                  <SectionTitle
                    actions={
                      <button
                        onClick={() => void loadLogs()}
                        className={btn('outline', 'xs')}
                        disabled={logsLoading}
                      >
                        <RotateCw className={`w-3 h-3 ${logsLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <ScrollText className="w-3.5 h-3.5 text-gray-400" />
                      Mail server log
                    </span>
                  </SectionTitle>
                  <div className="max-h-80 space-y-0.5 overflow-y-auto overflow-x-hidden bg-gray-50 p-2 font-mono text-[12px] dark:bg-[#0f172a]">
                    {logsLoading && (
                      <div className="space-y-1.5">
                        <div className="h-3 w-full animate-pulse rounded-sm bg-gray-200 dark:bg-[#1f2937]" />
                        <div className="h-3 w-5/6 animate-pulse rounded-sm bg-gray-200 dark:bg-[#1f2937]" />
                        <div className="h-3 w-4/6 animate-pulse rounded-sm bg-gray-200 dark:bg-[#1f2937]" />
                      </div>
                    )}
                    {!logsLoading &&
                      logLines.map((line, i) => (
                        <p key={i} className="break-all text-gray-700 dark:text-gray-300">
                          {line}
                        </p>
                      ))}
                    {!logsLoading && logLines.length === 0 && (
                      <p className={MUTED}>No log lines returned</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {/* Sidebar / mobile drawer */}
      <div className="drawer-side z-50 h-dvh">
        <label htmlFor="admin-nav" className="drawer-overlay" aria-label="Close navigation" />
        <aside className="flex flex-col w-56 max-w-[85vw] h-full border-r border-gray-300 bg-white dark:border-[#374151] dark:bg-[#111827]">
          {sidebar}
        </aside>
      </div>

      {/* ===================== MODAL: ADD VIRTUAL DOMAIN ===================== */}
      {showAddDomainModal && (
        <AdminModal
          title="Add virtual domain"
          description="A 2048-bit DKIM key is generated for the new domain."
          onClose={() => setShowAddDomainModal(false)}
        >
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateDomain();
            }}
          >
            <div className="w-full">
              <label className={LABEL} htmlFor="new-domain">
                Domain name
              </label>
              <input
                id="new-domain"
                type="text"
                placeholder="acme-corp.com"
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
                className={`${INPUT} font-mono`}
                autoFocus
              />
            </div>

            <div className="w-full">
              <label className={LABEL} htmlFor="new-domain-ip">
                Outbound IP <span className={`font-normal ${MUTED}`}>— optional</span>
              </label>
              <select
                id="new-domain-ip"
                value={newDomainIp}
                onChange={(e) => setNewDomainIp(e.target.value)}
                className={`${INPUT} font-mono`}
              >
                <option value="">No assignment</option>
                {ipPools.map((p) => (
                  <option key={p.id} value={p.ip}>
                    {p.ip} ({p.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-1.5 border-t border-gray-200 pt-2.5 dark:border-[#374151]">
              <button type="button" onClick={() => setShowAddDomainModal(false)} className={btn('outline')}>
                Cancel
              </button>
              <button type="submit" className={btn('primary')}>
                Provision domain
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* ===================== MODAL: CREATE MAILBOX ===================== */}
      {showAddMailboxModal && (
        <AdminModal
          title="Create mailbox"
          description="The account is created on the mail server immediately."
          onClose={() => setShowAddMailboxModal(false)}
        >
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateMailbox();
            }}
          >
            <div className="w-full">
              <label className={LABEL} htmlFor="new-mailbox-user">
                Username
              </label>
              <input
                id="new-mailbox-user"
                type="text"
                placeholder="john"
                value={newMailboxUser}
                onChange={(e) => setNewMailboxUser(e.target.value)}
                className={`${INPUT} font-mono`}
                autoFocus
              />
            </div>

            <div className="w-full">
              <label className={LABEL} htmlFor="new-mailbox-domain">
                Domain
              </label>
              <select
                id="new-mailbox-domain"
                value={newMailboxDomain}
                onChange={(e) => setNewMailboxDomain(e.target.value)}
                className={`${INPUT} font-mono`}
              >
                {domains.map((d) => (
                  <option key={d.id} value={d.name}>
                    @{d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-full">
              <label className={LABEL} htmlFor="new-mailbox-pass">
                Password
              </label>
              <input
                id="new-mailbox-pass"
                type="password"
                autoComplete="new-password"
                value={newMailboxPass}
                onChange={(e) => setNewMailboxPass(e.target.value)}
                className={INPUT}
              />
            </div>

            <div className="w-full">
              <label className={LABEL} htmlFor="new-mailbox-quota">
                Storage quota (MB)
              </label>
              <input
                id="new-mailbox-quota"
                type="number"
                min={1}
                value={newMailboxQuota}
                onChange={(e) => setNewMailboxQuota(e.target.value)}
                className={`${INPUT} font-mono tabular-nums`}
              />
            </div>

            <div className="flex items-center justify-end gap-1.5 border-t border-gray-200 pt-2.5 dark:border-[#374151]">
              <button type="button" onClick={() => setShowAddMailboxModal(false)} className={btn('outline')}>
                Cancel
              </button>
              <button type="submit" className={btn('primary')}>
                Create mailbox
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* ===================== MODAL: RESET PASSWORD ===================== */}
      {passwordTarget && (
        <AdminModal
          title="Set mailbox password"
          description={passwordTarget.email}
          onClose={() => {
            setPasswordTarget(null);
            setNewPassword('');
          }}
        >
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleResetPassword();
            }}
          >
            <div className="w-full">
              <label className={LABEL} htmlFor="mailbox-new-password">
                New password <span className={`font-normal ${MUTED}`}>— min. 8 characters</span>
              </label>
              <input
                id="mailbox-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={INPUT}
                autoFocus
              />
            </div>
            <p className={`text-[12px] ${MUTED}`}>
              The mailbox user signs in with this password from now on. Panel SSO into this mailbox
              keeps working after a reset.
            </p>
            <div className="flex items-center justify-end gap-1.5 border-t border-gray-200 pt-2.5 dark:border-[#374151]">
              <button
                type="button"
                onClick={() => {
                  setPasswordTarget(null);
                  setNewPassword('');
                }}
                className={btn('outline')}
              >
                Cancel
              </button>
              <button type="submit" className={btn('primary')}>
                Set password
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* ===================== MODAL: QUOTA ===================== */}
      {quotaTarget && (
        <AdminModal
          title="Storage quota"
          description={quotaTarget.email}
          onClose={() => setQuotaTarget(null)}
        >
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveQuota();
            }}
          >
            <div className="w-full">
              <label className={LABEL} htmlFor="mailbox-quota">
                Quota (MB)
              </label>
              <input
                id="mailbox-quota"
                type="number"
                min={1}
                value={newQuota}
                onChange={(e) => setNewQuota(e.target.value)}
                className={`${INPUT} font-mono tabular-nums`}
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-1.5 border-t border-gray-200 pt-2.5 dark:border-[#374151]">
              <button type="button" onClick={() => setQuotaTarget(null)} className={btn('outline')}>
                Cancel
              </button>
              <button type="submit" className={btn('primary')}>
                Save quota
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* ===================== MODAL: BIND OUTBOUND IP ===================== */}
      {showAddIpModal && (
        <AdminModal
          title="Bind outbound IP"
          description="Route outbound mail through a dedicated or shared address."
          onClose={() => setShowAddIpModal(false)}
        >
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateIpPool();
            }}
          >
            <div className="w-full">
              <label className={LABEL} htmlFor="new-ip-address">
                IP address
              </label>
              <input
                id="new-ip-address"
                type="text"
                placeholder="195.201.10.103"
                value={newIpAddress}
                onChange={(e) => setNewIpAddress(e.target.value)}
                className={`${INPUT} font-mono`}
                autoFocus
              />
            </div>
            <div className="w-full">
              <label className={LABEL} htmlFor="new-ip-rdns">
                rDNS hostname
              </label>
              <input
                id="new-ip-rdns"
                type="text"
                placeholder="mail3.hostaffin.com"
                value={newIpRdns}
                onChange={(e) => setNewIpRdns(e.target.value)}
                className={`${INPUT} font-mono`}
              />
            </div>
            <div className="w-full">
              <label className={LABEL} htmlFor="new-ip-type">
                Pool type
              </label>
              <select
                id="new-ip-type"
                value={newIpType}
                onChange={(e) => setNewIpType(e.target.value as 'shared' | 'dedicated')}
                className={INPUT}
              >
                <option value="shared">Shared</option>
                <option value="dedicated">Dedicated</option>
              </select>
            </div>
            <div className="flex items-center justify-end gap-1.5 border-t border-gray-200 pt-2.5 dark:border-[#374151]">
              <button type="button" onClick={() => setShowAddIpModal(false)} className={btn('outline')}>
                Cancel
              </button>
              <button type="submit" className={btn('primary')}>
                Bind IP
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* ===================== MODAL: DELIVERABILITY ===================== */}
      {selectedDnsDomain && (
        <AdminModal
          title="Deliverability"
          description={`DNS records and signing keys for ${selectedDnsDomain}`}
          onClose={() => setSelectedDnsDomain(null)}
          wide
        >
          <div className="space-y-3">
            {delivLoading && (
              <div className="space-y-1.5">
                <div className="h-3 w-full animate-pulse rounded-sm bg-gray-200 dark:bg-[#1f2937]" />
                <div className="h-3 w-5/6 animate-pulse rounded-sm bg-gray-200 dark:bg-[#1f2937]" />
                <div className="h-3 w-4/6 animate-pulse rounded-sm bg-gray-200 dark:bg-[#1f2937]" />
              </div>
            )}

            {!delivLoading && deliv && (
              <>
                <div className="overflow-x-auto rounded-sm border border-gray-300 dark:border-[#374151]">
                  <table className={TABLE}>
                    <thead>
                      <tr>
                        <th className={TH}>Type</th>
                        <th className={TH}>Host</th>
                        <th className={TH}>Value</th>
                        <th className={TH}>Status</th>
                        <th className={`${TH} w-8`} />
                      </tr>
                    </thead>
                    <tbody>
                      {deliv.checks.map((chk, i) => (
                        <tr key={`${chk.type}-${chk.name}-${i}`} className={T.row}>
                          <td className={T.cell}>
                            <span className={`${BADGE_NEUTRAL} font-mono`}>{chk.type}</span>
                          </td>
                          <td className={`${TD} ${CODE} break-all ${T.cell}`}>{chk.name}</td>
                          <td className={`${TD} ${CODE} w-full break-all sm:w-auto`}>{chk.expected}</td>
                          <td className={T.cell}>
                            {chk.published ? (
                              <span className={BADGE_OK}>Published</span>
                            ) : (
                              <span className={BADGE_BAD}>Missing</span>
                            )}
                          </td>
                          <td className={T.cell}>
                            <button
                              onClick={() => {
                                void navigator.clipboard.writeText(chk.expected);
                                onNotify('Record value copied', 'info');
                              }}
                              className={btnIcon('ghost')}
                              aria-label="Copy record value"
                              title="Copy record value"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {deliv.checks.length === 0 && (
                        <tr>
                          <td colSpan={5}>
                            <EmptyState icon={<Globe className="w-5 h-5" />} title="No DNS records returned" />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-sm border border-gray-300 dark:border-[#374151]">
                  <div className="border-b border-gray-300 bg-gray-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:border-[#374151] dark:bg-[#0f172a] dark:text-gray-400">
                    DKIM signing keys
                  </div>
                  <div className="space-y-1.5 p-2">
                    {deliv.signatures.length === 0 ? (
                      <p className={`text-[12px] ${MUTED}`}>No signing keys found for this domain.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {deliv.signatures.map((sig) => (
                          <li key={sig.id ?? sig.selector ?? ''} className="flex flex-wrap items-center gap-1.5">
                            <span className={`${BADGE_NEUTRAL} ${CODE}`}>selector: {sig.selector}</span>
                            <span className={`${BADGE_NEUTRAL} ${CODE}`}>algorithm: {sig.algorithm}</span>
                            {sig.stage && <span className={`${BADGE_NEUTRAL} ${CODE}`}>stage: {sig.stage}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <button onClick={() => void handleRotateDkim()} className={btn('outline')}>
                      Rotate DKIM key
                    </button>
                    <p className={`text-[11px] ${MUTED}`}>
                      Rotation adds a new signing key on the server. Publish the new selector record
                      above before retiring the old one.
                    </p>
                  </div>
                </div>

                <div className="rounded-sm border border-gray-300 dark:border-[#374151]">
                  <div className="border-b border-gray-300 bg-gray-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:border-[#374151] dark:bg-[#0f172a] dark:text-gray-400">
                    Catch-all address
                  </div>
                  <div className="space-y-1.5 p-2">
                    <p className={`text-[11px] ${MUTED}`}>
                      Mail to addresses that do not exist on this domain is delivered to the catch-all
                      mailbox instead of bouncing.
                    </p>
                    <div className="flex flex-col gap-1.5 sm:flex-row">
                      <select
                        value={catchAllInput}
                        onChange={(e) => setCatchAllInput(e.target.value)}
                        aria-label="Catch-all mailbox"
                        className={`${INPUT} font-mono sm:flex-1`}
                      >
                        <option value="">None — bounce unknown addresses</option>
                        {mailboxes
                          .filter((mb) => mb.domain === selectedDnsDomain)
                          .map((mb) => (
                            <option key={mb.id} value={mb.email}>
                              {mb.email}
                            </option>
                          ))}
                      </select>
                      <button onClick={() => void handleSaveCatchAll()} className={btn('primary')}>
                        Save catch-all
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-end border-t border-gray-200 pt-2.5 dark:border-[#374151]">
              <button onClick={() => setSelectedDnsDomain(null)} className={btn('outline')}>
                Close
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </div>
  );
};
