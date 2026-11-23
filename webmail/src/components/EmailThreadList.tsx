import React, { useState } from 'react';
import {
  Star,
  Paperclip,
  Inbox,
  Tag,
  Users,
  Archive,
  Trash2,
  Mail,
  MailCheck,
  Clock,
  ChevronRight,
  Bookmark,
} from 'lucide-react';
import { EmailThread } from '../types';
import { GmailCheckbox } from './GmailCheckbox';
import { ContactHovercard } from './ContactHovercard';

interface EmailThreadListProps {
  threads: EmailThread[];
  selectedThreadIds: Set<string>;
  cursorIndex: number;
  currentFolder?: string;
  activeTab?: 'primary' | 'promotions' | 'social';
  onTabChange?: (tab: 'primary' | 'promotions' | 'social') => void;
  onSelectThread: (thread: EmailThread) => void;
  onToggleSelectCheckbox: (threadId: string) => void;
  onToggleStar: (threadId: string) => void;
  onArchiveThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onToggleReadThread?: (threadId: string) => void;
  onSnoozeThread?: (threadId: string) => void;
  onComposeTo?: (email: string) => void;
}

export const EmailThreadList: React.FC<EmailThreadListProps> = ({
  threads,
  selectedThreadIds,
  cursorIndex,
  currentFolder = 'inbox',
  activeTab = 'primary',
  onTabChange,
  onSelectThread,
  onToggleSelectCheckbox,
  onToggleStar,
  onArchiveThread,
  onDeleteThread,
  onToggleReadThread,
  onSnoozeThread,
  onComposeTo,
}) => {
  // Category tabs state (Primary, Promotions, Social)
  const isInbox = currentFolder === 'inbox';

  if (threads.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-[#444746] dark:text-[#C4C7C5] bg-white dark:bg-[#1E1F20]">
        <div className="w-16 h-16 rounded-full bg-[#F2F6FC] dark:bg-[#282A2C] flex items-center justify-center mb-4 text-gmail-blue">
          <Inbox className="w-8 h-8 stroke-[1.5]" />
        </div>
        <h3 className="font-medium text-base text-[#1F1F1F] dark:text-[#E3E3E3]">Your inbox is clean</h3>
        <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F] mt-1.5 max-w-sm">
          No conversations found in this category. Messages that arrive will appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-[#1E1F20] flex flex-col select-none">
      {/* Gmail Inbox Category Tabs (Primary, Promotions, Social) */}
      {isInbox && (
        <div className="flex items-center overflow-x-auto border-b border-[#E0E2E7] dark:border-[#333538] px-2 select-none shrink-0 bg-white dark:bg-[#1E1F20]">
          {/* Primary Tab */}
          <button
            onClick={() => onTabChange?.('primary')}
            className={`flex items-center gap-3 px-5 py-3 text-xs font-semibold border-b-[3px] -mb-[1px] transition-all min-w-[120px] sm:min-w-[160px] ${
              activeTab === 'primary'
                ? 'border-b-gmail-blue text-gmail-blue font-bold'
                : 'border-b-transparent text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]'
            }`}
          >
            <Inbox className={`w-4 h-4 stroke-[2] ${activeTab === 'primary' ? 'text-gmail-blue' : ''}`} />
            <span>Primary</span>
          </button>

          {/* Promotions Tab */}
          <button
            onClick={() => onTabChange?.('promotions')}
            className={`flex items-center gap-3 px-5 py-3 text-xs font-semibold border-b-[3px] -mb-[1px] transition-all min-w-[120px] sm:min-w-[160px] ${
              activeTab === 'promotions'
                ? 'border-b-gmail-blue text-gmail-blue font-bold'
                : 'border-b-transparent text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]'
            }`}
          >
            <Tag className={`w-4 h-4 stroke-[2] ${activeTab === 'promotions' ? 'text-gmail-blue' : ''}`} />
            <div className="flex items-center gap-1.5">
              <span>Promotions</span>
              <span className="px-1.5 py-0.2 bg-emerald-600 text-white rounded text-[10px] font-medium">New</span>
            </div>
          </button>

          {/* Social Tab */}
          <button
            onClick={() => onTabChange?.('social')}
            className={`flex items-center gap-3 px-5 py-3 text-xs font-semibold border-b-[3px] -mb-[1px] transition-all min-w-[120px] sm:min-w-[160px] ${
              activeTab === 'social'
                ? 'border-b-gmail-blue text-gmail-blue font-bold'
                : 'border-b-transparent text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]'
            }`}
          >
            <Users className={`w-4 h-4 stroke-[2] ${activeTab === 'social' ? 'text-gmail-blue' : ''}`} />
            <span>Social</span>
          </button>
        </div>
      )}

      {/* Thread Rows */}
      <div className="divide-y divide-[#F2F4F7] dark:divide-[#2D2F31]">
        {threads.map((thread, index) => {
          const isSelected = selectedThreadIds.has(thread.id);
          const isCursor = index === cursorIndex;
          const isUnread = thread.isUnread;

          return (
            <div
              key={thread.id}
              onClick={() => onSelectThread(thread)}
              className={`gmail-row group cursor-pointer text-xs transition-colors flex flex-wrap items-center px-3 sm:px-4 py-2 relative border-b border-[#F2F4F7] dark:border-[#282A2C] ${
                isSelected
                  ? 'bg-[#C2E7FF]/60 dark:bg-[#004A77]/40 border-l-4 border-l-gmail-blue'
                  : isCursor
                  ? 'bg-[#F2F6FC] dark:bg-[#282A2C]'
                  : isUnread
                  ? 'bg-white dark:bg-[#1E1F20] font-semibold hover:shadow-sm'
                  : 'bg-[#F8FAFD] dark:bg-[#18191A] hover:bg-white dark:hover:bg-[#1E1F20]'
              }`}
            >
              {/* Checkbox */}
              <div
                className="flex items-center mr-2 shrink-0 p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelectCheckbox(thread.id);
                }}
              >
                <GmailCheckbox
                  checked={isSelected}
                  onChange={() => onToggleSelectCheckbox(thread.id)}
                  ariaLabel={`Select thread ${thread.subject}`}
                />
              </div>

              {/* Star Icon */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(thread.id);
                }}
                className="p-1 mr-1 text-gray-400 hover:text-amber-500 rounded-full shrink-0 transition-colors"
                title="Star conversation"
              >
                <Star
                  className={`w-4 h-4 stroke-[1.5] ${
                    thread.isStarred
                      ? 'fill-amber-400 text-amber-500'
                      : 'text-gray-400 dark:text-gray-600 hover:text-amber-500'
                  }`}
                />
              </button>

              {/* Important Marker Chevron (Gmail Bookmark Tag) */}
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-1 mr-2 text-gray-300 dark:text-gray-600 hover:text-amber-500 rounded shrink-0 hidden sm:inline-flex"
                title="Mark as important"
              >
                <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>

              {/* Sender Name with Gmail Contact Hovercard */}
              <div className="flex-1 min-w-0 sm:flex-none sm:w-36 md:w-48 sm:shrink-0 flex items-center gap-1.5 mr-3">
                <ContactHovercard
                  senderName={thread.senderName}
                  senderEmail={thread.senderEmail}
                  onComposeTo={onComposeTo}
                >
                  <span
                    className={`truncate text-xs hover:underline block max-w-[130px] md:max-w-[170px] ${
                      isUnread
                        ? 'font-bold text-[#1F1F1F] dark:text-[#E3E3E3]'
                        : 'font-normal text-[#444746] dark:text-[#C4C7C5]'
                    }`}
                  >
                    {thread.senderName}
                  </span>
                </ContactHovercard>
                {thread.messageCount > 1 && (
                  <span className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F] font-mono tabular-nums shrink-0">
                    ({thread.messageCount})
                  </span>
                )}
              </div>

              {/* Subject & Snippet & Labels */}
              <div className="flex-1 min-w-0 flex items-center gap-2 mr-3 max-sm:order-5 max-sm:basis-full max-sm:pl-[68px] max-sm:mt-0.5">
                {/* Labels Chips */}
                {thread.labels
                  .filter((l) => l !== 'inbox' && l !== 'sent' && l !== 'drafts')
                  .slice(0, 2)
                  .map((lbl) => (
                    <span
                      key={lbl}
                      className="px-2 py-0.5 rounded text-[10px] font-medium uppercase bg-[#E8F0FE] dark:bg-[#004A77]/50 text-gmail-blue shrink-0 border border-[#D2E3FC] dark:border-[#004A77]"
                    >
                      {lbl}
                    </span>
                  ))}

                <span
                  className={`truncate text-xs ${
                    isUnread
                      ? 'font-bold text-[#1F1F1F] dark:text-[#E3E3E3]'
                      : 'font-normal text-[#1F1F1F] dark:text-[#E3E3E3]'
                  }`}
                >
                  {thread.subject}
                </span>

                <span className="text-[#5E5E5E] dark:text-[#8E918F] truncate text-xs font-normal hidden sm:inline max-sm:hidden">
                  — {thread.snippet}
                </span>
              </div>

              {/* Attachment Pill or Paperclip */}
              {thread.hasAttachments && (
                <div
                  className="shrink-0 text-[#5E5E5E] dark:text-[#8E918F] mr-3 hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F2F6FC] dark:bg-[#282A2C] border border-[#E0E2E7] dark:border-[#333538]"
                  title="Attachment included"
                >
                  <Paperclip className="w-3 h-3 stroke-[2] text-gmail-blue" />
                  <span className="text-[10px] font-medium text-gmail-blue hidden lg:inline">Attachment</span>
                </div>
              )}

              {/* Right Side: Timestamp by default, or Gmail Quick Action Buttons on Hover! */}
              <div className="relative shrink-0 flex items-center justify-end min-w-0 sm:min-w-[120px]">
                {/* Default Timestamp (Hidden on hover) */}
                <span
                  className={`gmail-date group-hover:hidden font-sans text-xs tabular-nums text-right ${
                    isUnread
                      ? 'font-bold text-[#1F1F1F] dark:text-[#E3E3E3]'
                      : 'text-[#5E5E5E] dark:text-[#8E918F]'
                  }`}
                >
                  {thread.latestReceivedAt}
                </span>

                {/* Signature Gmail Hover Action Buttons Bar (Shown on hover) */}
                <div className="gmail-hover-actions hidden group-hover:flex items-center gap-1 bg-white/95 dark:bg-[#1E1F20]/95 px-1 rounded-full shadow-sm">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveThread?.(thread.id);
                    }}
                    title="Archive"
                    className="p-1.5 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                  >
                    <Archive className="w-4 h-4 stroke-[2]" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteThread?.(thread.id);
                    }}
                    title="Delete"
                    className="p-1.5 text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                  >
                    <Trash2 className="w-4 h-4 stroke-[2]" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleReadThread?.(thread.id);
                    }}
                    title={isUnread ? 'Mark as read' : 'Mark as unread'}
                    className="p-1.5 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                  >
                    {isUnread ? (
                      <MailCheck className="w-4 h-4 stroke-[2]" />
                    ) : (
                      <Mail className="w-4 h-4 stroke-[2]" />
                    )}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSnoozeThread?.(thread.id);
                    }}
                    title="Snooze"
                    className="p-1.5 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                  >
                    <Clock className="w-4 h-4 stroke-[2]" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
