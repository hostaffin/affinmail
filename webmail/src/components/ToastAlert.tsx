import React from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'error' | 'success' | 'info';
  message: string;
}

interface ToastAlertProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastAlert: React.FC<ToastAlertProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="toast toast-bottom toast-end z-[70] space-y-2 mb-3 right-3 sm:right-4 left-3 sm:left-auto max-w-[calc(100vw-1.5rem)] sm:max-w-md pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-[#1F1F1F] dark:bg-[#E3E3E3] text-white dark:text-[#1F1F1F] border border-white/10 dark:border-black/10 shadow-md text-xs py-2 px-3 rounded-lg flex items-center justify-between gap-3 pointer-events-auto transition-opacity"
        >
          <div className="flex items-center gap-2">
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 stroke-[1.5] text-red-400 dark:text-red-600 shrink-0" />}
            {toast.type === 'success' && <CheckCircle className="w-4 h-4 stroke-[1.5] text-green-400 dark:text-green-700 shrink-0" />}
            {toast.type === 'info' && <Info className="w-4 h-4 stroke-[1.5] opacity-70 shrink-0" />}
            <span className="font-normal text-xs">{toast.message}</span>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="opacity-50 hover:opacity-100 h-8 w-8 min-h-8 flex items-center justify-center rounded transition-opacity shrink-0"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
      ))}
    </div>
  );
};
