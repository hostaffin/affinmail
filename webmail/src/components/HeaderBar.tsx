import React from 'react';
import { Search, Sun, Moon, ShieldCheck, Mail, Server, Menu } from 'lucide-react';
import { PlanQuota, UserProfile } from '../types';

interface HeaderBarProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  user: UserProfile;
  quota: PlanQuota;
  onSwitchToAdmin?: () => void;
  onToggleMobileNav?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  theme,
  onToggleTheme,
  searchQuery,
  onSearchChange,
  searchInputRef,
  user,
  quota,
  onSwitchToAdmin,
  onToggleMobileNav,
}) => {
  return (
    <header className="h-14 border-b border-base-300 bg-base-100 px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 select-none shrink-0">
      {/* Brand & Mobile Hamburger */}
      <div className="flex items-center gap-2.5 shrink-0">
        {onToggleMobileNav && (
          <button
            onClick={onToggleMobileNav}
            className="btn btn-ghost btn-circle btn-sm md:hidden text-base-content/70 hover:bg-base-200"
            title="Toggle Menu"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-4 h-4 stroke-[1.5]" />
          </button>
        )}
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-content shrink-0">
          <Mail className="w-4 h-4 stroke-[1.5]" />
        </div>
        <div className="hidden xs:block sm:block">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm tracking-tight text-base-content">AffinMail</span>
          </div>
          <span className="text-xs text-base-content/60 font-mono -mt-0.5 block tabular-nums">
            {user.domain}
          </span>
        </div>
      </div>

      {/* Global Search Input */}
      <div className="flex-1 max-w-xl relative min-w-0">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-4 h-4 stroke-[1.5] text-base-content/40" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search messages"
            className="input input-sm w-full pl-9 pr-8 h-9 bg-base-200 border border-base-300 focus:bg-base-100 focus:border-primary text-xs rounded-lg transition-colors"
          />
          <kbd className="absolute right-2.5 kbd kbd-xs bg-base-300 text-base-content/60 text-[10px] font-mono hidden sm:inline-flex px-1.5 py-0.5">
            /
          </kbd>
        </div>
      </div>

      {/* Right Actions: IP Badge, Theme Toggle & User Profile */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Egress IP Status Badge */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-base-200 text-xs border border-base-300 text-base-content/70 font-mono tabular-nums">
          <Server className="w-3.5 h-3.5 stroke-[1.5] text-base-content/60" />
          <span className="text-xs">
            {quota.isDedicatedIp ? `Dedicated: ${quota.assignedIp}` : 'Shared cluster IP'}
          </span>
          <ShieldCheck className="w-3.5 h-3.5 stroke-[1.5] text-success ml-0.5" />
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} mode`}
          className="btn btn-ghost btn-circle btn-sm text-base-content/70 hover:text-base-content hover:bg-base-200"
        >
          {theme === 'light' ? (
            <Moon className="w-4 h-4 stroke-[1.5]" />
          ) : (
            <Sun className="w-4 h-4 stroke-[1.5]" />
          )}
        </button>

        {/* User Profile Avatar & Dropdown */}
        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-circle avatar btn-sm">
            <div className="w-8 h-8 rounded-full bg-base-200 border border-base-300 text-base-content flex items-center justify-center font-medium text-xs">
              {user.displayName.charAt(0)}
            </div>
          </label>
          <ul
            tabIndex={0}
            className="menu menu-sm dropdown-content mt-2 z-[60] p-2 shadow-lg bg-base-100 rounded-lg w-64 border border-base-300"
          >
            <li className="menu-title px-2 py-1.5">
              <span className="text-xs font-semibold text-base-content">{user.displayName}</span>
              <span className="text-xs text-base-content/60 font-mono">{user.email}</span>
            </li>
            <div className="divider my-1"></div>
            <li className="px-1 py-1">
              <div className="flex flex-col gap-1 w-full bg-base-200 p-2.5 rounded-md">
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="text-base-content/70">Mailbox storage</span>
                  <span className="font-medium">{quota.usedFormatted} / {quota.limitFormatted}</span>
                </div>
                <progress
                  className="progress progress-primary w-full h-1"
                  value={quota.percent}
                  max="100"
                ></progress>
                <span className="text-[11px] text-base-content/50 tabular-nums">
                  Attachment limit: {quota.maxAttachmentSizeMb} MB
                </span>
              </div>
            </li>
            <div className="divider my-1"></div>
            {onSwitchToAdmin && (
              <li>
                <button
                  onClick={onSwitchToAdmin}
                  className="text-xs font-medium text-primary hover:bg-base-200 flex items-center justify-between"
                >
                  <span>Admin console</span>
                  <span className="text-[11px] font-mono text-base-content/50">:2087</span>
                </button>
              </li>
            )}
            <li>
              <a className="text-xs font-normal">Settings and filters</a>
            </li>
            <li>
              <a className="text-xs font-normal">DNS records and deliverability</a>
            </li>
            <li>
              <a className="text-xs text-error font-normal">Sign out</a>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
};

