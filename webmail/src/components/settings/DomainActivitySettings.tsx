import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  MailCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../../lib/adminApi';

interface DayStat {
  day: string;
  sent: number;
  received: number;
  delivered: number;
  failed: number;
  deferred: number;
  spam: number;
}

interface DomainStats {
  domain: string;
  days: DayStat[];
  totals: {
    sent: number;
    received: number;
    delivered: number;
    failed: number;
    deferred: number;
    spam: number;
    rate: number | null;
  };
  mailboxes: number;
  storageBytes: number;
  storageQuotaBytes: number;
  reputation: { score: number; blacklisted: boolean } | null;
}

interface DomainActivitySettingsProps {
  userEmail: string;
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function dayLabel(day: string): string {
  // day is YYYY-MM-DD; render as e.g. "24 Nov" without timezone surprises.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parts = day.split('-').map(Number);
  if (parts.length !== 3) return day;
  return `${parts[2]} ${months[(parts[1] - 1 + 12) % 12]}`;
}

export const DomainActivitySettings: React.FC<DomainActivitySettingsProps> = ({
  userEmail,
  onNotify,
}) => {
  const domain = userEmail.includes('@') ? userEmail.split('@')[1] : '';
  const [stats, setStats] = useState<DomainStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!domain) return;
    setLoading(true);
    try {
      const data = await apiFetch<DomainStats>(
        `/client/domains/${encodeURIComponent(domain)}/stats`
      );
      setStats(data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    void load();
  }, [load]);

  const card =
    'rounded-xl border border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] p-4';
  const label = 'text-xs text-[#5E5E5E] dark:text-[#8E918F]';
  const value = 'mt-1 text-2xl font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] tabular-nums';

  const maxBar = Math.max(
    1,
    ...(stats?.days.map((d) => Math.max(d.sent, d.received)) ?? [1])
  );
  const chartW = 560;
  const chartH = 140;
  const slot = chartW / Math.max(1, stats?.days.length ?? 1);
  const barW = Math.min(16, slot / 4);

  return (
    <div className="max-w-3xl w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            Domain activity
          </h3>
          <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            How mail is flowing for <span className="font-medium">{domain}</span> — sent,
            delivered, received and blocked, sampled from the mail server every 5 minutes.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] text-xs font-medium text-[#444746] dark:text-[#C4C7C5]"
        >
          <RefreshCw className={`w-3.5 h-3.5 stroke-[1.5] ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {failed && (
        <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          Activity data could not be loaded right now. The mail service keeps collecting it —
          try Refresh in a little while.
        </div>
      )}

      {loading && !stats && (
        <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">Loading activity…</p>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className={card}>
              <div className="flex items-center gap-1.5">
                <ArrowUpFromLine className="w-3.5 h-3.5 stroke-[1.5] text-[#0B57D0]" />
                <span className={label}>Sent · 7 days</span>
              </div>
              <div className={value}>{stats.totals.sent}</div>
            </div>
            <div className={card}>
              <div className="flex items-center gap-1.5">
                <MailCheck className="w-3.5 h-3.5 stroke-[1.5] text-[#137333]" />
                <span className={label}>Delivered</span>
              </div>
              <div className={value}>{stats.totals.delivered}</div>
              <div className={label}>
                {stats.totals.rate !== null
                  ? `${stats.totals.rate}% delivery rate`
                  : 'No outbound deliveries yet'}
                {stats.totals.failed > 0 ? ` · ${stats.totals.failed} failed` : ''}
              </div>
            </div>
            <div className={card}>
              <div className="flex items-center gap-1.5">
                <ArrowDownToLine className="w-3.5 h-3.5 stroke-[1.5] text-[#0B57D0]" />
                <span className={label}>Received · 7 days</span>
              </div>
              <div className={value}>{stats.totals.received}</div>
            </div>
            <div className={card}>
              <div className="flex items-center gap-1.5">
                <Ban className="w-3.5 h-3.5 stroke-[1.5] text-[#B3261E]" />
                <span className={label}>Spam blocked</span>
              </div>
              <div className={value}>{stats.totals.spam}</div>
            </div>
          </div>

          <div className={card}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                Mail flow — last 7 days
              </h4>
              <div className="flex items-center gap-3 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-[#0B57D0]" /> Sent
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm bg-[#34A853]" /> Received
                </span>
              </div>
            </div>
            {stats.totals.sent + stats.totals.received === 0 ? (
              <p className="mt-6 mb-2 text-center text-xs text-[#5E5E5E] dark:text-[#8E918F]">
                No mail recorded for this domain in the last 7 days yet. New activity appears
                here within a few minutes of sending or receiving.
              </p>
            ) : (
              <svg
                viewBox={`0 0 ${chartW} ${chartH + 22}`}
                className="mt-3 w-full"
                role="img"
                aria-label="Sent and received mail per day"
              >
                {stats.days.map((d, i) => {
                  const x0 = i * slot + slot / 2;
                  const sentH = (d.sent / maxBar) * chartH;
                  const recvH = (d.received / maxBar) * chartH;
                  return (
                    <g key={d.day}>
                      <rect
                        x={x0 - barW - 1}
                        y={chartH - sentH}
                        width={barW}
                        height={sentH}
                        rx={2}
                        className="fill-[#0B57D0]"
                      />
                      <rect
                        x={x0 + 1}
                        y={chartH - recvH}
                        width={barW}
                        height={recvH}
                        rx={2}
                        className="fill-[#34A853]"
                      />
                      <text
                        x={x0}
                        y={chartH + 15}
                        textAnchor="middle"
                        fontSize={10}
                        className="fill-[#5E5E5E] dark:fill-[#8E918F]"
                      >
                        {dayLabel(d.day)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
            <div className="mt-2 divide-y divide-[#F2F4F7] dark:divide-[#333538]">
              {[...stats.days].reverse().map((d) => (
                <div
                  key={d.day}
                  className="flex items-center justify-between py-1.5 text-xs text-[#444746] dark:text-[#C4C7C5] tabular-nums"
                >
                  <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                    {dayLabel(d.day)}
                  </span>
                  <span>
                    Sent {d.sent} · Delivered {d.delivered} · Failed {d.failed} · Received{' '}
                    {d.received} · Spam {d.spam}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={card}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#444746] dark:text-[#C4C7C5]">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 stroke-[1.5]" />
                {stats.mailboxes} mailbox{stats.mailboxes === 1 ? '' : 'es'} on this domain
              </span>
              <span>
                Storage {fmtBytes(stats.storageBytes)}
                {stats.storageQuotaBytes > 0
                  ? ` of ${fmtBytes(stats.storageQuotaBytes)}`
                  : ''}
              </span>
              {stats.reputation &&
                (stats.reputation.blacklisted ? (
                  <span className="flex items-center gap-1.5 text-[#B3261E] dark:text-[#F28B82]">
                    <ShieldAlert className="w-3.5 h-3.5 stroke-[1.5]" />
                    Sending IP is on a blocklist — contact support
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[#137333] dark:text-[#81C995]">
                    <ShieldCheck className="w-3.5 h-3.5 stroke-[1.5]" />
                    Sending IP reputation {stats.reputation.score.toFixed(1)} / 99.9 — not listed
                  </span>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
