import React, { useCallback, useEffect, useState } from 'react';
import {
  Server,
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

const PageHeader: React.FC<{
  title: string;
  description?: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-xl font-semibold tracking-tight text-base-content">{title}</h1>
      {description && <p className="text-sm text-base-content/60 mt-1">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
}> = ({ icon, title, description }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
    <div className="w-10 h-10 rounded-full bg-base-200 flex items-center justify-center text-base-content/50">
      {icon}
    </div>
    <p className="text-sm font-medium text-base-content">{title}</p>
    {description && <p className="text-xs text-base-content/60 max-w-sm">{description}</p>}
  </div>
);

const SkeletonRows: React.FC<{ cols: number; rows?: number }> = ({ cols, rows = 3 }) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r}>
        <td colSpan={cols} className="py-3">
          <div className="skeleton h-4 w-full" />
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
  <div className="modal modal-open z-50" role="dialog" aria-modal="true" aria-label={title}>
    <div className={`modal-box ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90dvh]`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-base-content">{title}</h3>
          {description && <p className="text-sm text-base-content/60 mt-1">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-sm btn-circle btn-ghost shrink-0"
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
    <button type="button" className="modal-backdrop" onClick={onClose} aria-label="Close dialog" />
  </div>
);

const StatusBadge: React.FC<{ active: boolean }> = ({ active }) => (
  <span className={`badge badge-sm ${active ? 'badge-success' : 'badge-error'} badge-outline`}>
    {active ? 'Active' : 'Suspended'}
  </span>
);

/* Phone: table rows collapse into stacked blocks so action buttons stay reachable. */
const T = {
  head: 'bg-base-200 text-xs text-base-content/60 max-sm:hidden',
  row: 'hover max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-2 max-sm:py-3',
  primary: 'max-sm:w-full',
  cell: 'max-sm:w-auto',
  actions: 'text-right max-sm:w-full max-sm:text-left max-sm:mt-0.5',
};

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
      <div className="relative flex flex-col min-h-dvh h-dvh w-full overflow-y-auto bg-base-200 text-base-content">
        {/* Subtle dot grid; no gradients on the mark itself */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-30"
          style={{
            backgroundImage: 'radial-gradient(rgba(100,116,139,0.35) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        <header className="relative z-10 flex items-center justify-end px-4 sm:px-6 py-4">
          <button
            onClick={onToggleTheme}
            className="btn btn-ghost btn-circle btn-sm"
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </header>

        <main className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-6">
          <div className="card w-full max-w-md bg-base-100 border border-base-300 shadow-xl">
            <div className="card-body p-6 sm:p-8 gap-6">
              <div className="flex flex-col items-center text-center gap-3">
                <AffinMailLogo variant="full" size="lg" />
                <span className="badge badge-outline badge-sm gap-1.5 py-3 px-2.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Server administration
                </span>
              </div>

              <div className="text-center space-y-1">
                <h1 className="text-xl font-semibold tracking-tight">Sign in to the admin console</h1>
                <p className="text-sm text-base-content/60">
                  Manage domains, mailboxes and delivery for this mail server.
                </p>
              </div>

              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleLogin();
                }}
              >
                <div className="form-control w-full">
                  <label className="label py-1" htmlFor="admin-username">
                    <span className="label-text font-medium">Username</span>
                  </label>
                  <input
                    id="admin-username"
                    type="text"
                    autoComplete="username"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    className={`input input-bordered w-full font-mono ${authError ? 'input-error' : ''}`}
                    aria-invalid={!!authError}
                    autoFocus
                  />
                </div>

                <div className="form-control w-full">
                  <label className="label py-1" htmlFor="admin-password">
                    <span className="label-text font-medium">Password</span>
                  </label>
                  <input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className={`input input-bordered w-full ${authError ? 'input-error' : ''}`}
                    aria-invalid={!!authError}
                  />
                </div>

                {authError && (
                  <div className="alert alert-error py-2 px-3 text-sm" role="alert">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="min-w-0 break-words">{authError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authBusy}
                  className="btn btn-primary w-full gap-2"
                >
                  {authBusy ? (
                    <>
                      <span className="loading loading-spinner loading-sm" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      <LogIn className="w-4 h-4" />
                      Sign in
                    </>
                  )}
                </button>
              </form>

              <div className="divider my-0 text-xs text-base-content/50">or</div>

              <button
                type="button"
                onClick={onSwitchToWebmail}
                className="btn btn-ghost btn-sm w-full gap-2 text-base-content/70"
              >
                <ArrowRight className="w-4 h-4 rotate-180" />
                Back to webmail
              </button>
            </div>
          </div>
        </main>

        <footer className="relative z-10 px-4 sm:px-6 py-4 text-center text-xs text-base-content/50">
          AffinMail core · Secure administrator session
        </footer>
      </div>
    );
  }

  /* ---------------------------------------------------------------- panel */

  const storageUsed = storage ? fmtBytes(storage.used_bytes) : '—';
  const checks = healthData?.checks;
  const healthyCount = checks ? [checks.postgres, checks.redis, checks.stalwart].filter(Boolean).length : 0;

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
          trailing: <span className="badge badge-ghost badge-sm tabular-nums">{domains.length}</span>,
        },
        {
          id: 'mailboxes',
          label: 'Mailboxes',
          icon: <Users className="w-4 h-4" />,
          trailing: <span className="badge badge-ghost badge-sm tabular-nums">{mailboxes.length}</span>,
        },
        {
          id: 'aliases',
          label: 'Aliases',
          icon: <Forward className="w-4 h-4" />,
          trailing: <span className="badge badge-ghost badge-sm tabular-nums">{aliases.length}</span>,
        },
        {
          id: 'queue',
          label: 'Mail queue',
          icon: <ListOrdered className="w-4 h-4" />,
          trailing: (
            <span
              className={`badge badge-sm tabular-nums ${queueItems.length > 0 ? 'badge-warning' : 'badge-ghost'}`}
            >
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

  const sidebar = (
    <>
      <div className="flex items-center justify-between gap-2 px-4 h-14 border-b border-base-300 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Server className="w-4 h-4 text-primary shrink-0" />
          <span className="font-semibold text-sm truncate">Admin console</span>
        </div>
        <button
          type="button"
          onClick={() => setIsMobileNavOpen(false)}
          className="btn btn-sm btn-circle btn-ghost lg:hidden"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-4" aria-label="Admin sections">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-2 mb-2 text-xs font-medium uppercase tracking-wide text-base-content/50">
              {group.label}
            </p>
            <ul className="menu menu-sm w-full gap-0.5 p-0">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      if (window.innerWidth < 1024) setIsMobileNavOpen(false);
                    }}
                    className={activeTab === item.id ? 'bg-primary/10 text-primary font-medium' : ''}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                  >
                    <span className="text-base-content/60">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                    {item.trailing && <span className="ml-auto">{item.trailing}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-base-300 space-y-2 shrink-0">
        <div className="rounded-box bg-base-200 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between gap-2 font-medium">
            <span>AffinMail core</span>
            <span className="font-mono tabular-nums">{healthData?.version ?? '—'}</span>
          </div>
          <p className="text-base-content/60">Stalwart · PostgreSQL 16 · Redis 7</p>
          <div
            className={`flex items-center gap-1.5 font-medium ${healthyCount === 3 ? 'text-success' : 'text-warning'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {healthyCount} of 3 services up
          </div>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="btn btn-ghost btn-sm w-full justify-start gap-2"
        >
          <Power className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="drawer lg:drawer-open h-dvh w-full bg-base-100 text-base-content">
      <input
        id="admin-nav"
        type="checkbox"
        className="drawer-toggle"
        checked={isMobileNavOpen}
        onChange={(e) => setIsMobileNavOpen(e.target.checked)}
        aria-label="Toggle admin navigation"
      />

      <div className="drawer-content flex flex-col h-dvh min-w-0 overflow-hidden">
        {/* Master header */}
        <header className="navbar min-h-14 h-14 shrink-0 gap-1 border-b border-base-300 bg-base-100 px-2 sm:px-4">
          <div className="flex-none lg:hidden">
            <label htmlFor="admin-nav" className="btn btn-ghost btn-square btn-sm" aria-label="Open navigation">
              <Menu className="w-5 h-5" />
            </label>
          </div>

          <div className="flex-1 min-w-0 px-1">
            <AffinMailLogo variant="admin" size="sm" className="lg:hidden" />
            <div className="hidden lg:flex items-center gap-3 min-w-0">
              <AffinMailLogo variant="admin" size="sm" />
              <div className="h-5 w-px bg-base-300 shrink-0" />
              <span className="text-sm text-base-content/60 truncate">
                {navGroups.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label ?? 'Overview'}
              </span>
            </div>
          </div>

          <div className="flex-none flex items-center gap-1 sm:gap-2">
            <div
              className={`badge badge-sm gap-1.5 hidden xl:inline-flex ${
                healthyCount === 3 ? 'badge-success badge-outline' : 'badge-warning badge-outline'
              }`}
              title={`${healthyCount} of 3 services healthy`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {healthyCount === 3 ? 'Healthy' : 'Degraded'}
            </div>

            <button
              onClick={() => void loadData()}
              className="btn btn-ghost btn-circle btn-sm"
              title="Refresh cluster data"
              aria-label="Refresh cluster data"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onToggleTheme}
              className="btn btn-ghost btn-circle btn-sm"
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            <button
              onClick={onSwitchToWebmail}
              className="btn btn-outline btn-sm gap-1.5"
              title="Open client webmail"
            >
              <span className="hidden sm:inline">Webmail</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Loading hairline */}
        {loading && (
          <div className="relative h-0.5 w-full overflow-hidden bg-primary/10 shrink-0">
            <span className="animate-gmail-progress" />
          </div>
        )}

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-base-200/50">
          <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 space-y-6">
            {/* ===================== TAB 1: DASHBOARD ===================== */}
            {activeTab === 'dashboard' && (
              <>
                <PageHeader
                  title="System overview"
                  description="Virtual domains, mailboxes, storage, and cluster health at a glance."
                  actions={
                    <>
                      <button onClick={() => setShowAddDomainModal(true)} className="btn btn-primary btn-sm gap-1.5">
                        <Plus className="w-4 h-4" />
                        Add domain
                      </button>
                      <button onClick={() => setShowAddMailboxModal(true)} className="btn btn-outline btn-sm gap-1.5">
                        <Plus className="w-4 h-4" />
                        Create mailbox
                      </button>
                    </>
                  }
                />

                <div className="stats stats-vertical md:stats-horizontal w-full bg-base-100 border border-base-300 shadow-sm">
                  <div className="stat">
                    <div className="stat-figure text-primary">
                      <Globe className="w-6 h-6" />
                    </div>
                    <div className="stat-title">Virtual domains</div>
                    <div className="stat-value text-2xl tabular-nums">{domains.length}</div>
                    <div className="stat-desc">
                      {domains.filter((d) => d.dkimStatus === 'active').length} DKIM signed
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-figure text-primary">
                      <Users className="w-6 h-6" />
                    </div>
                    <div className="stat-title">Mailboxes</div>
                    <div className="stat-value text-2xl tabular-nums">{mailboxes.length}</div>
                    <div className="stat-desc">
                      {mailboxes.filter((m) => m.status === 'active').length} active
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-figure text-primary">
                      <HardDrive className="w-6 h-6" />
                    </div>
                    <div className="stat-title">Cluster storage</div>
                    <div className="stat-value text-2xl tabular-nums">{storageUsed}</div>
                    <div className="stat-desc">Engine: {storage?.storage_type ?? '—'}</div>
                  </div>
                  <div className="stat">
                    <div className={`stat-figure ${healthyCount === 3 ? 'text-success' : 'text-warning'}`}>
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div className="stat-title">Service health</div>
                    <div className="stat-value text-2xl tabular-nums">{healthyCount} / 3</div>
                    <div className={`stat-desc ${healthyCount === 3 ? 'text-success' : 'text-error'}`}>
                      {healthyCount === 3 ? 'All services up' : 'Service degraded'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="card bg-base-100 border border-base-300 shadow-sm">
                    <div className="card-body p-4 sm:p-5 gap-4">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="card-title text-sm font-semibold">Service checks</h2>
                        <span className="badge badge-ghost badge-sm tabular-nums">{healthyCount} / 3</span>
                      </div>
                      <ul className="space-y-2">
                        {(['postgres', 'redis', 'stalwart'] as const).map((svc) => {
                          const up = healthData?.checks[svc];
                          return (
                            <li
                              key={svc}
                              className="flex items-center justify-between gap-3 rounded-box bg-base-200 px-3 h-10"
                            >
                              <span className="text-sm font-medium capitalize">{svc}</span>
                              <span
                                className={`badge badge-sm gap-1.5 ${
                                  up ? 'badge-success badge-outline' : 'badge-error badge-outline'
                                }`}
                              >
                                {up ? 'Up' : 'Down'}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="text-xs text-base-content/60 font-mono">
                        {healthData?.service ?? 'api'} {healthData?.version ?? ''}
                      </div>
                    </div>
                  </div>

                  <div className="card bg-base-100 border border-base-300 shadow-sm">
                    <div className="card-body p-4 sm:p-5 gap-3">
                      <h2 className="card-title text-sm font-semibold">Cluster protocols</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        {[
                          ['2087', 'Admin console'],
                          ['2083 / 443', 'Client webmail'],
                          ['25 · 465 · 587', 'SMTP submission'],
                          ['993 · 4190', 'IMAP and Sieve'],
                        ].map(([port, label]) => (
                          <div key={port} className="rounded-box border border-base-300 bg-base-200/60 p-3">
                            <div className="font-mono text-xs font-medium tabular-nums">{port}</div>
                            <div className="text-xs text-base-content/60 mt-0.5">{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
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
                    <button onClick={() => setShowAddDomainModal(true)} className="btn btn-primary btn-sm gap-1.5">
                      <Plus className="w-4 h-4" />
                      Add domain
                    </button>
                  }
                />

                <div className="card bg-base-100 border border-base-300 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table table-sm w-full">
                      <thead className={T.head}>
                        <tr>
                          <th>Domain</th>
                          <th className="hidden sm:table-cell">Mailboxes</th>
                          <th className="hidden lg:table-cell">Disk used / limit</th>
                          <th className="hidden md:table-cell">Outbound IP</th>
                          <th>DKIM</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {domains.map((dom) => (
                          <tr key={dom.id} className={T.row}>
                            <td className={`font-medium ${T.primary}`}>
                              {dom.name}
                              <span className="sm:hidden block mt-1 text-xs font-normal text-base-content/60">
                                {dom.mailboxesCount} mailboxes · {dom.diskLimit}
                                {dom.assignedIp ? ` · ${dom.assignedIp}` : ''}
                              </span>
                            </td>
                            <td className="hidden sm:table-cell tabular-nums text-base-content/70">
                              {dom.mailboxesCount}
                            </td>
                            <td className="hidden lg:table-cell font-mono text-xs tabular-nums text-base-content/70">
                              {dom.diskUsed} / {dom.diskLimit}
                            </td>
                            <td className="hidden md:table-cell">
                              {dom.assignedIp ? (
                                <span className="badge badge-ghost badge-sm font-mono gap-1">
                                  {dom.ipType === 'dedicated' ? 'Dedicated' : 'Shared'} · {dom.assignedIp}
                                </span>
                              ) : (
                                <span className="text-xs text-base-content/50">Unassigned</span>
                              )}
                            </td>
                            <td className={T.cell}>
                              {dom.dkimStatus === 'active' ? (
                                <span className="badge badge-success badge-outline badge-sm">Signed</span>
                              ) : (
                                <span className="badge badge-warning badge-outline badge-sm">Missing</span>
                              )}
                            </td>
                            <td className={T.actions}>
                              <div className="flex items-center justify-end max-sm:justify-start gap-1">
                                <button
                                  onClick={() => setSelectedDnsDomain(dom.name)}
                                  className="btn btn-ghost btn-xs"
                                >
                                  Deliverability
                                </button>
                                <button
                                  onClick={() => void handleAssignIp(dom.name)}
                                  className="btn btn-ghost btn-xs hidden sm:inline-flex"
                                >
                                  Assign IP
                                </button>
                                <button
                                  onClick={() => void handleDeleteDomain(dom.name)}
                                  className="btn btn-ghost btn-xs btn-square text-error"
                                  title={`Delete ${dom.name}`}
                                  aria-label={`Delete ${dom.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
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
                  actions={
                    <button onClick={() => setShowAddMailboxModal(true)} className="btn btn-primary btn-sm gap-1.5">
                      <Plus className="w-4 h-4" />
                      Create mailbox
                    </button>
                  }
                />

                <div className="card bg-base-100 border border-base-300 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table table-sm w-full">
                      <thead className={T.head}>
                        <tr>
                          <th>Email address</th>
                          <th className="hidden md:table-cell">Domain</th>
                          <th>Quota</th>
                          <th className="hidden lg:table-cell">Route</th>
                          <th>Status</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mailboxes.map((mb) => (
                          <tr key={mb.id} className={T.row}>
                            <td className={`font-mono text-xs font-medium ${T.primary}`}>{mb.email}</td>
                            <td className="hidden md:table-cell text-base-content/70">{mb.domain}</td>
                            <td className={`font-mono text-xs tabular-nums text-base-content/70 ${T.cell}`}>
                              {mb.used} / {mb.quota}
                            </td>
                            <td className="hidden lg:table-cell">
                              <span className="badge badge-ghost badge-sm font-mono">{mb.route}</span>
                            </td>
                            <td className={T.cell}>
                              <StatusBadge active={mb.status === 'active'} />
                            </td>
                            <td className={T.actions}>
                              <div className="flex items-center justify-end max-sm:justify-start gap-0.5">
                                <button
                                  onClick={() => void handleOpenMailbox(mb)}
                                  className="btn btn-primary btn-xs gap-1"
                                  title={`Open ${mb.email} in webmail (SSO)`}
                                >
                                  <LogIn className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">Open</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setPasswordTarget(mb);
                                    setNewPassword('');
                                  }}
                                  className="btn btn-ghost btn-xs btn-square"
                                  title="Set a new password"
                                  aria-label={`Set password for ${mb.email}`}
                                >
                                  <KeyRound className="w-4 h-4" />
                                </button>
                                {!mb.isServerOnly && (
                                  <button
                                    onClick={() => {
                                      setQuotaTarget(mb);
                                      setNewQuota(String(mb.quotaMb || 5120));
                                    }}
                                    className="btn btn-ghost btn-xs btn-square"
                                    title="Change storage quota"
                                    aria-label={`Change quota for ${mb.email}`}
                                  >
                                    <Gauge className="w-4 h-4" />
                                  </button>
                                )}
                                {!mb.isServerOnly && (
                                  <button
                                    onClick={() => void handleToggleMailboxStatus(mb)}
                                    className="btn btn-ghost btn-xs btn-square"
                                    title={mb.status === 'active' ? 'Suspend mailbox' : 'Enable mailbox'}
                                    aria-label={
                                      mb.status === 'active'
                                        ? `Suspend ${mb.email}`
                                        : `Enable ${mb.email}`
                                    }
                                  >
                                    <Power className={`w-4 h-4 ${mb.status === 'active' ? '' : 'text-warning'}`} />
                                  </button>
                                )}
                                {!mb.isServerOnly && (
                                  <button
                                    onClick={() => void handleDeleteMailbox(mb)}
                                    className="btn btn-ghost btn-xs btn-square text-error"
                                    title="Delete mailbox"
                                    aria-label={`Delete ${mb.email}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                                {mb.isServerOnly && (
                                  <span className="badge badge-ghost badge-sm ml-1">server</span>
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

                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4 sm:p-5">
                    <form
                      className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleCreateAlias();
                      }}
                    >
                      <div className="form-control w-full">
                        <label className="label py-1" htmlFor="alias-source">
                          <span className="label-text">Alias address</span>
                        </label>
                        <input
                          id="alias-source"
                          type="email"
                          placeholder="sales@example.com"
                          value={newAliasSource}
                          onChange={(e) => setNewAliasSource(e.target.value)}
                          className="input input-bordered input-sm w-full font-mono"
                        />
                      </div>
                      <div className="form-control w-full">
                        <label className="label py-1" htmlFor="alias-dest">
                          <span className="label-text">Delivers to mailbox</span>
                        </label>
                        <input
                          id="alias-dest"
                          type="email"
                          placeholder="owner@example.com"
                          value={newAliasDest}
                          onChange={(e) => setNewAliasDest(e.target.value)}
                          className="input input-bordered input-sm w-full font-mono"
                        />
                      </div>
                      <button type="submit" className="btn btn-primary btn-sm gap-1.5">
                        <Plus className="w-4 h-4" />
                        Add alias
                      </button>
                    </form>
                  </div>
                </div>

                <div className="card bg-base-100 border border-base-300 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table table-sm w-full">
                      <thead className={T.head}>
                        <tr>
                          <th>Alias address</th>
                          <th>Delivers to</th>
                          <th>Status</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aliases.map((a) => (
                          <tr key={a.id} className={T.row}>
                            <td className={`font-mono text-xs font-medium ${T.primary}`}>
                              {a.source_address}
                              <span className="sm:hidden block mt-1 font-normal text-base-content/60">
                                → {a.destination_address}
                              </span>
                            </td>
                            <td className="hidden sm:table-cell font-mono text-xs text-base-content/70">
                              {a.destination_address}
                            </td>
                            <td className={T.cell}>
                              <StatusBadge active={a.isActive} />
                            </td>
                            <td className={T.actions}>
                              <button
                                onClick={() => void handleDeleteAlias(a)}
                                className="btn btn-ghost btn-xs btn-square text-error"
                                title={`Delete alias ${a.source_address}`}
                                aria-label={`Delete alias ${a.source_address}`}
                              >
                                <Trash2 className="w-4 h-4" />
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
                  actions={
                    <button
                      onClick={() => void loadQueue()}
                      className="btn btn-outline btn-sm gap-1.5"
                      disabled={queueLoading}
                    >
                      <RotateCw className={`w-4 h-4 ${queueLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  }
                />

                <div className="card bg-base-100 border border-base-300 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table table-sm w-full">
                      <thead className={T.head}>
                        <tr>
                          <th>Message ID</th>
                          <th className="hidden lg:table-cell">From</th>
                          <th className="hidden md:table-cell">To</th>
                          <th className="hidden xl:table-cell">Size</th>
                          <th className="hidden sm:table-cell">Next attempt</th>
                          <th className="text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queueItems.map((item) => (
                          <tr key={item.id} className={T.row}>
                            <td className={`font-mono text-xs text-base-content/70 ${T.primary}`}>
                              <span className="block max-w-[220px] truncate" title={item.id}>
                                {item.id}
                              </span>
                              <span className="sm:hidden block mt-1 text-base-content/60 whitespace-normal">
                                {queueSender(item)} → {queueRecipients(item)} ·{' '}
                                {typeof item.size === 'number' ? fmtBytes(item.size) : '—'}
                              </span>
                            </td>
                            <td className="hidden lg:table-cell font-mono text-xs text-base-content/70">
                              {queueSender(item)}
                            </td>
                            <td className="hidden md:table-cell font-mono text-xs text-base-content/70">
                              {queueRecipients(item)}
                            </td>
                            <td className="hidden xl:table-cell font-mono text-xs tabular-nums text-base-content/70">
                              {typeof item.size === 'number' ? fmtBytes(item.size) : '—'}
                            </td>
                            <td className="hidden sm:table-cell font-mono text-xs text-base-content/70">
                              {qStr(item.nextRetry) || qStr(item.nextDelivery) || qStr(item.scheduledAt) || '—'}
                            </td>
                            <td className={T.actions}>
                              <div className="flex items-center justify-end max-sm:justify-start gap-0.5">
                                <button
                                  onClick={() => void handleQueueRetry(item)}
                                  className="btn btn-ghost btn-xs btn-square text-primary"
                                  title="Retry now"
                                  aria-label={`Retry message ${item.id}`}
                                >
                                  <Play className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => void handleQueueDelete(item)}
                                  className="btn btn-ghost btn-xs btn-square text-error"
                                  title="Remove from queue"
                                  aria-label={`Remove message ${item.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
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

                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4 sm:p-5">
                    <form
                      className="flex flex-col sm:flex-row gap-2"
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
                        className="input input-bordered w-full sm:flex-1 font-mono"
                      />
                      <select
                        value={trackHours}
                        onChange={(e) => setTrackHours(Number(e.target.value))}
                        aria-label="Search period"
                        className="select select-bordered w-full sm:w-auto"
                      >
                        <option value={24}>Last 24 hours</option>
                        <option value={48}>Last 48 hours</option>
                        <option value={168}>Last 7 days</option>
                      </select>
                      <button type="submit" disabled={trackBusy} className="btn btn-primary gap-1.5">
                        {trackBusy ? (
                          <span className="loading loading-spinner loading-sm" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                        Search
                      </button>
                    </form>
                  </div>
                </div>

                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4 sm:p-5 gap-3">
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
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-sm font-semibold">Matching log lines</h2>
                          <span className="badge badge-ghost badge-sm tabular-nums">
                            {trackLines.length}
                          </span>
                        </div>
                        <div className="rounded-box bg-base-200 p-3 max-h-[480px] overflow-y-auto overflow-x-hidden">
                          <div className="font-mono text-xs space-y-1">
                            {trackLines.map((line, i) => (
                              <p key={i} className="text-base-content/80 break-all">
                                {line}
                              </p>
                            ))}
                          </div>
                        </div>
                      </>
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
                    <button onClick={() => setShowAddIpModal(true)} className="btn btn-primary btn-sm gap-1.5">
                      <Plus className="w-4 h-4" />
                      Bind outbound IP
                    </button>
                  }
                />

                {ipPools.length === 0 && !loading ? (
                  <div className="card bg-base-100 border border-base-300 shadow-sm">
                    <EmptyState
                      icon={<Layers className="w-5 h-5" />}
                      title="No outbound IPs bound yet"
                      description="Bind an IP to control the egress address used for your domains."
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {ipPools.map((pool) => (
                      <div key={pool.id} className="card bg-base-100 border border-base-300 shadow-sm">
                        <div className="card-body p-4 sm:p-5 gap-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-mono text-base font-medium tabular-nums truncate">
                                {pool.ip}
                              </div>
                              <p className="text-xs text-base-content/60 font-mono mt-0.5 truncate">
                                rDNS: {pool.rdns}
                              </p>
                            </div>
                            <span className="badge badge-outline badge-sm capitalize shrink-0">{pool.type}</span>
                          </div>

                          <div className="divider my-0" />

                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-base-content/60">Assigned domains</span>
                            <span className="font-mono tabular-nums font-medium">{pool.domainsCount}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-base-content/60">RBL status</span>
                            {pool.rblClean ? (
                              <span className="badge badge-success badge-outline badge-sm gap-1">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Clean
                              </span>
                            ) : (
                              <span className="badge badge-error badge-outline badge-sm gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Blacklisted
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {ipPools.length === 0 && loading && (
                      <div className="card bg-base-100 border border-base-300 shadow-sm">
                        <div className="card-body gap-3">
                          <div className="skeleton h-5 w-1/2" />
                          <div className="skeleton h-4 w-2/3" />
                          <div className="skeleton h-4 w-full" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ===================== TAB 6: STORAGE ===================== */}
            {activeTab === 'storage' && (
              <>
                <PageHeader
                  title="Storage engine"
                  description="Live blob storage status reported by the admin API."
                />

                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4 sm:p-5 gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-box bg-base-200 p-4">
                        <p className="text-xs text-base-content/60">Used</p>
                        <p className="text-lg font-semibold font-mono tabular-nums">
                          {storage ? fmtBytes(storage.used_bytes) : '—'}
                        </p>
                      </div>
                      <div className="rounded-box bg-base-200 p-4">
                        <p className="text-xs text-base-content/60">Free</p>
                        <p className="text-lg font-semibold font-mono tabular-nums">
                          {storage ? fmtBytes(storage.free_bytes) : '—'}
                        </p>
                      </div>
                      <div className="rounded-box bg-base-200 p-4">
                        <p className="text-xs text-base-content/60">Total</p>
                        <p className="text-lg font-semibold font-mono tabular-nums">
                          {storage ? fmtBytes(storage.total_bytes) : '—'}
                        </p>
                      </div>
                    </div>

                    {storage && storage.total_bytes > 0 && (
                      <div className="space-y-1">
                        <progress
                          className="progress progress-primary w-full h-2 bg-base-300"
                          value={storage.used_bytes}
                          max={storage.total_bytes}
                        />
                        <p className="text-xs text-base-content/50 text-right tabular-nums">
                          {Math.round((storage.used_bytes / storage.total_bytes) * 100)}% used
                        </p>
                      </div>
                    )}

                    <div className="divider my-0" />

                    <dl className="text-sm space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <dt className="text-base-content/60">Backend</dt>
                        <dd className="font-mono">{storage?.storage_type ?? '—'}</dd>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <dt className="text-base-content/60">Path</dt>
                        <dd className="font-mono break-all sm:text-right">{storage?.local_path ?? '—'}</dd>
                      </div>
                    </dl>
                  </div>
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

                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4 sm:p-5 gap-4">
                    <h2 className="card-title text-sm font-semibold">Cluster operations</h2>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void handleBackup()} className="btn btn-outline btn-sm gap-2">
                        <Database className="w-4 h-4" />
                        Create database backup
                      </button>
                      <button onClick={() => void handleRestart()} className="btn btn-outline btn-sm gap-2">
                        <RotateCw className="w-4 h-4" />
                        Restart mail service
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="card bg-base-100 border border-base-300 shadow-sm">
                    <div className="card-body p-4 sm:p-5 gap-3">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="card-title text-sm font-semibold">Service checks</h2>
                        <span className="badge badge-ghost badge-sm tabular-nums">
                          {healthyCount} / 3 healthy
                        </span>
                      </div>
                      <ul className="space-y-2 font-mono text-sm">
                        {(['postgres', 'redis', 'stalwart'] as const).map((svc) => (
                          <li
                            key={svc}
                            className="flex items-center justify-between gap-3 rounded-box bg-base-200 px-3 h-10"
                          >
                            <span>{svc}</span>
                            <span className={healthData?.checks[svc] ? 'text-success' : 'text-error'}>
                              {healthData?.checks[svc] ? 'up' : 'down'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="card bg-base-100 border border-base-300 shadow-sm">
                    <div className="card-body p-4 sm:p-5 gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="card-title text-sm font-semibold">CLI management</h2>
                        <span className="badge badge-ghost badge-sm font-mono max-w-full truncate">
                          /usr/local/bin/affinmail
                        </span>
                      </div>
                      <div className="rounded-box bg-base-200 p-3 font-mono text-xs space-y-1 overflow-x-auto">
                        {['status', 'restart', 'update', 'backup', 'logs stalwart'].map((cmd) => (
                          <p key={cmd} className="text-base-content/80 whitespace-nowrap">
                            <span className="text-base-content/40 select-none">$ </span>
                            affinmail {cmd}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4 sm:p-5 gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="card-title text-sm font-semibold gap-2">
                        <ScrollText className="w-4 h-4 text-base-content/50" />
                        Mail server log
                      </h2>
                      <button
                        onClick={() => void loadLogs()}
                        className="btn btn-ghost btn-xs gap-1.5"
                        disabled={logsLoading}
                      >
                        <RotateCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>
                    <div className="rounded-box bg-base-200 p-3 max-h-80 overflow-y-auto overflow-x-hidden font-mono text-xs space-y-1">
                      {logsLoading && (
                        <div className="space-y-2">
                          <div className="skeleton h-3 w-full" />
                          <div className="skeleton h-3 w-5/6" />
                          <div className="skeleton h-3 w-4/6" />
                        </div>
                      )}
                      {!logsLoading &&
                        logLines.map((line, i) => (
                          <p key={i} className="text-base-content/70 break-all">
                            {line}
                          </p>
                        ))}
                      {!logsLoading && logLines.length === 0 && (
                        <p className="text-base-content/50">No log lines returned</p>
                      )}
                    </div>
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
        <aside className="flex flex-col w-72 max-w-[85vw] h-full bg-base-100 border-r border-base-300">
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
            className="space-y-4 mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateDomain();
            }}
          >
            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-domain">
                <span className="label-text font-medium">Domain name</span>
              </label>
              <input
                id="new-domain"
                type="text"
                placeholder="acme-corp.com"
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
                className="input input-bordered w-full font-mono"
                autoFocus
              />
            </div>

            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-domain-ip">
                <span className="label-text font-medium">Outbound IP</span>
                <span className="label-text-alt text-base-content/50">optional</span>
              </label>
              <select
                id="new-domain-ip"
                value={newDomainIp}
                onChange={(e) => setNewDomainIp(e.target.value)}
                className="select select-bordered w-full font-mono"
              >
                <option value="">No assignment</option>
                {ipPools.map((p) => (
                  <option key={p.id} value={p.ip}>
                    {p.ip} ({p.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-action">
              <button
                type="button"
                onClick={() => setShowAddDomainModal(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
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
            className="space-y-4 mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateMailbox();
            }}
          >
            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-mailbox-user">
                <span className="label-text font-medium">Username</span>
              </label>
              <input
                id="new-mailbox-user"
                type="text"
                placeholder="john"
                value={newMailboxUser}
                onChange={(e) => setNewMailboxUser(e.target.value)}
                className="input input-bordered w-full font-mono"
                autoFocus
              />
            </div>

            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-mailbox-domain">
                <span className="label-text font-medium">Domain</span>
              </label>
              <select
                id="new-mailbox-domain"
                value={newMailboxDomain}
                onChange={(e) => setNewMailboxDomain(e.target.value)}
                className="select select-bordered w-full font-mono"
              >
                {domains.map((d) => (
                  <option key={d.id} value={d.name}>
                    @{d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-mailbox-pass">
                <span className="label-text font-medium">Password</span>
              </label>
              <input
                id="new-mailbox-pass"
                type="password"
                autoComplete="new-password"
                value={newMailboxPass}
                onChange={(e) => setNewMailboxPass(e.target.value)}
                className="input input-bordered w-full"
              />
            </div>

            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-mailbox-quota">
                <span className="label-text font-medium">Storage quota (MB)</span>
              </label>
              <input
                id="new-mailbox-quota"
                type="number"
                min={1}
                value={newMailboxQuota}
                onChange={(e) => setNewMailboxQuota(e.target.value)}
                className="input input-bordered w-full font-mono tabular-nums"
              />
            </div>

            <div className="modal-action">
              <button
                type="button"
                onClick={() => setShowAddMailboxModal(false)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
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
            className="space-y-4 mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleResetPassword();
            }}
          >
            <div className="form-control w-full">
              <label className="label py-1" htmlFor="mailbox-new-password">
                <span className="label-text font-medium">New password</span>
                <span className="label-text-alt text-base-content/50">min. 8 characters</span>
              </label>
              <input
                id="mailbox-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input input-bordered w-full"
                autoFocus
              />
            </div>
            <p className="text-xs text-base-content/60">
              The mailbox user signs in with this password from now on. Panel SSO into this mailbox
              keeps working after a reset.
            </p>
            <div className="modal-action">
              <button
                type="button"
                onClick={() => {
                  setPasswordTarget(null);
                  setNewPassword('');
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
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
            className="space-y-4 mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveQuota();
            }}
          >
            <div className="form-control w-full">
              <label className="label py-1" htmlFor="mailbox-quota">
                <span className="label-text font-medium">Quota (MB)</span>
              </label>
              <input
                id="mailbox-quota"
                type="number"
                min={1}
                value={newQuota}
                onChange={(e) => setNewQuota(e.target.value)}
                className="input input-bordered w-full font-mono tabular-nums"
                autoFocus
              />
            </div>
            <div className="modal-action">
              <button type="button" onClick={() => setQuotaTarget(null)} className="btn btn-ghost">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
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
            className="space-y-4 mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateIpPool();
            }}
          >
            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-ip-address">
                <span className="label-text font-medium">IP address</span>
              </label>
              <input
                id="new-ip-address"
                type="text"
                placeholder="195.201.10.103"
                value={newIpAddress}
                onChange={(e) => setNewIpAddress(e.target.value)}
                className="input input-bordered w-full font-mono"
                autoFocus
              />
            </div>
            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-ip-rdns">
                <span className="label-text font-medium">rDNS hostname</span>
              </label>
              <input
                id="new-ip-rdns"
                type="text"
                placeholder="mail3.hostaffin.com"
                value={newIpRdns}
                onChange={(e) => setNewIpRdns(e.target.value)}
                className="input input-bordered w-full font-mono"
              />
            </div>
            <div className="form-control w-full">
              <label className="label py-1" htmlFor="new-ip-type">
                <span className="label-text font-medium">Pool type</span>
              </label>
              <select
                id="new-ip-type"
                value={newIpType}
                onChange={(e) => setNewIpType(e.target.value as 'shared' | 'dedicated')}
                className="select select-bordered w-full"
              >
                <option value="shared">Shared</option>
                <option value="dedicated">Dedicated</option>
              </select>
            </div>
            <div className="modal-action">
              <button type="button" onClick={() => setShowAddIpModal(false)} className="btn btn-ghost">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
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
          <div className="mt-4 space-y-4">
            {delivLoading && (
              <div className="space-y-2">
                <div className="skeleton h-4 w-full" />
                <div className="skeleton h-4 w-5/6" />
                <div className="skeleton h-4 w-4/6" />
              </div>
            )}

            {!delivLoading && deliv && (
              <>
                <div className="rounded-box border border-base-300">
                  <table className="table table-sm w-full">
                    <thead className={T.head}>
                      <tr>
                        <th>Type</th>
                        <th>Host</th>
                        <th>Value</th>
                        <th>Status</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {deliv.checks.map((chk, i) => (
                        <tr key={`${chk.type}-${chk.name}-${i}`} className={T.row}>
                          <td className={T.cell}>
                            <span className="badge badge-ghost badge-sm font-mono">{chk.type}</span>
                          </td>
                          <td className={`font-mono text-xs break-all ${T.cell}`}>{chk.name}</td>
                          <td className="w-full font-mono text-xs break-all sm:w-auto">{chk.expected}</td>
                          <td className={T.cell}>
                            {chk.published ? (
                              <span className="badge badge-success badge-outline badge-sm">Published</span>
                            ) : (
                              <span className="badge badge-error badge-outline badge-sm">Missing</span>
                            )}
                          </td>
                          <td className={T.cell}>
                            <button
                              onClick={() => {
                                void navigator.clipboard.writeText(chk.expected);
                                onNotify('Record value copied', 'info');
                              }}
                              className="btn btn-ghost btn-xs btn-square"
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
                            <EmptyState
                              icon={<Globe className="w-5 h-5" />}
                              title="No DNS records returned"
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="divider my-0" />

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">DKIM signing keys</h4>
                  {deliv.signatures.length === 0 ? (
                    <p className="text-xs text-base-content/60">No signing keys found for this domain.</p>
                  ) : (
                    <ul className="space-y-2">
                      {deliv.signatures.map((sig) => (
                        <li
                          key={sig.id ?? sig.selector ?? ''}
                          className="flex flex-wrap items-center gap-2 rounded-box bg-base-200 p-3 text-xs font-mono"
                        >
                          <span className="badge badge-ghost badge-sm">selector: {sig.selector}</span>
                          <span className="badge badge-ghost badge-sm">algorithm: {sig.algorithm}</span>
                          {sig.stage && <span className="badge badge-ghost badge-sm">stage: {sig.stage}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button onClick={() => void handleRotateDkim()} className="btn btn-outline btn-sm">
                    Rotate DKIM key
                  </button>
                  <p className="text-xs text-base-content/60">
                    Rotation adds a new signing key on the server. Publish the new selector record
                    above before retiring the old one.
                  </p>
                </div>

                <div className="divider my-0" />

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Catch-all address</h4>
                  <p className="text-xs text-base-content/60">
                    Mail to addresses that do not exist on this domain is delivered to the catch-all
                    mailbox instead of bouncing.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={catchAllInput}
                      onChange={(e) => setCatchAllInput(e.target.value)}
                      aria-label="Catch-all mailbox"
                      className="select select-bordered w-full sm:flex-1 font-mono"
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
                    <button onClick={() => void handleSaveCatchAll()} className="btn btn-primary">
                      Save catch-all
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="modal-action">
              <button onClick={() => setSelectedDnsDomain(null)} className="btn btn-ghost">
                Close
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </div>
  );
};
