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
      className={`w-[18px] h-[18px] rounded-[3px] border transition-all flex items-center justify-center cursor-pointer select-none shrink-0 ${
        checked || indeterminate
          ? 'bg-[#0B57D0] border-[#0B57D0] text-white shadow-xs'
          : 'border-[#747775] dark:border-[#8E918F] bg-transparent hover:border-[#1F1F1F] dark:hover:border-[#E3E3E3] hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {checked && <Check className="w-3.5 h-3.5 stroke-[3] text-white" />}
      {indeterminate && !checked && <Minus className="w-3.5 h-3.5 stroke-[3] text-white" />}
    </div>
  );
};
