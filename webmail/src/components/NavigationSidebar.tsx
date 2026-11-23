import React, { useState } from 'react';
import {
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  AlertOctagon,
  Trash2,
  Plus,
  Pencil,
  Tag,
  HardDrive,
  Cpu,
  X,
  Mail,
  Clock,
  ChevronDown,
  ChevronUp,
  Bookmark,
  Calendar,
  CalendarDays,
  Users,
} from 'lucide-react';
import { MailboxFolderId, PlanQuota } from '../types';

interface NavigationSidebarProps {
  currentFolder: MailboxFolderId;
  onSelectFolder: (folder: MailboxFolderId) => void;
  selectedLabel: string | null;
  onSelectLabel: (label: string | null) => void;
  onOpenCompose: () => void;
  unreadCount: number;
  draftCount?: number;
  quota: PlanQuota | null;
  isCollapsed?: boolean;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  onOpenCalendar?: () => void;
  onOpenContacts?: () => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  currentFolder,
  onSelectFolder,
  selectedLabel,
  onSelectLabel,
  onOpenCompose,
  unreadCount,
  draftCount,
  quota,
  isCollapsed = false,
  isOpenMobile = false,
  onCloseMobile,
  onOpenCalendar,
  onOpenContacts,
}) => {
  const [isMoreExpanded, setIsMoreExpanded] = useState(false);

  const primaryFolders = [
    { id: 'inbox' as MailboxFolderId, name: 'Inbox', icon: Inbox, count: unreadCount },
    { id: 'starred' as MailboxFolderId, name: 'Starred', icon: Star },
    { id: 'snoozed' as MailboxFolderId, name: 'Snoozed', icon: Clock },
    { id: 'sent' as MailboxFolderId, name: 'Sent', icon: Send },
    { id: 'drafts' as MailboxFolderId, name: 'Drafts', icon: FileText, count: draftCount },
  ];

  const moreFolders = [
    { id: 'important' as MailboxFolderId, name: 'Important', icon: Bookmark },
    { id: 'scheduled' as MailboxFolderId, name: 'Scheduled', icon: Calendar },
    { id: 'archive' as MailboxFolderId, name: 'All Mail', icon: Mail },
    { id: 'spam' as MailboxFolderId, name: 'Spam', icon: AlertOctagon },
    { id: 'trash' as MailboxFolderId, name: 'Trash', icon: Trash2 },
  ];

  const labels = [
    { name: 'VIP', color: '#F59E0B' },
    { name: 'Billing', color: '#3B82F6' },
    { name: 'Security', color: '#EF4444' },
    { name: 'Operations', color: '#10B981' },
  ];

  const renderFolderButton = (folder: { id: MailboxFolderId; name: string; icon: React.ComponentType<{ className?: string }>; count?: number }, isMini = false) => {
    const Icon = folder.icon;
    const isActive = currentFolder === folder.id && selectedLabel === null;

    if (isMini) {
      return (
        <button
          key={folder.id}
          onClick={() => {
            onSelectFolder(folder.id);
            onSelectLabel(null);
          }}
          className={`w-12 h-10 rounded-full mx-auto flex items-center justify-center relative transition-colors group ${
            isActive
              ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF]'
              : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10'
          }`}
          title={`${folder.name}${folder.count ? ` (${folder.count})` : ''}`}
        >
          <Icon className="w-5 h-5 stroke-[2]" />
          {folder.count !== undefined && folder.count > 0 && (
            <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-gmail-blue"></span>
          )}
        </button>
      );
    }

    return (
      <button
        key={folder.id}
        onClick={() => {
          onSelectFolder(folder.id);
          onSelectLabel(null);
          if (isOpenMobile) onCloseMobile?.();
        }}
        className={`w-full flex items-center justify-between pl-6 pr-4 h-8 rounded-r-full text-sm transition-colors ${
          isActive
            ? 'bg-[#D3E3FD] dark:bg-[#004A77] font-semibold text-[#001D35] dark:text-[#C2E7FF]'
            : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 font-normal'
        }`}
      >
        <div className="flex items-center gap-4">
          <Icon className={`w-5 h-5 stroke-[2] ${isActive ? 'text-[#001D35] dark:text-[#C2E7FF]' : 'text-[#444746] dark:text-[#C4C7C5]'}`} />
          <span className="truncate">{folder.name}</span>
        </div>
        {folder.count !== undefined && folder.count > 0 && (
          <span className={`text-xs tabular-nums font-semibold ${isActive ? 'text-[#001D35] dark:text-[#C2E7FF]' : 'text-[#444746] dark:text-[#C4C7C5]'}`}>
            {folder.count}
          </span>
        )}
      </button>
    );
  };

  const renderContent = (isMini = false) => (
    <div className="flex flex-col justify-between h-full py-2">
      <div className="flex flex-col">
        {/* Mobile Header Close */}
        {isOpenMobile && (
          <div className="flex items-center justify-between pb-3 px-4 mb-2 border-b border-gmail-border dark:border-gmail-dark-border">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-gmail-blue" />
              <span className="font-semibold text-sm text-[#1F1F1F] dark:text-[#E3E3E3]">Mailbox</span>
            </div>
            <button
              onClick={onCloseMobile}
              className="btn btn-ghost btn-circle btn-xs text-[#444746] dark:text-[#C4C7C5]"
              title="Close"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4 stroke-[2]" />
            </button>
          </div>
        )}

        {/* 1. Iconic Gmail Compose Pill Button */}
        <div className={`mb-4 ${isMini ? 'px-2 flex justify-center' : 'px-4'}`}>
          {isMini ? (
            <button
              onClick={onOpenCompose}
              className="w-14 h-14 rounded-2xl bg-gmail-blue-light dark:bg-gmail-dark-blue-light text-[#001D35] dark:text-gmail-dark-blue-text shadow-gmail-compose hover:shadow-gmail-compose-hover flex items-center justify-center transition-all cursor-pointer"
              title="Compose"
              aria-label="Compose"
            >
              <Pencil className="w-6 h-6 stroke-[2]" />
            </button>
          ) : (
            <button
              onClick={() => {
                onOpenCompose();
                if (isOpenMobile) onCloseMobile?.();
              }}
              className="h-14 px-6 rounded-2xl bg-gmail-blue-light dark:bg-gmail-dark-blue-light text-[#001D35] dark:text-gmail-dark-blue-text shadow-gmail-compose hover:shadow-gmail-compose-hover flex items-center justify-between gap-3 text-sm font-medium tracking-[0.1px] transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <Pencil className="w-5 h-5 stroke-[2] text-[#001D35] dark:text-gmail-dark-blue-text" />
                <span className="font-medium text-[15px]">Compose</span>
              </div>
              <kbd className="kbd kbd-xs bg-black/10 dark:bg-white/10 text-[#001D35] dark:text-gmail-dark-blue-text font-mono text-[10px] border-none px-1.5 py-0.5">
                c
              </kbd>
            </button>
          )}
        </div>

        {/* 2. Folders Navigation */}
        <nav className="flex flex-col gap-0.5 pr-3">
          {primaryFolders.map((f) => renderFolderButton(f, isMini))}

          {/* More Expandable Section */}
          {!isMini && (
            <>
              {isMoreExpanded && moreFolders.map((f) => renderFolderButton(f, false))}

              <button
                onClick={() => setIsMoreExpanded(!isMoreExpanded)}
                className="w-full flex items-center gap-4 pl-6 pr-4 h-8 rounded-r-full text-sm text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 font-normal transition-colors"
              >
                {isMoreExpanded ? (
                  <>
                    <ChevronUp className="w-5 h-5 stroke-[2]" />
                    <span>Less</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-5 h-5 stroke-[2]" />
                    <span>More</span>
                  </>
                )}
              </button>
            </>
          )}
        </nav>

        {/* 2b. Workspace Apps (Calendar / Contacts) */}
        <div className={`mt-2 pt-2 border-t border-gmail-border dark:border-gmail-dark-border ${isMini ? 'pr-0' : 'pr-3'}`}>
          {[
            { name: 'Calendar', icon: CalendarDays, action: onOpenCalendar },
            { name: 'Contacts', icon: Users, action: onOpenContacts },
          ].map((app) => {
            const Icon = app.icon;
            if (isMini) {
              return (
                <button
                  key={app.name}
                  onClick={() => {
                    app.action?.();
                    if (isOpenMobile) onCloseMobile?.();
                  }}
                  className="w-12 h-10 rounded-full mx-auto flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
                  title={app.name}
                >
                  <Icon className="w-5 h-5 stroke-[2]" />
                </button>
              );
            }
            return (
              <button
                key={app.name}
                onClick={() => {
                  app.action?.();
                  if (isOpenMobile) onCloseMobile?.();
                }}
                className="w-full flex items-center gap-4 pl-6 pr-4 h-8 rounded-r-full text-sm text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 font-normal transition-colors"
              >
                <Icon className="w-5 h-5 stroke-[2]" />
                <span className="truncate">{app.name}</span>
              </button>
            );
          })}
        </div>

        {/* 3. Labels Section (Full view only) */}
        {!isMini && (
          <div className="pt-4 pr-3">
            <div className="pl-6 pr-4 pb-1.5 flex items-center justify-between text-xs font-semibold text-[#444746] dark:text-[#C4C7C5]">
              <span>Labels</span>
              <button
                className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                title="Create new label"
              >
                <Plus className="w-4 h-4 stroke-[2]" />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {labels.map((lbl) => {
                const isLblActive = selectedLabel === lbl.name.toLowerCase();
                return (
                  <button
                    key={lbl.name}
                    onClick={() => {
                      onSelectLabel(isLblActive ? null : lbl.name.toLowerCase());
                      if (isOpenMobile) onCloseMobile?.();
                    }}
                    className={`w-full flex items-center justify-between pl-6 pr-4 h-8 rounded-r-full text-sm transition-colors ${
                      isLblActive
                        ? 'bg-[#D3E3FD] dark:bg-[#004A77] font-semibold text-[#001D35] dark:text-[#C2E7FF]'
                        : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 font-normal'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <Tag className="w-4 h-4 stroke-[2]" style={{ color: lbl.color }} />
                      <span className="truncate">{lbl.name}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 4. Bottom Storage Breakdown (Gmail Style) */}
      {!isMini && quota && (
        <div className="px-6 py-3 space-y-1.5 border-t border-gmail-border dark:border-gmail-dark-border">
          <div className="flex items-center justify-between text-xs text-[#444746] dark:text-[#C4C7C5]">
            <span>{quota.usedFormatted} of {quota.limitFormatted} used</span>
            <span className="font-mono tabular-nums">{quota.percent.toFixed(0)}%</span>
          </div>
          <progress
            className="progress progress-primary w-full h-1 bg-gray-200 dark:bg-gray-700"
            value={quota.percent}
            max="100"
          ></progress>
          <div className="flex justify-between items-center text-[11px] text-[#444746]/70 dark:text-[#C4C7C5]/70 pt-0.5">
            <span className="truncate font-mono">Max attach: {quota.maxAttachmentSizeMb} MB</span>
            <span className="text-gmail-blue hover:underline cursor-pointer">Manage</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={`hidden md:flex flex-col justify-between bg-gmail-canvas dark:bg-gmail-dark-canvas select-none shrink-0 h-full transition-all duration-200 ${
          isCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {renderContent(isCollapsed)}
      </aside>

      {/* Mobile Drawer */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <aside className="relative w-64 max-w-[85vw] bg-gmail-canvas dark:bg-gmail-dark-canvas h-full shadow-2xl z-10 flex flex-col justify-between overflow-y-auto">
            {renderContent(false)}
          </aside>
        </div>
      )}
    </>
  );
};


