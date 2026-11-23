import React from 'react';
import {
  Inbox,
  Star,
  Send,
  FileText,
  Archive,
  AlertOctagon,
  Trash2,
  Plus,
  Tag,
  HardDrive,
  Cpu,
  X,
  Mail,
} from 'lucide-react';
import { MailboxFolderId, PlanQuota } from '../types';

interface NavigationSidebarProps {
  currentFolder: MailboxFolderId;
  onSelectFolder: (folder: MailboxFolderId) => void;
  selectedLabel: string | null;
  onSelectLabel: (label: string | null) => void;
  onOpenCompose: () => void;
  unreadCount: number;
  quota: PlanQuota;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
}

export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  currentFolder,
  onSelectFolder,
  selectedLabel,
  onSelectLabel,
  onOpenCompose,
  unreadCount,
  quota,
  isOpenMobile = false,
  onCloseMobile,
}) => {
  const folders = [
    { id: 'inbox' as MailboxFolderId, name: 'Inbox', icon: Inbox, count: unreadCount },
    { id: 'starred' as MailboxFolderId, name: 'Starred', icon: Star },
    { id: 'sent' as MailboxFolderId, name: 'Sent', icon: Send },
    { id: 'drafts' as MailboxFolderId, name: 'Drafts', icon: FileText },
    { id: 'archive' as MailboxFolderId, name: 'Archive', icon: Archive },
    { id: 'spam' as MailboxFolderId, name: 'Spam', icon: AlertOctagon },
    { id: 'trash' as MailboxFolderId, name: 'Trash', icon: Trash2 },
  ];

  const labels = [
    { name: 'VIP', color: 'bg-amber-500' },
    { name: 'Billing', color: 'bg-blue-500' },
    { name: 'Security', color: 'bg-red-500' },
    { name: 'Operations', color: 'bg-teal-500' },
  ];

  const renderContent = (isMobile = false) => (
    <div className="flex flex-col justify-between h-full">
      <div className="flex flex-col gap-4">
        {isMobile && (
          <div className="flex items-center justify-between pb-2 border-b border-base-200">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              <span className="font-bold text-sm text-base-content">Navigation</span>
            </div>
            <button
              onClick={onCloseMobile}
              className="btn btn-ghost btn-circle btn-xs text-base-content/60"
              title="Close"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Compose Button */}
        <button
          onClick={() => {
            onOpenCompose();
            if (isMobile) onCloseMobile?.();
          }}
          className="btn btn-primary w-full shadow-md shadow-primary/25 rounded-xl flex items-center justify-between px-4 h-11 normal-case font-semibold text-sm hover:scale-[1.01] transition-transform"
        >
          <div className="flex items-center gap-2.5">
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Compose</span>
          </div>
          <kbd className="kbd kbd-xs bg-primary-content/20 text-white font-mono text-[10px] border-none">
            c
          </kbd>
        </button>

        {/* Mailbox Folders */}
        <nav className="flex flex-col gap-0.5">
          {folders.map((folder) => {
            const Icon = folder.icon;
            const isActive = currentFolder === folder.id && selectedLabel === null;
            return (
              <button
                key={folder.id}
                onClick={() => {
                  onSelectFolder(folder.id);
                  onSelectLabel(null);
                  if (isMobile) onCloseMobile?.();
                }}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-base-content/80 hover:bg-base-200 hover:text-base-content'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-base-content/60'}`} />
                  <span>{folder.name}</span>
                </div>
                {folder.count !== undefined && folder.count > 0 && (
                  <span
                    className={`badge badge-sm font-semibold border-none ${
                      isActive ? 'bg-primary text-white' : 'bg-base-300 text-base-content/80'
                    }`}
                  >
                    {folder.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Labels Section */}
        <div className="pt-2">
          <div className="px-3 pb-2 flex items-center justify-between text-[11px] font-bold text-base-content/50 uppercase tracking-wider">
            <span>Labels</span>
            <Tag className="w-3 h-3" />
          </div>
          <div className="flex flex-col gap-0.5">
            {labels.map((lbl) => {
              const isLblActive = selectedLabel === lbl.name.toLowerCase();
              return (
                <button
                  key={lbl.name}
                  onClick={() => {
                    onSelectLabel(isLblActive ? null : lbl.name.toLowerCase());
                    if (isMobile) onCloseMobile?.();
                  }}
                  className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors ${
                    isLblActive
                      ? 'bg-base-200 text-base-content font-semibold'
                      : 'text-base-content/70 hover:bg-base-200/60 hover:text-base-content'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full ${lbl.color}`}></span>
                    <span>{lbl.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Card: Plan Usage & Quota Guard Indicator */}
      <div className="bg-base-200/70 border border-base-300 rounded-xl p-3 flex flex-col gap-2 mt-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-base-content/70 font-medium">
            <HardDrive className="w-3.5 h-3.5 text-primary" />
            <span>Plan Storage</span>
          </div>
          <span className="font-semibold text-xs text-base-content">
            {quota.percent.toFixed(0)}%
          </span>
        </div>

        <progress
          className={`progress w-full h-1.5 ${
            quota.percent >= 90
              ? 'progress-error'
              : quota.percent >= 80
              ? 'progress-warning'
              : 'progress-primary'
          }`}
          value={quota.percent}
          max="100"
        ></progress>

        <div className="flex justify-between items-center text-[10px] text-base-content/60 font-mono">
          <span>{quota.usedFormatted} used</span>
          <span>{quota.limitFormatted}</span>
        </div>

        <div className="pt-1.5 border-t border-base-300 flex items-center justify-between text-[10px] text-base-content/60">
          <div className="flex items-center gap-1">
            <Cpu className="w-3 h-3 text-accent" />
            <span>Max Attach:</span>
          </div>
          <span className="badge badge-xs badge-ghost font-semibold text-[10px]">
            {quota.maxAttachmentSizeMb} MB
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex w-64 border-r border-base-300 bg-base-100 flex-col justify-between p-3 select-none shrink-0 h-full">
        {renderContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <aside className="relative w-72 max-w-[85vw] bg-base-100 h-full shadow-2xl p-4 z-10 flex flex-col justify-between overflow-y-auto">
            {renderContent(true)}
          </aside>
        </div>
      )}
    </>
  );
};
