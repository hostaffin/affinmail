import React, { useState } from 'react';
import {
  Smartphone,
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Sparkles,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';
import {
  AppPassword,
  listAppPasswords,
  generateAppPassword,
  revokeAppPassword,
} from '../../lib/clientSelfService';

interface AppPasswordsSettingsProps {
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
}

export const AppPasswordsSettings: React.FC<AppPasswordsSettingsProps> = ({ onNotify }) => {
  const [passwords, setPasswords] = useState<AppPassword[]>(() => listAppPasswords());
  const [appName, setAppName] = useState('');
  const [generatedPass, setGeneratedPass] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appName.trim()) {
      onNotify('Please enter a name for the app (e.g. "Mac Mail" or "Thunderbird")', 'error');
      return;
    }

    try {
      const { entry, rawPassword } = generateAppPassword(appName.trim());
      setPasswords(listAppPasswords());
      setGeneratedPass(rawPassword);
      setAppName('');
      onNotify(`App password generated for ${entry.name}`, 'success');
    } catch {
      onNotify('Failed to generate app password', 'error');
    }
  };

  const handleRevoke = (id: string) => {
    if (!window.confirm('Revoke this app password? Any device or application using it will immediately be signed out.')) {
      return;
    }
    revokeAppPassword(id);
    setPasswords(listAppPasswords());
    onNotify('App password revoked', 'info');
  };

  const copyPassword = async () => {
    if (!generatedPass) return;
    try {
      await navigator.clipboard.writeText(generatedPass);
      setCopied(true);
      onNotify('App password copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      onNotify('Could not copy to clipboard', 'error');
    }
  };

  const inputClass =
    'mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue';
  const labelClass = 'block text-xs font-medium text-[#444746] dark:text-[#C4C7C5]';

  return (
    <div className="max-w-2xl w-full space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-gmail-blue dark:text-gmail-dark-blue-text" />
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            App Passwords
          </h3>
        </div>
        <p className="mt-1 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
          App passwords allow external email clients (Thunderbird, Apple Mail, Outlook, iOS Mail) to connect securely over IMAP/SMTP without exposing your master mailbox password.
        </p>
      </div>

      {/* Generated Banner */}
      {generatedPass && (
        <div className="rounded-xl border border-[#C2E7FF] dark:border-[#004A77] bg-[#EAF1FB] dark:bg-[#002744] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[#001D35] dark:text-[#C2E7FF]">
              <Sparkles className="w-4 h-4 text-gmail-blue dark:text-gmail-dark-blue-text" />
              New 16-Character App Password
            </span>
            <button
              onClick={() => setGeneratedPass(null)}
              className="text-xs text-[#5E5E5E] dark:text-[#8E918F] hover:underline"
            >
              Done
            </button>
          </div>
          <p className="text-xs text-[#444746] dark:text-[#C4C7C5]">
            Enter this 16-character password into your email client. Spaces and hyphens are optional. This password is shown only once.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-4 py-2.5 rounded-lg bg-white dark:bg-[#131314] border border-[#E0E2E7] dark:border-[#333538] font-mono text-sm tracking-widest font-bold text-[#1F1F1F] dark:text-[#E3E3E3] select-all text-center">
              {generatedPass}
            </code>
            <button
              onClick={copyPassword}
              className="h-10 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover text-white text-xs font-medium flex items-center gap-1.5 shrink-0 transition-colors"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy Password'}
            </button>
          </div>
        </div>
      )}

      {/* Generate Form */}
      <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-4 space-y-4 bg-white dark:bg-[#1E1F20]">
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] flex items-center gap-2">
          <Key className="w-4 h-4 text-[#5E5E5E] dark:text-[#8E918F]" />
          Create an App Password
        </h4>
        <form onSubmit={handleGenerate} className="space-y-3">
          <label className={labelClass}>
            Application Name or Device
            <input
              type="text"
              placeholder="e.g. Apple Mail on MacBook, Thunderbird Laptop, Outlook"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Generate Password
          </button>
        </form>
      </div>

      {/* List Active Passwords */}
      <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-4 space-y-3 bg-white dark:bg-[#1E1F20]">
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
          Active App Passwords ({passwords.length})
        </h4>

        {passwords.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#5E5E5E] dark:text-[#8E918F] flex flex-col items-center gap-1.5">
            <AlertCircle className="w-5 h-5 opacity-40" />
            No app passwords generated. Generate one above to connect third-party mail apps.
          </div>
        ) : (
          <div className="divide-y divide-[#F2F4F7] dark:divide-[#333538] border border-[#E0E2E7] dark:border-[#333538] rounded-lg overflow-hidden">
            {passwords.map((p) => (
              <div key={p.id} className="p-3 flex items-center justify-between gap-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                      {p.name}
                    </span>
                    <span className="text-[10px] text-[#5E5E5E] dark:text-[#8E918F]">
                      Created {new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                  <code className="text-[11px] font-mono text-[#5E5E5E] dark:text-[#8E918F]">
                    {p.passwordPreview}
                  </code>
                </div>

                <button
                  onClick={() => handleRevoke(p.id)}
                  className="h-8 px-2.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1 transition-colors shrink-0"
                  title="Revoke app password"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Revoke</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
