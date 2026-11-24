import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, Filter, KeyRound, Loader2, Plus, Save, Trash2, Upload, User, Zap } from 'lucide-react';
import {
  buildVacationSieve,
  changePassword,
  deleteSieveScript,
  getIdentity,
  getSieveScript,
  getVacation,
  listSieveScripts,
  saveSieveScript,
  setActiveSieveScript,
  setVacation,
  updateIdentityName,
  VacationSettings,
} from '../lib/collab';

interface SettingsViewProps {
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
  userEmail: string;
  onOpenImport?: () => void;
}

type Section = 'profile' | 'password' | 'filters' | 'vacation';

const NEW_SCRIPT = `require ["fileinto"];\n\n# Example: file invoices into a folder\n# if header :contains "subject" "invoice" {\n#     fileinto "Invoices";\n# }\n`;

export const SettingsView: React.FC<SettingsViewProps> = ({ onNotify, userEmail, onOpenImport }) => {
  const [section, setSection] = useState<Section>('profile');

  // Profile
  const [displayName, setDisplayName] = useState('');
  const [identityEmail, setIdentityEmail] = useState(userEmail);
  const [savingName, setSavingName] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Filters
  const [scripts, setScripts] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [scriptName, setScriptName] = useState('filter');
  const [scriptBody, setScriptBody] = useState(NEW_SCRIPT);
  const [savingScript, setSavingScript] = useState(false);

  // Vacation
  const [vacation, setVacation] = useState<VacationSettings>({ isEnabled: false });
  const [savingVacation, setSavingVacation] = useState(false);

  const loadFunctions = useCallback(async () => {
    try {
      const identity = await getIdentity();
      if (identity) {
        setDisplayName(identity.name);
        setIdentityEmail(identity.email || userEmail);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not load profile', 'error');
    }
    try {
      setScripts(await listSieveScripts());
    } catch {
      setScripts([]);
    }
    try {
      setVacation(await getVacation());
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not load vacation responder', 'error');
    }
  }, [onNotify, userEmail]);

  useEffect(() => {
    loadFunctions();
  }, [loadFunctions]);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    try {
      await updateIdentityName(displayName.trim());
      onNotify('Display name updated', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not update profile', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword.trim()) {
      onNotify('Enter your current password', 'error');
      return;
    }
    if (newPassword.length < 8) {
      onNotify('New password must be at least 8 characters', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      onNotify('New passwords do not match', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword(newPassword);
      onNotify('Password changed', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Password change failed', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const openScript = async (id: string) => {
    try {
      const content = await getSieveScript(id);
      const meta = scripts.find((s) => s.id === id);
      setScriptId(id);
      setScriptName(meta?.name ?? 'script');
      setScriptBody(content);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not load filter', 'error');
    }
  };

  const saveScript = async () => {
    if (!scriptName.trim()) {
      onNotify('Filter needs a name', 'error');
      return;
    }
    setSavingScript(true);
    try {
      const id = await saveSieveScript(scriptName.trim(), scriptBody, scriptId ?? undefined);
      setScriptId(id);
      setScripts(await listSieveScripts());
      onNotify('Filter saved', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save filter', 'error');
    } finally {
      setSavingScript(false);
    }
  };

  const activateScript = async (id: string) => {
    try {
      await setActiveSieveScript(id);
      setScripts(await listSieveScripts());
      onNotify('Filter activated', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not activate filter', 'error');
    }
  };

  const removeScript = async (id: string) => {
    if (!window.confirm('Delete this filter?')) return;
    try {
      await deleteSieveScript(id);
      if (scriptId === id) {
        setScriptId(null);
        setScriptName('filter');
        setScriptBody(NEW_SCRIPT);
      }
      setScripts(await listSieveScripts());
      onNotify('Filter deleted', 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not delete filter', 'error');
    }
  };

  const saveVacation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingVacation(true);
    try {
      await setVacation(vacation);
      // Mirrored Sieve script: best effort, VacationResponse alone is enough when Sieve is read-only.
      if (vacation.isEnabled) {
        try {
          const name = 'affinmail-vacation';
          const existing = scripts.find((s) => s.name === name);
          await saveSieveScript(name, buildVacationSieve(vacation), existing?.id);
          setScripts(await listSieveScripts());
        } catch {
          onNotify('Vacation saved; Sieve mirror script could not be written', 'info');
        }
      }
      onNotify(vacation.isEnabled ? 'Vacation responder enabled' : 'Vacation responder disabled', 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save vacation responder', 'error');
    } finally {
      setSavingVacation(false);
    }
  };

  const sections: { id: Section; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'password', label: 'Password', icon: KeyRound },
    { id: 'filters', label: 'Filters', icon: Filter },
    { id: 'vacation', label: 'Vacation responder', icon: Calendar },
  ];

  const inputClass =
    'mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue';
  const labelClass = 'block text-xs text-[#444746] dark:text-[#C4C7C5]';

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 min-w-0 bg-white dark:bg-[#1E1F20]">
      <nav className="shrink-0 border-b md:border-b-0 md:border-r border-[#F2F4F7] dark:border-[#333538] p-2 md:w-56 flex md:flex-col gap-0.5 overflow-x-auto md:overflow-visible">
        <h2 className="px-3 py-2 text-base font-medium shrink-0 text-[#1F1F1F] dark:text-[#E3E3E3]">Settings</h2>
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`shrink-0 flex items-center gap-2.5 px-3 h-10 md:h-9 rounded-full md:rounded-r-full text-xs font-medium transition-colors whitespace-nowrap ${
                section === s.id
                  ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF]'
                  : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              <Icon className="w-4 h-4 stroke-[1.5] shrink-0" />
              <span className="truncate">{s.label}</span>
            </button>
          );
        })}
        {onOpenImport && (
          <button
            onClick={onOpenImport}
            className="shrink-0 flex items-center gap-2.5 px-3 h-10 md:h-9 rounded-full md:rounded-r-full text-xs font-medium transition-colors text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 whitespace-nowrap"
          >
            <Upload className="w-4 h-4 stroke-[1.5] shrink-0" />
            <span className="truncate">Import mail</span>
          </button>
        )}
      </nav>

      <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-5">
        {section === 'profile' && (
          <form onSubmit={saveName} className="max-w-md w-full space-y-3">
            <h3 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Profile</h3>
            <label className={labelClass}>
              Display name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>
              Email
              <input value={identityEmail} readOnly className={`${inputClass} opacity-70`} />
            </label>
            <button
              type="submit"
              disabled={savingName}
              className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover transition-colors text-white text-xs font-medium disabled:opacity-60"
            >
              {savingName ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}

        {section === 'password' && (
          <form onSubmit={savePassword} className="max-w-md w-full space-y-3">
            <h3 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Change password</h3>
            <label className={labelClass}>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              The server must allow password changes over JMAP; the exact server error is shown if not.
            </p>
            <button
              type="submit"
              disabled={savingPassword}
              className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover transition-colors text-white text-xs font-medium disabled:opacity-60"
            >
              {savingPassword ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        {section === 'filters' && (
          <div className="max-w-2xl w-full space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Sieve filters</h3>
              <button
                onClick={() => {
                  setScriptId(null);
                  setScriptName('filter');
                  setScriptBody(NEW_SCRIPT);
                }}
                className="flex items-center gap-1 h-8 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] text-xs font-medium text-[#444746] dark:text-[#C4C7C5]"
              >
                <Plus className="w-4 h-4 stroke-[1.5]" />
                New filter
              </button>
            </div>

            {scripts.length > 0 && (
              <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] divide-y divide-[#F2F4F7] dark:divide-[#333538]">
                {scripts.map((script) => (
                  <div key={script.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <button onClick={() => openScript(script.id)} className="flex items-center gap-2 min-w-0 text-left">
                      <Filter className="w-3.5 h-3.5 stroke-[1.5] text-[#5E5E5E] dark:text-[#8E918F] shrink-0" />
                      <span className="text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">{script.name}</span>
                      {script.isActive && (
                        <span className="text-xs text-[#137333] dark:text-[#81C995] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#137333] dark:bg-[#81C995]" />
                          Active
                        </span>
                      )}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {!script.isActive && (
                        <button
                          onClick={() => activateScript(script.id)}
                          className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center rounded-md text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          title="Activate"
                        >
                          <Zap className="w-3.5 h-3.5 stroke-[1.5]" />
                        </button>
                      )}
                      <button
                        onClick={() => removeScript(script.id)}
                        className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center rounded-md text-[#444746] dark:text-[#C4C7C5] hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <label className={labelClass}>
              Script name
              <input value={scriptName} onChange={(e) => setScriptName(e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>
              Sieve source
              <textarea
                value={scriptBody}
                onChange={(e) => setScriptBody(e.target.value)}
                rows={12}
                spellCheck={false}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-[#F6F8FC] dark:bg-[#131314] font-mono text-xs leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue resize-y"
              />
            </label>
            <button
              onClick={saveScript}
              disabled={savingScript}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover transition-colors text-white text-xs font-medium disabled:opacity-60"
            >
              {savingScript ? <Loader2 className="w-3.5 h-3.5 stroke-[1.5] animate-spin" /> : <Save className="w-3.5 h-3.5 stroke-[1.5]" />}
              {scriptId ? 'Save filter' : 'Create filter'}
            </button>
          </div>
        )}

        {section === 'vacation' && (
          <form onSubmit={saveVacation} className="max-w-md w-full space-y-3">
            <h3 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Vacation responder</h3>
            <label className="flex items-center gap-2 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              <input
                type="checkbox"
                checked={vacation.isEnabled}
                onChange={(e) => setVacation({ ...vacation, isEnabled: e.target.checked })}
                className="checkbox checkbox-sm checkbox-primary"
              />
              Enable out-of-office replies
            </label>
            <label className={labelClass}>
              Subject
              <input
                value={vacation.subject ?? ''}
                onChange={(e) => setVacation({ ...vacation, subject: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Message
              <textarea
                value={vacation.textBody ?? ''}
                onChange={(e) => setVacation({ ...vacation, textBody: e.target.value })}
                rows={6}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue resize-none"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={labelClass}>
                From (optional)
                <input
                  type="date"
                  value={vacation.fromDate?.slice(0, 10) ?? ''}
                  onChange={(e) => setVacation({ ...vacation, fromDate: e.target.value || undefined })}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                To (optional)
                <input
                  type="date"
                  value={vacation.toDate?.slice(0, 10) ?? ''}
                  onChange={(e) => setVacation({ ...vacation, toDate: e.target.value || undefined })}
                  className={inputClass}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={savingVacation}
              className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover transition-colors text-white text-xs font-medium disabled:opacity-60"
            >
              {savingVacation ? 'Saving…' : 'Save responder'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
