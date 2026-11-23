import React, { useEffect } from 'react';
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
    <div className="toast toast-bottom toast-end z-[70] space-y-2 mb-2 mr-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`alert shadow-lg text-xs py-2.5 px-4 rounded-xl flex items-center justify-between gap-3 border ${
            toast.type === 'error'
              ? 'alert-error text-white border-red-600'
              : toast.type === 'success'
              ? 'alert-success text-white border-green-600'
              : 'alert-info text-white border-blue-600'
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
            {toast.type === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
            {toast.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
            <span className="font-medium">{toast.message}</span>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="hover:opacity-80 p-0.5 rounded-full"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
