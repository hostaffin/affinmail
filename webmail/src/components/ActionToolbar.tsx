import React from 'react';
import {
  Archive,
  AlertOctagon,
  Trash2,
  MailCheck,
  Tag,
  FolderInput,
  RotateCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface ActionToolbarProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onArchive: () => void;
  onReportSpam: () => void;
  onDelete: () => void;
  onMarkRead: () => void;
  onRefresh: () => void;
  isDetailView?: boolean;
  onBackToList?: () => void;
}

export const ActionToolbar: React.FC<ActionToolbarProps> = ({
  selectedCount,
  totalCount,
  allSelected,
  onToggleSelectAll,
  onArchive,
  onReportSpam,
  onDelete,
  onMarkRead,
  onRefresh,
  isDetailView = false,
  onBackToList,
}) => {
  return (
    <div className="h-12 border-b border-base-300 bg-base-100/90 px-3 sm:px-4 flex items-center justify-between select-none shrink-0 gap-2 overflow-x-auto">
      {/* Left Action Controls */}
      <div className="flex items-center gap-1 shrink-0">
        {isDetailView ? (
          <button
            onClick={onBackToList}
            className="btn btn-ghost btn-xs gap-1 text-base-content/70 hover:text-base-content normal-case font-medium"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back to list</span>
            <kbd className="kbd kbd-xs text-[9px] bg-base-200 hidden sm:inline-block">Esc</kbd>
          </button>
        ) : (
          <div className="flex items-center gap-2 mr-1 sm:mr-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
              className="checkbox checkbox-xs checkbox-primary rounded"
              title="Select all"
              aria-label="Select all conversations"
            />
          </div>
        )}

        <div className="h-4 w-px bg-base-300 mx-0.5 sm:mx-1"></div>

        {/* Action Buttons */}
        <button
          onClick={onArchive}
          title="Archive (e)"
          className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content hover:bg-base-200 shrink-0"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onReportSpam}
          title="Report Spam"
          className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-error hover:bg-base-200 shrink-0 hidden sm:inline-flex"
        >
          <AlertOctagon className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onDelete}
          title="Delete (#)"
          className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-error hover:bg-base-200 shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-base-300 mx-0.5 sm:mx-1"></div>

        <button
          onClick={onMarkRead}
          title="Mark as Read"
          className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-primary hover:bg-base-200 shrink-0"
        >
          <MailCheck className="w-3.5 h-3.5" />
        </button>

        <button
          title="Apply Label"
          className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content hover:bg-base-200 shrink-0 hidden md:inline-flex"
        >
          <Tag className="w-3.5 h-3.5" />
        </button>

        <button
          title="Move to folder"
          className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content hover:bg-base-200 shrink-0 hidden md:inline-flex"
        >
          <FolderInput className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onRefresh}
          title="Refresh messages"
          className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content hover:bg-base-200 shrink-0"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        {selectedCount > 0 && (
          <span className="text-xs text-primary font-medium ml-1 sm:ml-2 shrink-0">
            {selectedCount} selected
          </span>
        )}
      </div>

      {/* Right Pagination & Count */}
      <div className="flex items-center gap-1.5 sm:gap-3 text-xs text-base-content/60 font-mono shrink-0">
        <span className="text-[11px] sm:text-xs">1–{totalCount}</span>
        <div className="flex items-center gap-0.5">
          <button className="btn btn-ghost btn-circle btn-xs disabled:opacity-30" disabled>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button className="btn btn-ghost btn-circle btn-xs disabled:opacity-30" disabled>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
