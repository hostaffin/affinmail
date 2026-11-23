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
    <header className="h-16 border-b border-base-300 bg-base-100 px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 select-none shrink-0">
      {/* Brand & Mobile Hamburger */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {onToggleMobileNav && (
          <button
            onClick={onToggleMobileNav}
            className="btn btn-ghost btn-circle btn-sm md:hidden text-base-content/70 hover:bg-base-200"
            title="Toggle Menu"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary flex items-center justify-center text-white shadow-md shadow-primary/30 shrink-0">
          <Mail className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
        </div>
        <div className="hidden xs:block sm:block">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-base sm:text-lg tracking-tight text-base-content">AffinMail</span>
            <span className="badge badge-xs badge-primary font-semibold hidden sm:inline-flex">CORE</span>
          </div>
          <span className="text-[11px] text-base-content/60 font-medium hidden sm:block -mt-0.5">
            Rust Engine • {user.domain}
          </span>
        </div>
      </div>

      {/* Global Search Input */}
      <div className="flex-1 max-w-2xl relative min-w-0">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-4 h-4 text-base-content/40" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search mail (Press '/' to focus)..."
            className="input input-bordered w-full pl-9 pr-3 sm:pr-10 h-9 sm:h-10 bg-base-200/70 border-base-300 focus:bg-base-100 focus:border-primary text-xs sm:text-sm rounded-lg"
          />
          <kbd className="absolute right-3 kbd kbd-xs bg-base-300 text-base-content/60 text-[10px] font-mono hidden sm:inline-flex">
            /
          </kbd>
        </div>
      </div>

      {/* Right Actions: IP Badge, Theme Toggle & User Profile */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Egress IP Status Badge */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-base-200 text-xs border border-base-300 text-base-content/70">
          <Server className="w-3.5 h-3.5 text-accent" />
          <span className="font-mono text-[11px]">
            {quota.isDedicatedIp ? `Dedicated: ${quota.assignedIp}` : 'Shared Cluster IP'}
          </span>
          <ShieldCheck className="w-3.5 h-3.5 text-success ml-0.5" />
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
          className="btn btn-ghost btn-circle btn-sm text-base-content/70 hover:text-primary hover:bg-base-200"
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-warning" />}
        </button>

        {/* User Profile Avatar & Dropdown */}
        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-circle avatar btn-sm">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs ring-1 ring-primary/40">
              {user.displayName.charAt(0)}
            </div>
          </label>
          <ul
            tabIndex={0}
            className="menu menu-sm dropdown-content mt-3 z-[60] p-3 shadow-xl bg-base-100 rounded-box w-64 border border-base-300"
          >
            <li className="menu-title px-1 py-1">
              <span className="text-xs font-bold text-base-content">{user.displayName}</span>
              <span className="text-[11px] text-base-content/60 font-mono">{user.email}</span>
            </li>
            <div className="divider my-1"></div>
            <li className="px-1 py-1">
              <div className="flex flex-col gap-1 w-full bg-base-200/50 p-2 rounded-lg">
                <div className="flex justify-between text-xs">
                  <span className="text-base-content/70">Mailbox Storage</span>
                  <span className="font-semibold">{quota.usedFormatted} / {quota.limitFormatted}</span>
                </div>
                <progress
                  className="progress progress-primary w-full h-1.5"
                  value={quota.percent}
                  max="100"
                ></progress>
                <span className="text-[10px] text-base-content/50">
                  Plan Attachment Limit: {quota.maxAttachmentSizeMb} MB
                </span>
              </div>
            </li>
            <div className="divider my-1"></div>
            {onSwitchToAdmin && (
              <li>
                <button
                  onClick={onSwitchToAdmin}
                  className="text-xs font-semibold text-primary hover:bg-primary/10 flex items-center justify-between"
                >
                  <span>WHM Admin Console</span>
                  <span className="badge badge-xs badge-warning font-mono">:2087</span>
                </button>
              </li>
            )}
            <li>
              <a className="text-xs font-medium">Settings & Sieve Filters</a>
            </li>
            <li>
              <a className="text-xs font-medium">DNS Records & Deliverability</a>
            </li>
            <li>
              <a className="text-xs text-error font-medium">Sign Out</a>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
};
