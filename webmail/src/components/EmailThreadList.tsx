import React from 'react';
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

const TAB_BASE =
  'flex items-center justify-center gap-2 px-3 sm:px-5 h-12 text-sm border-b-2 -mb-px transition-colors flex-1 sm:flex-none sm:min-w-[160px]';
const TAB_IDLE = 'border-b-transparent text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] font-normal';
const TAB_ACTIVE = 'border-b-gmail-blue dark:border-b-gmail-dark-blue-text text-gmail-blue dark:text-gmail-dark-blue-text font-medium';
const ROW_ACTION =
  'h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors';

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
  const isInbox = currentFolder === 'inbox';

  if (threads.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-[#444746] dark:text-[#C4C7C5] bg-white dark:bg-[#1E1F20]">
        <div className="w-16 h-16 rounded-full bg-[#F2F6FC] dark:bg-[#282A2C] flex items-center justify-center mb-4 text-[#444746] dark:text-[#C4C7C5]">
          <Inbox className="w-8 h-8 stroke-[1.5]" />
        </div>
        <h3 className="font-medium text-base text-[#1F1F1F] dark:text-[#E3E3E3]">No conversations here</h3>
        <p className="text-sm text-[#5E5E5E] dark:text-[#8E918F] mt-1.5 max-w-sm">
          New messages for this folder appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-[#1E1F20] flex flex-col select-none">
      {/* Category tabs */}
      {isInbox && (
        <div className="flex items-center overflow-x-auto border-b border-[#E0E2E7] dark:border-[#333538] px-2 select-none shrink-0 bg-white dark:bg-[#1E1F20]">
          <button
            onClick={() => onTabChange?.('primary')}
            className={`${TAB_BASE} ${activeTab === 'primary' ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Inbox className="w-4 h-4 stroke-[1.5]" />
            <span>Primary</span>
          </button>

          <button
            onClick={() => onTabChange?.('promotions')}
            className={`${TAB_BASE} ${activeTab === 'promotions' ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Tag className="w-4 h-4 stroke-[1.5]" />
            <span>Promotions</span>
          </button>

          <button
            onClick={() => onTabChange?.('social')}
            className={`${TAB_BASE} ${activeTab === 'social' ? TAB_ACTIVE : TAB_IDLE}`}
          >
            <Users className="w-4 h-4 stroke-[1.5]" />
            <span>Social</span>
          </button>
        </div>
      )}

      {/* Rows */}
      <div className="divide-y divide-[#F2F4F7] dark:divide-[#333538]">
        {threads.map((thread, index) => {
          const isSelected = selectedThreadIds.has(thread.id);
          const isCursor = index === cursorIndex;
          const isUnread = thread.isUnread;

          return (
            <div
              key={thread.id}
              onClick={() => onSelectThread(thread)}
              className={`gmail-row group cursor-pointer text-xs transition-colors flex flex-wrap items-center px-3 sm:px-4 min-h-12 sm:min-h-10 py-1.5 relative border-l-2 ${
                isSelected
                  ? 'bg-[#C2E7FF]/60 dark:bg-[#004A77]/40 border-l-gmail-blue dark:border-l-gmail-dark-blue-text'
                  : isCursor
                  ? 'bg-[#F2F6FC] dark:bg-[#282A2C] border-l-transparent'
                  : isUnread
                  ? 'bg-white dark:bg-[#1E1F20] font-medium border-l-transparent'
                  : 'bg-[#F6F8FC] dark:bg-[#131314] hover:bg-white dark:hover:bg-[#1E1F20] border-l-transparent'
              }`}
            >
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

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(thread.id);
                }}
                className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center mr-0.5 md:mr-1 text-[#8E918F] hover:text-[#B06000] dark:hover:text-[#F4B400] rounded-full shrink-0 transition-colors"
                title="Star conversation"
              >
                <Star
                  className={`w-4 h-4 stroke-[1.5] ${
                    thread.isStarred
                      ? 'fill-[#F4B400] text-[#B06000] dark:fill-[#F4B400] dark:text-[#F4B400]'
                      : 'text-[#8E918F]'
                  }`}
                />
              </button>

              <button
                onClick={(e) => e.stopPropagation()}
                className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center mr-1 md:mr-2 text-[#8E918F] hover:text-[#B06000] dark:hover:text-[#F4B400] rounded-md transition-colors shrink-0 hidden sm:flex"
                title="Mark as important"
              >
                <ChevronRight className="w-4 h-4 stroke-[1.5]" />
              </button>

              <div className="flex-1 min-w-0 sm:flex-none sm:w-36 md:w-48 sm:shrink-0 flex items-center gap-1.5 mr-3">
                <ContactHovercard
                  senderName={thread.senderName}
                  senderEmail={thread.senderEmail}
                  onComposeTo={onComposeTo}
                >
                  <span
                    className={`truncate text-xs hover:underline block max-w-[130px] md:max-w-[170px] ${
                      isUnread
                        ? 'font-medium text-[#1F1F1F] dark:text-[#E3E3E3]'
                        : 'font-normal text-[#444746] dark:text-[#C4C7C5]'
                    }`}
                  >
                    {thread.senderName}
                  </span>
                </ContactHovercard>
                {thread.messageCount > 1 && (
                  <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F] font-mono tabular-nums shrink-0">
                    {thread.messageCount}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0 flex items-center gap-2 mr-3 max-sm:order-5 max-sm:basis-full max-sm:pl-[68px]">
                {thread.labels
                  .filter((l) => l !== 'inbox' && l !== 'sent' && l !== 'drafts')
                  .slice(0, 2)
                  .map((lbl) => (
                    <span
                      key={lbl}
                      className="px-2 py-0.5 rounded bg-[#F2F6FC] dark:bg-[#282A2C] text-xs font-normal text-[#444746] dark:text-[#C4C7C5] shrink-0 border border-[#E0E2E7] dark:border-[#333538]"
                    >
                      {lbl}
                    </span>
                  ))}

                <span
                  className={`truncate text-xs ${
                    isUnread
                      ? 'font-medium text-[#1F1F1F] dark:text-[#E3E3E3]'
                      : 'font-normal text-[#1F1F1F] dark:text-[#E3E3E3]'
                  }`}
                >
                  {thread.subject}
                </span>

                <span className="text-[#5E5E5E] dark:text-[#8E918F] truncate text-xs font-normal hidden sm:inline">
                  — {thread.snippet}
                </span>
              </div>

              {thread.hasAttachments && (
                <div
                  className="shrink-0 text-[#5E5E5E] dark:text-[#8E918F] mr-3 hidden sm:flex items-center gap-1 px-2 py-0.5 rounded bg-[#F2F6FC] dark:bg-[#282A2C] border border-[#E0E2E7] dark:border-[#333538]"
                  title="Attachment included"
                >
                  <Paperclip className="w-3.5 h-3.5 stroke-[1.5]" />
                  <span className="text-xs font-normal hidden lg:inline">Attachment</span>
                </div>
              )}

              <div className="relative shrink-0 flex items-center justify-end min-w-0 sm:min-w-[120px]">
                <span
                  className={`gmail-date font-sans text-xs tabular-nums text-right ${
                    isUnread
                      ? 'font-medium text-[#1F1F1F] dark:text-[#E3E3E3]'
                      : 'text-[#5E5E5E] dark:text-[#8E918F]'
                  }`}
                >
                  {thread.latestReceivedAt}
                </span>

                <div className="gmail-hover-actions hidden group-hover:flex items-center gap-1 bg-white/95 dark:bg-[#1E1F20]/95 px-1 rounded-full">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveThread?.(thread.id);
                    }}
                    title="Archive"
                    className={ROW_ACTION}
                  >
                    <Archive className="w-4 h-4 stroke-[1.5]" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteThread?.(thread.id);
                    }}
                    title="Delete"
                    className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 dark:hover:text-red-400 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                  >
                    <Trash2 className="w-4 h-4 stroke-[1.5]" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleReadThread?.(thread.id);
                    }}
                    title={isUnread ? 'Mark as read' : 'Mark as unread'}
                    className={ROW_ACTION}
                  >
                    {isUnread ? (
                      <MailCheck className="w-4 h-4 stroke-[1.5]" />
                    ) : (
                      <Mail className="w-4 h-4 stroke-[1.5]" />
                    )}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSnoozeThread?.(thread.id);
                    }}
                    title="Snooze"
                    className={ROW_ACTION}
                  >
                    <Clock className="w-4 h-4 stroke-[1.5]" />
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
