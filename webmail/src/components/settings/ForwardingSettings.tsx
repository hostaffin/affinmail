import React, { useState } from 'react';
import { CornerUpRight, Save, Loader2, AlertCircle } from 'lucide-react';
import {
  ForwardingSettings as IForwardingSettings,
  getStoredForwardingSettings,
  saveForwardingSettings,
} from '../../lib/clientSelfService';

interface ForwardingSettingsProps {
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
}

export const ForwardingSettings: React.FC<ForwardingSettingsProps> = ({ onNotify }) => {
  const [settings, setSettings] = useState<IForwardingSettings>(() => getStoredForwardingSettings());
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (settings.isEnabled) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!settings.destination.trim() || !emailRegex.test(settings.destination.trim())) {
        onNotify('Please enter a valid destination email address', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      await saveForwardingSettings(settings);
      onNotify(
        settings.isEnabled
          ? `Automatic forwarding enabled to ${settings.destination}`
          : 'Email forwarding disabled',
        'success'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save forwarding settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue';
  const labelClass = 'block text-xs font-medium text-[#444746] dark:text-[#C4C7C5]';

  return (
    <div className="max-w-md w-full space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <CornerUpRight className="w-5 h-5 text-gmail-blue dark:text-gmail-dark-blue-text" />
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            Email Forwarding
          </h3>
        </div>
        <p className="mt-1 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
          Automatically redirect incoming messages to another email address using Sieve filtering rules.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Enable toggle */}
        <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-4 space-y-4 bg-white dark:bg-[#1E1F20]">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.isEnabled}
              onChange={(e) => setSettings({ ...settings, isEnabled: e.target.checked })}
              className="checkbox checkbox-sm checkbox-primary mt-0.5"
            />
            <div>
              <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                Enable automatic forwarding
              </span>
              <p className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">
                Forward all new incoming messages to the designated address
              </p>
            </div>
          </label>

          {/* Destination */}
          <label className={labelClass}>
            Forward to email address
            <input
              type="email"
              disabled={!settings.isEnabled}
              placeholder="e.g. personal@example.com"
              value={settings.destination}
              onChange={(e) => setSettings({ ...settings, destination: e.target.value })}
              className={`${inputClass} disabled:opacity-50`}
            />
          </label>

          {/* Keep copy toggle */}
          <label className={`flex items-start gap-3 cursor-pointer ${!settings.isEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <input
              type="checkbox"
              disabled={!settings.isEnabled}
              checked={settings.keepCopy}
              onChange={(e) => setSettings({ ...settings, keepCopy: e.target.checked })}
              className="checkbox checkbox-sm checkbox-primary mt-0.5"
            />
            <div>
              <span className="text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                Keep a copy of forwarded messages in mailbox
              </span>
              <p className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">
                When checked, messages remain in your AffinMail Inbox after forwarding.
              </p>
            </div>
          </label>
        </div>

        {/* Tip */}
        <div className="rounded-lg bg-[#F6F8FC] dark:bg-[#131314] border border-[#E0E2E7] dark:border-[#333538] p-3 text-xs text-[#5E5E5E] dark:text-[#8E918F] flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-gmail-blue shrink-0 mt-0.5" />
          <span>
            Forwarding rules are powered by server-side RFC 5228 Sieve scripts, guaranteeing zero-latency redirection before mail hits local storage.
          </span>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover text-white text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save Forwarding Settings'}
        </button>
      </form>
    </div>
  );
};
