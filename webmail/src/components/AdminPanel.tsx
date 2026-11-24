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
  Key,
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
  Bell,
  Server,
  Thermometer,
  RefreshCcwDot,
  ShieldAlert,
  Timer,
  Shuffle,
  Network,
  ArrowLeftRight,
  FileCode2,
  Ban,
  MousePointerClick,
  Lock,
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
  type AdminStats,
  type MailDay,
  getStats,
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
  type ServerNode,
  listServers,
  createServer,
  setServerStatus,
  listWarmups,
  startWarmup,
  pauseWarmup,
  resumeWarmup,
  type Warmup,
  getRotation,
  setRotation,
  pickRotation,
  type RotationPool,
  listIps,
  assignIpToDomain,
  getRdns,
  setRdns,
  type RdnsInfo,
  type IpDetail,
  getBlacklist,
  type BlacklistIp,
  type BlacklistEvent,
  getLoginLog,
  revokeSession,
  type LoginEventRow,
  type AdminSessionRow,
  getNotifications,
  markNotifRead,
  dismissNotif,
  setNotifRules,
  type NotifItem,
  type NotifRules,
  getRateLimits,
  type RateLimits,
  getMtaTemplates,
  applyMtaTemplate,
  type MtaTemplate,
  type MtaVersionInfo,
  listMigrations,
  createMigration,
  type MigrationJobRow,
  type ApiKeyRow,
  listApiKeys,
  createApiKey,
  deleteApiKey,
  rotateApiKey,
  getApiKeyUsage,
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
  | 'servers'
  | 'deliverability'
  | 'activity'
  | 'notifications'
  | 'ratelimits'
  | 'mta'
  | 'storage'
  | 'system'
  | 'apikeys';

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

function pctOf(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
}

function fmtUptime(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function fmtWhen(s: string): string {
  return s ? s.replace('T', ' ').slice(0, 16) : '—';
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
/* AffinMail Console — fully custom visual system (Lily, 2026-11-24).
   Ink sidebar, paper content, hairline borders, tinted status pills,
   9-10px radii, soft single-layer shadows on surfaces only. No DaisyUI
   component classes, no WHM chrome. */

const PANEL =
  'rounded-2xl border border-[#E4E7EC] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] dark:border-[#22304A] dark:bg-[#101828]';
const PANEL_HD =
  'flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF1F5] px-5 py-3.5 dark:border-[#1B2740]';
const INPUT =
  'h-10 w-full rounded-[10px] border border-[#D0D5DD] bg-white px-3 text-[13.5px] text-[#101828] placeholder:text-[#98A2B3] transition focus:border-[#0B57D0] focus:outline-none focus:ring-4 focus:ring-[#0B57D0]/10 dark:border-[#2A3A57] dark:bg-[#0D1526] dark:text-[#E6EAF2] dark:placeholder:text-[#5B6B82]';
const LABEL = 'block text-[12.5px] font-medium text-[#344054] dark:text-[#C4CEDD] mb-1.5';
const MUTED = 'text-[#667085] dark:text-[#8A94A6]';

type BtnVariant = 'primary' | 'outline' | 'ghost' | 'danger';
const BTN: Record<BtnVariant, string> = {
  primary:
    'bg-[#0B57D0] hover:bg-[#0A4DB8] text-white border-transparent shadow-[0_1px_2px_rgba(11,87,208,0.35)]',
  outline:
    'bg-white hover:bg-[#F8FAFC] text-[#344054] border-[#D0D5DD] dark:bg-[#101828] dark:hover:bg-[#16223C] dark:text-[#D7DEE9] dark:border-[#2A3A57]',
  ghost:
    'bg-transparent hover:bg-[#F2F4F7] text-[#475467] border-transparent dark:hover:bg-white/5 dark:text-[#A7B2C5]',
  danger:
    'bg-transparent hover:bg-[#FEF3F2] text-[#D92D20] border-transparent dark:hover:bg-[#D92D20]/10 dark:text-[#F97066]',
};
const btn = (variant: BtnVariant = 'outline', size: 'sm' | 'xs' = 'sm'): string =>
  `inline-flex items-center justify-center gap-1.5 rounded-[9px] border font-medium whitespace-nowrap transition disabled:opacity-50 disabled:pointer-events-none ${
    size === 'sm' ? 'h-9 px-3.5 text-[13px]' : 'h-7 px-2.5 text-[12px] rounded-[7px]'
  } ${BTN[variant]}`;
const btnIcon = (variant: BtnVariant = 'ghost'): string =>
  `inline-flex items-center justify-center h-8 w-8 rounded-[8px] border shrink-0 transition disabled:opacity-50 ${BTN[variant]}`;

const BADGE =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-none whitespace-nowrap';
const BADGE_OK = `${BADGE} bg-[#ECFDF3] text-[#067647] dark:bg-[#067647]/15 dark:text-[#32D583]`;
const BADGE_WARN = `${BADGE} bg-[#FFFAEB] text-[#B54708] dark:bg-[#B54708]/15 dark:text-[#FDB022]`;
const BADGE_BAD = `${BADGE} bg-[#FEF3F2] text-[#B42318] dark:bg-[#B42318]/15 dark:text-[#F97066]`;
const BADGE_NEUTRAL = `${BADGE} bg-[#F2F4F7] text-[#475467] dark:bg-white/5 dark:text-[#A7B2C5]`;
const NAVCOUNT =
  'inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-white/10 px-1.5 text-[11px] font-semibold text-[#C4CEDD] tabular-nums';
const NAVCOUNT_WARN =
  'inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-[#FDB022]/20 px-1.5 text-[11px] font-semibold text-[#FDB022] tabular-nums';

const Bar: React.FC<{ value: number }> = ({ value }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#EEF1F5] dark:bg-[#1B2740]">
    <div
      className="h-full rounded-full bg-[#0B57D0] dark:bg-[#7FB0FF]"
      style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
    />
  </div>
);

type ChartSeries = { label: string; color: string; points: (number | null)[]; area?: boolean };

const LineChart: React.FC<{
  series: ChartSeries[];
  height?: number;
  yMax?: number;
  yMin?: number;
  formatY?: (v: number) => string;
  xLabels?: string[];
}> = ({ series, height = 128, yMax, yMin = 0, formatY, xLabels }) => {
  const W = 560;
  const H = height;
  const PADL = 36;
  const PADR = 10;
  const PADT = 10;
  const PADB = 20;
  const all = series.flatMap((s) => s.points).filter((v): v is number => v !== null);
  const max = yMax ?? Math.max(10, ...all);
  const min = yMin;
  const n = Math.max(1, ...series.map((s) => s.points.length));
  const x = (i: number) => PADL + (n <= 1 ? (W - PADL - PADR) / 2 : (i / (n - 1)) * (W - PADL - PADR));
  const y = (v: number) => PADT + (1 - (v - min) / (max - min || 1)) * (H - PADT - PADB);
  const gridVals = [min, min + (max - min) / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img">
      {gridVals.map((gv, i) => (
        <g key={i}>
          <line x1={PADL} x2={W - PADR} y1={y(gv)} y2={y(gv)} strokeWidth="1" className="stroke-[#EAECF0] dark:stroke-[#1B2740]" />
          <text x={PADL - 6} y={y(gv) + 3} textAnchor="end" className="fill-[#98A2B3] text-[9px]">
            {formatY ? formatY(gv) : Math.round(gv)}
          </text>
        </g>
      ))}
      {series.map((s) => {
        const pts = s.points
          .map((v, i) => (v === null ? null : ([x(i), y(v)] as const)))
          .filter((p): p is readonly [number, number] => p !== null);
        if (pts.length === 0) return null;
        const line = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
        return (
          <g key={s.label}>
            {s.area && pts.length > 1 && (
              <polygon points={`${pts[0][0]},${y(min)} ${line} ${pts[pts.length - 1][0]},${y(min)}`} fill={s.color} opacity="0.12" />
            )}
            {pts.length > 1 && (
              <polyline points={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            )}
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r="2.4" fill={s.color} />
            ))}
          </g>
        );
      })}
      {xLabels &&
        xLabels.map(
          (lb, i) =>
            (i === 0 || i === xLabels.length - 1 || i === Math.floor(xLabels.length / 2)) && (
              <text
                key={i}
                x={x(i)}
                y={H - 5}
                textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
                className="fill-[#98A2B3] text-[9px]"
              >
                {lb}
              </text>
            ),
        )}
    </svg>
  );
};

const ChartLegend: React.FC<{ items: { label: string; color: string; value?: string }[] }> = ({ items }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
    {items.map((it) => (
      <span key={it.label} className="inline-flex items-center gap-1.5 text-[12px] text-[#475467] dark:text-[#A7B2C5]">
        <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
        {it.label}
        {it.value && <span className="font-semibold text-[#101828] dark:text-white">{it.value}</span>}
      </span>
    ))}
  </div>
);

/** Seven chart days ending at the last day present in the data (zeros filled). */
function last7Days(mailDaily: MailDay[]): MailDay[] {
  const byDay = new Map(mailDaily.map((d) => [d.day, d]));
  const end = mailDaily.length > 0 ? mailDaily[mailDaily.length - 1].day : new Date().toISOString().slice(0, 10);
  const [yy, mm, dd] = end.split('-').map(Number);
  const endTs = Date.UTC(yy, (mm || 1) - 1, dd || 1);
  const out: MailDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = new Date(endTs - i * 86400000).toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, queued: 0, delivered: 0, failed: 0, deferred: 0, spam: 0, rate: null });
  }
  return out;
}

function dayLabel(day: string): string {
  const [yy, mm, dd] = day.split('-').map(Number);
  return new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

const PageHeader: React.FC<{
  title: string;
  description?: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <div className="flex flex-col gap-3 pb-1 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[#101828] dark:text-white">{title}</h1>
      {description && <p className={`text-[13px] mt-1 ${MUTED}`}>{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode; actions?: React.ReactNode }> = ({
  children,
  actions,
}) => (
  <div className={PANEL_HD}>
    <h2 className="text-[13px] font-semibold text-[#101828] dark:text-[#E6EAF2]">{children}</h2>
    {actions}
  </div>
);

const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
}> = ({ icon, title, description }) => (
  <div className={`flex flex-col items-center justify-center gap-2 px-4 py-12 text-center ${MUTED}`}>
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F2F4F7] text-[#98A2B3] dark:bg-white/5 dark:text-[#5B6B82]">
      {icon}
    </span>
    <p className="text-[13.5px] font-medium text-[#344054] dark:text-[#D7DEE9]">{title}</p>
    {description && <p className="text-[12.5px] max-w-sm">{description}</p>}
  </div>
);

const SkeletonRows: React.FC<{ cols: number; rows?: number }> = ({ cols, rows = 6 }) => (
  <>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r} className="border-t border-[#EEF1F5] dark:border-[#1B2740]">
        <td colSpan={cols} className="px-4 py-3">
          <div className="h-3 w-full animate-pulse rounded-md bg-[#EEF1F5] dark:bg-white/5" />
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
    className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0A0F1A]/50 p-4 backdrop-blur-[3px] sm:items-center"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div
      className={`my-auto w-full ${wide ? 'max-w-3xl' : 'max-w-md'} rounded-[18px] border border-[#E4E7EC] bg-white shadow-[0_24px_64px_-16px_rgba(16,24,40,0.35)] dark:border-[#22304A] dark:bg-[#101828]`}
    >
      <div className="flex items-start justify-between gap-3 px-6 pt-5">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[#101828] dark:text-white">{title}</h3>
          {description && <p className={`text-[12.5px] mt-1 ${MUTED}`}>{description}</p>}
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
      <div className="max-h-[80dvh] overflow-y-auto p-6 pt-4">{children}</div>
    </div>
  </div>
);

const StatusBadge: React.FC<{ active: boolean }> = ({ active }) => (
  <span className={active ? BADGE_OK : BADGE_BAD}>{active ? 'Active' : 'Suspended'}</span>
);

/* Custom table: hairline row rules, no zebra, generous cells; narrow
   screens scroll the panel horizontally. */
const T = {
  row: 'border-t border-[#EEF1F5] transition-colors hover:bg-[#F8FAFF] dark:border-[#1B2740] dark:hover:bg-white/[0.03]',
  primary: '',
  cell: '',
  actions: 'text-right',
};
const TABLE =
  'w-full min-w-[640px] border-collapse text-left text-[13.5px] text-[#1D2939] dark:text-[#D7DEE9]';
/* For small tables inside half-width panels: fit the panel, never clip. */
const TABLE_FIT =
  'w-full border-collapse text-left text-[13.5px] text-[#1D2939] dark:text-[#D7DEE9]';
const TH = 'whitespace-nowrap border-b border-[#E4E7EC] px-4 py-2.5 text-[11px] font-medium tracking-[0.01em] text-[#98A2B3] dark:border-[#22304A] dark:text-[#5B6B82]';
const TD = 'px-4 py-3 align-middle';
const CODE = 'font-mono text-[12.5px] tabular-nums';

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
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyScopes, setApiKeyScopes] = useState<string[]>([]);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);

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
  const [assignModal, setShowAssignModal] = useState<{ domain: string; ip: string } | null>(null);

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
      const [d, m, ip, st, h, keys] = await Promise.all([
        listDomains(),
        listMailboxes(),
        listIpPools(),
        getStorage(),
        apiHealth(),
        listApiKeys(),
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
      setApiKeys(keys.map((k: ApiKeyRow) => k));
      void getStats()
        .then(setStats)
        .catch(() => {});
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

  const handleAssignIp = async (name: string, ip: string) => {
    if (!ip) return;
    try {
      const r = await assignIpToDomain(name, ip);
      onNotify(
        r.previousDomainsOnIp > 0
          ? `IP ${ip} assigned to ${name} — ${r.previousDomainsOnIp} other domain(s) already use this IP`
          : `IP ${ip} assigned to ${name}`,
        'success'
      );
      setShowAssignModal(null);
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

  // API keys
  const handleCreateApiKey = async () => {
    const name = apiKeyName.trim();
    if (!name) {
      onNotify('Key name is required', 'error');
      return;
    }
    setApiKeyBusy(true);
    try {
      await createApiKey({ name, scopes: apiKeyScopes.length ? apiKeyScopes : ['mailbox:read'] });
      setApiKeyName('');
      setApiKeyScopes([]);
      onNotify(`API key ${name} created`, 'success');
      const keys = await listApiKeys();
      setApiKeys(keys);
    } catch (e) {
      fail(e);
    } finally {
      setApiKeyBusy(false);
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    if (!confirm(`Delete API key ${id}?`)) return;
    try {
      await deleteApiKey(id);
      onNotify('API key removed', 'info');
      const keys = await listApiKeys();
      setApiKeys(keys);
    } catch (e) {
      fail(e);
    }
  };

  const handleRotateApiKey = async (id: string) => {
    if (!confirm(`Rotate API key ${id}?`)) return;
    try {
      await rotateApiKey(id);
      onNotify('API key rotated', 'success');
      const keys = await listApiKeys();
      setApiKeys(keys);
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

  // Poll the notification badge while the panel is open (F-009).
  useEffect(() => {
    if (!authed) return;
    let stop = false;
    const tick = () => {
      getNotifications()
        .then((r) => {
          if (!stop) {
            setNotifUnread(r.unread);
            setNotifs(r.notifications);
            setNotifDelivery(r.delivery);
          }
        })
        .catch(() => {});
    };
    tick();
    const iv = window.setInterval(tick, 30000);
    return () => {
      stop = true;
      window.clearInterval(iv);
    };
  }, [authed]);

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

  /* ---------------------------------------- Module A + B: infra state */

  // F-011 servers
  const [servers, setServers] = useState<ServerNode[]>([]);
  const [showAddNodeModal, setShowAddNodeModal] = useState(false);
  const [nodeHostname, setNodeHostname] = useState('');
  const [nodeIp, setNodeIp] = useState('');
  const [nodeLocation, setNodeLocation] = useState('');
  const [nodeRole, setNodeRole] = useState('all-in-one');

  const loadServers = useCallback(async () => {
    try {
      const r = await listServers();
      setServers(r.servers);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'servers') void loadServers();
  }, [authed, activeTab, loadServers]);

  const handleCreateNode = async () => {
    if (!nodeHostname.trim() || !nodeIp.trim()) {
      onNotify('Hostname and primary IP are required', 'error');
      return;
    }
    try {
      const r = await createServer({
        hostname: nodeHostname.trim(),
        primary_ip: nodeIp.trim(),
        location: nodeLocation.trim() || undefined,
        role: nodeRole,
      });
      onNotify(r.note, 'info');
      setNodeHostname('');
      setNodeIp('');
      setNodeLocation('');
      setShowAddNodeModal(false);
      await loadServers();
    } catch (e) {
      fail(e);
    }
  };

  const handleNodeStatus = async (n: ServerNode, status: string) => {
    try {
      await setServerStatus(n.id, status);
      onNotify(`${n.hostname} → ${status}`, 'info');
      await loadServers();
    } catch (e) {
      fail(e);
    }
  };

  // F-013 warmup
  const [warmups, setWarmups] = useState<Warmup[]>([]);
  const [warmupDomain, setWarmupDomain] = useState('');
  const [warmupIp, setWarmupIp] = useState('');
  const [warmupPlan, setWarmupPlan] = useState<'conservative' | 'standard' | 'aggressive'>('standard');

  const loadWarmups = useCallback(async () => {
    try {
      const r = await listWarmups();
      setWarmups(r.warmups);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'deliverability') void loadWarmups();
  }, [authed, activeTab, loadWarmups]);

  const handleStartWarmup = async () => {
    if (!warmupDomain.trim() || !warmupIp.trim()) {
      onNotify('Domain and IP are required', 'error');
      return;
    }
    try {
      await startWarmup({
        domain: warmupDomain.trim(),
        ip_address: warmupIp.trim(),
        plan: warmupPlan,
      });
      onNotify(`Warmup started for ${warmupDomain.trim()} on ${warmupIp.trim()}`, 'success');
      setWarmupDomain('');
      setWarmupIp('');
      await loadWarmups();
    } catch (e) {
      fail(e);
    }
  };

  const handleWarmupPauseResume = async (w: Warmup) => {
    try {
      if (w.completed) {
        await resumeWarmup(w.id);
        onNotify(`Warmup ${w.domain} resumed`, 'success');
      } else {
        await pauseWarmup(w.id);
        onNotify(`Warmup ${w.domain} paused`, 'info');
      }
      await loadWarmups();
    } catch (e) {
      fail(e);
    }
  };

  // F-015 rotation
  const [rotationPools, setRotationPools] = useState<RotationPool[]>([]);
  const [pickDomain, setPickDomain] = useState('');
  const [pickResult, setPickResult] = useState<string | null>(null);

  const loadRotation = useCallback(async () => {
    try {
      const r = await getRotation();
      setRotationPools(r.pools);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'ippools') void loadRotation();
  }, [authed, activeTab, loadRotation]);

  const handleSetStrategy = async (pool: string, strategy: string) => {
    try {
      const r = await setRotation({ pool, strategy });
      onNotify(r.note, 'info');
      await loadRotation();
    } catch (e) {
      fail(e);
    }
  };

  const handlePickIp = async () => {
    if (pickDomain.trim().length < 3) {
      onNotify('Enter a sender domain', 'error');
      return;
    }
    try {
      const r = await pickRotation({ sender_domain: pickDomain.trim() });
      setPickResult(`${r.senderDomain} → ${r.ip} (${r.strategy})`);
    } catch (e) {
      fail(e);
    }
  };

  // F-014 / F-017 IP details + rDNS
  const [ipDetails, setIpDetails] = useState<IpDetail[]>([]);
  const [rdnsEdit, setRdnsEdit] = useState<{ ip: string; info: RdnsInfo } | null>(null);
  const [rdnsValue, setRdnsValue] = useState('');

  const loadIpDetails = useCallback(async () => {
    try {
      const r = await listIps();
      setIpDetails(r.ips);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'deliverability') void loadIpDetails();
  }, [authed, activeTab, loadIpDetails]);

  const openRdns = async (ip: string) => {
    try {
      const info = await getRdns(ip);
      setRdnsEdit({ ip, info });
      setRdnsValue(info.rdns);
    } catch (e) {
      fail(e);
    }
  };

  const handleSaveRdns = async () => {
    if (!rdnsEdit) return;
    if (!rdnsValue.trim()) {
      onNotify('Enter an rDNS hostname', 'error');
      return;
    }
    try {
      const r = await setRdns(rdnsEdit.ip, rdnsValue.trim());
      if (r.warning) {
        onNotify(String(r.warning), 'error');
      } else {
        onNotify(`rDNS for ${rdnsEdit.ip} saved and forward-confirmed`, 'success');
      }
      setRdnsEdit(null);
      await loadIpDetails();
    } catch (e) {
      fail(e);
    }
  };

  // F-016 blacklist
  const [blIps, setBlIps] = useState<BlacklistIp[]>([]);
  const [blEvents, setBlEvents] = useState<BlacklistEvent[]>([]);

  const loadBlacklist = useCallback(async () => {
    try {
      const r = await getBlacklist();
      setBlIps(r.ips);
      setBlEvents(r.events);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'deliverability') void loadBlacklist();
  }, [authed, activeTab, loadBlacklist]);

  // F-008 login activity
  const [loginRows, setLoginRows] = useState<LoginEventRow[]>([]);
  const [sessionRows, setSessionRows] = useState<AdminSessionRow[]>([]);
  const [loginGeoNote, setLoginGeoNote] = useState('');

  const loadLoginLog = useCallback(async () => {
    try {
      const r = await getLoginLog();
      setLoginRows(r.logins);
      setSessionRows(r.sessions);
      setLoginGeoNote(r.note);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'activity') void loadLoginLog();
  }, [authed, activeTab, loadLoginLog]);

  const handleRevokeSession = async (s: AdminSessionRow) => {
    try {
      await revokeSession(s.token);
      onNotify(`Session for ${s.username} revoked`, 'info');
      await loadLoginLog();
    } catch (e) {
      fail(e);
    }
  };

  // F-009 notifications
  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifDelivery, setNotifDelivery] = useState('');
  const [notifRules, setNotifRulesState] = useState<NotifRules | null>(null);
  const [ruleQueue, setRuleQueue] = useState('500');
  const [ruleDisk, setRuleDisk] = useState('80');
  const [ruleUptime, setRuleUptime] = useState('99');

  const loadNotifs = useCallback(async () => {
    try {
      const r = await getNotifications();
      setNotifs(r.notifications);
      setNotifUnread(r.unread);
      setNotifDelivery(r.delivery);
      setNotifRulesState(r.rules);
      setRuleQueue(String(r.rules.queue_warn));
      setRuleDisk(String(r.rules.disk_warn_pct));
      setRuleUptime(String(r.rules.uptime_warn_pct));
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'notifications') void loadNotifs();
  }, [authed, activeTab, loadNotifs]);

  const handleSaveRules = async () => {
    try {
      await setNotifRules({
        queue_warn: Number(ruleQueue) || 500,
        disk_warn_pct: Number(ruleDisk) || 80,
        uptime_warn_pct: Number(ruleUptime) || 99,
      });
      onNotify('Notification thresholds saved', 'success');
      await loadNotifs();
    } catch (e) {
      fail(e);
    }
  };

  // F-019 rate limits
  const [rateLimits, setRateLimits] = useState<RateLimits | null>(null);

  const loadRateLimits = useCallback(async () => {
    try {
      const r = await getRateLimits();
      setRateLimits(r);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'ratelimits') void loadRateLimits();
  }, [authed, activeTab, loadRateLimits]);

  // F-021 MTA templates
  const [mtaTemplates, setMtaTemplates] = useState<MtaTemplate[]>([]);
  const [mtaVersions, setMtaVersions] = useState<MtaVersionInfo[]>([]);
  const [mtaResult, setMtaResult] = useState<{
    template: string;
    rendered: string;
    diff: string[];
    note: string;
  } | null>(null);

  const loadMta = useCallback(async () => {
    try {
      const r = await getMtaTemplates();
      setMtaTemplates(r.templates);
      setMtaVersions(r.versions);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'mta') void loadMta();
  }, [authed, activeTab, loadMta]);

  const handleApplyTemplate = async (tpl: string) => {
    try {
      const r = await applyMtaTemplate({ template: tpl });
      setMtaResult({ template: r.template, rendered: r.rendered, diff: r.diff, note: r.note });
      onNotify(r.note, 'info');
      await loadMta();
    } catch (e) {
      fail(e);
    }
  };

  // F-022 migrations
  const [migrations, setMigrations] = useState<MigrationJobRow[]>([]);
  const [migDomain, setMigDomain] = useState('');
  const [migTarget, setMigTarget] = useState('');

  const loadMigrations = useCallback(async () => {
    try {
      const r = await listMigrations();
      setMigrations(r.migrations);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    if (authed && activeTab === 'mta') void loadMigrations();
  }, [authed, activeTab, loadMigrations]);

  const handleCreateMigration = async () => {
    if (!migDomain.trim() || !migTarget) {
      onNotify('Domain and target node are required', 'error');
      return;
    }
    try {
      const r = await createMigration({ domain: migDomain.trim(), target_node: migTarget });
      onNotify(r.migration.note, 'info');
      setMigDomain('');
      await loadMigrations();
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
      <div className="adm-root flex min-h-dvh h-dvh w-full bg-white text-[#101828] dark:bg-[#0A0F1A] dark:text-[#E6EAF2]">
        {/* Brand panel — custom ink panel with the product story, desktop only */}
        <aside className="adm-login-brand relative hidden w-[44%] max-w-[540px] shrink-0 flex-col justify-between overflow-hidden p-10 text-white md:flex">
          <div className="relative flex items-center gap-3">
            <AffinMailLogo variant="icon" size="md" />
            <div>
              <p className="text-[16px] font-semibold leading-tight tracking-[-0.01em]">AffinMail</p>
              <p className="text-[11px] font-medium tracking-[0.02em] text-[#8A94A6]">
                Admin console
              </p>
            </div>
          </div>

          <div className="relative">
            <p className="text-[14px] leading-relaxed text-[#A7B2C5]">
              Sign in to manage domains, mailboxes, and delivery.
            </p>
          </div>

          <p className="relative text-[11.5px] text-[#5B6B82]">
            AffinMail
          </p>
        </aside>

        <main className="relative flex flex-1 items-center justify-center overflow-y-auto p-6">
          <button
            onClick={onToggleTheme}
            className="absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-[9px] text-[#475467] transition hover:bg-[#F2F4F7] dark:text-[#A7B2C5] dark:hover:bg-white/5"
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

          <div className="w-full max-w-[380px]">
            <div className="mb-8">
              <span className="mb-6 block md:hidden">
                <AffinMailLogo variant="icon" size="md" />
              </span>
              <h1 className="text-[24px] font-semibold tracking-[-0.01em]">Admin sign in</h1>
              <p className={`mt-1 text-[13.5px] ${MUTED}`}>Enter your administrator credentials to continue.</p>
            </div>

            <form
              className="space-y-4"
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
                  className="flex items-start gap-2 rounded-[10px] bg-[#FEF3F2] px-3.5 py-3 text-[13px] text-[#B42318] dark:bg-[#B42318]/10 dark:text-[#F97066]"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" />
                  <span className="min-w-0 break-words">{authError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={authBusy}
                className={`${btn('primary')} h-11 w-full rounded-[10px] text-[14px]`}
              >
                {authBusy ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
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

            <div className="mt-7 flex items-center gap-3 text-[10.5px] font-medium tracking-[0.02em] text-[#98A2B3]">
              <span className="h-px flex-1 bg-[#EEF1F5] dark:bg-[#1B2740]" />
              or
              <span className="h-px flex-1 bg-[#EEF1F5] dark:bg-[#1B2740]" />
            </div>
            <button
              type="button"
              onClick={onSwitchToWebmail}
              className={`${btn('outline')} mt-5 h-11 w-full rounded-[10px] text-[13.5px]`}
            >
              Back to webmail
            </button>
            <p className="mt-9 text-center text-[11.5px] text-[#98A2B3]">
              Secure administrator session · AffinMail core
            </p>
          </div>
        </main>
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
          trailing: <span className={`${NAVCOUNT} tabular-nums`}>{domains.length}</span>,
        },
        {
          id: 'mailboxes',
          label: 'Mailboxes',
          icon: <Users className="w-4 h-4" />,
          trailing: <span className={`${NAVCOUNT} tabular-nums`}>{mailboxes.length}</span>,
        },
        {
          id: 'aliases',
          label: 'Aliases',
          icon: <Forward className="w-4 h-4" />,
          trailing: <span className={`${NAVCOUNT} tabular-nums`}>{aliases.length}</span>,
        },
        {
          id: 'queue',
          label: 'Mail queue',
          icon: <ListOrdered className="w-4 h-4" />,
          trailing: (
            <span className={queueItems.length > 0 ? NAVCOUNT_WARN : NAVCOUNT}>
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
        { id: 'deliverability', label: 'IP deliverability', icon: <Network className="w-4 h-4" /> },
        { id: 'servers', label: 'Server nodes', icon: <Server className="w-4 h-4" /> },
        { id: 'ratelimits', label: 'Rate limits', icon: <Thermometer className="w-4 h-4" /> },
        { id: 'mta', label: 'MTA & migration', icon: <FileCode2 className="w-4 h-4" /> },
        { id: 'storage', label: 'Storage engine', icon: <HardDrive className="w-4 h-4" /> },
        { id: 'system', label: 'System controls', icon: <Terminal className="w-4 h-4" /> },
      ],
    },
    {
      label: 'Oversight',
      items: [
        {
          id: 'notifications',
          label: 'Notifications',
          icon: <Bell className="w-4 h-4" />,
          trailing:
            notifUnread > 0 ? (
              <span className={NAVCOUNT_WARN}>{notifUnread}</span>
            ) : (
              <span className={NAVCOUNT}>0</span>
            ),
        },
        { id: 'activity', label: 'Login activity', icon: <Lock className="w-4 h-4" /> },
        { id: 'apikeys', label: 'API keys', icon: <KeyRound className="w-4 h-4" /> },
      ],
    },
  ];

  const activeLabel = navGroups.flatMap((g) => g.items).find((i) => i.id === activeTab)?.label ?? 'Overview';

  const sidebar = (
    <>
      <div className="flex h-[60px] shrink-0 items-center gap-2.5 px-4">
        <AffinMailLogo variant="icon" size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold leading-tight text-white">AffinMail</p>
          <p className="text-[10px] font-medium tracking-[0.02em] text-[#5B6B82]">
            Admin console
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsMobileNavOpen(false)}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#A7B2C5] hover:bg-white/5 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3" aria-label="Admin sections">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-2">
            <p className="px-2.5 pb-1.5 pt-4 text-[12px] font-medium tracking-[0.01em] text-[#5B6B82]">
              {group.label}
            </p>
            <ul className="space-y-0.5">
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
                      className={`flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] transition-colors ${
                        active
                          ? 'bg-white/[0.09] font-medium text-white'
                          : 'text-[#A7B2C5] hover:bg-white/[0.05] hover:text-white'
                      }`}
                      aria-current={active ? 'page' : undefined}
                    >
                      <span className={active ? 'text-white' : 'text-[#5B6B82]'}>{item.icon}</span>
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

      <div className="shrink-0 space-y-1.5 p-3">
        <div className="space-y-1.5 rounded-xl bg-white/[0.06] p-3 text-[11.5px] ring-1 ring-white/[0.06]">
          <div className="flex items-center justify-between gap-2 font-semibold text-white">
            <span>AffinMail core</span>
            <span className="font-mono text-[11px] tabular-nums text-[#8A94A6]">
              {healthData?.version ?? '—'}
            </span>
          </div>
          <p className="text-[#8A94A6]">Stalwart · PostgreSQL 16 · Redis 7</p>
          <div
            className={`flex items-center gap-1.5 font-medium ${
              healthyCount === 3 ? 'text-[#32D583]' : 'text-[#FDB022]'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {healthyCount} of 3 services up
          </div>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] text-[#A7B2C5] transition hover:bg-white/[0.05] hover:text-white"
        >
          <Power className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </>
  );

  const navBtn =
    'inline-flex h-9 w-9 items-center justify-center rounded-[9px] text-[#475467] transition hover:bg-[#F2F4F7] dark:text-[#A7B2C5] dark:hover:bg-white/5';

  return (
    <div className="adm-root flex h-dvh w-full bg-[#F4F5F7] text-[#101828] dark:bg-[#0A0F1A] dark:text-[#E6EAF2]">
      {/* Desktop sidebar */}
      <aside className="adm-sidebar hidden w-[250px] shrink-0 flex-col lg:flex">{sidebar}</aside>

      {/* Mobile sidebar overlay */}
      {isMobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-[#0A0F1A]/50"
            onClick={() => setIsMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="adm-sidebar absolute inset-y-0 left-0 flex w-[264px] max-w-[85vw] flex-col">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex flex-col h-dvh min-w-0 flex-1 overflow-hidden">
        {/* Top bar */}
        <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-[#E4E7EC] bg-white px-4 dark:border-[#1B2740] dark:bg-[#0D1526] sm:px-6">
          <div className="flex-none lg:hidden">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              className={navBtn}
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <AffinMailLogo variant="icon" size="sm" />
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-[#101828] dark:text-white">
              AffinMail
            </span>
            <div className="hidden h-5 w-px shrink-0 bg-[#E4E7EC] dark:bg-[#22304A] sm:block" />
            <span className="truncate text-[13.5px] text-[#667085] max-sm:hidden dark:text-[#8A94A6]">{activeLabel}</span>
          </div>

          <div className="flex flex-none items-center gap-1 sm:gap-1.5">
            <button
              onClick={() => setActiveTab('notifications')}
              className={`${navBtn} relative`}
              title="Notifications"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {notifUnread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D92D20] px-1 text-[9px] font-bold text-white tabular-nums">
                  {notifUnread}
                </span>
              )}
            </button>
            <div
              className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold md:inline-flex ${
                healthyCount === 3
                  ? 'bg-[#ECFDF3] text-[#067647] dark:bg-[#067647]/15 dark:text-[#32D583]'
                  : 'bg-[#FFFAEB] text-[#B54708] dark:bg-[#B54708]/15 dark:text-[#FDB022]'
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

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <div className="w-full space-y-4 p-4 sm:p-6">
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

                {/* Metric cards */}
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
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
                    <div key={m.label} className={`${PANEL} p-5`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-medium ${MUTED}`}>
                          {m.label}
                        </span>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#EEF4FF] text-[#0B57D0] dark:bg-[#0B57D0]/15 dark:text-[#7FB0FF]">
                          {m.icon}
                        </span>
                      </div>
                      <div className="mt-3 text-[26px] font-semibold leading-none tracking-[-0.01em] tabular-nums text-[#101828] dark:text-white">
                        {m.value}
                      </div>
                      <div
                        className={`mt-1.5 text-[12px] ${
                          'bad' in m && m.bad ? 'text-[#B54708] dark:text-[#FDB022]' : MUTED
                        }`}
                      >
                        {m.sub}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Charts: mail flow, delivery rate, reputation, queue history, service status */}
                {(() => {
                  const hist = stats?.history;
                  if (!hist) return null;
                  const days = last7Days(hist.mailDaily);
                  const dayLabels = days.map((d) => dayLabel(d.day));
                  const totalFlow = days.reduce((a, d) => a + d.queued + d.delivered + d.failed, 0);
                  const rateDay = [...days].reverse().find((d) => d.rate !== null);
                  const queuePts = hist.queueSeries.map((p) => p.queue);
                  const queueLabels = hist.queueSeries.map((p) => p.ts.slice(11, 16));
                  const svcNames = ['Stalwart mail core', 'PostgreSQL', 'Redis'];
                  const svcKeys = ['stalwart', 'postgresql', 'redis'];
                  return (
                    <>
                      <div className={`${PANEL} p-5`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <SectionTitle>Mail flow — last 7 days</SectionTitle>
                            <div className="mt-2">
                              <ChartLegend
                                items={[
                                  { label: 'Queued', color: '#0B57D0', value: String(days.reduce((a, d) => a + d.queued, 0)) },
                                  { label: 'Delivered', color: '#079455', value: String(days.reduce((a, d) => a + d.delivered, 0)) },
                                  { label: 'Failed', color: '#D92D20', value: String(days.reduce((a, d) => a + d.failed, 0)) },
                                ]}
                              />
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[26px] font-semibold leading-none tabular-nums text-[#101828] dark:text-white">
                              {rateDay?.rate != null ? `${rateDay.rate}%` : '—'}
                            </div>
                            <div className={`mt-1.5 text-[12px] ${MUTED}`}>
                              delivery rate{rateDay ? ` · ${dayLabel(rateDay.day)}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3">
                          {totalFlow > 0 ? (
                            <LineChart
                              height={150}
                              xLabels={dayLabels}
                              series={[
                                { label: 'Queued', color: '#0B57D0', points: days.map((d) => d.queued) },
                                { label: 'Delivered', color: '#079455', points: days.map((d) => d.delivered) },
                                { label: 'Failed', color: '#D92D20', points: days.map((d) => d.failed) },
                              ]}
                            />
                          ) : (
                            <p className={`py-6 text-center text-[13px] ${MUTED}`}>
                              No mail recorded in the last 7 days yet. The collector reads Stalwart's log every 5 minutes.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className={`${PANEL} p-5`}>
                          <SectionTitle>Delivery rate</SectionTitle>
                          <p className={`mt-1 text-[12px] ${MUTED}`}>Delivered ÷ (delivered + failed), per day</p>
                          <div className="mt-3">
                            {days.some((d) => d.rate !== null) ? (
                              <LineChart
                                height={120}
                                yMax={100}
                                formatY={(v) => `${Math.round(v)}%`}
                                xLabels={dayLabels}
                                series={[{ label: 'Rate', color: '#079455', points: days.map((d) => d.rate), area: true }]}
                              />
                            ) : (
                              <p className={`py-6 text-center text-[13px] ${MUTED}`}>No completed deliveries yet.</p>
                            )}
                          </div>
                        </div>

                        <div className={`${PANEL} p-5`}>
                          <SectionTitle>IP reputation</SectionTitle>
                          <p className={`mt-1 text-[12px] ${MUTED}`}>
                            Average pool score from DNSBL checks (Spamhaus, SpamCop, Barracuda), sampled every 5 minutes
                          </p>
                          <div className="mt-3">
                            {hist.repSeries.length > 1 ? (
                              <LineChart
                                height={120}
                                yMax={100}
                                formatY={(v) => `${Math.round(v)}`}
                                xLabels={hist.repSeries.map((p) => p.ts.slice(11, 16))}
                                series={[{ label: 'Reputation', color: '#0B57D0', points: hist.repSeries.map((p) => p.score), area: true }]}
                              />
                            ) : (
                              <p className={`py-4 text-center text-[13px] ${MUTED}`}>
                                Reputation sampling has started — the trend line appears as samples accumulate.
                              </p>
                            )}
                          </div>
                          <div className="mt-2 divide-y divide-[#EAECF0] dark:divide-[#1B2740]">
                            {hist.ips.map((ip) => (
                              <div key={ip.ip} className="flex items-center justify-between gap-3 py-2">
                                <span className="font-mono text-[12.5px] text-[#101828] dark:text-white">{ip.ip}</span>
                                <span className="flex items-center gap-2">
                                  <span className={ip.listedNow > 0 ? BADGE_BAD : BADGE_OK}>
                                    {ip.listedNow > 0 ? `Listed on ${ip.listedNow}` : 'Not listed'}
                                  </span>
                                  <span className="text-[12.5px] font-semibold tabular-nums text-[#101828] dark:text-white">
                                    {ip.score.toFixed(1)}
                                  </span>
                                </span>
                              </div>
                            ))}
                            {hist.ips.length === 0 && <p className={`py-3 text-[13px] ${MUTED}`}>No active IP pools.</p>}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className={`${PANEL} p-5`}>
                          <SectionTitle>Mail queue — last 24 hours</SectionTitle>
                          <div className="mt-3">
                            {queuePts.length > 1 ? (
                              <LineChart
                                height={120}
                                xLabels={queueLabels}
                                series={[{ label: 'Queue', color: '#B54708', points: queuePts, area: true }]}
                              />
                            ) : (
                              <p className={`py-6 text-center text-[13px] ${MUTED}`}>
                                Queue sampling has started — history builds every 5 minutes.
                              </p>
                            )}
                          </div>
                        </div>

                        <div className={`${PANEL} p-5`}>
                          <SectionTitle>Service status — last 24 hours</SectionTitle>
                          <div className="mt-3 space-y-4">
                            {svcNames.map((name, si) => {
                              const uptime = hist.uptime24h[svcKeys[si]];
                              const strip = hist.queueSeries.slice(-48);
                              return (
                                <div key={name}>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[13px] font-medium text-[#101828] dark:text-white">{name}</span>
                                    <span className={`text-[12px] tabular-nums ${MUTED}`}>
                                      {uptime != null ? `${uptime}% uptime` : 'no samples yet'}
                                    </span>
                                  </div>
                                  <div className="mt-1.5 flex gap-[2px]">
                                    {strip.map((p, i) => {
                                      const v = p.svc?.[si];
                                      return (
                                        <span
                                          key={i}
                                          className="h-4 flex-1 rounded-[2px]"
                                          style={{ background: v == null ? '#EAECF0' : v === 1 ? '#12B76A' : '#F04438' }}
                                        />
                                      );
                                    })}
                                    {strip.length === 0 && <span className={`text-[12px] ${MUTED}`}>Sampling has started.</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Mail queue snapshot */}
                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle
                    actions={
                      <div className="flex items-center gap-2">
                        <span className={stats && stats.queue.count > 0 ? BADGE_WARN : BADGE_NEUTRAL}>
                          {stats ? `${stats.queue.count} waiting` : '…'}
                        </span>
                        <button onClick={() => setActiveTab('queue')} className={btn('outline', 'xs')}>
                          Open queue
                        </button>
                      </div>
                    }
                  >
                    Mail queue
                  </SectionTitle>
                  {!stats ? (
                    <p className={`px-5 py-4 text-[13px] ${MUTED}`}>Loading queue…</p>
                  ) : stats.queue.count === 0 ? (
                    <p className={`px-5 py-4 text-[13px] ${MUTED}`}>
                      Queue is empty — no mail is waiting to be delivered.
                    </p>
                  ) : (
                    <table className={TABLE_FIT}>
                      <thead>
                        <tr>
                          <th className={TH}>From</th>
                          <th className={TH}>To</th>
                          <th className={`${TH} text-right`}>Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.queue.items.map((item) => (
                          <tr key={item.id} className={T.row}>
                            <td className={`${TD} ${CODE}`}>{queueSender(item)}</td>
                            <td className={`${TD} ${CODE}`}>{queueRecipients(item)}</td>
                            <td className={`${TD} text-right tabular-nums`}>
                              {fmtBytes(Number(item.size ?? 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Storage by domain + top mailboxes */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle>Storage by domain</SectionTitle>
                    <div className="space-y-4 px-5 py-4">
                      {(stats?.byDomain ?? []).slice(0, 5).map((d) => (
                        <div key={d.domain}>
                          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                            <span className="font-medium text-[#101828] dark:text-[#E6EAF2]">
                              {d.domain}
                            </span>
                            <span className={`${MUTED} tabular-nums`}>
                              {fmtBytes(d.usedBytes)} of {fmtBytes(d.quotaMb * 1024 * 1024)} ·{' '}
                              {d.mailboxes} mailboxes
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <Bar value={pctOf(d.usedBytes, d.quotaMb * 1024 * 1024)} />
                          </div>
                        </div>
                      ))}
                      {stats && stats.byDomain.length === 0 && (
                        <p className={`text-[13px] ${MUTED}`}>No domains yet.</p>
                      )}
                      {!stats && <p className={`text-[13px] ${MUTED}`}>Loading…</p>}
                    </div>
                  </div>

                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle>Top mailboxes by usage</SectionTitle>
                    <div className="space-y-4 px-5 py-4">
                      {(stats?.topMailboxes ?? []).map((m) => (
                        <div key={m.email}>
                          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                            <span className="font-medium text-[#101828] dark:text-[#E6EAF2]">
                              {m.email}
                            </span>
                            <span className={`${MUTED} tabular-nums`}>
                              {fmtBytes(m.usedBytes)} / {fmtBytes(m.quotaMb * 1024 * 1024)}
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <Bar value={pctOf(m.usedBytes, m.quotaMb * 1024 * 1024)} />
                          </div>
                        </div>
                      ))}
                      {stats && stats.topMailboxes.length === 0 && (
                        <p className={`text-[13px] ${MUTED}`}>No mailboxes yet.</p>
                      )}
                      {!stats && <p className={`text-[13px] ${MUTED}`}>Loading…</p>}
                    </div>
                  </div>
                </div>

                {/* Server resources + recent activity */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle
                      actions={
                        stats ? (
                          <span className={`${BADGE_NEUTRAL} tabular-nums`}>
                            up {fmtUptime(stats.server.uptimeSec)}
                          </span>
                        ) : undefined
                      }
                    >
                      Server resources
                    </SectionTitle>
                    {stats ? (
                      <div className="space-y-4 px-5 py-4">
                        <div>
                          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                            <span className="font-medium text-[#101828] dark:text-[#E6EAF2]">Disk</span>
                            <span className={`${MUTED} tabular-nums`}>
                              {fmtBytes(stats.server.diskTotal - stats.server.diskFree)} used ·{' '}
                              {fmtBytes(stats.server.diskFree)} free of {fmtBytes(stats.server.diskTotal)}
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <Bar
                              value={pctOf(
                                stats.server.diskTotal - stats.server.diskFree,
                                stats.server.diskTotal
                              )}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                            <span className="font-medium text-[#101828] dark:text-[#E6EAF2]">Memory</span>
                            <span className={`${MUTED} tabular-nums`}>
                              {fmtBytes((stats.server.memTotalKb - stats.server.memAvailKb) * 1024)} used ·{' '}
                              {fmtBytes(stats.server.memTotalKb * 1024)} total
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <Bar
                              value={pctOf(
                                stats.server.memTotalKb - stats.server.memAvailKb,
                                stats.server.memTotalKb
                              )}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[12.5px]">
                          <span className="font-medium text-[#101828] dark:text-[#E6EAF2]">Load average</span>
                          <span className={`${CODE} ${MUTED} tabular-nums`}>
                            {stats.server.load.map((v) => v.toFixed(2)).join(' · ')}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className={`px-5 py-4 text-[13px] ${MUTED}`}>Loading…</p>
                    )}
                  </div>

                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle
                      actions={
                        stats ? (
                          <span className={BADGE_NEUTRAL}>+{stats.newMailboxes7d} mailboxes · 7d</span>
                        ) : undefined
                      }
                    >
                      Recent activity
                    </SectionTitle>
                    {stats ? (
                      <>
                        <div className="divide-y divide-[#EEF1F5] dark:divide-[#1B2740]">
                          {stats.recentMailboxes.map((m) => (
                            <div key={m.email} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[12.5px]">
                              <span className="min-w-0">
                                <span className="font-medium text-[#101828] dark:text-[#E6EAF2]">{m.email}</span>{' '}
                                <span className={MUTED}>mailbox created</span>
                              </span>
                              <span className={`${MUTED} tabular-nums whitespace-nowrap`}>{fmtWhen(m.createdAt)}</span>
                            </div>
                          ))}
                          {stats.recentDomains.map((d) => (
                            <div key={d.domain} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[12.5px]">
                              <span className="min-w-0">
                                <span className="font-medium text-[#101828] dark:text-[#E6EAF2]">{d.domain}</span>{' '}
                                <span className={MUTED}>domain added</span>
                              </span>
                              <span className={`${MUTED} tabular-nums whitespace-nowrap`}>{fmtWhen(d.createdAt)}</span>
                            </div>
                          ))}
                          {stats.recentMailboxes.length === 0 && stats.recentDomains.length === 0 && (
                            <p className={`px-5 py-4 text-[13px] ${MUTED}`}>Nothing yet.</p>
                          )}
                        </div>
                        <div className={`border-t border-[#EEF1F5] px-5 py-3 text-[11.5px] dark:border-[#1B2740] ${MUTED}`}>
                          {stats.lastBackup
                            ? `Last backup ${stats.lastBackup.file} · ${fmtBytes(stats.lastBackup.sizeBytes)} · ${stats.lastBackup.at} UTC`
                            : 'No backup has been taken yet.'}
                        </div>
                      </>
                    ) : (
                      <p className={`px-5 py-4 text-[13px] ${MUTED}`}>Loading…</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle
                      actions={
                        <span className={`${BADGE_NEUTRAL} tabular-nums`}>{healthyCount} / 3</span>
                      }
                    >
                      Service checks
                    </SectionTitle>
                    <table className={TABLE_FIT}>
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
                    <div className={`border-t border-[#EEF1F5] px-5 py-3 text-[11.5px] dark:border-[#1B2740] ${MUTED} ${CODE}`}>
                      {healthData?.service ?? 'api'} {healthData?.version ?? ''}
                    </div>
                  </div>

                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle>Cluster protocols</SectionTitle>
                    <table className={TABLE_FIT}>
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
                                  onClick={() => {
                                    void listIps()
                                      .then(() => setShowAssignModal({ domain: dom.name, ip: '' }))
                                      .catch(fail);
                                  }}
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
                        <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[#98A2B3]" />
                        <input
                          id="mailbox-filter"
                          type="search"
                          value={mailboxFilter}
                          onChange={(e) => setMailboxFilter(e.target.value)}
                          placeholder="Filter mailboxes"
                          className={`${INPUT} h-9 w-40 pl-9 sm:w-64`}
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

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle>Create alias</SectionTitle>
                  <form
                    className="grid grid-cols-1 items-end gap-3 p-5 sm:grid-cols-[1fr_1fr_auto]"
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

            {/* ===================== TAB: API KEYS ===================== */}
            {activeTab === 'apikeys' && (
              <>
                <PageHeader
                  title="API keys"
                  description="Management of API access keys for integrations and automation."
                />
                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle>Create API key</SectionTitle>
                  <form
                    className="grid grid-cols-1 items-end gap-3 p-5 sm:grid-cols-[1fr_1fr_auto]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleCreateApiKey();
                    }}
                  >
                    <div className="w-full">
                      <label className={LABEL} htmlFor="api-key-name">
                        Key name
                      </label>
                      <input
                        id="api-key-name"
                        type="text"
                        placeholder="e.g. webhook-notifications"
                        value={apiKeyName}
                        onChange={(e) => setApiKeyName(e.target.value)}
                        className={`${INPUT}`}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3 w-full">
                      <div>
                        <label className={LABEL} htmlFor="api-key-scopes">
                          Scopes
                        </label>
                        <select
                          id="api-key-scopes"
                          multiple
                          className={`${INPUT}`}
                          onChange={(e) => {
                            const selected = Array.from(
                              (e.target as HTMLSelectElement).selectedOptions,
                            ).map((o) => o.value);
                            setApiKeyScopes(selected);
                          }}
                        >
                          <option value="mailbox:read">Mailbox read</option>
                          <option value="mailbox:write">Mailbox write</option>
                          <option value="domain:read">Domain read</option>
                          <option value="domain:write">Domain write</option>
                          <option value="statistics:read">Statistics read</option>
                          <option value="batch:write">Batch write</option>
                          <option value="system:read">System read</option>
                        </select>
                      </div>
                    </div>
                    <button type="submit" className={btn('primary')} disabled={apiKeyBusy}>
                      <Plus className="w-3.5 h-3.5" />
                      {apiKeyBusy ? 'Creating...' : 'Create key'}
                    </button>
                  </form>
                </div>

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle actions={<span className={`${BADGE_NEUTRAL} tabular-num`}>{apiKeys.length}</span>}>
                    API keys
                  </SectionTitle>
                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Key ID</th>
                          <th className={TH}>Name</th>
                          <th className={TH}>Scopes</th>
                          <th className={TH}>Created</th>
                          <th className={`${TH} text-right`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apiKeys.map((k) => (
                          <tr key={k.id} className={T.row}>
                            <td className={`${TD} ${CODE} font-medium ${T.primary}`}>
                              {k.id}
                            </td>
                            <td className={`${TD} ${CODE} font-medium`}>
                              {k.name}
                            </td>
                            <td className={`${TD} font-mono ${MUTED}`}>
                              {k.scopes.join(', ')}
                            </td>
                            <td className={`${TD} hidden sm:table-cell ${MUTED}`}>
                              {k.created_at}
                            </td>
                            <td className={T.actions}>
                              <button
                                className={btn('outline', 'xs')}
                                onClick={() => void handleRotateApiKey(k.id)}
                              >
                                <RotateCw className="w-3 h-3" />
                              </button>
                              <button
                                className={btn('danger', 'xs')}
                                onClick={() => void handleDeleteApiKey(k.id)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {apiKeys.length === 0 && (
                          <tr>
                            <td colSpan={6}>
                              <EmptyState
                                icon={<Key className="w-5 h-5" />}
                                title="No API keys yet"
                                description="Create your first API key to authorize integrations and automation."
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

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle>Log search</SectionTitle>
                  <form
                    className="flex flex-col gap-3 p-5 sm:flex-row"
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

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle
                    actions={
                      trackLines !== null ? (
                        <span className={`${BADGE_NEUTRAL} tabular-nums`}>{trackLines.length} lines</span>
                      ) : undefined
                    }
                  >
                    Results
                  </SectionTitle>
                  <div className="p-5">
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
                      <div className="max-h-[480px] overflow-y-auto overflow-x-hidden rounded-xl border border-[#E4E7EC] bg-[#F8FAFC] p-4 dark:border-[#22304A] dark:bg-[#0A0F1A]">
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

                {/* F-015 Rotation strategies */}
                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle
                    actions={
                      <button onClick={() => void loadRotation()} className={btn('outline', 'xs')}>
                        <RotateCw className="w-3 h-3" />
                        Refresh
                      </button>
                    }
                  >
                    Shared IP rotation strategy
                  </SectionTitle>
                  <div className="divide-y divide-[#EEF1F5] dark:divide-[#1B2740]">
                    {rotationPools.map((p) => (
                      <div key={p.pool} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[#101828] dark:text-white">{p.poolName}</p>
                          <p className={`${CODE} mt-0.5 text-[12px] ${MUTED}`}>{p.ips.join(', ')}</p>
                        </div>
                        <select
                          value={p.strategy}
                          onChange={(e) => void handleSetStrategy(p.pool, e.target.value)}
                          aria-label={`Rotation strategy for ${p.poolName}`}
                          className={`${INPUT} h-9 w-auto min-w-[180px]`}
                        >
                          <option value="hash-based">Hash-based (default)</option>
                          <option value="round-robin">Round-robin</option>
                          <option value="least-used">Least-used</option>
                          <option value="weighted">Weighted</option>
                        </select>
                      </div>
                    ))}
                    {rotationPools.length === 0 && (
                      <p className={`px-5 py-4 text-[13px] ${MUTED}`}>No pools configured.</p>
                    )}
                  </div>
                  <div className="border-t border-[#EEF1F5] p-5 dark:border-[#1B2740]">
                    <p className={`text-[12px] font-semibold ${MUTED}`}>Test: pick an IP for a sender domain</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={pickDomain}
                        onChange={(e) => setPickDomain(e.target.value)}
                        placeholder="newsletter.client.com"
                        aria-label="Sender domain"
                        className={`${INPUT} font-mono sm:flex-1`}
                      />
                      <button onClick={() => void handlePickIp()} className={btn('outline')}>
                        <Shuffle className="w-3.5 h-3.5" />
                        Pick IP
                      </button>
                    </div>
                    {pickResult && (
                      <p className={`mt-2 ${CODE} text-[13px] text-[#101828] dark:text-[#E6EAF2]`}>{pickResult}</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB: IP DELIVERABILITY (F-013/14/16/17) ===================== */}
            {activeTab === 'deliverability' && (
              <>
                <PageHeader
                  title="IP deliverability"
                  description="Warmup schedules, per-IP assignment, blacklist monitoring, and rDNS."
                />

                {/* F-013 Warmup */}
                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle actions={<span className={BADGE_NEUTRAL}>warmup schedules</span>}>
                    IP warmup
                  </SectionTitle>
                  <form
                    className="grid grid-cols-1 items-end gap-3 border-b border-[#EEF1F5] p-5 dark:border-[#1B2740] sm:grid-cols-[1fr_1fr_auto_auto]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleStartWarmup();
                    }}
                  >
                    <div>
                      <label className={LABEL} htmlFor="warmup-domain">Domain</label>
                      <input
                        id="warmup-domain"
                        type="text"
                        placeholder="client.com"
                        value={warmupDomain}
                        onChange={(e) => setWarmupDomain(e.target.value)}
                        className={`${INPUT} font-mono`}
                      />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="warmup-ip">Dedicated IP</label>
                      <select
                        id="warmup-ip"
                        value={warmupIp}
                        onChange={(e) => setWarmupIp(e.target.value)}
                        className={`${INPUT} font-mono`}
                      >
                        <option value="">Select IP…</option>
                        {ipDetails.map((i) => (
                          <option key={i.ip} value={i.ip}>
                            {i.ip} ({i.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="warmup-plan">Plan</label>
                      <select
                        id="warmup-plan"
                        value={warmupPlan}
                        onChange={(e) => setWarmupPlan(e.target.value as typeof warmupPlan)}
                        className={INPUT}
                      >
                        <option value="conservative">Conservative (60d)</option>
                        <option value="standard">Standard (30d)</option>
                        <option value="aggressive">Aggressive (14d)</option>
                      </select>
                    </div>
                    <button type="submit" className={btn('primary')}>
                      <Plus className="w-3.5 h-3.5" />
                      Start warmup
                    </button>
                  </form>
                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>Domain</th>
                          <th className={TH}>IP</th>
                          <th className={TH}>Progress</th>
                          <th className={TH}>Today</th>
                          <th className={`${TH} text-right`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {warmups.map((w) => (
                          <tr key={w.id} className={T.row}>
                            <td className={`${TD} font-medium`}>{w.domain}</td>
                            <td className={`${TD} ${CODE} ${MUTED}`}>{w.ip}</td>
                            <td className={TD}>
                              <div className="flex items-center gap-2">
                                <div className="w-24">
                                  <Bar value={Math.min(100, (w.day / 30) * 100)} />
                                </div>
                                <span className={`${CODE} ${MUTED} whitespace-nowrap`}>
                                  day {w.day} · cap {w.dailyLimit}
                                </span>
                              </div>
                            </td>
                            <td className={`${TD} ${CODE} tabular-nums`}>
                              {w.sentToday} / {w.dailyLimit}
                              {w.sentToday >= w.dailyLimit && (
                                <span className={`${BADGE_WARN} ml-2`}>throttled</span>
                              )}
                            </td>
                            <td className={T.actions}>
                              <button
                                onClick={() => void handleWarmupPauseResume(w)}
                                className={btn(w.completed ? 'outline' : 'ghost', 'xs')}
                              >
                                {w.completed ? 'Resume' : 'Pause'}
                              </button>
                            </td>
                          </tr>
                        ))}
                        {warmups.length === 0 && (
                          <tr>
                            <td colSpan={5}>
                              <EmptyState
                                icon={<Timer className="w-5 h-5" />}
                                title="No warmup schedules"
                                description="Start one above: new dedicated IPs ramp volume over 14-60 days."
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* F-014 + F-017 IP table with rDNS */}
                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle actions={<span className={`${BADGE_NEUTRAL} tabular-nums`}>{ipDetails.length} IPs</span>}>
                    Outbound IPs — assignment & rDNS
                  </SectionTitle>
                  <div className="overflow-x-auto">
                    <table className={TABLE}>
                      <thead>
                        <tr>
                          <th className={TH}>IP</th>
                          <th className={TH}>rDNS (PTR)</th>
                          <th className={TH}>Domains</th>
                          <th className={TH}>RBL now</th>
                          <th className={`${TH} text-right`}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ipDetails.map((i) => (
                          <tr key={i.ip} className={T.row}>
                            <td className={`${TD} ${CODE} font-medium`}>{i.ip}</td>
                            <td className={`${TD} ${CODE} ${MUTED} break-all`}>{i.rdns}</td>
                            <td className={`${TD} tabular-nums`}>{i.domains}</td>
                            <td className={TD}>
                              {i.listedNow > 0 ? (
                                <span className={BADGE_BAD}>Listed on {i.listedNow}</span>
                              ) : (
                                <span className={BADGE_OK}>
                                  <CheckCircle className="w-3 h-3" />
                                  Clean
                                </span>
                              )}
                            </td>
                            <td className={T.actions}>
                              <button onClick={() => void openRdns(i.ip)} className={btn('outline', 'xs')}>
                                Set rDNS
                              </button>
                            </td>
                          </tr>
                        ))}
                        {ipDetails.length === 0 && !loading && (
                          <tr>
                            <td colSpan={5}>
                              <EmptyState icon={<Network className="w-5 h-5" />} title="No active IPs" />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className={`border-t border-[#EEF1F5] px-5 py-3 text-[11.5px] dark:border-[#1B2740] ${MUTED}`}>
                    PTR records are stored here and forward-confirmed (PTR → A → IP). Provider APIs
                    (Hetzner/DO/OVH) are not connected — set the PTR at your provider, then save it here.
                  </p>
                </div>

                {/* F-016 Blacklist monitoring */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle
                      actions={
                        <button onClick={() => void loadBlacklist()} className={btn('outline', 'xs')}>
                          <RotateCw className="w-3 h-3" />
                          Refresh
                        </button>
                      }
                    >
                      Blacklist status — checked every 5 min
                    </SectionTitle>
                    <table className={TABLE_FIT}>
                      <thead>
                        <tr>
                          <th className={TH}>IP</th>
                          <th className={TH}>Listings (last hour)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {blIps.map((b) => (
                          <tr key={b.ip} className={T.row}>
                            <td className={`${TD} ${CODE} font-medium`}>{b.ip}</td>
                            <td className={TD}>
                              {b.listed ? (
                                <span className={BADGE_BAD}>
                                  <Ban className="w-3 h-3" />
                                  {b.lists.join(', ')}
                                </span>
                              ) : (
                                <span className={BADGE_OK}>Clean on all lists</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {blIps.length === 0 && (
                          <tr>
                            <td colSpan={2} className={`px-4 py-4 text-[13px] ${MUTED}`}>
                              No RBL data yet — the collector checks Spamhaus, SpamCop, Barracuda,
                              SORBS, PSBL, Spameatingmonkey, UCEPROTECT and GBUdb every 5 minutes.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle>Listing history — last 7 days</SectionTitle>
                    <div className="max-h-[300px] overflow-y-auto divide-y divide-[#EEF1F5] dark:divide-[#1B2740]">
                      {blEvents.filter((e) => e.listed).length === 0 && (
                        <p className={`px-5 py-4 text-[13px] ${MUTED}`}>
                          No listings recorded in the last 7 days.
                        </p>
                      )}
                      {blEvents
                        .filter((e) => e.listed)
                        .map((e, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[12.5px]">
                            <span className="min-w-0">
                              <span className={`${CODE} font-medium text-[#101828] dark:text-[#E6EAF2]`}>{e.ip}</span>{' '}
                              <span className={MUTED}>listed on {e.provider}</span>
                            </span>
                            <span className={`${MUTED} whitespace-nowrap tabular-nums`}>{fmtWhen(e.at)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB: SERVER NODES (F-011) ===================== */}
            {activeTab === 'servers' && (
              <>
                <PageHeader
                  title="Server nodes"
                  description="Registered nodes, roles, and drain states."
                  actions={
                    <button onClick={() => setShowAddNodeModal(true)} className={btn('primary')}>
                      <Plus className="w-3.5 h-3.5" />
                      Register node
                    </button>
                  }
                />

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {servers.map((n) => {
                    const svc = n.health?.services;
                    const upCount = svc ? [svc.stalwart, svc.redis, svc.postgres].filter(Boolean).length : 0;
                    return (
                      <div key={n.id} className={`${PANEL} p-5`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-[15px] font-semibold text-[#101828] dark:text-white">
                                {n.hostname}
                              </p>
                              {n.isLocal ? (
                                <span className={BADGE_OK}>This server</span>
                              ) : (
                                <span className={BADGE_WARN}>Remote · not configured</span>
                              )}
                            </div>
                            <p className={`mt-1 text-[12.5px] ${MUTED}`}>
                              {n.primaryIp} · {n.role} · {n.location} · group {n.group}
                            </p>
                          </div>
                          <span
                            className={
                              n.status === 'active'
                                ? BADGE_OK
                                : n.status === 'draining'
                                  ? BADGE_WARN
                                  : BADGE_NEUTRAL
                            }
                          >
                            {n.status}
                          </span>
                        </div>

                        {n.isLocal && n.health ? (
                          <>
                            <div className="mt-4 flex flex-wrap gap-2">
                              {(['stalwart', 'postgres', 'redis'] as const).map((s, idx) => {
                                const up = svc ? [svc.stalwart, svc.postgres, svc.redis][idx] : false;
                                return (
                                  <span key={s} className={up ? BADGE_OK : BADGE_BAD}>
                                    {s}: {up ? 'up' : 'down'}
                                  </span>
                                );
                              })}
                              <span className={BADGE_NEUTRAL}>{upCount}/3 up</span>
                            </div>
                            <div className="mt-4 space-y-3">
                              <div>
                                <div className="flex justify-between text-[12px]">
                                  <span className={MUTED}>Disk</span>
                                  <span className={`${CODE} tabular-nums`}>
                                    {fmtBytes(n.health.diskTotal - n.health.diskFree)} / {fmtBytes(n.health.diskTotal)}
                                  </span>
                                </div>
                                <div className="mt-1">
                                  <Bar value={pctOf(n.health.diskTotal - n.health.diskFree, n.health.diskTotal)} />
                                </div>
                              </div>
                              <div className="flex justify-between text-[12px]">
                                <span className={MUTED}>Load / uptime</span>
                                <span className={`${CODE} tabular-nums`}>
                                  {n.health.load.map((v) => v.toFixed(2)).join(' · ')} · {fmtUptime(n.health.uptimeSec)}
                                </span>
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className={`mt-4 rounded-[10px] bg-[#FFFAEB] px-3.5 py-3 text-[12.5px] text-[#B54708] dark:bg-[#B54708]/10 dark:text-[#FDB022]`}>
                            Health unknown — remote monitoring needs an SSH key or agent on this node,
                            which is not configured in this build.
                          </p>
                        )}

                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
                          {(['active', 'maintenance', 'draining'] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => void handleNodeStatus(n, s)}
                              disabled={n.status === s}
                              className={btn(n.status === s ? 'primary' : 'outline', 'xs')}
                            >
                              {s === 'active' ? (
                                <Play className="w-3 h-3" />
                              ) : s === 'draining' ? (
                                <RefreshCcwDot className="w-3 h-3" />
                              ) : (
                                <Power className="w-3 h-3" />
                              )}
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {servers.length === 0 && loading && (
                  <div className={`${PANEL} p-5`}>
                    <SkeletonRows cols={1} rows={2} />
                  </div>
                )}
              </>
            )}

            {/* ===================== TAB: RATE LIMITS (F-019) ===================== */}
            {activeTab === 'ratelimits' && (
              <>
                <PageHeader
                  title="Rate limits"
                  description="Server and per-ISP send caps with current utilization."
                />
                {rateLimits ? (
                  <>
                    <div className={`${PANEL} p-5`}>
                      <div className="flex items-baseline justify-between">
                        <p className="text-[13px] font-medium text-[#101828] dark:text-white">Server total</p>
                        <span className={`${CODE} text-[12.5px] tabular-nums ${MUTED}`}>
                          {rateLimits.server.sentToday} sent today · limit {rateLimits.server.limitPerHour}/h
                        </span>
                      </div>
                      <div className="mt-2">
                        <Bar value={rateLimits.server.utilizationPct} />
                      </div>
                    </div>
                    <div className={`${PANEL} overflow-hidden`}>
                      <SectionTitle>Per-ISP caps</SectionTitle>
                      <table className={TABLE_FIT}>
                        <thead>
                          <tr>
                            <th className={TH}>Destination</th>
                            <th className={TH}>Limit / hour</th>
                            <th className={TH}>Sent today</th>
                            <th className={`${TH} w-48`}>Utilization</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rateLimits.isps.map((isp) => (
                            <tr key={isp.isp} className={T.row}>
                              <td className={`${TD} font-medium`}>{isp.isp}</td>
                              <td className={`${TD} ${CODE} tabular-nums`}>{isp.limitPerHour}</td>
                              <td className={`${TD} ${CODE} tabular-nums`}>{isp.sentToday}</td>
                              <td className={TD}>
                                <Bar value={isp.utilizationPct} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className={`border-t border-[#EEF1F5] px-5 py-3 text-[11.5px] dark:border-[#1B2740] ${MUTED}`}>
                        {rateLimits.note}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className={`${PANEL} p-5`}>
                    <p className={`text-[13px] ${MUTED}`}>Loading…</p>
                  </div>
                )}
              </>
            )}

            {/* ===================== TAB: MTA & MIGRATION (F-021/F-022) ===================== */}
            {activeTab === 'mta' && (
              <>
                <PageHeader
                  title="MTA configuration & migration"
                  description="Stalwart config templates with diff + rollback, and domain migration jobs."
                />

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle>Configuration templates</SectionTitle>
                  <div className="grid grid-cols-1 gap-3 p-5 lg:grid-cols-3">
                    {mtaTemplates.map((t) => (
                      <div key={t.id} className="rounded-xl border border-[#E4E7EC] p-4 dark:border-[#22304A]">
                        <p className="text-[13.5px] font-semibold text-[#101828] dark:text-white">{t.name}</p>
                        <p className={`mt-1 text-[12px] ${MUTED}`}>{t.description}</p>
                        <button onClick={() => void handleApplyTemplate(t.id)} className={`${btn('outline', 'xs')} mt-3`}>
                          <MousePointerClick className="w-3 h-3" />
                          Preview & apply
                        </button>
                      </div>
                    ))}
                  </div>
                  {mtaResult && (
                    <div className="border-t border-[#EEF1F5] p-5 dark:border-[#1B2740]">
                      <p className="text-[12px] font-semibold tracking-[0.04em] text-[#98A2B3]">
                        RENDERED CONFIG — template “{mtaResult.template}”
                      </p>
                      <pre className={`mt-2 overflow-x-auto rounded-xl bg-[#F8FAFC] p-4 ${CODE} text-gray-700 dark:bg-[#0A0F1A] dark:text-gray-300`}>
                        {mtaResult.rendered}
                      </pre>
                      <p className={`mt-3 text-[12px] font-semibold ${MUTED}`}>Diff vs current config</p>
                      <pre className={`mt-1 max-h-48 overflow-auto rounded-xl bg-[#F8FAFC] p-4 ${CODE} text-gray-700 dark:bg-[#0A0F1A] dark:text-gray-300`}>
                        {mtaResult.diff.length > 0 ? mtaResult.diff.join('\n') : '(no textual diff — template starts from the live file)'}
                      </pre>
                      <p className={`mt-3 text-[11.5px] ${MUTED}`}>{mtaResult.note}</p>
                    </div>
                  )}
                  {mtaVersions.length > 0 && (
                    <div className="border-t border-[#EEF1F5] px-5 py-4 dark:border-[#1B2740]">
                      <p className={`text-[12px] font-semibold ${MUTED}`}>Config snapshots (rollback points)</p>
                      <ul className="mt-2 space-y-1">
                        {mtaVersions.map((v) => (
                          <li key={v.id} className={`${CODE} text-[12px] ${MUTED}`}>
                            v{v.id} · {v.template_id} · {fmtBytes(v.size_bytes)} · {fmtWhen(v.created_at)} · {v.file}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle>Domain migration</SectionTitle>
                  <form
                    className="grid grid-cols-1 items-end gap-3 border-b border-[#EEF1F5] p-5 dark:border-[#1B2740] sm:grid-cols-[1fr_1fr_auto]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleCreateMigration();
                    }}
                  >
                    <div>
                      <label className={LABEL} htmlFor="mig-domain">Domain</label>
                      <select
                        id="mig-domain"
                        value={migDomain}
                        onChange={(e) => setMigDomain(e.target.value)}
                        className={`${INPUT} font-mono`}
                      >
                        <option value="">Select domain…</option>
                        {domains.map((d) => (
                          <option key={d.id} value={d.name}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="mig-target">Target node</label>
                      <select
                        id="mig-target"
                        value={migTarget}
                        onChange={(e) => setMigTarget(e.target.value)}
                        className={INPUT}
                      >
                        <option value="">Select node…</option>
                        {servers.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.hostname}{n.isLocal ? ' (this server)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className={btn('primary')}>
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      Create migration
                    </button>
                  </form>
                  <div className="divide-y divide-[#EEF1F5] dark:divide-[#1B2740]">
                    {migrations.map((m) => (
                      <div key={m.id} className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13.5px] font-medium text-[#101828] dark:text-white">
                            {m.domain} → {m.target_node}
                          </p>
                          <span className={m.status === 'blocked' ? BADGE_WARN : BADGE_NEUTRAL}>{m.status}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.steps.map((s) => (
                            <span
                              key={s.name}
                              className={s.status === 'done' ? BADGE_OK : s.status === 'blocked' ? BADGE_BAD : BADGE_NEUTRAL}
                            >
                              {s.name}
                            </span>
                          ))}
                        </div>
                        <p className={`mt-2 text-[11.5px] ${MUTED}`}>{m.note}</p>
                      </div>
                    ))}
                    {migrations.length === 0 && (
                      <p className={`px-5 py-4 text-[13px] ${MUTED}`}>
                        No migration jobs. Register a remote node first — real migrations need a sync channel to it.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB: NOTIFICATIONS (F-009) ===================== */}
            {activeTab === 'notifications' && (
              <>
                <PageHeader
                  title="Notifications"
                  description="Threshold-triggered alerts for queue, disk, services, and backups."
                />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle
                      actions={<span className={BADGE_NEUTRAL}>{notifUnread} unread</span>}
                    >
                      Alerts
                    </SectionTitle>
                    <div className="max-h-[420px] divide-y divide-[#EEF1F5] overflow-y-auto dark:divide-[#1B2740]">
                      {notifs.length === 0 && (
                        <p className={`px-5 py-6 text-[13px] ${MUTED}`}>
                          No alerts. Everything is inside the configured thresholds.
                        </p>
                      )}
                      {notifs.map((n) => (
                        <div key={n.id} className={`px-5 py-3.5 ${n.read ? 'opacity-60' : ''}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={n.severity === 'critical' ? BADGE_BAD : BADGE_WARN}>
                                  {n.severity}
                                </span>
                                <p className="text-[13px] font-medium text-[#101828] dark:text-white">{n.title}</p>
                              </div>
                              <p className={`mt-1 text-[12px] ${MUTED}`}>{n.detail}</p>
                              <p className={`mt-1 text-[11px] ${MUTED} tabular-nums`}>{fmtWhen(n.createdAt)}</p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              {!n.read && (
                                <button
                                  onClick={() => {
                                    void markNotifRead(n.id).then(loadNotifs);
                                  }}
                                  className={btn('ghost', 'xs')}
                                >
                                  Read
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  void dismissNotif(n.id).then(loadNotifs);
                                }}
                                className={btnIcon('ghost')}
                                title="Dismiss"
                                aria-label={`Dismiss ${n.title}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className={`border-t border-[#EEF1F5] px-5 py-3 text-[11.5px] dark:border-[#1B2740] ${MUTED}`}>
                      Delivery: {notifDelivery || 'in-panel'}.
                    </p>
                  </div>

                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle>Thresholds & delivery</SectionTitle>
                    <form
                      className="space-y-4 p-5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveRules();
                      }}
                    >
                      <div>
                        <label className={LABEL} htmlFor="rule-queue">Queue spike threshold (messages)</label>
                        <input id="rule-queue" type="number" min={1} value={ruleQueue} onChange={(e) => setRuleQueue(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
                      </div>
                      <div>
                        <label className={LABEL} htmlFor="rule-disk">Disk usage threshold (%)</label>
                        <input id="rule-disk" type="number" min={1} max={99} value={ruleDisk} onChange={(e) => setRuleDisk(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
                      </div>
                      <div>
                        <label className={LABEL} htmlFor="rule-uptime">Service uptime threshold (%, 24h)</label>
                        <input id="rule-uptime" type="number" min={0} max={100} value={ruleUptime} onChange={(e) => setRuleUptime(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
                      </div>
                      {notifRules && (
                        <p className={`text-[12px] ${MUTED}`}>
                          Backup alert: warn when the newest backup is older than{' '}
                          {notifRules.backup_stale_days} day(s). Delivery target{' '}
                          <span className={CODE}>{notifRules.email_to || '—'}</span>; Slack/Telegram
                          webhook and admin-email delivery are not configured in this build.
                        </p>
                      )}
                      <button type="submit" className={btn('primary')}>
                        Save thresholds
                      </button>
                    </form>
                  </div>
                </div>
              </>
            )}

            {/* ===================== TAB: LOGIN ACTIVITY (F-008/F-010) ===================== */}
            {activeTab === 'activity' && (
              <>
                <PageHeader
                  title="Login activity"
                  description="Admin sign-ins, active sessions, and the role model."
                />
                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle
                    actions={
                      <button onClick={() => void loadLoginLog()} className={btn('outline', 'xs')}>
                        <RotateCw className="w-3 h-3" />
                        Refresh
                      </button>
                    }
                  >
                    Active admin sessions
                  </SectionTitle>
                  <table className={TABLE_FIT}>
                    <thead>
                      <tr>
                        <th className={TH}>User</th>
                        <th className={TH}>IP</th>
                        <th className={TH}>Since</th>
                        <th className={`${TH} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionRows.map((s) => (
                        <tr key={s.token} className={T.row}>
                          <td className={`${TD} font-medium`}>{s.username}</td>
                          <td className={`${TD} ${CODE} ${MUTED}`}>{s.ip}</td>
                          <td className={`${TD} ${MUTED} tabular-nums`}>{fmtWhen(s.created_at)}</td>
                          <td className={T.actions}>
                            <button onClick={() => void handleRevokeSession(s)} className={btn('danger', 'xs')}>
                              Force logout
                            </button>
                          </td>
                        </tr>
                      ))}
                      {sessionRows.length === 0 && (
                        <tr>
                          <td colSpan={4} className={`px-4 py-4 text-[13px] ${MUTED}`}>
                            No active sessions this server run.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle>Login history (this server run)</SectionTitle>
                  <table className={TABLE}>
                    <thead>
                      <tr>
                        <th className={TH}>Time</th>
                        <th className={TH}>User</th>
                        <th className={TH}>IP</th>
                        <th className={`${TH} hidden md:table-cell`}>User agent</th>
                        <th className={TH}>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loginRows.map((l, i) => (
                        <tr key={i} className={T.row}>
                          <td className={`${TD} ${MUTED} tabular-nums`}>{fmtWhen(l.ts)}</td>
                          <td className={`${TD} font-medium`}>{l.username}</td>
                          <td className={`${TD} ${CODE} ${MUTED}`}>{l.ip}</td>
                          <td className={`${TD} hidden max-w-[280px] truncate text-[12px] md:table-cell ${MUTED}`}>
                            {l.user_agent}
                          </td>
                          <td className={TD}>
                            <span className={l.success ? BADGE_OK : BADGE_BAD}>
                              {l.success ? 'Success' : 'Failed'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {loginRows.length === 0 && (
                        <tr>
                          <td colSpan={5}>
                            <EmptyState icon={<Lock className="w-5 h-5" />} title="No logins recorded yet" />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {loginGeoNote && (
                    <p className={`border-t border-[#EEF1F5] px-5 py-3 text-[11.5px] dark:border-[#1B2740] ${MUTED}`}>
                      {loginGeoNote}
                    </p>
                  )}
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {[
                    ['Used', storage ? fmtBytes(storage.used_bytes) : '—'],
                    ['Free', storage ? fmtBytes(storage.free_bytes) : '—'],
                    ['Total', storage ? fmtBytes(storage.total_bytes) : '—'],
                  ].map(([label, value]) => (
                    <div key={label} className={`${PANEL} p-5`}>
                      <div className="text-[11px] font-medium text-muted ${MUTED}">{label}</div>
                      <div className="mt-2 text-[20px] font-semibold tabular-nums text-[#101828] dark:text-white">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle>Capacity</SectionTitle>
                  <div className="space-y-2 p-5">
                    {storage && storage.total_bytes > 0 ? (
                      <>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF1F5] dark:bg-white/5">
                          <div
                            className="h-full rounded-full bg-[#0B57D0] dark:bg-[#4C8DFF]"
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
                  <table className={TABLE_FIT}>
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

                <div className={`${PANEL} overflow-hidden`}>
                  <SectionTitle>Cluster operations</SectionTitle>
                  <div className="flex flex-wrap gap-2 p-5">
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

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle
                      actions={
                        <span className={`${healthyCount === 3 ? BADGE_OK : BADGE_WARN} tabular-nums`}>
                          {healthyCount} / 3 healthy
                        </span>
                      }
                    >
                      Service checks
                    </SectionTitle>
                    <table className={TABLE_FIT}>
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

                  <div className={`${PANEL} overflow-hidden`}>
                    <SectionTitle
                      actions={
                        <span className={`${BADGE_NEUTRAL} ${CODE} max-w-full truncate`}>
                          /usr/local/bin/affinmail
                        </span>
                      }
                    >
                      CLI management
                    </SectionTitle>
                    <div className={`${CODE} space-y-0.5 overflow-x-auto border-t border-[#EEF1F5] bg-[#F8FAFC] p-4 dark:border-[#1B2740] dark:bg-[#0A0F1A]`}>
                      {['status', 'restart', 'update', 'backup', 'logs stalwart'].map((cmd) => (
                        <p key={cmd} className="whitespace-nowrap text-gray-700 dark:text-gray-300">
                          <span className="select-none text-gray-400">$ </span>
                          affinmail {cmd}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={`${PANEL} overflow-hidden`}>
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
                  <div className="max-h-80 space-y-0.5 overflow-y-auto overflow-x-hidden bg-[#F8FAFC] p-4 font-mono text-[12px] dark:bg-[#0A0F1A]">
                    {logsLoading && (
                      <div className="space-y-1.5">
                        <div className="h-3 w-full animate-pulse rounded-md bg-[#EEF1F5] dark:bg-white/5" />
                        <div className="h-3 w-5/6 animate-pulse rounded-md bg-[#EEF1F5] dark:bg-white/5" />
                        <div className="h-3 w-4/6 animate-pulse rounded-md bg-[#EEF1F5] dark:bg-white/5" />
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

      {/* ===================== MODAL: ADD VIRTUAL DOMAIN ===================== */}
      {showAddDomainModal && (
        <AdminModal
          title="Add virtual domain"
          description="A 2048-bit DKIM key is generated for the new domain."
          onClose={() => setShowAddDomainModal(false)}
        >
          <form
            className="space-y-4"
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

            <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
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
            className="space-y-4"
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

            <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
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
            className="space-y-4"
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
            <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
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
            className="space-y-4"
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
            <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
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
            className="space-y-4"
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
            <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
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

      {/* ===================== MODAL: ASSIGN DEDICATED IP (F-014) ===================== */}
      {assignModal && (
        <AdminModal
          title="Assign dedicated IP"
          description={`All outbound mail for ${assignModal.domain} will route through the chosen IP.`}
          onClose={() => setShowAssignModal(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAssignIp(assignModal.domain, assignModal.ip);
            }}
          >
            <div className="w-full">
              <label className={LABEL} htmlFor="assign-ip">
                Available IPs
              </label>
              <select
                id="assign-ip"
                value={assignModal.ip}
                onChange={(e) => setShowAssignModal({ ...assignModal, ip: e.target.value })}
                className={`${INPUT} font-mono`}
                autoFocus
              >
                <option value="">Select IP…</option>
                {ipDetails.map((i) => (
                  <option key={i.ip} value={i.ip}>
                    {i.ip} — {i.type}, {i.domains} domain(s){i.listedNow > 0 ? ' · LISTED' : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className={`text-[12px] ${MUTED}`}>
              Unassigned or shared IPs are listed. Assigning updates SPF guidance in the
              deliverability panel; the DKIM record stays unchanged.
            </p>
            <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
              <button type="button" onClick={() => setShowAssignModal(null)} className={btn('outline')}>
                Cancel
              </button>
              <button type="submit" disabled={!assignModal.ip} className={btn('primary')}>
                Assign IP
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* ===================== MODAL: rDNS (F-017) ===================== */}
      {rdnsEdit && (
        <AdminModal
          title="rDNS (PTR) record"
          description={rdnsEdit.ip}
          onClose={() => setRdnsEdit(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveRdns();
            }}
          >
            <div className="w-full">
              <label className={LABEL} htmlFor="rdns-host">PTR hostname</label>
              <input
                id="rdns-host"
                type="text"
                placeholder={`mail.${rdnsEdit.ip.split('.').slice(-2).join('.')}`}
                value={rdnsValue}
                onChange={(e) => setRdnsValue(e.target.value)}
                className={`${INPUT} font-mono`}
                autoFocus
              />
            </div>
            <div className="rounded-[10px] bg-[#F8FAFC] px-3.5 py-3 text-[12px] dark:bg-white/5">
              <p className={MUTED}>
                Stored PTR: <span className={`${CODE} text-[#101828] dark:text-[#E6EAF2]`}>{rdnsEdit.info.rdns || '—'}</span>
              </p>
              <p className={`mt-1 ${MUTED}`}>
                Forward-confirmed: {rdnsEdit.info.forwardConfirmed ? 'yes' : 'no'}
                {rdnsEdit.info.resolvedA && (
                  <> · A record: <span className={CODE}>{rdnsEdit.info.resolvedA}</span></>
                )}
              </p>
            </div>
            <p className={`text-[11.5px] ${MUTED}`}>
              Set the same PTR at your hosting provider first — no provider API is connected, so this
              panel records and validates it (PTR → A → IP) but cannot push it upstream.
            </p>
            <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
              <button type="button" onClick={() => setRdnsEdit(null)} className={btn('outline')}>
                Cancel
              </button>
              <button type="submit" className={btn('primary')}>
                Save & verify
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
                <div className="h-3 w-full animate-pulse rounded-md bg-[#EEF1F5] dark:bg-white/5" />
                <div className="h-3 w-5/6 animate-pulse rounded-md bg-[#EEF1F5] dark:bg-white/5" />
                <div className="h-3 w-4/6 animate-pulse rounded-md bg-[#EEF1F5] dark:bg-white/5" />
              </div>
            )}

            {!delivLoading && deliv && (
              <>
                <div className="overflow-x-auto rounded-xl border border-[#E4E7EC] dark:border-[#22304A]">
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

                <div className="rounded-xl border border-[#E4E7EC] dark:border-[#22304A]">
                  <div className="border-b border-[#EEF1F5] px-4 py-3 text-[11px] font-semibold tracking-[0.06em] text-[#98A2B3] dark:border-[#1B2740] dark:text-[#5B6B82]">
                    DKIM signing keys
                  </div>
                  <div className="space-y-2 p-5">
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

                <div className="rounded-xl border border-[#E4E7EC] dark:border-[#22304A]">
                  <div className="border-b border-[#EEF1F5] px-4 py-3 text-[11px] font-semibold tracking-[0.06em] text-[#98A2B3] dark:border-[#1B2740] dark:text-[#5B6B82]">
                    Catch-all address
                  </div>
                  <div className="space-y-2 p-5">
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

            <div className="flex items-center justify-end border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
              <button onClick={() => setSelectedDnsDomain(null)} className={btn('outline')}>
                Close
              </button>
            </div>
          </div>
        </AdminModal>
      )}
      {/* ===================== MODAL: REGISTER NODE (F-011) ===================== */}
      {showAddNodeModal && (
        <AdminModal
          title="Register server node"
          description="Adds a node to the fleet. Remote health requires an agent — not configured in this build."
          onClose={() => setShowAddNodeModal(false)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateNode();
            }}
          >
            <div className="w-full">
              <label className={LABEL} htmlFor="node-hostname">Hostname</label>
              <input
                id="node-hostname"
                type="text"
                placeholder="mta2.hostaffin.com"
                value={nodeHostname}
                onChange={(e) => setNodeHostname(e.target.value)}
                className={`${INPUT} font-mono`}
                autoFocus
              />
            </div>
            <div className="w-full">
              <label className={LABEL} htmlFor="node-ip">Primary IP</label>
              <input
                id="node-ip"
                type="text"
                placeholder="203.0.113.20"
                value={nodeIp}
                onChange={(e) => setNodeIp(e.target.value)}
                className={`${INPUT} font-mono`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor="node-location">Location tag</label>
                <input
                  id="node-location"
                  type="text"
                  placeholder="EU-West"
                  value={nodeLocation}
                  onChange={(e) => setNodeLocation(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="node-role">Role</label>
                <select
                  id="node-role"
                  value={nodeRole}
                  onChange={(e) => setNodeRole(e.target.value)}
                  className={INPUT}
                >
                  <option value="all-in-one">All-in-one</option>
                  <option value="mta-outbound">MTA-outbound</option>
                  <option value="mta-inbound">MTA-inbound</option>
                  <option value="imap">IMAP</option>
                  <option value="dns">DNS</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#EEF1F5] pt-4 dark:border-[#1B2740]">
              <button type="button" onClick={() => setShowAddNodeModal(false)} className={btn('outline')}>
                Cancel
              </button>
              <button type="submit" className={btn('primary')}>
                Register node
              </button>
            </div>
          </form>
        </AdminModal>
      )}
    </div>
  );
};
