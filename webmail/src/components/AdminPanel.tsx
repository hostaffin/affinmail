import React, { useState } from 'react';
import {
  Server,
  Globe,
  Users,
  HardDrive,
  ShieldCheck,
  Activity,
  Plus,
  Key,
  Database,
  ArrowRight,
  Sun,
  Moon,
  AlertTriangle,
  CheckCircle,
  Copy,
  RotateCw,
  Cpu,
  Layers,
  Terminal,
  Menu,
  X,
} from 'lucide-react';
import { AffinMailLogo } from './AffinMailLogo';

interface AdminPanelProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSwitchToWebmail: () => void;
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  theme,
  onToggleTheme,
  onSwitchToWebmail,
  onNotify,
}) => {
  type AdminTab = 'dashboard' | 'domains' | 'mailboxes' | 'ippools' | 'storage' | 'system';
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Domains State
  const [domains, setDomains] = useState([
    {
      id: 'd-1',
      name: 'apexlogistics.com',
      mailboxesCount: 2,
      diskUsed: '3.2 GB',
      diskLimit: '20 GB',
      ipType: 'dedicated',
      assignedIp: '195.201.10.102',
      dkimStatus: 'active',
      status: 'active',
    },
    {
      id: 'd-2',
      name: 'trendmart.com',
      mailboxesCount: 2,
      diskUsed: '1.0 GB',
      diskLimit: '10 GB',
      ipType: 'shared',
      assignedIp: '195.201.10.101',
      dkimStatus: 'active',
      status: 'active',
    },
  ]);

  // Mailboxes State
  const [mailboxes, setMailboxes] = useState([
    {
      id: 'mb-1',
      email: 'marcus@apexlogistics.com',
      domain: 'apexlogistics.com',
      quota: '10240 MB',
      used: '3435 MB',
      route: 'direct',
      status: 'active',
    },
    {
      id: 'mb-2',
      email: 'support@apexlogistics.com',
      domain: 'apexlogistics.com',
      quota: '5120 MB',
      used: '120 MB',
      route: 'direct',
      status: 'active',
    },
    {
      id: 'mb-3',
      email: 'elena@trendmart.com',
      domain: 'trendmart.com',
      quota: '5120 MB',
      used: '1024 MB',
      route: 'relay_ses',
      status: 'active',
    },
  ]);

  // IP Pools State
  const [ipPools, setIpPools] = useState([
    {
      id: 'ip-1',
      ip: '195.201.10.101',
      type: 'shared',
      rdns: 'mail-shared1.hostaffin.com',
      domainsCount: 1,
      rblClean: true,
      warmupDay: 30,
    },
    {
      id: 'ip-2',
      ip: '195.201.10.102',
      type: 'dedicated',
      rdns: 'mail-dedicated1.hostaffin.com',
      domainsCount: 1,
      rblClean: true,
      warmupDay: 5,
    },
  ]);

  // Dynamic Storage State
  const [storageType, setStorageType] = useState<'fs' | 's3' | 'sftp'>('fs');
  const [s3Bucket, setS3Bucket] = useState('affinmail-blobs');
  const [s3Endpoint, setS3Endpoint] = useState('https://<account_id>.r2.cloudflarestorage.com');
  const [s3AccessKey, setS3AccessKey] = useState('cflare_r2_key_demo');
  const [s3SecretKey, setS3SecretKey] = useState('********************************');

  // Modals
  const [showAddDomainModal, setShowAddDomainModal] = useState(false);
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainIpType, setNewDomainIpType] = useState<'shared' | 'dedicated'>('shared');
  const [selectedDnsDomain, setSelectedDnsDomain] = useState<string | null>(null);

  const [showAddMailboxModal, setShowAddMailboxModal] = useState(false);
  const [newMailboxUser, setNewMailboxUser] = useState('');
  const [newMailboxDomain, setNewMailboxDomain] = useState(domains[0]?.name || '');
  const [newMailboxPass, setNewMailboxPass] = useState('');
  const [newMailboxQuota, setNewMailboxQuota] = useState('5120');

  const handleCreateDomain = () => {
    if (!newDomainName.trim()) {
      onNotify('Enter a valid domain name', 'error');
      return;
    }
    const newDom = {
      id: `d-${Date.now()}`,
      name: newDomainName.toLowerCase().trim(),
      mailboxesCount: 0,
      diskUsed: '0 MB',
      diskLimit: '10 GB',
      ipType: newDomainIpType,
      assignedIp: newDomainIpType === 'dedicated' ? '195.201.10.102' : '195.201.10.101',
      dkimStatus: 'active',
      status: 'active',
    };
    setDomains([...domains, newDom]);
    setNewDomainName('');
    setShowAddDomainModal(false);
    onNotify(`Domain ${newDom.name} provisioned with 2048-bit DKIM keys`, 'success');
  };

  const handleCreateMailbox = () => {
    if (!newMailboxUser.trim() || !newMailboxPass.trim()) {
      onNotify('Username and password are required', 'error');
      return;
    }
    const fullEmail = `${newMailboxUser.trim()}@${newMailboxDomain}`;
    const newMb = {
      id: `mb-${Date.now()}`,
      email: fullEmail,
      domain: newMailboxDomain,
      quota: `${newMailboxQuota} MB`,
      used: '0 MB',
      route: 'direct',
      status: 'active',
    };
    setMailboxes([...mailboxes, newMb]);
    setNewMailboxUser('');
    setNewMailboxPass('');
    setShowAddMailboxModal(false);
    onNotify(`Mailbox ${fullEmail} created`, 'success');
  };

  const handleToggleMailboxStatus = (id: string) => {
    setMailboxes(
      mailboxes.map((mb) =>
        mb.id === id ? { ...mb, status: mb.status === 'active' ? 'suspended' : 'active' } : mb
      )
    );
    onNotify('Mailbox status updated', 'info');
  };

  const handleSaveStorage = () => {
    onNotify(`Storage backend switched to ${storageType.toUpperCase()}`, 'success');
  };

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col justify-between h-full">
      <div className="space-y-0.5">
        {isMobile && (
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-base-300">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 stroke-[1.5] text-primary" />
              <span className="font-semibold text-xs text-base-content">Administration</span>
            </div>
            <button
              onClick={() => setIsMobileNavOpen(false)}
              className="btn btn-ghost btn-circle btn-xs text-base-content/60"
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
          className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-xs font-normal transition-colors ${
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
          className={`w-full flex items-center justify-between px-2.5 h-8 rounded-md text-xs font-normal transition-colors ${
            activeTab === 'domains'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Globe className="w-4 h-4 stroke-[1.5] text-base-content/60" />
            <span>Virtual domains</span>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-base-content/60">
            {domains.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('mailboxes');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-2.5 h-8 rounded-md text-xs font-normal transition-colors ${
            activeTab === 'mailboxes'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Users className="w-4 h-4 stroke-[1.5] text-base-content/60" />
            <span>Mailboxes and quotas</span>
          </div>
          <span className="font-mono text-[11px] tabular-nums text-base-content/60">
            {mailboxes.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('ippools');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-2.5 h-8 rounded-md text-xs font-normal transition-colors ${
            activeTab === 'ippools'
              ? 'bg-base-200 text-base-content font-medium'
              : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 stroke-[1.5] text-base-content/60" />
            <span>IP pools and warm-up</span>
          </div>
          <span className="font-mono text-[11px] text-success">Clean</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('storage');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-xs font-normal transition-colors ${
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
          className={`w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-xs font-normal transition-colors ${
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
      <div className="p-3 bg-base-200 border border-base-300 rounded-lg text-xs space-y-1 text-base-content/70 mt-4 font-mono tabular-nums">
        <div className="flex justify-between font-medium text-base-content">
          <span>AffinMail core</span>
          <span>v1.2.0</span>
        </div>
        <p className="text-[11px] text-base-content/50">Rust Stalwart • PG16 • Redis7</p>
        <p className="text-[11px] text-success flex items-center gap-1">
          <CheckCircle className="w-3 h-3 stroke-[1.5]" /> Active
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-100 text-base-content select-none">
      {/* 1. Admin Panel Master Header */}
      <header className="h-14 border-b border-base-300 bg-base-100 px-3 sm:px-4 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setIsMobileNavOpen((prev) => !prev)}
            className="btn btn-ghost btn-circle btn-sm md:hidden text-base-content/70 hover:bg-base-200"
            title="Toggle admin menu"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-4 h-4 stroke-[1.5]" />
          </button>
          <AffinMailLogo
            variant="admin"
            size="sm"
            tagline="mail.hostaffin.com (Rust Stalwart)"
            withGlow
          />
        </div>

        {/* Center: System Quick Metrics */}
        <div className="hidden lg:flex items-center gap-5 text-xs text-base-content/60 font-mono tabular-nums">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 stroke-[1.5] text-base-content/40" />
            <span>CPU 4%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 stroke-[1.5] text-base-content/40" />
            <span>RAM 680 MB / 4 GB</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 stroke-[1.5] text-success" />
            <span>Deliverability 10/10</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggleTheme}
            className="btn btn-ghost btn-circle btn-sm text-base-content/70 hover:text-base-content hover:bg-base-200"
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
            className="btn btn-ghost btn-xs h-8 px-2.5 gap-1.5 font-medium text-xs border border-base-300 rounded-md hover:bg-base-200"
          >
            <span>Webmail</span>
            <span className="hidden md:inline font-mono text-[10px] text-base-content/50">:2083</span>
            <ArrowRight className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
      </header>

      {/* 2. Main Admin Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Left Navigation Sidebar */}
        <aside className="hidden md:flex w-60 border-r border-base-300 bg-base-100 flex-col justify-between p-3 shrink-0">
          {renderSidebarContent(false)}
        </aside>

        {/* Mobile Slide-over Drawer */}
        {isMobileNavOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex" role="dialog" aria-modal="true">
            <div
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
              onClick={() => setIsMobileNavOpen(false)}
            />
            <aside className="relative w-64 max-w-[85vw] bg-base-100 h-full shadow-xl p-3 z-10 flex flex-col justify-between overflow-y-auto">
              {renderSidebarContent(true)}
            </aside>
          </div>
        )}

        {/* Central Content Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-base-100">
          {/* ===================== TAB 1: DASHBOARD ===================== */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 max-w-6xl">
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-base-content">Cluster overview</h1>
                <p className="text-xs text-base-content/60 mt-0.5">
                  Virtual domains, multi-IP routing, storage, and mailboxes.
                </p>
              </div>

              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-base-200 border border-base-300 p-3.5 rounded-lg space-y-1">
                  <div className="flex justify-between items-center text-xs font-normal text-base-content/60">
                    <span>Virtual domains</span>
                    <Globe className="w-4 h-4 stroke-[1.5] text-base-content/40" />
                  </div>
                  <div className="text-xl font-medium font-mono tabular-nums text-base-content">{domains.length}</div>
                  <span className="text-[11px] text-base-content/50 font-mono">100% DKIM signed</span>
                </div>

                <div className="bg-base-200 border border-base-300 p-3.5 rounded-lg space-y-1">
                  <div className="flex justify-between items-center text-xs font-normal text-base-content/60">
                    <span>Mailboxes</span>
                    <Users className="w-4 h-4 stroke-[1.5] text-base-content/40" />
                  </div>
                  <div className="text-xl font-medium font-mono tabular-nums text-base-content">{mailboxes.length}</div>
                  <span className="text-[11px] text-base-content/50 font-mono">All daemons active</span>
                </div>

                <div className="bg-base-200 border border-base-300 p-3.5 rounded-lg space-y-1">
                  <div className="flex justify-between items-center text-xs font-normal text-base-content/60">
                    <span>Cluster storage</span>
                    <HardDrive className="w-4 h-4 stroke-[1.5] text-base-content/40" />
                  </div>
                  <div className="text-xl font-medium font-mono tabular-nums text-base-content">4.2 GB</div>
                  <span className="text-[11px] text-base-content/50 font-mono">Engine: {storageType.toUpperCase()}</span>
                </div>

                <div className="bg-base-200 border border-base-300 p-3.5 rounded-lg space-y-1">
                  <div className="flex justify-between items-center text-xs font-normal text-base-content/60">
                    <span>IP deliverability</span>
                    <ShieldCheck className="w-4 h-4 stroke-[1.5] text-base-content/40" />
                  </div>
                  <div className="text-xl font-medium font-mono tabular-nums text-base-content">10 / 10</div>
                  <span className="text-[11px] text-success font-mono">0 blacklists flagged</span>
                </div>
              </div>

              {/* Quick Actions Bar */}
              <div className="bg-base-200 border border-base-300 p-4 rounded-lg flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h3 className="text-xs font-semibold text-base-content">Management actions</h3>
                  <p className="text-xs text-base-content/50">Provisioning and cluster commands</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setShowAddDomainModal(true)}
                    className="btn btn-primary btn-xs px-3 h-8 gap-1.5 font-medium rounded"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                    <span>Add virtual domain</span>
                  </button>
                  <button
                    onClick={() => setShowAddMailboxModal(true)}
                    className="btn btn-ghost btn-xs px-3 h-8 border border-base-300 gap-1.5 font-medium rounded hover:bg-base-100"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                    <span>Create mailbox</span>
                  </button>
                  <button
                    onClick={() => onNotify('Rate limits flushed', 'info')}
                    className="btn btn-ghost btn-xs px-3 h-8 border border-base-300 gap-1.5 font-medium rounded hover:bg-base-100"
                  >
                    <RotateCw className="w-3.5 h-3.5 stroke-[1.5]" />
                    <span>Flush rate limits</span>
                  </button>
                </div>
              </div>

              {/* Cluster Ports Reference */}
              <div className="bg-base-200 border border-base-300 p-4 rounded-lg space-y-3">
                <h3 className="text-xs font-semibold text-base-content">Cluster protocols and ports</h3>
                <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                  <div className="p-3 bg-base-100 rounded-md border border-base-300">
                    <span className="text-base-content font-medium block">Port 2087</span>
                    <span className="text-[11px] text-base-content/60">Admin console</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-md border border-base-300">
                    <span className="text-base-content font-medium block">Port 2083 / 443</span>
                    <span className="text-[11px] text-base-content/60">Client webmail</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-md border border-base-300">
                    <span className="text-base-content font-medium block">Port 25, 465, 587</span>
                    <span className="text-[11px] text-base-content/60">SMTP submission</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-md border border-base-300">
                    <span className="text-base-content font-medium block">Port 993, 4190</span>
                    <span className="text-[11px] text-base-content/60">IMAP and Sieve</span>
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
                  <h2 className="text-base font-semibold tracking-tight text-base-content">Virtual domains</h2>
                  <p className="text-xs text-base-content/60">DKIM keys, quotas, and dedicated egress IPs</p>
                </div>
                <button
                  onClick={() => setShowAddDomainModal(true)}
                  className="btn btn-primary btn-xs px-3 h-8 gap-1.5 font-medium rounded self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                  <span>Add virtual domain</span>
                </button>
              </div>

              <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
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
                              className="px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums bg-base-200 border border-base-300 text-base-content/80"
                            >
                              {dom.ipType === 'dedicated' ? `Dedicated (${dom.assignedIp})` : 'Shared pool'}
                            </span>
                          </td>
                          <td>
                            <span className="font-mono text-xs text-base-content/60">2048-bit RSA</span>
                          </td>
                          <td className="text-right space-x-1">
                            <button
                              onClick={() => setSelectedDnsDomain(dom.name)}
                              className="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content font-medium rounded"
                            >
                              View DNS
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete domain ${dom.name}?`)) {
                                  setDomains(domains.filter((d) => d.id !== dom.id));
                                  onNotify(`Domain ${dom.name} removed`, 'info');
                                }
                              }}
                              className="btn btn-ghost btn-xs text-error hover:bg-base-200 font-medium rounded"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
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
                  <h2 className="text-base font-semibold tracking-tight text-base-content">Mailbox accounts</h2>
                  <p className="text-xs text-base-content/60">Accounts, storage quotas, and outbound routing</p>
                </div>
                <button
                  onClick={() => setShowAddMailboxModal(true)}
                  className="btn btn-primary btn-xs px-3 h-8 gap-1.5 font-medium rounded self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                  <span>Create mailbox</span>
                </button>
              </div>

              <div className="bg-base-100 border border-base-300 rounded-lg overflow-hidden">
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
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-base-200 border border-base-300 text-base-content/70">
                              {mb.route}
                            </span>
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-1.5 text-xs text-base-content/80 font-mono">
                              <span className={`w-1.5 h-1.5 rounded-full ${mb.status === 'active' ? 'bg-success' : 'bg-error'}`}></span>
                              {mb.status}
                            </span>
                          </td>
                          <td className="text-right space-x-1">
                            <button
                              onClick={() => handleToggleMailboxStatus(mb.id)}
                              className="btn btn-ghost btn-xs font-medium text-base-content/70 hover:text-base-content rounded"
                            >
                              {mb.status === 'active' ? 'Suspend' : 'Unsuspend'}
                            </button>
                            <button
                              onClick={() => {
                                const newP = prompt('Enter new password:');
                                if (newP) onNotify(`Password for ${mb.email} updated`, 'success');
                              }}
                              className="btn btn-ghost btn-xs text-base-content/70 hover:text-base-content font-medium rounded"
                            >
                              Change password
                            </button>
                          </td>
                        </tr>
                      ))}
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
                  <h2 className="text-base font-semibold tracking-tight text-base-content">IP pools and egress routing</h2>
                  <p className="text-xs text-base-content/60">Dedicated and shared outbound IP addresses with 30-day warmup progression</p>
                </div>
                <button
                  onClick={() => onNotify('New IP binding added', 'success')}
                  className="btn btn-primary btn-xs px-3 h-8 gap-1.5 font-medium rounded self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
                  <span>Bind new outbound IP</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ipPools.map((pool) => (
                  <div key={pool.id} className="bg-base-200 border border-base-300 p-4 rounded-lg space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-sm font-medium text-base-content tabular-nums">{pool.ip}</span>
                        <p className="text-xs text-base-content/50 font-mono mt-0.5">rDNS: {pool.rdns}</p>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-mono capitalize bg-base-100 border border-base-300 text-base-content/80">
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
                        <span className="text-success flex items-center gap-1 font-medium">
                          <CheckCircle className="w-3.5 h-3.5 stroke-[1.5]" /> Clean (0 listings)
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-base-content/70 font-mono tabular-nums">
                        <span>Warm-up progression</span>
                        <span className="font-medium text-base-content">
                          Day {pool.warmupDay} / 30 {pool.warmupDay >= 30 ? '(Completed)' : ''}
                        </span>
                      </div>
                      <progress
                        className="progress progress-primary w-full h-1 bg-base-300"
                        value={pool.warmupDay}
                        max="30"
                      ></progress>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===================== TAB 5: DYNAMIC STORAGE ===================== */}
          {activeTab === 'storage' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-base-content">Dynamic storage engine</h2>
                <p className="text-xs text-base-content/60">
                  Switch blob and attachment storage between NVMe SSD, S3-compatible object storage, and SFTP.
                </p>
              </div>

              {/* Storage Mode Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  onClick={() => setStorageType('fs')}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-colors ${
                    storageType === 'fs'
                      ? 'border-base-content/40 bg-base-200'
                      : 'border-base-300 bg-base-100 hover:bg-base-200/50'
                  }`}
                >
                  <HardDrive className="w-5 h-5 mb-2 stroke-[1.5] text-base-content/60" />
                  <h4 className="font-medium text-xs text-base-content">Local NVMe SSD</h4>
                  <p className="text-[11px] text-base-content/50 mt-1">Direct local filesystem, sub-millisecond access</p>
                </div>

                <div
                  onClick={() => setStorageType('s3')}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-colors ${
                    storageType === 's3'
                      ? 'border-base-content/40 bg-base-200'
                      : 'border-base-300 bg-base-100 hover:bg-base-200/50'
                  }`}
                >
                  <Database className="w-5 h-5 mb-2 stroke-[1.5] text-base-content/60" />
                  <h4 className="font-medium text-xs text-base-content">S3 object storage</h4>
                  <p className="text-[11px] text-base-content/50 mt-1">Cloudflare R2, AWS S3, MinIO, Wasabi</p>
                </div>

                <div
                  onClick={() => setStorageType('sftp')}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-colors ${
                    storageType === 'sftp'
                      ? 'border-base-content/40 bg-base-200'
                      : 'border-base-300 bg-base-100 hover:bg-base-200/50'
                  }`}
                >
                  <Server className="w-5 h-5 mb-2 stroke-[1.5] text-base-content/60" />
                  <h4 className="font-medium text-xs text-base-content">SFTP storage box</h4>
                  <p className="text-[11px] text-base-content/50 mt-1">Remote SSH/SFTP mounted storage box</p>
                </div>
              </div>

              {/* S3 Configuration Form if S3 selected */}
              {storageType === 's3' && (
                <div className="bg-base-100 border border-base-300 p-4 rounded-lg space-y-3">
                  <h4 className="text-xs font-semibold text-base-content">S3-compatible API credentials</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="label-text text-xs text-base-content/60 mb-1 block">Bucket name</label>
                      <input
                        type="text"
                        value={s3Bucket}
                        onChange={(e) => setS3Bucket(e.target.value)}
                        className="input input-bordered input-xs h-8 w-full font-mono rounded"
                      />
                    </div>
                    <div>
                      <label className="label-text text-xs text-base-content/60 mb-1 block">S3 endpoint URL</label>
                      <input
                        type="text"
                        value={s3Endpoint}
                        onChange={(e) => setS3Endpoint(e.target.value)}
                        className="input input-bordered input-xs h-8 w-full font-mono rounded"
                      />
                    </div>
                    <div>
                      <label className="label-text text-xs text-base-content/60 mb-1 block">Access key ID</label>
                      <input
                        type="text"
                        value={s3AccessKey}
                        onChange={(e) => setS3AccessKey(e.target.value)}
                        className="input input-bordered input-xs h-8 w-full font-mono rounded"
                      />
                    </div>
                    <div>
                      <label className="label-text text-xs text-base-content/60 mb-1 block">Secret access key</label>
                      <input
                        type="password"
                        value={s3SecretKey}
                        onChange={(e) => setS3SecretKey(e.target.value)}
                        className="input input-bordered input-xs h-8 w-full font-mono rounded"
                      />
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleSaveStorage}
                className="btn btn-primary btn-xs px-4 h-8 font-medium rounded"
              >
                Save storage configuration
              </button>
            </div>
          )}

          {/* ===================== TAB 6: SYSTEM ===================== */}
          {activeTab === 'system' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-base-content">System controls and backup</h2>
                <p className="text-xs text-base-content/60">Cluster service orchestration and maintenance</p>
              </div>

              <div className="bg-base-100 border border-base-300 p-4 rounded-lg space-y-3">
                <h3 className="text-xs font-semibold text-base-content">Cluster operations</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onNotify('PostgreSQL backup saved to /opt/affinmail/backups/', 'success')}
                    className="btn btn-ghost btn-xs h-8 px-3 border border-base-300 rounded font-medium gap-1.5"
                  >
                    <Database className="w-3.5 h-3.5 stroke-[1.5] text-base-content/60" />
                    <span>Create database backup</span>
                  </button>

                  <button
                    onClick={() => onNotify('Services restarted', 'info')}
                    className="btn btn-ghost btn-xs h-8 px-3 border border-base-300 rounded font-medium gap-1.5"
                  >
                    <RotateCw className="w-3.5 h-3.5 stroke-[1.5] text-base-content/60" />
                    <span>Restart services</span>
                  </button>

                  <button
                    onClick={() => onNotify('Spam filter cache purged', 'info')}
                    className="btn btn-ghost btn-xs h-8 px-3 border border-base-300 rounded font-medium gap-1.5"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 stroke-[1.5] text-base-content/60" />
                    <span>Purge filter cache</span>
                  </button>
                </div>
              </div>

              <div className="bg-base-200 border border-base-300 p-4 rounded-lg font-mono text-xs space-y-2 tabular-nums">
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
          <div className="bg-base-100 border border-base-300 w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-5 rounded-lg shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-base-content">Add virtual domain</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Domain name</label>
                <input
                  type="text"
                  placeholder="e.g. acme-corp.com"
                  value={newDomainName}
                  onChange={(e) => setNewDomainName(e.target.value)}
                  className="input input-bordered input-xs h-8 w-full font-mono rounded"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Outbound IP policy</label>
                <select
                  value={newDomainIpType}
                  onChange={(e) => setNewDomainIpType(e.target.value as 'shared' | 'dedicated')}
                  className="select select-bordered select-xs h-8 w-full font-mono rounded"
                >
                  <option value="shared">Shared IP pool (195.201.10.101)</option>
                  <option value="dedicated">Dedicated IP (195.201.10.102)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
              <button onClick={() => setShowAddDomainModal(false)} className="btn btn-ghost btn-xs h-8 px-3 rounded font-medium">
                Cancel
              </button>
              <button onClick={handleCreateDomain} className="btn btn-primary btn-xs h-8 px-3 rounded font-medium">
                Provision domain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: CREATE MAILBOX ===================== */}
      {showAddMailboxModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 border border-base-300 w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-5 rounded-lg shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-base-content">Create mailbox</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Username</label>
                <input
                  type="text"
                  placeholder="e.g. john"
                  value={newMailboxUser}
                  onChange={(e) => setNewMailboxUser(e.target.value)}
                  className="input input-bordered input-xs h-8 w-full font-mono rounded"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Domain</label>
                <select
                  value={newMailboxDomain}
                  onChange={(e) => setNewMailboxDomain(e.target.value)}
                  className="select select-bordered select-xs h-8 w-full font-mono rounded"
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
                  className="input input-bordered input-xs h-8 w-full rounded"
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
              <button onClick={() => setShowAddMailboxModal(false)} className="btn btn-ghost btn-xs h-8 px-3 rounded font-medium">
                Cancel
              </button>
              <button onClick={handleCreateMailbox} className="btn btn-primary btn-xs h-8 px-3 rounded font-medium">
                Create mailbox
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: DNS RECORDS & DKIM ===================== */}
      {selectedDnsDomain && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 border border-base-300 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-5 rounded-lg shadow-xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-base-content">DNS records for {selectedDnsDomain}</h3>
              <button onClick={() => setSelectedDnsDomain(null)} className="btn btn-ghost btn-circle btn-xs text-base-content/60">
                ✕
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
                  <tr>
                    <td><span className="px-1.5 py-0.5 rounded text-[10px] bg-base-200 border border-base-300">MX</span></td>
                    <td>@</td>
                    <td>10 mail.hostaffin.com</td>
                  </tr>
                  <tr>
                    <td><span className="px-1.5 py-0.5 rounded text-[10px] bg-base-200 border border-base-300">TXT</span></td>
                    <td>@</td>
                    <td>v=spf1 mx include:_spf.hostaffin.com ~all</td>
                  </tr>
                  <tr>
                    <td><span className="px-1.5 py-0.5 rounded text-[10px] bg-base-200 border border-base-300">TXT</span></td>
                    <td>affinmail._domainkey</td>
                    <td className="break-all">v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w...</td>
                  </tr>
                  <tr>
                    <td><span className="px-1.5 py-0.5 rounded text-[10px] bg-base-200 border border-base-300">TXT</span></td>
                    <td>_dmarc</td>
                    <td>v=DMARC1; p=quarantine; rua=mailto:dmarc@{selectedDnsDomain}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button onClick={() => setSelectedDnsDomain(null)} className="btn btn-ghost btn-xs h-8 px-4 border border-base-300 rounded font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
