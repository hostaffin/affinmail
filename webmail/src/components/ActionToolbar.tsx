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
  Columns2,
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
  /** Shown when 2-3 conversations are checkbox-selected. */
  onCompare?: () => void;
}

const ICON_BTN =
  'h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors';
const MENU_ITEM =
  'w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors';

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
  onCompare,
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
    <div className="min-h-12 border-b border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] px-2 sm:px-4 py-1 flex items-center justify-between select-none shrink-0 gap-1 sm:gap-2 transition-colors">
      {/* Left controls */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
        {isDetailView ? (
          <button
            onClick={onBackToList}
            className="h-10 min-h-10 md:h-8 md:min-h-8 px-2 md:px-3 shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors flex items-center gap-1.5"
            title="Back to inbox (u or Esc)"
          >
            <ArrowLeft className="w-5 h-5 stroke-[1.5]" />
            <span className="text-xs font-medium hidden sm:inline text-[#1F1F1F] dark:text-[#E3E3E3]">Back</span>
            <kbd className="text-xs font-mono bg-[#F2F6FC] dark:bg-[#282A2C] px-2 py-1 rounded text-[#5E5E5E] dark:text-[#8E918F] hidden md:inline">
              Esc
            </kbd>
          </button>
        ) : (
          <div className="relative flex items-center mr-0.5 sm:mr-1 shrink-0" ref={selectMenuRef}>
            <div className="flex items-center rounded-lg hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] p-1 transition-colors">
              <div
                className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center cursor-pointer [&>div]:pointer-events-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelectAll();
                }}
              >
                <GmailCheckbox
                  checked={allSelected}
                  indeterminate={selectedCount > 0 && !allSelected}
                  onChange={onToggleSelectAll}
                  title="Select"
                  ariaLabel="Select all conversations"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsSelectMenuOpen((prev) => !prev)}
                className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center ml-1 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] rounded"
                title="Select options"
              >
                <ChevronDown className="w-4 h-4 stroke-[1.5]" />
              </button>
            </div>

            {isSelectMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-[#1E1F20] rounded-xl shadow-gmail-modal border border-[#E0E2E7] dark:border-[#333538] py-2 z-40 text-xs font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">
                <button onClick={() => handleSelectOption('all')} className={MENU_ITEM}>All</button>
                <button onClick={() => handleSelectOption('none')} className={MENU_ITEM}>None</button>
                <button onClick={() => handleSelectOption('read')} className={MENU_ITEM}>Read</button>
                <button onClick={() => handleSelectOption('unread')} className={MENU_ITEM}>Unread</button>
                <button onClick={() => handleSelectOption('starred')} className={MENU_ITEM}>Starred</button>
                <button onClick={() => handleSelectOption('unstarred')} className={MENU_ITEM}>Unstarred</button>
              </div>
            )}
          </div>
        )}

        {!isDetailView && selectedCount === 0 && (
          <button onClick={onRefresh} title="Refresh" className={ICON_BTN}>
            <RotateCw className="w-4 h-4 stroke-[1.5]" />
          </button>
        )}

        {(selectedCount > 0 || isDetailView) && (
          <>
            <button onClick={onArchive} title="Archive (e)" className={ICON_BTN}>
              <Archive className="w-4 h-4 stroke-[1.5]" />
            </button>

            <button
              onClick={onReportSpam}
              title="Report spam (!)"
              className={`${ICON_BTN} hover:text-red-600 dark:hover:text-red-400 hidden sm:inline-flex`}
            >
              <AlertOctagon className="w-4 h-4 stroke-[1.5]" />
            </button>

            <button
              onClick={onDelete}
              title="Delete (#)"
              className={`${ICON_BTN} hover:text-red-600 dark:hover:text-red-400`}
            >
              <Trash2 className="w-4 h-4 stroke-[1.5]" />
            </button>

            <div className="h-4 w-px bg-[#E0E2E7] dark:bg-[#333538] mx-1"></div>

            <button onClick={onMarkRead} title="Mark as read" className={ICON_BTN}>
              <MailCheck className="w-4 h-4 stroke-[1.5]" />
            </button>

            {onMarkUnread && (
              <button onClick={onMarkUnread} title="Mark as unread" className={`${ICON_BTN} hidden sm:inline-flex`}>
                <Mail className="w-4 h-4 stroke-[1.5]" />
              </button>
            )}

            <button onClick={onSnooze} title="Snooze" className={`${ICON_BTN} hidden sm:inline-flex`}>
              <Clock className="w-4 h-4 stroke-[1.5]" />
            </button>

            <button title="Add to tasks" className={`${ICON_BTN} hidden md:inline-flex`}>
              <CheckSquare className="w-4 h-4 stroke-[1.5]" />
            </button>

            <div className="h-4 w-px bg-[#E0E2E7] dark:bg-[#333538] mx-1 hidden md:block"></div>

            <button title="Move to" className={`${ICON_BTN} hidden md:inline-flex`}>
              <FolderInput className="w-4 h-4 stroke-[1.5]" />
            </button>

            <button title="Labels" className={`${ICON_BTN} hidden md:inline-flex`}>
              <Tag className="w-4 h-4 stroke-[1.5]" />
            </button>
          </>
        )}

        <div className="relative" ref={moreMenuRef}>
          <button
            onClick={() => setIsMoreMenuOpen((prev) => !prev)}
            title="More"
            className={ICON_BTN}
          >
            <MoreVertical className="w-4 h-4 stroke-[1.5]" />
          </button>
          {isMoreMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-[#1E1F20] rounded-xl shadow-gmail-modal border border-[#E0E2E7] dark:border-[#333538] py-2 z-40 text-xs font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">
              <button
                onClick={() => {
                  onMarkRead();
                  setIsMoreMenuOpen(false);
                }}
                className={MENU_ITEM}
              >
                Mark all as read
              </button>
              <button onClick={() => setIsMoreMenuOpen(false)} className={MENU_ITEM}>
                Filter messages like these
              </button>
              <button onClick={() => setIsMoreMenuOpen(false)} className={MENU_ITEM}>
                Mute conversation
              </button>
            </div>
          )}
        </div>

        {!isDetailView && selectedCount >= 2 && selectedCount <= 3 && onCompare && (
          <button
            onClick={onCompare}
            title="Open the selected emails side by side"
            className="h-10 min-h-10 md:h-8 md:min-h-8 px-3 ml-1 shrink-0 flex items-center gap-2 rounded-full border border-[#C4C7C5] dark:border-[#5F6368] text-xs font-medium text-[#0B57D0] dark:text-[#A8C7FA] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors"
          >
            <Columns2 className="w-4 h-4 stroke-[1.5]" />
            <span className="hidden sm:inline">Compare</span>
          </button>
        )}

        {selectedCount > 0 && (
          <span className="text-xs text-[#444746] dark:text-[#C4C7C5] font-normal ml-2 shrink-0 tabular-nums">
            {selectedCount} selected
          </span>
        )}
      </div>

      {/* Right: count and paging */}
      <div className="flex items-center gap-1 sm:gap-2 text-xs text-[#444746] dark:text-[#C4C7C5] shrink-0 font-normal select-none">
        <span className="text-xs tabular-nums hidden sm:inline">
          {totalCount > 0 ? `1–${totalCount} of ${totalCount}` : '0 of 0'}
        </span>
        <div className="flex items-center">
          <button
            className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            disabled
            title="Newer"
          >
            <ChevronLeft className="w-4 h-4 stroke-[1.5]" />
          </button>
          <button
            className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            disabled
            title="Older"
          >
            <ChevronRight className="w-4 h-4 stroke-[1.5]" />
          </button>
        </div>
      </div>
    </div>
  );
};
