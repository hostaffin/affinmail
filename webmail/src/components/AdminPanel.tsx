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
  Cpu,
  Layers,
  Terminal,
  Menu,
  X,
  LogIn,
  KeyRound,
  Gauge,
  Forward,
} from 'lucide-react';
import { AffinMailLogo } from './AffinMailLogo';
import {
  type Domain,
  type Mailbox,
  type IpPool,
  type StorageStatus,
  type Health,
  type DnsRecord,
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
  health as apiHealth,
  listDomains,
  createDomain,
  deleteDomain,
  getDomainDns,
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

type AdminTab = 'dashboard' | 'domains' | 'mailboxes' | 'aliases' | 'ippools' | 'storage' | 'system';

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

function isAuthError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg === 'unauthorized' || msg.includes('401');
}

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
  const [usernameInput, setUsernameInput] = useState('root');
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
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [dnsLoading, setDnsLoading] = useState(false);

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
    setDnsLoading(true);
    setDnsRecords([]);
    getDomainDns(selectedDnsDomain)
      .then((r) => {
        if (!cancelled) setDnsRecords(r.records);
      })
      .catch((e) => {
        if (!cancelled) fail(e);
      })
      .finally(() => {
        if (!cancelled) setDnsLoading(false);
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

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col justify-between h-full">
      <div className="space-y-0.5">
        {isMobile && (
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-base-300">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 stroke-[1.5] text-primary" />
              <span className="font-medium text-xs text-base-content">Administration</span>
            </div>
            <button
              onClick={() => setIsMobileNavOpen(false)}
              className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 text-base-content/60"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4 stroke-[1.5]" />
            </button>
          </div>
        )}

        <div className="px-2.5 py-2 text-xs font-medium text-base-content/50">
          Administration
        </div>

        <button
          onClick={() => {
            setActiveTab('dashboard');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs font-normal transition-colors ${
            activeTab === 'dashboard'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <Activity className="w-4 h-4 stroke-[1.5] text-base-content/60" />
          <span>Overview</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('domains');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-2.5 h-8 rounded-lg text-xs font-normal transition-colors ${
            activeTab === 'domains'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 stroke-[1.5] text-base-content/60" />
            <span>Virtual domains</span>
          </div>
          <span className="font-mono text-xs tabular-nums text-base-content/60">
            {domains.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('mailboxes');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-2.5 h-8 rounded-lg text-xs font-normal transition-colors ${
            activeTab === 'mailboxes'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 stroke-[1.5] text-base-content/60" />
            <span>Mailboxes and quotas</span>
          </div>
          <span className="font-mono text-xs tabular-nums text-base-content/60">
            {mailboxes.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('aliases');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-2.5 h-8 rounded-lg text-xs font-normal transition-colors ${
            activeTab === 'aliases'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <div className="flex items-center gap-2">
            <Forward className="w-4 h-4 stroke-[1.5] text-base-content/60" />
            <span>Aliases and forwarding</span>
          </div>
          <span className="font-mono text-xs tabular-nums text-base-content/60">
            {aliases.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('ippools');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-2.5 h-8 rounded-lg text-xs font-normal transition-colors ${
            activeTab === 'ippools'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 stroke-[1.5] text-base-content/60" />
            <span>IP pools and warm-up</span>
          </div>
          <span className="font-mono text-xs text-success">Clean</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('storage');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs font-normal transition-colors ${
            activeTab === 'storage'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <HardDrive className="w-4 h-4 stroke-[1.5] text-base-content/60" />
          <span>Storage engine</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('system');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center gap-2 px-2.5 h-8 rounded-lg text-xs font-normal transition-colors ${
            activeTab === 'system'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <Terminal className="w-4 h-4 stroke-[1.5] text-base-content/60" />
          <span>System controls</span>
        </button>
      </div>

      {/* Node License & Version */}
      <div className="p-3 bg-base-200 border border-base-300 rounded-xl text-xs space-y-1 text-base-content/70 mt-4 font-mono tabular-nums">
        <div className="flex justify-between font-medium text-base-content">
          <span>AffinMail core</span>
          <span>{healthData?.version ?? '—'}</span>
        </div>
        <p className="text-xs text-base-content/50">Rust Stalwart • PG16 • Redis7</p>
        <p className={`text-xs flex items-center gap-1 ${healthData?.checks.stalwart ? 'text-success' : 'text-error'}`}>
          <CheckCircle className="w-3.5 h-3.5 stroke-[1.5]" />
          {healthData?.checks.stalwart ? 'Active' : 'Unreachable'}
        </p>
        <button
          onClick={() => logout()}
          className="btn btn-ghost btn-xs h-8 w-full mt-2 border border-base-300 rounded-lg font-medium"
        >
          Sign out
        </button>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- auth gate */

  if (!authed) {
    return (
      <div className="flex flex-col h-dvh w-full overflow-hidden bg-base-100 text-base-content">
        <header className="h-14 border-b border-base-300 bg-base-100 px-3 sm:px-4 flex items-center justify-between shrink-0">
          <AffinMailLogo
            variant="admin"
            size="sm"
            tagline="Administration console"
          />
          <button
            onClick={onToggleTheme}
            className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 text-base-content/70 hover:text-base-content hover:bg-base-200"
            title="Toggle theme"
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4 stroke-[1.5]" />
            ) : (
              <Sun className="w-4 h-4 stroke-[1.5]" />
            )}
          </button>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <form
            className="w-full max-w-sm bg-base-100 border border-base-300 rounded-xl p-5 space-y-4 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void handleLogin();
            }}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 stroke-[1.5] text-primary" />
              <h1 className="text-sm font-medium">Admin sign in</h1>
            </div>
            <p className="text-xs text-base-content/60">
              Sign in with the mail server's administrator (root) credentials —
              the same username and password as the mail server itself. No
              separate panel account is needed.
            </p>

            <div className="space-y-1">
              <label className="text-xs text-base-content/70 block" htmlFor="admin-username">
                Username
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="input input-bordered input-sm w-full font-mono rounded-lg"
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-base-content/70 block" htmlFor="admin-password">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="input input-bordered input-sm w-full rounded-lg"
              />
            </div>

            {authError && (
              <p className="text-xs text-error flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 stroke-[1.5]" />
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={authBusy}
              className="btn btn-primary btn-sm w-full rounded-lg font-medium"
            >
              {authBusy ? 'Signing in…' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={onSwitchToWebmail}
              className="btn btn-ghost btn-xs w-full rounded-lg text-base-content/60"
            >
              Back to webmail
            </button>
          </form>
        </main>
      </div>
    );
  }

  /* ---------------------------------------------------------------- panel */

  const storageUsed = storage ? fmtBytes(storage.used_bytes) : '—';
  const checks = healthData?.checks;
  const healthyCount = checks ? [checks.postgres, checks.redis, checks.stalwart].filter(Boolean).length : 0;

  return (
    <div className="flex flex-col h-dvh w-full overflow-hidden bg-base-100 text-base-content select-none">
      {/* 1. Admin Panel Master Header */}
      <header className="h-14 border-b border-base-300 bg-base-100 px-2 sm:px-4 flex items-center justify-between shrink-0 gap-1 sm:gap-2">
        <div className="flex items-center gap-1 sm:gap-2 shrink min-w-0 overflow-hidden">
          <button
            onClick={() => setIsMobileNavOpen((prev) => !prev)}
            className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 md:hidden text-base-content/70 hover:bg-base-200"
            title="Toggle admin menu"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-4 h-4 stroke-[1.5]" />
          </button>
          <AffinMailLogo
            variant="admin"
            size="sm"
            tagline="mail.hostaffin.com"
          />
        </div>

        {/* Center: System Quick Metrics */}
        <div className="hidden lg:flex items-center gap-5 text-xs text-base-content/60 font-mono tabular-nums">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 stroke-[1.5] text-base-content/40" />
            <span>{healthData?.service ?? 'api'} {healthData?.version ?? ''}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 stroke-[1.5] text-base-content/40" />
            <span>{healthyCount} of 3 services up</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck
              className={`w-3.5 h-3.5 stroke-[1.5] ${healthyCount === 3 ? 'text-success' : 'text-warning'}`}
            />
            <span>{healthyCount === 3 ? 'Healthy' : 'Degraded'}</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void loadData()}
            className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 hidden sm:inline-flex text-base-content/70 hover:text-base-content hover:bg-base-200"
            title="Refresh"
          >
            <RotateCw className={`w-4 h-4 stroke-[1.5] ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onToggleTheme}
            className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 text-base-content/70 hover:text-base-content hover:bg-base-200"
            title="Toggle theme"
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4 stroke-[1.5]" />
            ) : (
              <Sun className="w-4 h-4 stroke-[1.5]" />
            )}
          </button>

          {/* Switcher to Port 2083 Client Webmail */}
          <button
            onClick={onSwitchToWebmail}
            className="btn btn-ghost btn-xs h-8 px-2.5 gap-1.5 font-medium text-xs border border-base-300 rounded-lg hover:bg-base-200"
          >
            <span className="hidden sm:inline">Webmail</span>
            <span className="hidden lg:inline font-mono text-xs text-base-content/50">:2083</span>
            <ArrowRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
      </header>

      {/* 2. Main Admin Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Desktop Left Navigation Sidebar */}
        <aside className="hidden md:flex w-60 border-r border-base-300 bg-base-100 flex-col justify-between p-3 shrink-0">
          {renderSidebarContent(false)}
        </aside>

        {/* Mobile Slide-over Drawer */}
        {isMobileNavOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex h-dvh" role="dialog" aria-modal="true">
            <div
              className="fixed inset-0 bg-black/40 transition-opacity"
              onClick={() => setIsMobileNavOpen(false)}
            />
            <aside className="relative w-[min(320px,85vw)] bg-base-100 h-full max-h-dvh shadow-gmail-modal p-3 z-10 flex flex-col justify-between overflow-y-auto">
              {renderSidebarContent(true)}
            </aside>
          </div>
        )}

        {/* Central Content Area */}
        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 space-y-6 bg-base-100">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-base-content/60 font-mono">
              <RotateCw className="w-3.5 h-3.5 animate-spin" />
              <span>Loading cluster data…</span>
            </div>
          )}

          {/* ===================== TAB 1: DASHBOARD ===================== */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 max-w-6xl">
              <div>
                <h1 className="text-lg font-medium text-base-content">Cluster overview</h1>
                <p className="text-xs text-base-content/60 mt-0.5">
                  Virtual domains, multi-IP routing, storage, and mailboxes.
                </p>
              </div>

              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-base-200 border border-base-300 p-4 rounded-xl space-y-1">
                  <div className="flex justify-between items-center text-xs font-normal text-base-content/60">
                    <span>Virtual domains</span>
                    <Globe className="w-4 h-4 stroke-[1.5] text-base-content/40" />
                  </div>
                  <div className="text-xl font-medium font-mono tabular-nums text-base-content">{domains.length}</div>
                  <span className="text-xs text-base-content/50 font-mono">
                    {domains.filter((d) => d.dkimStatus === 'active').length} DKIM signed
                  </span>
                </div>

                <div className="bg-base-200 border border-base-300 p-4 rounded-xl space-y-1">
                  <div className="flex justify-between items-center text-xs font-normal text-base-content/60">
                    <span>Mailboxes</span>
                    <Users className="w-4 h-4 stroke-[1.5] text-base-content/40" />
                  </div>
                  <div className="text-xl font-medium font-mono tabular-nums text-base-content">{mailboxes.length}</div>
                  <span className="text-xs text-base-content/50 font-mono">
                    {mailboxes.filter((m) => m.status === 'active').length} active
                  </span>
                </div>

                <div className="bg-base-200 border border-base-300 p-4 rounded-xl space-y-1">
                  <div className="flex justify-between items-center text-xs font-normal text-base-content/60">
                    <span>Cluster storage</span>
                    <HardDrive className="w-4 h-4 stroke-[1.5] text-base-content/40" />
                  </div>
                  <div className="text-xl font-medium font-mono tabular-nums text-base-content">{storageUsed}</div>
                  <span className="text-xs text-base-content/50 font-mono">
                    Engine: {storage?.storage_type ?? '—'}
                  </span>
                </div>

                <div className="bg-base-200 border border-base-300 p-4 rounded-xl space-y-1">
                  <div className="flex justify-between items-center text-xs font-normal text-base-content/60">
                    <span>Service health</span>
                    <ShieldCheck className="w-4 h-4 stroke-[1.5] text-base-content/40" />
                  </div>
                  <div className="text-xl font-medium font-mono tabular-nums text-base-content">{healthyCount} / 3</div>
                  <span className={`text-xs font-mono ${healthyCount === 3 ? 'text-success' : 'text-error'}`}>
                    {healthyCount === 3 ? 'All services up' : 'Service degraded'}
                  </span>
                </div>
              </div>

              {/* Quick Actions Bar */}
              <div className="bg-base-200 border border-base-300 p-4 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h3 className="text-xs font-medium text-base-content">Management actions</h3>
                  <p className="text-xs text-base-content/50">Provisioning and cluster commands</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setShowAddDomainModal(true)}
                    className="btn btn-primary btn-xs px-3 h-8 gap-1.5 font-medium rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                    <span>Add virtual domain</span>
                  </button>
                  <button
                    onClick={() => setShowAddMailboxModal(true)}
                    className="btn btn-ghost btn-xs px-3 h-8 border border-base-300 gap-1.5 font-medium rounded-lg hover:bg-base-100"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                    <span>Create mailbox</span>
                  </button>
                  <button
                    onClick={() => void loadData()}
                    className="btn btn-ghost btn-xs px-3 h-8 border border-base-300 gap-1.5 font-medium rounded-lg hover:bg-base-100"
                  >
                    <RotateCw className="w-3.5 h-3.5 stroke-[1.5]" />
                    <span>Refresh stats</span>
                  </button>
                </div>
              </div>

              {/* Cluster Ports Reference */}
              <div className="bg-base-200 border border-base-300 p-4 rounded-xl space-y-3">
                <h3 className="text-xs font-medium text-base-content">Cluster protocols and ports</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                  <div className="p-3 bg-base-100 rounded-lg border border-base-300">
                    <span className="text-base-content font-medium block">Port 2087</span>
                    <span className="text-xs text-base-content/60">Admin console</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-lg border border-base-300">
                    <span className="text-base-content font-medium block">Port 2083 / 443</span>
                    <span className="text-xs text-base-content/60">Client webmail</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-lg border border-base-300">
                    <span className="text-base-content font-medium block">Port 25, 465, 587</span>
                    <span className="text-xs text-base-content/60">SMTP submission</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-lg border border-base-300">
                    <span className="text-base-content font-medium block">Port 993, 4190</span>
                    <span className="text-xs text-base-content/60">IMAP and Sieve</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===================== TAB 2: DOMAINS ===================== */}
          {activeTab === 'domains' && (
            <div className="space-y-6 max-w-6xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium text-base-content">Virtual domains</h2>
                  <p className="text-xs text-base-content/60">DKIM keys, quotas, and dedicated egress IPs</p>
                </div>
                <button
                  onClick={() => setShowAddDomainModal(true)}
                  className="btn btn-primary btn-xs px-3 h-8 gap-1.5 font-medium rounded-lg self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                  <span>Add virtual domain</span>
                </button>
              </div>

              <div className="bg-base-100 border border-base-300 rounded-xl overflow-hidden">
                <div className="overflow-x-auto w-full">
                  <table className="table table-sm w-full text-xs min-w-[600px]">
                    <thead className="bg-base-200/60 text-base-content/60 font-medium">
                      <tr>
                        <th>Domain name</th>
                        <th>Mailboxes</th>
                        <th>Disk used / limit</th>
                        <th>Outbound IP egress</th>
                        <th>DKIM status</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-base-300">
                      {domains.map((dom) => (
                        <tr key={dom.id} className="hover:bg-base-200/40">
                          <td className="font-medium text-base-content">{dom.name}</td>
                          <td className="font-mono tabular-nums text-base-content/70">{dom.mailboxesCount} mailboxes</td>
                          <td className="font-mono tabular-nums text-base-content/70">
                            <span>{dom.diskUsed}</span> / {dom.diskLimit}
                          </td>
                          <td>
                            <span
                              className="px-1.5 py-0.5 rounded bg-base-200 border border-base-300 text-xs font-mono tabular-nums text-base-content/80"
                            >
                              {dom.assignedIp
                                ? `${dom.ipType === 'dedicated' ? 'Dedicated' : 'Shared'} (${dom.assignedIp})`
                                : 'Unassigned'}
                            </span>
                          </td>
                          <td>
                            <span className="font-mono text-xs text-base-content/60">
                              {dom.dkimStatus === 'active' ? '2048-bit RSA' : 'missing key'}
                            </span>
                          </td>
                          <td className="text-right space-x-1">
                            <button
                              onClick={() => setSelectedDnsDomain(dom.name)}
                              className="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content font-medium rounded-lg"
                            >
                              View DNS
                            </button>
                            <button
                              onClick={() => void handleAssignIp(dom.name)}
                              className="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content font-medium rounded-lg"
                            >
                              Assign IP
                            </button>
                            <button
                              onClick={() => void handleDeleteDomain(dom.name)}
                              className="btn btn-ghost btn-xs text-error hover:bg-base-200 font-medium rounded-lg"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                      {domains.length === 0 && !loading && (
                        <tr>
                          <td colSpan={6} className="text-center text-xs text-base-content/50 py-6">
                            No virtual domains yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ===================== TAB 3: MAILBOXES ===================== */}
          {activeTab === 'mailboxes' && (
            <div className="space-y-6 max-w-6xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium text-base-content">Mailbox accounts</h2>
                  <p className="text-xs text-base-content/60">Accounts, storage quotas, and outbound routing</p>
                </div>
                <button
                  onClick={() => setShowAddMailboxModal(true)}
                  className="btn btn-primary btn-xs px-3 h-8 gap-1.5 font-medium rounded-lg self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                  <span>Create mailbox</span>
                </button>
              </div>

              <div className="bg-base-100 border border-base-300 rounded-xl overflow-hidden">
                <div className="overflow-x-auto w-full">
                  <table className="table table-sm w-full text-xs min-w-[620px]">
                    <thead className="bg-base-200/60 text-base-content/60 font-medium">
                      <tr>
                        <th>Email address</th>
                        <th>Domain</th>
                        <th>Storage quota</th>
                        <th>Outbound route</th>
                        <th>Status</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-base-300">
                      {mailboxes.map((mb) => (
                        <tr key={mb.id} className="hover:bg-base-200/40">
                          <td className="font-medium text-base-content font-mono">{mb.email}</td>
                          <td className="text-base-content/70">{mb.domain}</td>
                          <td className="font-mono tabular-nums text-base-content/70">
                            <span>{mb.used}</span> / {mb.quota}
                          </td>
                          <td>
                            <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-base-200 border border-base-300 text-base-content/70">
                              {mb.route}
                            </span>
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-1.5 text-xs text-base-content/80 font-mono">
                              <span className={`w-1.5 h-1.5 rounded-full ${mb.status === 'active' ? 'bg-success' : 'bg-error'}`}></span>
                              {mb.status}
                            </span>
                          </td>
                          <td className="text-right space-x-1 whitespace-nowrap">
                            <button
                              onClick={() => void handleOpenMailbox(mb)}
                              className="btn btn-ghost btn-xs font-medium text-primary hover:bg-base-200 rounded-lg"
                              title={`Open ${mb.email} in the webmail (SSO)`}
                            >
                              <LogIn className="w-3.5 h-3.5 stroke-[1.5] inline" /> Open
                            </button>
                            <button
                              onClick={() => {
                                setPasswordTarget(mb);
                                setNewPassword('');
                              }}
                              className="btn btn-ghost btn-xs font-medium text-base-content/70 hover:text-base-content rounded-lg"
                              title="Set a new password"
                            >
                              <KeyRound className="w-3.5 h-3.5 stroke-[1.5] inline" /> Password
                            </button>
                            {!mb.isServerOnly && (
                              <button
                                onClick={() => {
                                  setQuotaTarget(mb);
                                  setNewQuota(String(mb.quotaMb || 5120));
                                }}
                                className="btn btn-ghost btn-xs font-medium text-base-content/70 hover:text-base-content rounded-lg"
                                title="Change storage quota"
                              >
                                <Gauge className="w-3.5 h-3.5 stroke-[1.5] inline" /> Quota
                              </button>
                            )}
                            {!mb.isServerOnly && (
                              <>
                                <button
                                  onClick={() => void handleToggleMailboxStatus(mb)}
                                  className="btn btn-ghost btn-xs font-medium text-base-content/70 hover:text-base-content rounded-lg-lg"
                                >
                                  {mb.status === 'active' ? 'Suspend' : 'Unsuspend'}
                                </button>
                                <button
                                  onClick={() => void handleDeleteMailbox(mb)}
                                  className="btn btn-ghost btn-xs text-error hover:bg-base-200 font-medium rounded-lg"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                            {mb.isServerOnly && (
                              <span className="text-xs text-base-content/40 font-mono">server</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {mailboxes.length === 0 && !loading && (
                        <tr>
                          <td colSpan={6} className="text-center text-xs text-base-content/50 py-6">
                            No mailboxes yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ===================== TAB: ALIASES ===================== */}
          {activeTab === 'aliases' && (
            <div className="space-y-6 max-w-6xl">
              <div>
                <h2 className="text-base font-medium text-base-content">Aliases and forwarding</h2>
                <p className="text-xs text-base-content/60">
                  An alias delivers mail for one address into another mailbox on this server.
                </p>
              </div>

              <div className="bg-base-100 border border-base-300 rounded-xl p-4 space-y-3">
                <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Alias address</label>
                    <input
                      type="email"
                      placeholder="sales@example.com"
                      value={newAliasSource}
                      onChange={(e) => setNewAliasSource(e.target.value)}
                      className="input input-bordered input-xs h-8 w-full font-mono rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Delivers to mailbox</label>
                    <input
                      type="email"
                      placeholder="owner@example.com"
                      value={newAliasDest}
                      onChange={(e) => setNewAliasDest(e.target.value)}
                      className="input input-bordered input-xs h-8 w-full font-mono rounded-lg"
                    />
                  </div>
                  <button
                    onClick={() => void handleCreateAlias()}
                    className="btn btn-primary btn-xs h-8 px-3 rounded-lg font-medium"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[1.5]" /> Add alias
                  </button>
                </div>
              </div>

              <div className="bg-base-100 border border-base-300 rounded-xl overflow-hidden">
                <div className="overflow-x-auto w-full">
                  <table className="table table-sm w-full text-xs min-w-[520px]">
                    <thead className="bg-base-200/60 text-base-content/60 font-medium">
                      <tr>
                        <th>Alias address</th>
                        <th>Delivers to</th>
                        <th>Status</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-base-300">
                      {aliases.map((a) => (
                        <tr key={a.id} className="hover:bg-base-200/40">
                          <td className="font-medium text-base-content font-mono">{a.source_address}</td>
                          <td className="font-mono text-base-content/70">{a.destination_address}</td>
                          <td>
                            <span className="inline-flex items-center gap-1.5 text-xs text-base-content/80 font-mono">
                              <span className={`w-1.5 h-1.5 rounded-full ${a.isActive ? 'bg-success' : 'bg-error'}`}></span>
                              {a.isActive ? 'active' : 'inactive'}
                            </span>
                          </td>
                          <td className="text-right">
                            <button
                              onClick={() => void handleDeleteAlias(a)}
                              className="btn btn-ghost btn-xs text-error hover:bg-base-200 font-medium rounded-lg"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                      {aliases.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center text-xs text-base-content/50 py-6">
                            No aliases yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ===================== TAB 4: IP POOLS ===================== */}
          {activeTab === 'ippools' && (
            <div className="space-y-6 max-w-6xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium text-base-content">IP pools and egress routing</h2>
                  <p className="text-xs text-base-content/60">Dedicated and shared outbound IP addresses</p>
                </div>
                <button
                  onClick={() => setShowAddIpModal(true)}
                  className="btn btn-primary btn-xs px-3 h-8 gap-1.5 font-medium rounded-lg self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                  <span>Bind new outbound IP</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ipPools.map((pool) => (
                  <div key={pool.id} className="bg-base-200 border border-base-300 p-4 rounded-xl space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-sm font-medium text-base-content tabular-nums">{pool.ip}</span>
                        <p className="text-xs text-base-content/50 font-mono mt-0.5">rDNS: {pool.rdns}</p>
                      </div>
                      <span className="px-1.5 py-0.5 rounded bg-base-100 border border-base-300 text-xs font-mono text-base-content/80">
                        {pool.type}
                      </span>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-base-300 text-xs">
                      <div className="flex justify-between text-base-content/70 font-mono tabular-nums">
                        <span>Assigned domains</span>
                        <span className="font-medium text-base-content">{pool.domainsCount}</span>
                      </div>
                      <div className="flex justify-between text-base-content/70 font-mono">
                        <span>RBL status</span>
                        {pool.rblClean ? (
                          <span className="text-success flex items-center gap-1 font-medium">
                            <CheckCircle className="w-3.5 h-3.5 stroke-[1.5]" /> Clean
                          </span>
                        ) : (
                          <span className="text-error flex items-center gap-1 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5 stroke-[1.5]" /> Blacklisted
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {ipPools.length === 0 && !loading && (
                  <div className="text-xs text-base-content/50 py-6">No outbound IPs bound yet</div>
                )}
              </div>
            </div>
          )}

          {/* ===================== TAB 5: STORAGE ===================== */}
          {activeTab === 'storage' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h2 className="text-base font-medium text-base-content">Storage engine</h2>
                <p className="text-xs text-base-content/60">Live blob storage status reported by the admin API.</p>
              </div>

              <div className="bg-base-100 border border-base-300 p-4 rounded-xl space-y-3 text-xs">
                <div className="flex justify-between items-center border-b border-base-300 pb-2">
                  <span className="text-base-content/60">Backend</span>
                  <span className="font-mono text-base-content">
                    {storage?.storage_type ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-4">
                  <span className="text-base-content/60">Path</span>
                  <span className="font-mono text-base-content break-all text-right">
                    {storage?.local_path ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-base-content/60">Used</span>
                  <span className="font-mono tabular-nums text-base-content">
                    {storage ? fmtBytes(storage.used_bytes) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-base-content/60">Free</span>
                  <span className="font-mono tabular-nums text-base-content">
                    {storage ? fmtBytes(storage.free_bytes) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-base-content/60">Total</span>
                  <span className="font-mono tabular-nums text-base-content">
                    {storage ? fmtBytes(storage.total_bytes) : '—'}
                  </span>
                </div>
                {storage && storage.total_bytes > 0 && (
                  <progress
                    className="progress progress-primary w-full h-1 bg-base-300"
                    value={storage.used_bytes}
                    max={storage.total_bytes}
                  ></progress>
                )}
              </div>
            </div>
          )}

          {/* ===================== TAB 6: SYSTEM ===================== */}
          {activeTab === 'system' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h2 className="text-base font-medium text-base-content">System controls and backup</h2>
                <p className="text-xs text-base-content/60">Cluster service orchestration and maintenance</p>
              </div>

              <div className="bg-base-100 border border-base-300 p-4 rounded-xl space-y-3">
                <h3 className="text-xs font-medium text-base-content">Cluster operations</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void handleBackup()}
                    className="btn btn-ghost btn-xs h-8 px-3 border border-base-300 rounded-lg font-medium gap-1.5"
                  >
                    <Database className="w-3.5 h-3.5 stroke-[1.5] text-base-content/60" />
                    <span>Create database backup</span>
                  </button>

                  <button
                    onClick={() => void handleRestart()}
                    className="btn btn-ghost btn-xs h-8 px-3 border border-base-300 rounded-lg font-medium gap-1.5"
                  >
                    <RotateCw className="w-3.5 h-3.5 stroke-[1.5] text-base-content/60" />
                    <span>Restart mail service</span>
                  </button>
                </div>
              </div>

              <div className="bg-base-200 border border-base-300 p-4 rounded-xl font-mono text-xs space-y-2 tabular-nums">
                <div className="flex justify-between items-center text-base-content/50 border-b border-base-300 pb-2">
                  <span>Service checks</span>
                  <span>{healthyCount} / 3 healthy</span>
                </div>
                {(['postgres', 'redis', 'stalwart'] as const).map((svc) => (
                  <div key={svc} className="flex justify-between items-center">
                    <span className="text-base-content/80">{svc}</span>
                    <span className={healthData?.checks[svc] ? 'text-success' : 'text-error'}>
                      {healthData?.checks[svc] ? 'up' : 'down'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="bg-base-200 border border-base-300 p-4 rounded-xl font-mono text-xs space-y-2 tabular-nums">
                <div className="flex justify-between items-center text-base-content/50 border-b border-base-300 pb-2">
                  <span>CLI management</span>
                  <span>/usr/local/bin/affinmail</span>
                </div>
                <p className="text-base-content/80">$ affinmail status</p>
                <p className="text-base-content/80">$ affinmail restart</p>
                <p className="text-base-content/80">$ affinmail update</p>
                <p className="text-base-content/80">$ affinmail backup</p>
                <p className="text-base-content/80">$ affinmail logs stalwart</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ===================== MODAL: ADD VIRTUAL DOMAIN ===================== */}
      {showAddDomainModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 border border-base-300 w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-5 rounded-xl shadow-gmail-modal space-y-4">
            <h3 className="text-sm font-medium text-base-content">Add virtual domain</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Domain name</label>
                <input
                  type="text"
                  placeholder="e.g. acme-corp.com"
                  value={newDomainName}
                  onChange={(e) => setNewDomainName(e.target.value)}
                  className="input input-bordered input-xs h-8 w-full font-mono rounded-lg"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Outbound IP (optional)</label>
                <select
                  value={newDomainIp}
                  onChange={(e) => setNewDomainIp(e.target.value)}
                  className="select select-bordered select-xs h-8 w-full font-mono rounded-lg"
                >
                  <option value="">No assignment</option>
                  {ipPools.map((p) => (
                    <option key={p.id} value={p.ip}>
                      {p.ip} ({p.type})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
              <button onClick={() => setShowAddDomainModal(false)} className="btn btn-ghost btn-xs h-8 px-3 rounded-lg font-medium">
                Cancel
              </button>
              <button onClick={() => void handleCreateDomain()} className="btn btn-primary btn-xs h-8 px-3 rounded font-medium">
                Provision domain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: CREATE MAILBOX ===================== */}
      {/* ===================== MODAL: RESET PASSWORD ===================== */}
      {passwordTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 border border-base-300 w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-5 rounded-xl shadow-gmail-modal space-y-4">
            <h3 className="text-sm font-medium text-base-content">Set password for {passwordTarget.email}</h3>
            <div>
              <label className="text-xs text-base-content/70 mb-1 block">New password (min. 8 characters)</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input input-bordered input-xs h-8 w-full rounded-lg"
                autoFocus
              />
              <p className="text-xs text-base-content/50 mt-1">
                The mailbox user signs in with this password from now on. Panel SSO into
                this mailbox keeps working after a reset.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
              <button onClick={() => setPasswordTarget(null)} className="btn btn-ghost btn-xs h-8 px-3 rounded-lg font-medium">
                Cancel
              </button>
              <button onClick={() => void handleResetPassword()} className="btn btn-primary btn-xs h-8 px-3 rounded font-medium">
                Set password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: QUOTA ===================== */}
      {quotaTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 border border-base-300 w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-5 rounded-xl shadow-gmail-modal space-y-4">
            <h3 className="text-sm font-medium text-base-content">Storage quota for {quotaTarget.email}</h3>
            <div>
              <label className="text-xs text-base-content/70 mb-1 block">Quota (MB)</label>
              <input
                type="number"
                value={newQuota}
                onChange={(e) => setNewQuota(e.target.value)}
                className="input input-bordered input-xs h-8 w-full font-mono tabular-nums rounded-lg"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
              <button onClick={() => setQuotaTarget(null)} className="btn btn-ghost btn-xs h-8 px-3 rounded-lg font-medium">
                Cancel
              </button>
              <button onClick={() => void handleSaveQuota()} className="btn btn-primary btn-xs h-8 px-3 rounded font-medium">
                Save quota
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddMailboxModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 border border-base-300 w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-5 rounded-xl shadow-gmail-modal space-y-4">
            <h3 className="text-sm font-medium text-base-content">Create mailbox</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Username</label>
                <input
                  type="text"
                  placeholder="e.g. john"
                  value={newMailboxUser}
                  onChange={(e) => setNewMailboxUser(e.target.value)}
                  className="input input-bordered input-xs h-8 w-full font-mono rounded-lg"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Domain</label>
                <select
                  value={newMailboxDomain}
                  onChange={(e) => setNewMailboxDomain(e.target.value)}
                  className="select select-bordered select-xs h-8 w-full font-mono rounded-lg"
                >
                  {domains.map((d) => (
                    <option key={d.id} value={d.name}>
                      @{d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Password</label>
                <input
                  type="password"
                  placeholder="Password"
                  value={newMailboxPass}
                  onChange={(e) => setNewMailboxPass(e.target.value)}
                  className="input input-bordered input-xs h-8 w-full rounded-lg"
                />
              </div>

              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Storage quota (MB)</label>
                <input
                  type="number"
                  value={newMailboxQuota}
                  onChange={(e) => setNewMailboxQuota(e.target.value)}
                  className="input input-bordered input-xs h-8 w-full font-mono tabular-nums rounded"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
              <button onClick={() => setShowAddMailboxModal(false)} className="btn btn-ghost btn-xs h-8 px-3 rounded-lg font-medium">
                Cancel
              </button>
              <button onClick={() => void handleCreateMailbox()} className="btn btn-primary btn-xs h-8 px-3 rounded font-medium">
                Create mailbox
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: BIND OUTBOUND IP ===================== */}
      {showAddIpModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 border border-base-300 w-full max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-5 rounded-xl shadow-gmail-modal space-y-4">
            <h3 className="text-sm font-medium text-base-content">Bind new outbound IP</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">IP address</label>
                <input
                  type="text"
                  placeholder="e.g. 195.201.10.103"
                  value={newIpAddress}
                  onChange={(e) => setNewIpAddress(e.target.value)}
                  className="input input-bordered input-xs h-8 w-full font-mono rounded-lg"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">rDNS hostname</label>
                <input
                  type="text"
                  placeholder="e.g. mail3.hostaffin.com"
                  value={newIpRdns}
                  onChange={(e) => setNewIpRdns(e.target.value)}
                  className="input input-bordered input-xs h-8 w-full font-mono rounded-lg"
                />
              </div>
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Pool type</label>
                <select
                  value={newIpType}
                  onChange={(e) => setNewIpType(e.target.value as 'shared' | 'dedicated')}
                  className="select select-bordered select-xs h-8 w-full font-mono rounded-lg"
                >
                  <option value="shared">Shared</option>
                  <option value="dedicated">Dedicated</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
              <button onClick={() => setShowAddIpModal(false)} className="btn btn-ghost btn-xs h-8 px-3 rounded-lg font-medium">
                Cancel
              </button>
              <button onClick={() => void handleCreateIpPool()} className="btn btn-primary btn-xs h-8 px-3 rounded font-medium">
                Bind IP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: DNS RECORDS & DKIM ===================== */}
      {selectedDnsDomain && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 border border-base-300 w-full max-w-2xl max-h-[90dvh] overflow-y-auto p-4 sm:p-5 rounded-xl shadow-gmail-modal space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-medium text-base-content">DNS records for {selectedDnsDomain}</h3>
              <button
                onClick={() => setSelectedDnsDomain(null)}
                className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 text-base-content/60"
                aria-label="Close"
              >
                <X className="w-4 h-4 stroke-[1.5]" />
              </button>
            </div>

            <div className="overflow-x-auto text-xs">
              <table className="table table-sm w-full font-mono tabular-nums">
                <thead className="bg-base-200/60 text-base-content/60">
                  <tr>
                    <th>Type</th>
                    <th>Host</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-base-300">
                  {dnsLoading && (
                    <tr>
                      <td colSpan={3} className="text-center text-base-content/50 py-4">
                        Loading DNS records…
                      </td>
                    </tr>
                  )}
                  {!dnsLoading &&
                    dnsRecords.map((rec, i) => (
                      <tr key={`${rec.type}-${rec.name}-${i}`}>
                        <td>
                          <span className="px-1.5 py-0.5 rounded bg-base-200 border border-base-300 text-xs">
                            {rec.type}
                          </span>
                        </td>
                        <td>{rec.name}</td>
                        <td className="break-all">
                          {rec.priority !== undefined ? `${rec.priority} ${rec.value}` : rec.value}
                        </td>
                      </tr>
                    ))}
                  {!dnsLoading && dnsRecords.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center text-base-content/50 py-4">
                        No records returned
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button onClick={() => setSelectedDnsDomain(null)} className="btn btn-ghost btn-xs h-8 px-4 border border-base-300 rounded-lg font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
