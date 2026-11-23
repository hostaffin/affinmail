import React, { useState, useRef, useEffect } from 'react';
import {
  Archive,
  AlertOctagon,
  Trash2,
  Mail,
  MailCheck,
  Tag,
  FolderInput,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Clock,
  MoreVertical,
  CheckSquare,
} from 'lucide-react';
import { GmailCheckbox } from './GmailCheckbox';

interface ActionToolbarProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onSelectSpecific?: (type: 'all' | 'none' | 'read' | 'unread' | 'starred' | 'unstarred') => void;
  onArchive: () => void;
  onReportSpam: () => void;
  onDelete: () => void;
  onMarkRead: () => void;
  onMarkUnread?: () => void;
  onSnooze?: () => void;
  onRefresh: () => void;
  isDetailView?: boolean;
  onBackToList?: () => void;
}

export const ActionToolbar: React.FC<ActionToolbarProps> = ({
  selectedCount,
  totalCount,
  allSelected,
  onToggleSelectAll,
  onSelectSpecific,
  onArchive,
  onReportSpam,
  onDelete,
  onMarkRead,
  onMarkUnread,
  onSnooze,
  onRefresh,
  isDetailView = false,
  onBackToList,
}) => {
  const [isSelectMenuOpen, setIsSelectMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const selectMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectMenuRef.current && !selectMenuRef.current.contains(e.target as Node)) {
        setIsSelectMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectOption = (type: 'all' | 'none' | 'read' | 'unread' | 'starred' | 'unstarred') => {
    setIsSelectMenuOpen(false);
    if (onSelectSpecific) {
      onSelectSpecific(type);
    } else if (type === 'all') {
      onToggleSelectAll();
    } else if (type === 'none') {
      if (allSelected || selectedCount > 0) onToggleSelectAll();
    }
  };

  return (
    <div className="h-12 border-b border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] px-4 flex items-center justify-between select-none shrink-0 gap-2 transition-colors">
      {/* Left Toolbar Controls */}
      <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
        {isDetailView ? (
          <button
            onClick={onBackToList}
            className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors flex items-center gap-1.5"
            title="Back to Inbox (u or Esc)"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2]" />
            <span className="text-xs font-medium hidden sm:inline text-[#1F1F1F] dark:text-[#E3E3E3]">Back</span>
            <kbd className="text-[10px] font-mono bg-gray-100 dark:bg-[#282A2C] px-1 py-0.5 rounded text-gray-500 hidden md:inline">
              Esc
            </kbd>
          </button>
        ) : (
          /* Checkbox with Dropdown Caret Split Button */
          <div className="relative flex items-center mr-1" ref={selectMenuRef}>
            <div className="flex items-center rounded-lg hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] p-1 transition-colors">
              <GmailCheckbox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onChange={onToggleSelectAll}
                title="Select"
                ariaLabel="Select all conversations"
              />
              <button
                type="button"
                onClick={() => setIsSelectMenuOpen((prev) => !prev)}
                className="p-1 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] rounded"
                title="Select options"
              >
                <ChevronDown className="w-3.5 h-3.5 stroke-[2]" />
              </button>
            </div>

            {/* Selection Dropdown */}
            {isSelectMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-36 bg-white dark:bg-[#1E1F20] rounded-xl shadow-lg border border-[#E0E2E7] dark:border-[#333538] py-1.5 z-40 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                <button
                  onClick={() => handleSelectOption('all')}
                  className="w-full text-left px-3.5 py-1.5 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
                >
                  All
                </button>
                <button
                  onClick={() => handleSelectOption('none')}
                  className="w-full text-left px-3.5 py-1.5 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
                >
                  None
                </button>
                <button
                  onClick={() => handleSelectOption('read')}
                  className="w-full text-left px-3.5 py-1.5 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
                >
                  Read
                </button>
                <button
                  onClick={() => handleSelectOption('unread')}
                  className="w-full text-left px-3.5 py-1.5 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
                >
                  Unread
                </button>
                <button
                  onClick={() => handleSelectOption('starred')}
                  className="w-full text-left px-3.5 py-1.5 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
                >
                  Starred
                </button>
                <button
                  onClick={() => handleSelectOption('unstarred')}
                  className="w-full text-left px-3.5 py-1.5 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
                >
                  Unstarred
                </button>
              </div>
            )}
          </div>
        )}

        {/* If no items are selected and not in detail view, show Refresh */}
        {!isDetailView && selectedCount === 0 && (
          <button
            onClick={onRefresh}
            title="Refresh"
            className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
          >
            <RotateCw className="w-4 h-4 stroke-[2]" />
          </button>
        )}

        {/* Action Icons when items are selected OR in Detail View */}
        {(selectedCount > 0 || isDetailView) && (
          <>
            <button
              onClick={onArchive}
              title="Archive (e)"
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
            >
              <Archive className="w-4 h-4 stroke-[2]" />
            </button>

            <button
              onClick={onReportSpam}
              title="Report spam (!)"
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden sm:inline-flex"
            >
              <AlertOctagon className="w-4 h-4 stroke-[2]" />
            </button>

            <button
              onClick={onDelete}
              title="Delete (#)"
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
            >
              <Trash2 className="w-4 h-4 stroke-[2]" />
            </button>

            <div className="h-4 w-px bg-[#E0E2E7] dark:bg-[#333538] mx-1"></div>

            <button
              onClick={onMarkRead}
              title="Mark as read"
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
            >
              <MailCheck className="w-4 h-4 stroke-[2]" />
            </button>

            {onMarkUnread && (
              <button
                onClick={onMarkUnread}
                title="Mark as unread"
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden sm:inline-flex"
              >
                <Mail className="w-4 h-4 stroke-[2]" />
              </button>
            )}

            <button
              onClick={onSnooze}
              title="Snooze"
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden sm:inline-flex"
            >
              <Clock className="w-4 h-4 stroke-[2]" />
            </button>

            <button
              title="Add to tasks"
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden md:inline-flex"
            >
              <CheckSquare className="w-4 h-4 stroke-[2]" />
            </button>

            <div className="h-4 w-px bg-[#E0E2E7] dark:bg-[#333538] mx-1 hidden md:block"></div>

            <button
              title="Move to"
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden md:inline-flex"
            >
              <FolderInput className="w-4 h-4 stroke-[2]" />
            </button>

            <button
              title="Labels"
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden md:inline-flex"
            >
              <Tag className="w-4 h-4 stroke-[2]" />
            </button>
          </>
        )}

        {/* More Actions Dropdown */}
        <div className="relative" ref={moreMenuRef}>
          <button
            onClick={() => setIsMoreMenuOpen((prev) => !prev)}
            title="More"
            className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
          >
            <MoreVertical className="w-4 h-4 stroke-[2]" />
          </button>
          {isMoreMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-[#1E1F20] rounded-xl shadow-lg border border-[#E0E2E7] dark:border-[#333538] py-1.5 z-40 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              <button
                onClick={() => {
                  onMarkRead();
                  setIsMoreMenuOpen(false);
                }}
                className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
              >
                Mark all as read
              </button>
              <button
                onClick={() => setIsMoreMenuOpen(false)}
                className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
              >
                Filter messages like these
              </button>
              <button
                onClick={() => setIsMoreMenuOpen(false)}
                className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
              >
                Mute conversation
              </button>
            </div>
          )}
        </div>

        {selectedCount > 0 && (
          <span className="text-xs text-[#444746] dark:text-[#C4C7C5] font-medium ml-2 shrink-0 tabular-nums">
            {selectedCount} selected
          </span>
        )}
      </div>

      {/* Right Pagination & Count */}
      <div className="flex items-center gap-1 sm:gap-2 text-xs text-[#444746] dark:text-[#C4C7C5] shrink-0 font-medium select-none">
        <span className="text-xs tabular-nums tracking-tight">
          {totalCount > 0 ? `1–${totalCount} of ${totalCount}` : '0 of 0'}
        </span>
        <div className="flex items-center">
          <button
            className="p-1.5 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            disabled
            title="Newer"
          >
            <ChevronLeft className="w-4 h-4 stroke-[2]" />
          </button>
          <button
            className="p-1.5 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            disabled
            title="Older"
          >
            <ChevronRight className="w-4 h-4 stroke-[2]" />
          </button>
        </div>
      </div>
    </div>
  );
};
