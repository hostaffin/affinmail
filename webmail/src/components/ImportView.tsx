import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Inbox, Loader2, Server, Upload } from 'lucide-react';
import { ImportJob, importEml, importImap, importMbox, listImportJobs } from '../lib/importApi';

interface ImportViewProps {
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
  userEmail: string;
}

type SourceType = 'imap' | 'mbox' | 'eml';

const inputClass =
  'mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue';
const labelClass = 'block text-xs text-[#444746] dark:text-[#C4C7C5]';
const fieldsetClass = 'rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-4 space-y-3';

export const ImportView: React.FC<ImportViewProps> = ({ onNotify, userEmail }) => {
  const [source, setSource] = useState<SourceType>('imap');
  const [targetEmail, setTargetEmail] = useState(userEmail);
  const [targetFolder, setTargetFolder] = useState('');
  const [targetPassword, setTargetPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // IMAP source
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [ssl, setSsl] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sourceFolder, setSourceFolder] = useState('INBOX');

  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [history, setHistory] = useState<ImportJob[]>([]);

  const refreshHistory = async () => {
    try {
      const res = await listImportJobs(targetEmail.trim() || undefined);
      setHistory(res.jobs);
    } catch {
      setHistory([]);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEmail.trim()) {
      onNotify('Enter a target email address', 'error');
      return;
    }
    setRunning(true);
    setJob(null);
    try {
      let result: ImportJob;
      if (source === 'imap') {
        result = await importImap({
          host: host.trim(),
          port: Number(port) || undefined,
          ssl,
          username: username.trim(),
          password,
          sourceFolder: sourceFolder.trim() || 'INBOX',
          targetEmail: targetEmail.trim(),
          targetFolder: targetFolder.trim() || undefined,
          targetPassword: targetPassword || undefined,
        });
      } else {
        if (!file) {
          onNotify(`Choose a ${source === 'eml' ? '.eml' : 'mbox'} file first`, 'error');
          setRunning(false);
          return;
        }
        const fn = source === 'eml' ? importEml : importMbox;
        result = await fn(file, targetEmail.trim(), targetFolder.trim() || undefined, targetPassword || undefined);
      }
      setJob(result);
      onNotify(
        result.status === 'failed'
          ? 'Import failed'
          : `Imported ${result.imported} message${result.imported === 1 ? '' : 's'}`,
        result.status === 'failed' ? 'error' : 'success'
      );
      refreshHistory();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      setRunning(false);
    }
  };

  const sourceOptions: { id: SourceType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'imap', label: 'IMAP server', icon: Server },
    { id: 'mbox', label: 'mbox file', icon: Inbox },
    { id: 'eml', label: '.eml file', icon: FileText },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-white dark:bg-[#1E1F20] p-4 sm:p-5">
      <div className="max-w-2xl w-full space-y-4">
        <div>
          <h2 className="text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Import mail</h2>
          <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F] mt-1">
            Copy messages from another mailbox into {userEmail}. Dates, folders and read/flag states are preserved.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {sourceOptions.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSource(s.id)}
                className={`flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-medium transition-colors ${
                  source === s.id
                    ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF] border border-transparent'
                    : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 border border-[#E0E2E7] dark:border-[#333538]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {s.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <fieldset className={fieldsetClass}>
            <legend className="px-1 text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">Source</legend>

            {source === 'imap' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className={`${labelClass} sm:col-span-2`}>
                    IMAP host
                    <input value={host} onChange={(e) => setHost(e.target.value)} required placeholder="imap.example.com" className={inputClass} />
                  </label>
                  <label className={labelClass}>
                    Port
                    <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" className={inputClass} />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-xs text-[#444746] dark:text-[#C4C7C5]">
                  <input type="checkbox" className="checkbox checkbox-xs" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
                  Use SSL/TLS
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className={labelClass}>
                    Username
                    <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" className={inputClass} />
                  </label>
                  <label className={labelClass}>
                    Password
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" className={inputClass} />
                  </label>
                </div>
                <label className={labelClass}>
                  Source folder
                  <input value={sourceFolder} onChange={(e) => setSourceFolder(e.target.value)} placeholder="INBOX" className={inputClass} />
                </label>
              </>
            ) : (
              <label className={labelClass}>
                {source === 'eml' ? '.eml file' : 'mbox file'}
                <input
                  type="file"
                  accept={source === 'eml' ? '.eml,message/rfc822' : '.mbox,application/mbox,text/plain,*/*'}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-xs text-[#444746] dark:text-[#C4C7C5] file:mr-3 file:h-8 file:px-3 file:rounded-lg file:border-0 file:bg-gmail-blue file:text-white file:text-xs file:font-medium"
                />
                {file && <span className="mt-1 block text-xs text-[#5E5E5E] dark:text-[#8E918F]">{file.name} · {(file.size / 1024).toFixed(1)} KB</span>}
              </label>
            )}
          </fieldset>

          <fieldset className={fieldsetClass}>
            <legend className="px-1 text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">Destination</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={labelClass}>
                Target email
                <input value={targetEmail} onChange={(e) => setTargetEmail(e.target.value)} required className={inputClass} />
              </label>
              <label className={labelClass}>
                Target folder (optional)
                <input value={targetFolder} onChange={(e) => setTargetFolder(e.target.value)} placeholder="Inbox" className={inputClass} />
              </label>
            </div>
            <label className={labelClass}>
              Mailbox password (only if not stored on the server)
              <input
                type="password"
                value={targetPassword}
                onChange={(e) => setTargetPassword(e.target.value)}
                autoComplete="off"
                className={inputClass}
              />
            </label>
          </fieldset>

          <button
            type="submit"
            disabled={running}
            className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover transition-colors text-white text-xs font-medium disabled:opacity-60 flex items-center gap-2"
          >
            {running ? <Loader2 className="w-4 h-4 stroke-[1.5] animate-spin" /> : <Upload className="w-4 h-4 stroke-[1.5]" />}
            {running ? 'Importing…' : 'Start import'}
          </button>
        </form>

        {job && (
          <div className={`rounded-xl border p-4 space-y-2 ${job.status === 'failed' ? 'border-red-300 dark:border-red-800' : 'border-[#E0E2E7] dark:border-[#333538]'}`}>
            <div className="flex items-center gap-2 text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              {job.status === 'failed' ? <AlertTriangle className="w-4 h-4 stroke-[1.5] text-red-600 dark:text-red-400" /> : <CheckCircle2 className="w-4 h-4 stroke-[1.5] text-[#137333] dark:text-[#81C995]" />}
              {job.status === 'completed' ? 'Import complete' : job.status}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-[#444746] dark:text-[#C4C7C5]">
              <span>
                Imported <strong className="text-[#1F1F1F] dark:text-[#E3E3E3]">{job.imported}</strong>
              </span>
              <span>
                Skipped duplicates <strong className="text-[#1F1F1F] dark:text-[#E3E3E3]">{job.skippedDuplicates}</strong>
              </span>
              <span>
                Errors <strong className="text-[#1F1F1F] dark:text-[#E3E3E3]">{job.errors.length}</strong>
              </span>
            </div>
            {job.errors.length > 0 && (
              <ul className="max-h-40 overflow-y-auto text-xs space-y-1 text-red-600 dark:text-red-400">
                {job.errors.map((err, i) => (
                  <li key={`${err.messageId}-${i}`} className="break-all">
                    <span className="font-mono">{err.messageId || '(no message-id)'}</span>: {err.error}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              Job {job.id} · {job.total} message{job.total === 1 ? '' : 's'} scanned
            </p>
          </div>
        )}

        {history.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">Recent imports</h3>
            <ul className="text-xs text-[#5E5E5E] dark:text-[#8E918F] space-y-1">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate">
                    {h.type} to {h.targetFolder || 'Inbox'} ({h.status})
                  </span>
                  <span className="tabular-nums shrink-0">
                    {h.imported} imported · {h.skippedDuplicates} skipped · {h.errors.length} errors
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
