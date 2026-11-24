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
  Mail,
  Clock,
  ChevronDown,
  ChevronUp,
  Bookmark,
  Calendar,
  CalendarDays,
  Users,
  Upload,
  X,
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
  onOpenImport?: () => void;
}

const ACTIVE_ROW = 'bg-[#D3E3FD] dark:bg-[#004A77] font-medium text-[#001D35] dark:text-[#C2E7FF]';
const IDLE_ROW = 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 font-normal';

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
  onOpenImport,
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
    { id: 'archive' as MailboxFolderId, name: 'All mail', icon: Mail },
    { id: 'spam' as MailboxFolderId, name: 'Spam', icon: AlertOctagon },
    { id: 'trash' as MailboxFolderId, name: 'Trash', icon: Trash2 },
  ];

  const labels = [
    { name: 'VIP' },
    { name: 'Billing' },
    { name: 'Security' },
    { name: 'Operations' },
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
              : IDLE_ROW
          }`}
          title={`${folder.name}${folder.count ? ` (${folder.count})` : ''}`}
        >
          <Icon className="w-5 h-5 stroke-[1.5]" />
          {folder.count !== undefined && folder.count > 0 && (
            <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-gmail-blue dark:bg-gmail-dark-blue-text"></span>
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
        className={`w-full flex items-center justify-between pl-6 pr-4 h-10 md:h-8 rounded-r-full text-sm transition-colors ${
          isActive ? ACTIVE_ROW : IDLE_ROW
        }`}
      >
        <div className="flex items-center gap-4">
          <Icon className="w-5 h-5 stroke-[1.5]" />
          <span className="truncate">{folder.name}</span>
        </div>
        {folder.count !== undefined && folder.count > 0 && (
          <span className="text-xs tabular-nums font-medium">
            {folder.count}
          </span>
        )}
      </button>
    );
  };

  const renderContent = (isMini = false) => (
    <div className="flex flex-col justify-between h-full py-2">
      <div className="flex flex-col">
        {/* Mobile header */}
        {isOpenMobile && (
          <div className="flex items-center justify-between pb-3 px-4 mb-2 border-b border-gmail-border dark:border-gmail-dark-border">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 stroke-[1.5] text-[#444746] dark:text-[#C4C7C5]" />
              <span className="font-medium text-sm text-[#1F1F1F] dark:text-[#E3E3E3]">Mailbox</span>
            </div>
            <button
              onClick={onCloseMobile}
              className="btn btn-ghost btn-circle btn-sm h-10 w-10 min-h-10 text-[#444746] dark:text-[#C4C7C5]"
              title="Close"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4 stroke-[1.5]" />
            </button>
          </div>
        )}

        {/* Compose */}
        <div className={`mb-4 ${isMini ? 'px-2 flex justify-center' : 'px-4'}`}>
          {isMini ? (
            <button
              onClick={onOpenCompose}
              className="w-14 h-14 rounded-xl bg-gmail-blue-light dark:bg-gmail-dark-blue-light text-[#001D35] dark:text-gmail-dark-blue-text hover:bg-[#A8D8FF] dark:hover:bg-[#0B57D0] flex items-center justify-center transition-colors cursor-pointer"
              title="Compose"
              aria-label="Compose"
            >
              <Pencil className="w-6 h-6 stroke-[1.5]" />
            </button>
          ) : (
            <button
              onClick={() => {
                onOpenCompose();
                if (isOpenMobile) onCloseMobile?.();
              }}
              className="h-14 pl-6 pr-4 rounded-xl bg-gmail-blue-light dark:bg-gmail-dark-blue-light text-[#001D35] dark:text-gmail-dark-blue-text hover:bg-[#A8D8FF] dark:hover:bg-[#0B57D0] flex items-center justify-between gap-3 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <Pencil className="w-5 h-5 stroke-[1.5]" />
                <span className="font-medium text-sm">Compose</span>
              </div>
              <kbd className="kbd kbd-xs h-5 min-h-5 bg-black/10 dark:bg-white/10 text-[#001D35] dark:text-gmail-dark-blue-text font-mono text-xs border-none px-2">
                c
              </kbd>
            </button>
          )}
        </div>

        {/* Folders */}
        <nav className="flex flex-col gap-1 pr-3">
          {primaryFolders.map((f) => renderFolderButton(f, isMini))}

          {!isMini && (
            <>
              {isMoreExpanded && moreFolders.map((f) => renderFolderButton(f, false))}

              <button
                onClick={() => setIsMoreExpanded(!isMoreExpanded)}
                className={`w-full flex items-center gap-4 pl-6 pr-4 h-10 md:h-8 rounded-r-full text-sm transition-colors ${IDLE_ROW}`}
              >
                {isMoreExpanded ? (
                  <>
                    <ChevronUp className="w-5 h-5 stroke-[1.5]" />
                    <span>Less</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-5 h-5 stroke-[1.5]" />
                    <span>More</span>
                  </>
                )}
              </button>
            </>
          )}
        </nav>

        {/* Workspace apps */}
        <div className={`mt-4 pt-2 border-t border-gmail-border dark:border-gmail-dark-border ${isMini ? 'pr-0' : 'pr-3'}`}>
          {[
            { name: 'Calendar', icon: CalendarDays, action: onOpenCalendar },
            { name: 'Contacts', icon: Users, action: onOpenContacts },
            { name: 'Import', icon: Upload, action: onOpenImport },
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
                  className={`w-12 h-10 rounded-full mx-auto flex items-center justify-center ${IDLE_ROW} transition-colors`}
                  title={app.name}
                >
                  <Icon className="w-5 h-5 stroke-[1.5]" />
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
                className={`w-full flex items-center gap-4 pl-6 pr-4 h-10 md:h-8 rounded-r-full text-sm transition-colors ${IDLE_ROW}`}
              >
                <Icon className="w-5 h-5 stroke-[1.5]" />
                <span className="truncate">{app.name}</span>
              </button>
            );
          })}
        </div>

        {/* Labels */}
        {!isMini && (
          <div className="mt-4 pt-4 pr-3 border-t border-gmail-border dark:border-gmail-dark-border">
            <div className="pl-6 pr-4 pb-2 flex items-center justify-between text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
              <span>Labels</span>
              <button
                className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                title="Create new label"
              >
                <Plus className="w-4 h-4 stroke-[1.5]" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {labels.map((lbl) => {
                const isLblActive = selectedLabel === lbl.name.toLowerCase();
                return (
                  <button
                    key={lbl.name}
                    onClick={() => {
                      onSelectLabel(isLblActive ? null : lbl.name.toLowerCase());
                      if (isOpenMobile) onCloseMobile?.();
                    }}
                    className={`w-full flex items-center justify-between pl-6 pr-4 h-10 md:h-8 rounded-r-full text-sm transition-colors ${
                      isLblActive ? ACTIVE_ROW : IDLE_ROW
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <Tag className="w-4 h-4 stroke-[1.5]" />
                      <span className="truncate">{lbl.name}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Storage */}
      {!isMini && quota && (
        <div className="px-6 py-3 space-y-2 border-t border-gmail-border dark:border-gmail-dark-border">
          <div className="flex items-center justify-between text-xs text-[#444746] dark:text-[#C4C7C5]">
            <span>{quota.usedFormatted} of {quota.limitFormatted} used</span>
            <span className="font-mono tabular-nums">{quota.percent.toFixed(0)}%</span>
          </div>
          <progress
            className="progress progress-primary w-full h-1.5 bg-[#E0E2E7] dark:bg-[#333538]"
            value={quota.percent}
            max="100"
          ></progress>
          <div className="flex justify-between items-center text-xs text-[#444746] dark:text-[#C4C7C5] pt-1">
            <span className="truncate font-mono">Max attach: {quota.maxAttachmentSizeMb} MB</span>
            <span className="text-gmail-blue dark:text-gmail-dark-blue-text hover:underline cursor-pointer">Manage</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <aside
        className={`hidden md:flex flex-col justify-between bg-gmail-canvas dark:bg-gmail-dark-canvas select-none shrink-0 h-full ${
          isCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {renderContent(isCollapsed)}
      </aside>

      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex h-dvh" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40 transition-opacity"
            onClick={onCloseMobile}
          />
          <aside className="relative w-[min(320px,85vw)] bg-gmail-canvas dark:bg-gmail-dark-canvas h-full max-h-dvh shadow-gmail-modal z-10 flex flex-col justify-between overflow-y-auto">
            {renderContent(false)}
          </aside>
        </div>
      )}
    </>
  );
};
