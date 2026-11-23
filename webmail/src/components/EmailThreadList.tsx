import React from 'react';
import { Star, Paperclip } from 'lucide-react';
import { EmailThread } from '../types';

interface EmailThreadListProps {
  threads: EmailThread[];
  selectedThreadIds: Set<string>;
  cursorIndex: number;
  onSelectThread: (thread: EmailThread) => void;
  onToggleSelectCheckbox: (threadId: string) => void;
  onToggleStar: (threadId: string) => void;
}

export const EmailThreadList: React.FC<EmailThreadListProps> = ({
  threads,
  selectedThreadIds,
  cursorIndex,
  onSelectThread,
  onToggleSelectCheckbox,
  onToggleStar,
}) => {
  const getBadgeClass = (label: string) => {
    switch (label.toLowerCase()) {
      case 'billing':
        return 'badge-info';
      case 'security':
        return 'badge-error';
      case 'operations':
      case 'design':
        return 'badge-accent';
      case 'vip':
        return 'badge-warning';
      default:
        return 'badge-ghost';
    }
  };

  if (threads.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-base-content/50">
        <div className="w-16 h-16 rounded-full bg-base-200 flex items-center justify-center mb-3">
          <Star className="w-8 h-8 text-base-content/30" />
        </div>
        <h3 className="font-semibold text-base text-base-content">Your inbox is clear</h3>
        <p className="text-xs text-base-content/60 mt-1 max-w-sm">
          No messages match the current folder or label filter.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-base-200 bg-base-100">
      {threads.map((thread, index) => {
        const isSelected = selectedThreadIds.has(thread.id);
        const isCursor = index === cursorIndex;
        const isUnread = thread.isUnread;

        return (
          <div
            key={thread.id}
            onClick={() => onSelectThread(thread)}
            className={`group flex items-center gap-3 px-4 py-2.5 cursor-pointer text-xs transition-colors select-none ${
              isCursor ? 'ring-1 ring-inset ring-primary/40 bg-primary/5' : ''
            } ${
              isSelected ? 'bg-primary/10' : isUnread ? 'bg-base-200/40' : 'hover:bg-base-200/70'
            }`}
          >
            {/* Checkbox */}
            <div
              className="flex items-center"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelectCheckbox(thread.id);
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {}}
                className="checkbox checkbox-xs checkbox-primary rounded"
              />
            </div>

            {/* Star Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(thread.id);
              }}
              className="btn btn-ghost btn-circle btn-xs -ml-1 text-base-content/40 hover:text-amber-500"
              title="Star email (s)"
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  thread.isStarred
                    ? 'fill-amber-400 text-amber-500'
                    : 'text-base-content/40 group-hover:text-base-content/70'
                }`}
              />
            </button>

            {/* Sender Name */}
            <div className="w-44 shrink-0 truncate flex items-center gap-1.5">
              <span className={`truncate ${isUnread ? 'font-bold text-base-content' : 'text-base-content/80'}`}>
                {thread.senderName}
              </span>
              {thread.messageCount > 1 && (
                <span className="text-[10px] text-base-content/50 font-semibold font-mono">
                  ({thread.messageCount})
                </span>
              )}
            </div>

            {/* Labels Badges */}
            <div className="flex items-center gap-1 shrink-0">
              {thread.labels.filter(l => l !== 'inbox').map((lbl) => (
                <span key={lbl} className={`badge badge-xs capitalize font-medium ${getBadgeClass(lbl)}`}>
                  {lbl}
                </span>
              ))}
            </div>

            {/* Subject & Snippet */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className={`truncate ${isUnread ? 'font-semibold text-base-content' : 'text-base-content/70'}`}>
                {thread.subject}
              </span>
              <span className="text-base-content/40 truncate text-[11px] hidden md:inline">
                - {thread.snippet}
              </span>
            </div>

            {/* Attachment Indicator */}
            {thread.hasAttachments && (
              <div className="shrink-0 text-base-content/40" title="Has attachments">
                <Paperclip className="w-3.5 h-3.5" />
              </div>
            )}

            {/* Time / Date */}
            <div className="w-20 text-right shrink-0 font-mono text-[11px] text-base-content/60">
              {thread.latestReceivedAt}
            </div>
          </div>
        );
      })}
    </div>
  );
};
