import React from 'react';
import { Check, Minus } from 'lucide-react';

interface GmailCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  title?: string;
  ariaLabel?: string;
}

export const GmailCheckbox: React.FC<GmailCheckboxProps> = ({
  checked,
  indeterminate = false,
  onChange,
  title,
  ariaLabel,
}) => {
  return (
    <div
      role="checkbox"
      tabIndex={0}
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      title={title}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          onChange();
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`w-4 h-4 rounded border transition-colors flex items-center justify-center cursor-pointer select-none shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gmail-blue ${
        checked || indeterminate
          ? 'bg-[#0B57D0] border-[#0B57D0] dark:bg-[#A8C7FA] dark:border-[#A8C7FA] text-white dark:text-[#042B5C]'
          : 'border-[#8E918F] bg-transparent hover:border-[#1F1F1F] dark:hover:border-[#E3E3E3] hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {checked && <Check className="w-3 h-3 stroke-[2]" />}
      {indeterminate && !checked && <Minus className="w-3 h-3 stroke-[2]" />}
    </div>
  );
};
