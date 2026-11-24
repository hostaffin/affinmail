import React, { useEffect, useRef, useState } from 'react';
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
  CalendarDays,
  BookUser,
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
  quota: PlanQuota | null;
  onSwitchToAdmin?: () => void;
  onToggleSidebar?: () => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  onOpenCalendar?: () => void;
  onOpenContacts?: () => void;
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
  onLogout,
  onOpenSettings,
  onOpenCalendar,
  onOpenContacts,
}) => {
  const [showAppsMenu, setShowAppsMenu] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showSearchFilter, setShowSearchFilter] = useState(false);

  const accountMenuRef = useRef<HTMLDivElement>(null);
  const appsMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
      if (appsMenuRef.current && !appsMenuRef.current.contains(e.target as Node)) {
        setShowAppsMenu(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchFilter(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAccountMenu(false);
        setShowAppsMenu(false);
        setShowSearchFilter(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <header className="min-h-16 px-2 sm:px-4 pb-1 pt-[env(safe-area-inset-top)] bg-gmail-canvas dark:bg-gmail-dark-canvas flex items-center justify-between gap-1 sm:gap-4 select-none shrink-0 relative z-30">
      {/* 1. Brand & menu toggle */}
      <div className={`flex items-center gap-1 sm:gap-2 shrink-0 min-w-0 ${mobileSearch ? "max-sm:hidden" : ""}`}>
        <button
          onClick={onToggleSidebar}
          className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
          title="Main menu"
          aria-label="Main menu"
        >
          <Menu className="w-5 h-5 stroke-[1.5]" />
        </button>

        <div
          className="flex items-center cursor-pointer"
          onClick={() => window.location.reload()}
          title="AffinMail home"
        >
          {/* Mark alone on phones: the wordmark would push the account button off a 320px header */}
          <AffinMailLogo variant="icon" size="md" className="sm:hidden" />
          <AffinMailLogo variant="full" size="md" className="hidden sm:flex" />
        </div>
      </div>

      {/* 2. Search */}
      <div ref={searchRef} className={`flex-1 max-w-[720px] relative min-w-0 ${mobileSearch ? "" : "max-sm:hidden"}`}>
        <div
          className={`flex items-center h-12 px-3 rounded-lg border transition-colors duration-150 ${
            searchQuery.trim()
              ? 'bg-white dark:bg-gmail-dark-surface border-gmail-border dark:border-gmail-dark-border'
              : 'bg-gmail-search dark:bg-gmail-dark-search border-transparent hover:bg-gmail-search-hover dark:hover:bg-gmail-dark-search-hover focus-within:bg-white dark:focus-within:bg-gmail-dark-surface focus-within:border-gmail-border dark:focus-within:border-gmail-dark-border'
          }`}
        >
          <button
            onClick={() => searchInputRef.current?.focus()}
            className="h-10 w-10 min-h-10 sm:h-8 sm:w-8 sm:min-h-8 flex items-center justify-center shrink-0 rounded-md text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
            title="Search"
            aria-label="Search"
          >
            <Search className="w-5 h-5 stroke-[1.5]" />
          </button>

          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search mail"
            className="w-full mx-2 bg-transparent border-none outline-none text-[#1F1F1F] dark:text-[#E3E3E3] placeholder-[#5E5E5E] dark:placeholder-[#8E918F] text-sm"
          />

          {(searchQuery || mobileSearch) && (
            <button
              onClick={() => { if (searchQuery) onSearchChange(''); else setMobileSearch(false); }}
              className="h-10 w-10 min-h-10 sm:h-8 sm:w-8 sm:min-h-8 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 rounded-md shrink-0"
              title="Clear search"
            >
              <X className="w-4 h-4 stroke-[1.5]" />
            </button>
          )}

          <button
            onClick={() => setShowSearchFilter(!showSearchFilter)}
            className={`h-10 w-10 min-h-10 sm:h-8 sm:w-8 sm:min-h-8 flex items-center justify-center rounded-md shrink-0 transition-colors ${
              showSearchFilter
                ? 'bg-black/10 dark:bg-white/10 text-gmail-blue dark:text-gmail-dark-blue-text'
                : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            title="Search options"
          >
            <SlidersHorizontal className="w-4 h-4 stroke-[1.5]" />
          </button>
        </div>

        {/* Search filters */}
        {showSearchFilter && (
          <div className="absolute top-14 left-0 right-0 bg-white dark:bg-gmail-dark-surface border border-gmail-border dark:border-gmail-dark-border rounded-xl shadow-gmail-modal p-3 sm:p-4 z-50 text-xs space-y-3 max-h-[70dvh] overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[#444746] dark:text-[#C4C7C5] block mb-1">From</label>
                <input
                  type="text"
                  placeholder="Sender name or address"
                  className="input input-sm input-bordered w-full rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-[#444746] dark:text-[#C4C7C5] block mb-1">To</label>
                <input
                  type="text"
                  placeholder="Recipient"
                  className="input input-sm input-bordered w-full rounded-lg text-xs"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-[#444746] dark:text-[#C4C7C5] block mb-1">Subject</label>
              <input
                type="text"
                placeholder="Subject keywords"
                className="input input-sm input-bordered w-full rounded-lg text-xs"
              />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gmail-border dark:border-gmail-dark-border">
              <label className="flex items-center gap-2 cursor-pointer text-[#444746] dark:text-[#C4C7C5]">
                <input type="checkbox" className="checkbox checkbox-xs checkbox-primary rounded" />
                <span>Has attachment</span>
              </label>
              <button
                onClick={() => setShowSearchFilter(false)}
                className="btn btn-sm btn-primary px-4 rounded-lg font-medium text-xs normal-case"
              >
                Search
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Right controls */}
      <div className={`flex items-center gap-0.5 sm:gap-1 shrink-0 ${mobileSearch ? 'max-sm:hidden' : ''}`}>
        <button
          onClick={() => setMobileSearch(true)}
          className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 sm:hidden"
          title="Search"
          aria-label="Search"
        >
          <Search className="w-5 h-5 stroke-[1.5]" />
        </button>

        <button
          className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 hidden sm:inline-flex"
          title="Support and help"
        >
          <HelpCircle className="w-5 h-5 stroke-[1.5]" />
        </button>

        <button
          onClick={onOpenSettings}
          className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5 stroke-[1.5]" />
        </button>

        {/* Workspace launcher: the sidebar already carries Calendar, Contacts and Admin on phones */}
        <div ref={appsMenuRef} className="relative hidden sm:block">
          <button
            onClick={() => {
              setShowAppsMenu(!showAppsMenu);
              setShowAccountMenu(false);
            }}
            className={`btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 hover:bg-black/5 dark:hover:bg-white/10 ${
              showAppsMenu ? 'bg-black/10 dark:bg-white/10 text-gmail-blue dark:text-gmail-dark-blue-text' : 'text-[#444746] dark:text-[#C4C7C5]'
            }`}
            title="Workspace and tools"
            aria-label="Workspace"
          >
            <Grid className="w-5 h-5 stroke-[1.5]" />
          </button>

          {showAppsMenu && (
            <div className="absolute right-0 top-12 w-80 max-w-[calc(100vw-1rem)] bg-white dark:bg-gmail-dark-surface border border-gmail-border dark:border-gmail-dark-border rounded-xl shadow-gmail-modal p-2 z-50">
              <div className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5] px-2 py-1.5">
                Workspace
              </div>
              <div className="grid grid-cols-3 gap-1 text-center">
                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <Mail className="w-5 h-5 stroke-[1.5]" />
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Mail</span>
                </button>

                <button
                  onClick={() => {
                    setShowAppsMenu(false);
                    onOpenCalendar?.();
                  }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <CalendarDays className="w-5 h-5 stroke-[1.5]" />
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Calendar</span>
                </button>

                <button
                  onClick={() => {
                    setShowAppsMenu(false);
                    onOpenContacts?.();
                  }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <BookUser className="w-5 h-5 stroke-[1.5]" />
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Contacts</span>
                </button>

                {onSwitchToAdmin && (
                  <button
                    onClick={() => {
                      setShowAppsMenu(false);
                      onSwitchToAdmin();
                    }}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    <Server className="w-5 h-5 stroke-[1.5]" />
                    <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Admin</span>
                  </button>
                )}

                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <HardDrive className="w-5 h-5 stroke-[1.5]" />
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Storage</span>
                </button>

                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <ShieldCheck className="w-5 h-5 stroke-[1.5]" />
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">DKIM and SPF</span>
                </button>

                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <Layers className="w-5 h-5 stroke-[1.5]" />
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">IP pools</span>
                </button>

                <button
                  onClick={() => setShowAppsMenu(false)}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                  <Database className="w-5 h-5 stroke-[1.5]" />
                  <span className="text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Backups</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 hidden sm:inline-flex"
        >
          {theme === 'light' ? (
            <Moon className="w-5 h-5 stroke-[1.5]" />
          ) : (
            <Sun className="w-5 h-5 stroke-[1.5]" />
          )}
        </button>

        {/* Account */}
        <div ref={accountMenuRef} className="relative ml-0.5 sm:ml-1 shrink-0">
          <button
            onClick={() => {
              setShowAccountMenu(!showAccountMenu);
              setShowAppsMenu(false);
            }}
            className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Account"
          >
            <span className="w-8 h-8 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] text-white dark:text-[#042B5C] flex items-center justify-center font-medium text-sm hover:ring-4 hover:ring-black/10 dark:hover:ring-white/10 transition-[box-shadow]">
              {user.displayName.charAt(0).toUpperCase()}
            </span>
          </button>

          {showAccountMenu && (
            <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1rem)] bg-white dark:bg-gmail-dark-surface border border-gmail-border dark:border-gmail-dark-border rounded-xl shadow-gmail-modal p-4 z-50 text-center">
              <div className="text-xs text-[#444746] dark:text-[#C4C7C5] mb-3 truncate">
                {user.email}
              </div>

              <div className="w-16 h-16 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] text-white dark:text-[#042B5C] text-2xl font-medium flex items-center justify-center mx-auto mb-3">
                {user.displayName.charAt(0).toUpperCase()}
              </div>

              <div className="text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                {user.displayName}
              </div>

              <button
                onClick={() => {
                  setShowAccountMenu(false);
                  onOpenSettings?.();
                }}
                className="mt-3 w-full h-9 px-3 rounded-lg border border-gmail-border dark:border-gmail-dark-border text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center justify-center gap-1.5"
              >
                Manage your AffinMail account
              </button>

              {/* Theme lives here on phones: the header has no room for it */}
              <button
                onClick={() => {
                  onToggleTheme();
                  setShowAccountMenu(false);
                }}
                className="w-full h-9 px-3 rounded-lg text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center gap-1.5 transition-colors sm:hidden"
              >
                {theme === 'light' ? (
                  <Moon className="w-4 h-4 stroke-[1.5]" />
                ) : (
                  <Sun className="w-4 h-4 stroke-[1.5]" />
                )}
                <span>Switch to {theme === 'light' ? 'dark' : 'light'} mode</span>
              </button>

              {quota && (
                <div className="mt-4 p-3 bg-gmail-canvas dark:bg-gmail-dark-canvas rounded-lg text-left border border-gmail-border dark:border-gmail-dark-border space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#444746] dark:text-[#C4C7C5]">Storage used</span>
                    <span className="font-medium tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]">{quota.usedFormatted} of {quota.limitFormatted}</span>
                  </div>
                  <progress
                    className="progress progress-primary w-full h-1.5 bg-[#E0E2E7] dark:bg-[#333538]"
                    value={quota.percent}
                    max="100"
                  ></progress>
                  {quota.assignedIp && (
                    <div className="flex justify-between items-center text-xs text-[#444746] dark:text-[#C4C7C5]">
                      <span>Dedicated IP</span>
                      <span className="font-mono tabular-nums font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                        {quota.assignedIp}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-2 pt-2 border-t border-gmail-border dark:border-gmail-dark-border">
                <button
                  onClick={() => {
                    setShowAccountMenu(false);
                    onLogout?.();
                  }}
                  className="w-full h-9 px-3 rounded-lg text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 dark:hover:text-red-400 flex items-center justify-center gap-1.5"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
