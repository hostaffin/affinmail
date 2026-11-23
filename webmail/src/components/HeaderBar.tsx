import React, { useState } from 'react';
import {
  Search,
  Sun,
  Moon,
  ShieldCheck,
  Menu,
  SlidersHorizontal,
  HelpCircle,
  Settings,
  Grid,
  X,
  Server,
  HardDrive,
  ExternalLink,
  Layers,
  Key,
  Database,
  CheckCircle,
  Mail,
} from 'lucide-react';
import { PlanQuota, UserProfile } from '../types';
import { AffinMailLogo } from './AffinMailLogo';

interface HeaderBarProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  user: UserProfile;
  quota: PlanQuota;
  onSwitchToAdmin?: () => void;
  onToggleSidebar?: () => void;
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
  onToggleSidebar,
}) => {
  const [showAppsMenu, setShowAppsMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showSearchFilter, setShowSearchFilter] = useState(false);

  return (
    <header className="h-16 px-4 bg-gmail-canvas dark:bg-gmail-dark-canvas flex items-center justify-between gap-4 select-none shrink-0 relative z-30">
      {/* 1. Brand & Hamburger Toggle */}
      <div className="flex items-center gap-3 shrink-0 min-w-[230px]">
        <button
          onClick={onToggleSidebar}
          className="btn btn-ghost btn-circle btn-sm text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
          title="Main menu"
          aria-label="Main menu"
        >
          <Menu className="w-5 h-5 stroke-[2]" />
        </button>

        <div
          className="flex items-center cursor-pointer hover:opacity-95 transition-opacity"
          onClick={() => window.location.reload()}
          title="AffinMail Home"
        >
          <AffinMailLogo variant="full" size="md" />
        </div>
      </div>

      {/* 2. Gmail Iconic Pill Search Bar */}
      <div className="flex-1 max-w-[720px] relative min-w-0">
        <div
          className={`flex items-center h-12 px-3.5 rounded-full transition-all duration-150 ${
            searchQuery.trim()
              ? 'bg-white dark:bg-gmail-dark-surface shadow-gmail-search'
              : 'bg-gmail-search dark:bg-gmail-dark-search hover:bg-gmail-search-hover dark:hover:bg-gmail-dark-search-hover hover:shadow-sm focus-within:bg-white dark:focus-within:bg-gmail-dark-surface focus-within:shadow-gmail-search'
          }`}
        >
          <button
            onClick={() => searchInputRef.current?.focus()}
            className="p-1 rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
            title="Search"
            aria-label="Search"
          >
            <Search className="w-5 h-5 stroke-[2]" />
          </button>

          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search mail"
            className="w-full mx-2 bg-transparent border-none outline-none text-[#1F1F1F] dark:text-[#E3E3E3] placeholder-[#444746]/70 dark:placeholder-[#C4C7C5]/70 text-[15px]"
          />

          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="p-1 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 rounded-full shrink-0 mr-1"
              title="Clear search"
            >
              <X className="w-4 h-4 stroke-[2]" />
            </button>
          )}

          <button
            onClick={() => setShowSearchFilter(!showSearchFilter)}
            className={`p-1.5 rounded-full shrink-0 transition-colors ${
              showSearchFilter
                ? 'bg-black/10 dark:bg-white/10 text-gmail-blue'
                : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            title="Show search options"
          >
            <SlidersHorizontal className="w-4 h-4 stroke-[2]" />
          </button>
        </div>

        {/* Filter Tune Dropdown */}
        {showSearchFilter && (
          <div className="absolute top-14 left-0 right-0 bg-white dark:bg-gmail-dark-surface border border-gmail-border dark:border-gmail-dark-border rounded-2xl shadow-gmail-modal p-4 z-50 text-xs space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-[#444746] dark:text-[#C4C7C5] block mb-1">From</label>
                <input
                  type="text"
                  placeholder="Sender name or email"
                  className="input input-sm input-bordered w-full rounded-md text-xs"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#444746] dark:text-[#C4C7C5] block mb-1">To</label>
                <input
                  type="text"
                  placeholder="Recipient"
                  className="input input-sm input-bordered w-full rounded-md text-xs"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-[#444746] dark:text-[#C4C7C5] block mb-1">Subject</label>
              <input
                type="text"
                placeholder="Subject keywords"
                className="input input-sm input-bordered w-full rounded-md text-xs"
              />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gmail-border dark:border-gmail-dark-border">
              <label className="flex items-center gap-2 cursor-pointer text-[#444746] dark:text-[#C4C7C5]">
                <input type="checkbox" className="checkbox checkbox-xs checkbox-primary rounded" />
                <span>Has attachment</span>
              </label>
              <button
                onClick={() => setShowSearchFilter(false)}
                className="btn btn-sm btn-primary px-4 rounded-full font-medium text-xs normal-case"
              >
                Search
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Right Icons (Support, Settings, Google Apps Launcher, Theme, Avatar) */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Support Icon */}
        <button
          className="btn btn-ghost btn-circle btn-sm text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 hidden sm:inline-flex"
          title="Support and help"
        >
          <HelpCircle className="w-5 h-5 stroke-[1.8]" />
        </button>

        {/* Settings Icon */}
        <button
          className="btn btn-ghost btn-circle btn-sm text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
          title="Settings"
        >
          <Settings className="w-5 h-5 stroke-[1.8]" />
        </button>

        {/* Google Apps 9-Dot Launcher Button */}
        <div className="relative">
          <button
            onClick={() => {
              setShowAppsMenu(!showAppsMenu);
              setShowAccountMenu(false);
            }}
            className={`btn btn-ghost btn-circle btn-sm hover:bg-black/5 dark:hover:bg-white/10 ${
              showAppsMenu ? 'bg-black/10 dark:bg-white/10 text-gmail-blue' : 'text-[#444746] dark:text-[#C4C7C5]'
            }`}
            title="AffinMail Workspace & Tools"
            aria-label="AffinMail Workspace"
          >
            <Grid className="w-5 h-5 stroke-[2]" />
          </button>

          {/* Apps Dropdown Launcher Modal */}
          {showAppsMenu && (
            <div className="absolute right-0 top-12 w-80 bg-white dark:bg-gmail-dark-surface border border-gmail-border dark:border-gmail-dark-border rounded-2xl shadow-gmail-modal p-4 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="text-xs font-semibold text-[#444746] dark:text-[#C4C7C5] mb-3 px-1">
                AffinMail Cloud Workspace
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-gmail-blue flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                    <Mail className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Mail</span>
                </button>

                {onSwitchToAdmin && (
                  <button
                    onClick={() => {
                      setShowAppsMenu(false);
                      onSwitchToAdmin();
                    }}
                    className="flex flex-col items-center p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                      <Server className="w-5 h-5" />
                    </div>
                    <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Admin :2087</span>
                  </button>
                )}

                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-600 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Storage Box</span>
                </button>

                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">DKIM/SPF</span>
                </button>

                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                    <Layers className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">IP Pools</span>
                </button>

                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center p-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
                    <Database className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Backups</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle (Day / Night) */}
        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} mode`}
          className="btn btn-ghost btn-circle btn-sm text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
        >
          {theme === 'light' ? (
            <Moon className="w-5 h-5 stroke-[1.8]" />
          ) : (
            <Sun className="w-5 h-5 stroke-[1.8] text-amber-400" />
          )}
        </button>

        {/* 4. Google Account Profile Avatar */}
        <div className="relative ml-1">
          <button
            onClick={() => {
              setShowAccountMenu(!showAccountMenu);
              setShowAppsMenu(false);
            }}
            className="w-8 h-8 rounded-full bg-[#0B57D0] text-white flex items-center justify-center font-medium text-sm hover:ring-4 hover:ring-black/10 dark:hover:ring-white/10 transition-all cursor-pointer"
            aria-label="AffinMail Account"
          >
            {user.displayName.charAt(0)}
          </button>

          {/* AffinMail Account Dialog */}
          {showAccountMenu && (
            <div className="absolute right-0 top-11 w-84 bg-white dark:bg-gmail-dark-surface border border-gmail-border dark:border-gmail-dark-border rounded-3xl shadow-gmail-modal p-5 z-50 text-center animate-in fade-in zoom-in-95 duration-100">
              <div className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-2">
                {user.email}
              </div>

              {/* Avatar Large */}
              <div className="w-16 h-16 rounded-full bg-[#0B57D0] text-white text-2xl font-normal flex items-center justify-center mx-auto mb-2 shadow-sm">
                {user.displayName.charAt(0)}
              </div>

              <div className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                Hi, {user.displayName}!
              </div>

              {/* Manage Account Pill Button */}
              <button className="mt-3 px-4 py-1.5 rounded-full border border-gmail-border dark:border-gmail-dark-border text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                Manage your AffinMail Account
              </button>

              {/* Storage Info Card */}
              <div className="mt-4 p-3.5 bg-gmail-canvas dark:bg-gmail-dark-canvas rounded-2xl text-left border border-gmail-border dark:border-gmail-dark-border space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#444746] dark:text-[#C4C7C5]">Storage used</span>
                  <span className="font-medium tabular-nums">{quota.usedFormatted} of {quota.limitFormatted}</span>
                </div>
                <progress
                  className="progress progress-primary w-full h-1.5 bg-gray-200 dark:bg-gray-700"
                  value={quota.percent}
                  max="100"
                ></progress>
                <div className="flex justify-between items-center text-[11px] text-[#444746] dark:text-[#C4C7C5]">
                  <span>Dedicated IP:</span>
                  <span className="font-mono tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                    {quota.assignedIp}
                  </span>
                </div>
              </div>

              {/* Admin console link */}
              {onSwitchToAdmin && (
                <button
                  onClick={() => {
                    setShowAccountMenu(false);
                    onSwitchToAdmin();
                  }}
                  className="w-full mt-3 py-2 px-3 rounded-xl text-xs font-medium text-gmail-blue hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Server className="w-4 h-4" />
                  <span>Open Admin Panel (:2087)</span>
                </button>
              )}

              {/* Sign out */}
              <div className="mt-3 pt-3 border-t border-gmail-border dark:border-gmail-dark-border">
                <button className="text-xs text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 font-medium py-1">
                  Sign out of all accounts
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};


