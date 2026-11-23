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
    <div className="toast toast-bottom toast-end z-[70] space-y-1.5 mb-3 right-3 sm:right-4 left-3 sm:left-auto max-w-[calc(100vw-1.5rem)] sm:max-w-md pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-neutral text-neutral-content border border-base-300 shadow-md text-xs py-2 px-3 rounded-lg flex items-center justify-between gap-3 pointer-events-auto transition-opacity"
        >
          <div className="flex items-center gap-2">
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 stroke-[1.5] text-error shrink-0" />}
            {toast.type === 'success' && <CheckCircle className="w-4 h-4 stroke-[1.5] text-success shrink-0" />}
            {toast.type === 'info' && <Info className="w-4 h-4 stroke-[1.5] text-base-content/60 shrink-0" />}
            <span className="font-normal text-xs">{toast.message}</span>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-neutral-content/50 hover:text-neutral-content p-0.5 rounded"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
      ))}
    </div>
  );
};

