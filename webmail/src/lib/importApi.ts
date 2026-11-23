// Client for the AffinMail import/migration API (/api/v1/import/*).
// Auth: admin Bearer token when present, otherwise the signed-in user's JMAP Basic auth.

import { getToken } from './adminApi';
import { authHeaderValue, getAuth } from './jmap';

const BASE = '/api/v1';

export interface ImportJobError {
  messageId: string;
  error: string;
}

export interface ImportJob {
  id: string;
  type: 'mbox' | 'eml' | 'imap' | string;
  status: 'running' | 'completed' | 'failed' | string;
  targetEmail: string;
  targetFolder: string | null;
  total: number;
  imported: number;
  skippedDuplicates: number;
  errors: ImportJobError[];
  createdAt?: string;
  finishedAt?: string | null;
}

function headers(): Record<string, string> {
  const token = getToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  if (getAuth()) {
    return { Authorization: authHeaderValue() };
  }
  throw new Error('Not signed in');
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
  const payload = await res.json().catch(() => null);
  if (!res.ok || payload?.status === 'error') {
    throw new Error(payload?.error || `HTTP ${res.status}`);
  }
  return payload?.data as T;
}

async function upload(path: '/import/mbox' | '/import/eml', file: File, targetEmail: string, targetFolder?: string, targetPassword?: string): Promise<ImportJob> {
  const form = new FormData();
  form.append('file', file);
  form.append('targetEmail', targetEmail);
  if (targetFolder?.trim()) form.append('targetFolder', targetFolder.trim());
  if (targetPassword) form.append('targetPassword', targetPassword);
  // No manual Content-Type: the browser sets the multipart boundary.
  return call<ImportJob>(path, { method: 'POST', body: form });
}

export const importMbox = (file: File, targetEmail: string, targetFolder?: string, targetPassword?: string) =>
  upload('/import/mbox', file, targetEmail, targetFolder, targetPassword);

export const importEml = (file: File, targetEmail: string, targetFolder?: string, targetPassword?: string) =>
  upload('/import/eml', file, targetEmail, targetFolder, targetPassword);

export interface ImportImapPayload {
  host: string;
  port?: number;
  ssl?: boolean;
  username: string;
  password: string;
  sourceFolder?: string;
  targetEmail: string;
  targetFolder?: string;
  targetPassword?: string;
  limit?: number;
}

export const importImap = (payload: ImportImapPayload) =>
  call<ImportJob>('/import/imap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const getImportJob = (id: string) => call<ImportJob>(`/import/jobs/${encodeURIComponent(id)}`, { method: 'GET' });

export const listImportJobs = (targetEmail?: string) =>
  call<{ jobs: ImportJob[]; count: number }>(
    `/import/jobs${targetEmail ? `?targetEmail=${encodeURIComponent(targetEmail)}` : ''}`,
    { method: 'GET' }
  );
