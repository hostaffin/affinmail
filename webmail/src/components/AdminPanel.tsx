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
      onNotify('Please enter a valid domain name.', 'error');
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
    onNotify(`Domain ${newDom.name} provisioned with 2048-bit DKIM keys!`, 'success');
  };

  const handleCreateMailbox = () => {
    if (!newMailboxUser.trim() || !newMailboxPass.trim()) {
      onNotify('Username and password are required.', 'error');
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
    onNotify(`Mailbox ${fullEmail} created successfully!`, 'success');
  };

  const handleToggleMailboxStatus = (id: string) => {
    setMailboxes(
      mailboxes.map((mb) =>
        mb.id === id ? { ...mb, status: mb.status === 'active' ? 'suspended' : 'active' } : mb
      )
    );
    onNotify('Mailbox status updated.', 'info');
  };

  const handleSaveStorage = () => {
    onNotify(`Storage backend switched to ${storageType.toUpperCase()}! Containers re-configured.`, 'success');
  };

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col justify-between h-full">
      <div className="space-y-1">
        {isMobile && (
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-base-300">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" />
              <span className="font-bold text-sm text-base-content">WHM Administration</span>
            </div>
            <button
              onClick={() => setIsMobileNavOpen(false)}
              className="btn btn-ghost btn-circle btn-xs text-base-content/60"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="px-3 py-2 text-[11px] font-bold text-base-content/50 uppercase tracking-wider">
          Administration
        </div>

        <button
          onClick={() => {
            setActiveTab('dashboard');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'dashboard'
              ? 'bg-primary text-white shadow-sm'
              : 'text-base-content/80 hover:bg-base-300'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Overview Dashboard</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('domains');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'domains'
              ? 'bg-primary text-white shadow-sm'
              : 'text-base-content/80 hover:bg-base-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <Globe className="w-4 h-4" />
            <span>Virtual Domains</span>
          </div>
          <span
            className={`badge badge-sm border-none ${
              activeTab === 'domains' ? 'bg-white/20 text-white' : 'bg-base-300'
            }`}
          >
            {domains.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('mailboxes');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'mailboxes'
              ? 'bg-primary text-white shadow-sm'
              : 'text-base-content/80 hover:bg-base-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <Users className="w-4 h-4" />
            <span>Mailboxes & Quotas</span>
          </div>
          <span
            className={`badge badge-sm border-none ${
              activeTab === 'mailboxes' ? 'bg-white/20 text-white' : 'bg-base-300'
            }`}
          >
            {mailboxes.length}
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab('ippools');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'ippools'
              ? 'bg-primary text-white shadow-sm'
              : 'text-base-content/80 hover:bg-base-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <Layers className="w-4 h-4" />
            <span>IP Pools & Warm-up</span>
          </div>
          <span className="badge badge-sm badge-success text-white border-none">Clean</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('storage');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'storage'
              ? 'bg-primary text-white shadow-sm'
              : 'text-base-content/80 hover:bg-base-300'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          <span>Dynamic Storage Engine</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('system');
            if (isMobile) setIsMobileNavOpen(false);
          }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'system'
              ? 'bg-primary text-white shadow-sm'
              : 'text-base-content/80 hover:bg-base-300'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>System & CLI Tools</span>
        </button>
      </div>

      {/* Node License & Version */}
      <div className="p-3 bg-base-300/60 rounded-xl text-[11px] space-y-1 text-base-content/70 mt-4">
        <div className="flex justify-between font-bold text-base-content">
          <span>AffinMail Core</span>
          <span>v1.2.0</span>
        </div>
        <p>Rust Stalwart • PG16 • Redis7</p>
        <p className="text-success font-semibold flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> Standalone Active
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-100 text-base-content select-none">
      {/* 1. WHM Master Header */}
      <header className="h-16 border-b border-base-300 bg-neutral text-neutral-content px-3 sm:px-5 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={() => setIsMobileNavOpen((prev) => !prev)}
            className="btn btn-ghost btn-circle btn-sm md:hidden text-white/80 hover:text-white"
            title="Toggle Admin Menu"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary flex items-center justify-center text-white shadow-md shadow-primary/30 shrink-0">
            <Server className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-bold text-base sm:text-lg tracking-tight text-white">AffinMail Control</span>
              <span className="badge badge-xs sm:badge-sm badge-warning font-mono font-bold text-[10px]">
                :2087
              </span>
            </div>
            <span className="text-[11px] text-neutral-content/70 font-mono hidden sm:block">
              Cluster Node: mail.hostaffin.com (Tokio Engine v0.8)
            </span>
          </div>
        </div>

        {/* Center: System Quick Metrics */}
        <div className="hidden lg:flex items-center gap-6 text-xs text-neutral-content/80 font-mono">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-accent" />
            <span>CPU: 4% (ARM64/x86)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-success" />
            <span>RAM: 680 MB / 4 GB</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-info" />
            <span>Deliverability: 10/10</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            onClick={onToggleTheme}
            className="btn btn-ghost btn-circle btn-sm text-white/80 hover:text-white"
            title="Toggle Theme"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-warning" />}
          </button>

          {/* Switcher to Port 2083 Client Webmail */}
          <button
            onClick={onSwitchToWebmail}
            className="btn btn-primary btn-xs sm:btn-sm gap-1 sm:gap-2 normal-case font-semibold text-xs shadow-md shadow-primary/30 shrink-0"
          >
            <span className="hidden xs:inline sm:inline">Open </span>
            <span>Webmail</span>
            <span className="hidden md:inline font-mono text-[10px] opacity-80">(Port 2083)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* 2. Main Admin Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Left Navigation Sidebar */}
        <aside className="hidden md:flex w-64 border-r border-base-300 bg-base-200/50 flex-col justify-between p-3 shrink-0">
          {renderSidebarContent(false)}
        </aside>

        {/* Mobile Slide-over Drawer */}
        {isMobileNavOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex" role="dialog" aria-modal="true">
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
              onClick={() => setIsMobileNavOpen(false)}
            />
            <aside className="relative w-72 max-w-[85vw] bg-base-200 h-full shadow-2xl p-4 z-10 flex flex-col justify-between overflow-y-auto">
              {renderSidebarContent(true)}
            </aside>
          </div>
        )}

        {/* Central Content Area */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6 bg-base-100">
          {/* ===================== TAB 1: DASHBOARD ===================== */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 max-w-6xl">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Enterprise Mail Administration</h1>
                <p className="text-xs text-base-content/60 mt-0.5">
                  Manage your virtual domains, multi-IP routing, storage, and mailboxes directly or via Hostaffin API.
                </p>
              </div>

              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card bg-base-200/50 border border-base-300 p-4 rounded-xl">
                  <div className="flex justify-between items-center text-xs font-semibold text-base-content/60">
                    <span>Virtual Domains</span>
                    <Globe className="w-4 h-4 text-primary" />
                  </div>
                  <div className="text-2xl font-bold mt-2">{domains.length}</div>
                  <span className="text-[11px] text-success font-medium">100% DKIM Signed</span>
                </div>

                <div className="card bg-base-200/50 border border-base-300 p-4 rounded-xl">
                  <div className="flex justify-between items-center text-xs font-semibold text-base-content/60">
                    <span>Total Mailboxes</span>
                    <Users className="w-4 h-4 text-accent" />
                  </div>
                  <div className="text-2xl font-bold mt-2">{mailboxes.length}</div>
                  <span className="text-[11px] text-base-content/60 font-medium">All Daemons Active</span>
                </div>

                <div className="card bg-base-200/50 border border-base-300 p-4 rounded-xl">
                  <div className="flex justify-between items-center text-xs font-semibold text-base-content/60">
                    <span>Cluster Storage</span>
                    <HardDrive className="w-4 h-4 text-warning" />
                  </div>
                  <div className="text-2xl font-bold mt-2">4.2 GB</div>
                  <span className="text-[11px] text-base-content/60 font-mono">Engine: {storageType.toUpperCase()}</span>
                </div>

                <div className="card bg-base-200/50 border border-base-300 p-4 rounded-xl">
                  <div className="flex justify-between items-center text-xs font-semibold text-base-content/60">
                    <span>IP Deliverability</span>
                    <ShieldCheck className="w-4 h-4 text-success" />
                  </div>
                  <div className="text-2xl font-bold mt-2 text-success">10 / 10</div>
                  <span className="text-[11px] text-base-content/60 font-medium">0 Blacklists Flagged</span>
                </div>
              </div>

              {/* Quick Actions Bar */}
              <div className="card bg-base-200/40 border border-base-300 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold">Quick Management Actions</h3>
                  <p className="text-xs text-base-content/60">One-click provisioning and cluster commands</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setShowAddDomainModal(true)}
                    className="btn btn-primary btn-sm gap-1.5 normal-case font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Virtual Domain</span>
                  </button>
                  <button
                    onClick={() => setShowAddMailboxModal(true)}
                    className="btn btn-outline btn-sm gap-1.5 normal-case font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Mailbox</span>
                  </button>
                  <button
                    onClick={() => onNotify('Rate limits flushed successfully.', 'info')}
                    className="btn btn-ghost btn-sm gap-1.5 normal-case text-xs"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Flush Rate Limits</span>
                  </button>
                </div>
              </div>

              {/* Cluster Ports Reference */}
              <div className="card bg-base-200/40 border border-base-300 p-4 sm:p-5 rounded-xl space-y-3">
                <h3 className="text-sm font-bold">Active Cluster Protocols & Ports</h3>
                <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-3 bg-base-100 rounded-lg border border-base-300">
                    <span className="text-primary font-bold block">Port 2087</span>
                    <span className="text-[11px] text-base-content/60">WHM Admin Panel</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-lg border border-base-300">
                    <span className="text-primary font-bold block">Port 2083 / 443</span>
                    <span className="text-[11px] text-base-content/60">Client Webmail SPA</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-lg border border-base-300">
                    <span className="text-success font-bold block">Port 25, 465, 587</span>
                    <span className="text-[11px] text-base-content/60">SMTP Submission</span>
                  </div>
                  <div className="p-3 bg-base-100 rounded-lg border border-base-300">
                    <span className="text-accent font-bold block">Port 993, 4190</span>
                    <span className="text-[11px] text-base-content/60">IMAP4rev2 & Sieve</span>
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
                  <h2 className="text-xl font-bold tracking-tight">Virtual Hosted Domains</h2>
                  <p className="text-xs text-base-content/60">Configure per-domain DKIM keys, quotas, and dedicated IPs</p>
                </div>
                <button
                  onClick={() => setShowAddDomainModal(true)}
                  className="btn btn-primary btn-sm gap-2 normal-case font-semibold self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Virtual Domain</span>
                </button>
              </div>

              <div className="card bg-base-100 border border-base-300 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto w-full">
                  <table className="table w-full text-xs min-w-[600px]">
                    <thead className="bg-base-200/60 text-base-content/70">
                      <tr>
                        <th>Domain Name</th>
                        <th>Mailboxes</th>
                        <th>Disk Used / Limit</th>
                        <th>Outbound IP Egress</th>
                        <th>DKIM Status</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {domains.map((dom) => (
                        <tr key={dom.id} className="hover:bg-base-200/40">
                          <td className="font-bold text-base-content">{dom.name}</td>
                          <td>{dom.mailboxesCount} mailboxes</td>
                          <td>
                            <span className="font-mono">{dom.diskUsed}</span> / {dom.diskLimit}
                          </td>
                          <td>
                            <span
                              className={`badge badge-xs font-semibold ${
                                dom.ipType === 'dedicated' ? 'badge-success text-white' : 'badge-ghost'
                              }`}
                            >
                              {dom.ipType === 'dedicated' ? `Dedicated (${dom.assignedIp})` : 'Shared Pool'}
                            </span>
                          </td>
                          <td>
                            <span className="badge badge-xs badge-info font-mono">2048-bit RSA</span>
                          </td>
                          <td className="text-right space-x-2">
                            <button
                              onClick={() => setSelectedDnsDomain(dom.name)}
                              className="btn btn-ghost btn-xs text-primary font-medium"
                            >
                              View DNS
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete domain ${dom.name}?`)) {
                                  setDomains(domains.filter((d) => d.id !== dom.id));
                                  onNotify(`Domain ${dom.name} removed.`, 'info');
                                }
                              }}
                              className="btn btn-ghost btn-xs text-error font-medium"
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
                  <h2 className="text-xl font-bold tracking-tight">Mailbox Accounts</h2>
                  <p className="text-xs text-base-content/60">Create users, assign storage quotas and configure SmartHost routing</p>
                </div>
                <button
                  onClick={() => setShowAddMailboxModal(true)}
                  className="btn btn-primary btn-sm gap-2 normal-case font-semibold self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Mailbox</span>
                </button>
              </div>

              <div className="card bg-base-100 border border-base-300 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto w-full">
                  <table className="table w-full text-xs min-w-[620px]">
                    <thead className="bg-base-200/60 text-base-content/70">
                      <tr>
                        <th>Email Address</th>
                        <th>Domain</th>
                        <th>Storage Quota</th>
                        <th>Outbound Route</th>
                        <th>Status</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mailboxes.map((mb) => (
                        <tr key={mb.id} className="hover:bg-base-200/40">
                          <td className="font-bold text-base-content font-mono">{mb.email}</td>
                          <td>{mb.domain}</td>
                          <td>
                            <span className="font-mono">{mb.used}</span> / {mb.quota}
                          </td>
                          <td>
                            <span className="badge badge-xs badge-outline font-mono uppercase">
                              {mb.route}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`badge badge-xs font-semibold ${
                                mb.status === 'active' ? 'badge-success text-white' : 'badge-error text-white'
                              }`}
                            >
                              {mb.status}
                            </span>
                          </td>
                          <td className="text-right space-x-2">
                            <button
                              onClick={() => handleToggleMailboxStatus(mb.id)}
                              className="btn btn-ghost btn-xs font-medium"
                            >
                              {mb.status === 'active' ? 'Suspend' : 'Unsuspend'}
                            </button>
                            <button
                              onClick={() => {
                                const newP = prompt('Enter new password:');
                                if (newP) onNotify(`Password for ${mb.email} updated.`, 'success');
                              }}
                              className="btn btn-ghost btn-xs text-primary font-medium"
                            >
                              Change Password
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
                  <h2 className="text-xl font-bold tracking-tight">Multi-IP Pools & Egress Router</h2>
                  <p className="text-xs text-base-content/60">Manage dedicated & shared outbound IP addresses and automated 30-day warm-up</p>
                </div>
                <button
                  onClick={() => onNotify('New IP binding added to Stalwart listener.', 'success')}
                  className="btn btn-primary btn-sm gap-2 normal-case font-semibold self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Bind New Outbound IP</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ipPools.map((pool) => (
                  <div key={pool.id} className="card bg-base-100 border border-base-300 p-5 rounded-xl shadow-sm space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-base font-bold">{pool.ip}</span>
                        <p className="text-xs text-base-content/60 font-mono mt-0.5">rDNS: {pool.rdns}</p>
                      </div>
                      <span
                        className={`badge font-semibold capitalize ${
                          pool.type === 'dedicated' ? 'badge-success text-white' : 'badge-neutral'
                        }`}
                      >
                        {pool.type}
                      </span>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-base-200 text-xs">
                      <div className="flex justify-between">
                        <span className="text-base-content/60">Assigned Domains:</span>
                        <span className="font-semibold">{pool.domainsCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-base-content/60">RBL / Blacklist Status:</span>
                        <span className="text-success font-semibold flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> 100% Clean (0 listings)
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-base-content/60">Warm-up Progression:</span>
                        <span className="font-mono font-bold">
                          Day {pool.warmupDay} / 30 {pool.warmupDay >= 30 ? '(Completed)' : ''}
                        </span>
                      </div>
                      <progress
                        className="progress progress-primary w-full h-1.5"
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
                <h2 className="text-xl font-bold tracking-tight">Pluggable Dynamic Storage Engine</h2>
                <p className="text-xs text-base-content/60">
                  Switch blob and attachment storage between Local NVMe, Cloudflare R2 / AWS S3, and Hetzner SFTP without code changes.
                </p>
              </div>

              {/* Storage Mode Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  onClick={() => setStorageType('fs')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    storageType === 'fs'
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-base-300 bg-base-100 hover:bg-base-200'
                  }`}
                >
                  <HardDrive className={`w-6 h-6 mb-2 ${storageType === 'fs' ? 'text-primary' : 'text-base-content/60'}`} />
                  <h4 className="font-bold text-sm">Local NVMe SSD</h4>
                  <p className="text-xs text-base-content/60 mt-1">Zero cloud fees, ultra-low sub-millisecond latency</p>
                </div>

                <div
                  onClick={() => setStorageType('s3')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    storageType === 's3'
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-base-300 bg-base-100 hover:bg-base-200'
                  }`}
                >
                  <Database className={`w-6 h-6 mb-2 ${storageType === 's3' ? 'text-primary' : 'text-base-content/60'}`} />
                  <h4 className="font-bold text-sm">S3 Object Storage</h4>
                  <p className="text-xs text-base-content/60 mt-1">Cloudflare R2 (0 egress fee), AWS S3, MinIO, Wasabi</p>
                </div>

                <div
                  onClick={() => setStorageType('sftp')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    storageType === 'sftp'
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-base-300 bg-base-100 hover:bg-base-200'
                  }`}
                >
                  <Server className={`w-6 h-6 mb-2 ${storageType === 'sftp' ? 'text-primary' : 'text-base-content/60'}`} />
                  <h4 className="font-bold text-sm">SFTP / Storage Box</h4>
                  <p className="text-xs text-base-content/60 mt-1">Hetzner Storage Box remote high-capacity store</p>
                </div>
              </div>

              {/* S3 Configuration Form if S3 selected */}
              {storageType === 's3' && (
                <div className="card bg-base-100 border border-base-300 p-5 rounded-xl space-y-4">
                  <h4 className="text-sm font-bold">S3-Compatible API Credentials</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="label-text font-semibold mb-1 block">Bucket Name</label>
                      <input
                        type="text"
                        value={s3Bucket}
                        onChange={(e) => setS3Bucket(e.target.value)}
                        className="input input-bordered input-sm w-full font-mono"
                      />
                    </div>
                    <div>
                      <label className="label-text font-semibold mb-1 block">S3 Endpoint URL</label>
                      <input
                        type="text"
                        value={s3Endpoint}
                        onChange={(e) => setS3Endpoint(e.target.value)}
                        className="input input-bordered input-sm w-full font-mono"
                      />
                    </div>
                    <div>
                      <label className="label-text font-semibold mb-1 block">Access Key ID</label>
                      <input
                        type="text"
                        value={s3AccessKey}
                        onChange={(e) => setS3AccessKey(e.target.value)}
                        className="input input-bordered input-sm w-full font-mono"
                      />
                    </div>
                    <div>
                      <label className="label-text font-semibold mb-1 block">Secret Access Key</label>
                      <input
                        type="password"
                        value={s3SecretKey}
                        onChange={(e) => setS3SecretKey(e.target.value)}
                        className="input input-bordered input-sm w-full font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleSaveStorage}
                className="btn btn-primary btn-sm px-6 font-semibold normal-case shadow-sm"
              >
                Save & Hot-Switch Storage Engine
              </button>
            </div>
          )}

          {/* ===================== TAB 6: SYSTEM ===================== */}
          {activeTab === 'system' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h2 className="text-xl font-bold tracking-tight">System Controls & Backup</h2>
                <p className="text-xs text-base-content/60">Direct administrative service orchestration and emergency commands</p>
              </div>

              <div className="card bg-base-100 border border-base-300 p-5 rounded-xl space-y-4">
                <h3 className="text-sm font-bold">Instant Cluster Operations</h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => onNotify('PostgreSQL dump saved to /opt/affinmail/backups/!', 'success')}
                    className="btn btn-outline btn-sm gap-2"
                  >
                    <Database className="w-4 h-4 text-primary" />
                    <span>Generate Instant DB Backup</span>
                  </button>

                  <button
                    onClick={() => onNotify('All Docker containers restarted smoothly.', 'info')}
                    className="btn btn-outline btn-sm gap-2"
                  >
                    <RotateCw className="w-4 h-4 text-warning" />
                    <span>Rolling Restart Services</span>
                  </button>

                  <button
                    onClick={() => onNotify('Spamhaus DNSBL cache flushed.', 'info')}
                    className="btn btn-outline btn-sm gap-2"
                  >
                    <ShieldCheck className="w-4 h-4 text-success" />
                    <span>Purge Spam Filter Cache</span>
                  </button>
                </div>
              </div>

              <div className="card bg-neutral text-neutral-content p-4 rounded-xl font-mono text-xs space-y-2">
                <div className="flex justify-between items-center text-neutral-content/60 border-b border-white/10 pb-2">
                  <span>Terminal CLI Management Quick Reference</span>
                  <span>/usr/local/bin/affinmail</span>
                </div>
                <p className="text-accent">$ affinmail status</p>
                <p className="text-accent">$ affinmail restart</p>
                <p className="text-accent">$ affinmail update</p>
                <p className="text-accent">$ affinmail backup</p>
                <p className="text-accent">$ affinmail logs stalwart</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ===================== MODAL: ADD VIRTUAL DOMAIN ===================== */}
      {showAddDomainModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="card bg-base-100 border border-base-300 w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-2xl space-y-4">
            <h3 className="text-base font-bold">Add New Virtual Domain</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="label-text font-semibold mb-1 block">Domain Name</label>
                <input
                  type="text"
                  placeholder="e.g. acme-corp.com"
                  value={newDomainName}
                  onChange={(e) => setNewDomainName(e.target.value)}
                  className="input input-bordered input-sm w-full font-mono"
                  autoFocus
                />
              </div>

              <div>
                <label className="label-text font-semibold mb-1 block">Outbound IP Egress Policy</label>
                <select
                  value={newDomainIpType}
                  onChange={(e) => setNewDomainIpType(e.target.value as 'shared' | 'dedicated')}
                  className="select select-bordered select-sm w-full"
                >
                  <option value="shared">Shared IP Pool (Standard - 195.201.10.101)</option>
                  <option value="dedicated">Dedicated Outbound IP (VIP - 195.201.10.102)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-base-200">
              <button onClick={() => setShowAddDomainModal(false)} className="btn btn-ghost btn-sm">
                Cancel
              </button>
              <button onClick={handleCreateDomain} className="btn btn-primary btn-sm font-semibold">
                Provision Domain
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: CREATE MAILBOX ===================== */}
      {showAddMailboxModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="card bg-base-100 border border-base-300 w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-2xl space-y-4">
            <h3 className="text-base font-bold">Create Mailbox Account</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="label-text font-semibold mb-1 block">Username / Prefix</label>
                <input
                  type="text"
                  placeholder="e.g. john"
                  value={newMailboxUser}
                  onChange={(e) => setNewMailboxUser(e.target.value)}
                  className="input input-bordered input-sm w-full font-mono"
                  autoFocus
                />
              </div>

              <div>
                <label className="label-text font-semibold mb-1 block">Domain</label>
                <select
                  value={newMailboxDomain}
                  onChange={(e) => setNewMailboxDomain(e.target.value)}
                  className="select select-bordered select-sm w-full font-mono"
                >
                  {domains.map((d) => (
                    <option key={d.id} value={d.name}>
                      @{d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label-text font-semibold mb-1 block">Password</label>
                <input
                  type="password"
                  placeholder="Strong password"
                  value={newMailboxPass}
                  onChange={(e) => setNewMailboxPass(e.target.value)}
                  className="input input-bordered input-sm w-full"
                />
              </div>

              <div>
                <label className="label-text font-semibold mb-1 block">Storage Quota (MB)</label>
                <input
                  type="number"
                  value={newMailboxQuota}
                  onChange={(e) => setNewMailboxQuota(e.target.value)}
                  className="input input-bordered input-sm w-full font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-base-200">
              <button onClick={() => setShowAddMailboxModal(false)} className="btn btn-ghost btn-sm">
                Cancel
              </button>
              <button onClick={handleCreateMailbox} className="btn btn-primary btn-sm font-semibold">
                Create Mailbox
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: DNS RECORDS & DKIM ===================== */}
      {selectedDnsDomain && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="card bg-base-100 border border-base-300 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl sm:rounded-2xl shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-base font-bold">DNS Records for {selectedDnsDomain}</h3>
              <button onClick={() => setSelectedDnsDomain(null)} className="btn btn-ghost btn-circle btn-xs">
                ✕
              </button>
            </div>

            <div className="overflow-x-auto text-xs">
              <table className="table table-zebra w-full font-mono">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Host</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="badge badge-xs badge-primary">MX</span></td>
                    <td>@</td>
                    <td>10 mail.hostaffin.com</td>
                  </tr>
                  <tr>
                    <td><span className="badge badge-xs badge-accent">TXT</span></td>
                    <td>@</td>
                    <td>v=spf1 mx include:_spf.hostaffin.com ~all</td>
                  </tr>
                  <tr>
                    <td><span className="badge badge-xs badge-info">TXT</span></td>
                    <td>affinmail._domainkey</td>
                    <td className="break-all">v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w...</td>
                  </tr>
                  <tr>
                    <td><span className="badge badge-xs badge-warning">TXT</span></td>
                    <td>_dmarc</td>
                    <td>v=DMARC1; p=quarantine; rua=mailto:dmarc@{selectedDnsDomain}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button onClick={() => setSelectedDnsDomain(null)} className="btn btn-primary btn-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
