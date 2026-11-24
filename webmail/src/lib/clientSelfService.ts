// Client Self-Service & MCP integration helper
// Manages MCP tokens, activity logs, app passwords, email forwarding, DNS checks, and .mobileconfig generation.

import { listSieveScripts, saveSieveScript, deleteSieveScript } from './collab';

export interface McpToken {
  id: string;
  name: string;
  token: string;
  maskedToken: string;
  scopes: ('mcp:read' | 'mcp:write' | 'mcp:send')[];
  createdAt: string;
}

export interface McpActivityLog {
  id: string;
  timestamp: string;
  tool: string;
  status: 'success' | 'failed';
  details?: string;
}

export interface AppPassword {
  id: string;
  name: string;
  passwordPreview: string; // e.g. "a1b2-****-****-9z8y"
  createdAt: string;
  lastUsedAt: string;
}

export interface ForwardingSettings {
  isEnabled: boolean;
  destination: string;
  keepCopy: boolean;
}

export interface DnsRecordItem {
  type: 'MX' | 'TXT';
  name: string;
  value: string;
  priority?: number;
  purpose: string;
  status: 'verified' | 'pending' | 'missing';
}

const MCP_TOKENS_KEY = 'affinmail_mcp_tokens';
const MCP_LOGS_KEY = 'affinmail_mcp_activity_logs';
const APP_PASSWORDS_KEY = 'affinmail_app_passwords';
const FORWARDING_KEY = 'affinmail_forwarding_settings';

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && (globalThis as unknown as { localStorage: Storage }).localStorage) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    // fallback
  }
  return null;
}

/* ---------------------------------------------------------------- MCP Tokens */

export function listMcpTokens(): McpToken[] {
  const store = getStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(MCP_TOKENS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function generateMcpToken(
  name: string,
  scopes: ('mcp:read' | 'mcp:write' | 'mcp:send')[]
): { token: McpToken; rawSecret: string } {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : (globalThis.crypto as Crypto | undefined);
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(24);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      rand += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 24; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  const rawSecret = `affmcp_${rand}`;
  const maskedToken = `${rawSecret.slice(0, 10)}...${rawSecret.slice(-4)}`;

  const newToken: McpToken = {
    id: `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: name.trim() || 'Default MCP Token',
    token: rawSecret,
    maskedToken,
    scopes: scopes.length > 0 ? scopes : ['mcp:read'],
    createdAt: new Date().toISOString(),
  };

  const current = listMcpTokens();
  const updated = [newToken, ...current];
  const store = getStorage();
  try {
    store?.setItem(MCP_TOKENS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota error
  }

  return { token: newToken, rawSecret };
}

export function revokeMcpToken(id: string): void {
  const current = listMcpTokens();
  const updated = current.filter((t) => t.id !== id);
  const store = getStorage();
  try {
    store?.setItem(MCP_TOKENS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota error
  }
}

/* ------------------------------------------------------------- MCP Activity Logs */

const SEED_LOGS: McpActivityLog[] = [
  {
    id: 'log_seed_1',
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    tool: 'affinmail_search_emails',
    status: 'success',
    details: 'query: "invoice", folder: "INBOX", returned 3 messages',
  },
  {
    id: 'log_seed_2',
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    tool: 'affinmail_get_quota',
    status: 'success',
    details: 'used: 12.4 MB, limit: 10240 MB',
  },
  {
    id: 'log_seed_3',
    timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    tool: 'affinmail_draft_email',
    status: 'success',
    details: 'draft saved to drafts folder',
  },
];

export function listMcpActivityLogs(): McpActivityLog[] {
  const store = getStorage();
  if (!store) return SEED_LOGS;
  try {
    const raw = store.getItem(MCP_LOGS_KEY);
    if (!raw) {
      store.setItem(MCP_LOGS_KEY, JSON.stringify(SEED_LOGS));
      return SEED_LOGS;
    }
    return JSON.parse(raw);
  } catch {
    return SEED_LOGS;
  }
}

export function addMcpActivityLog(
  tool: string,
  status: 'success' | 'failed',
  details?: string
): void {
  const newLog: McpActivityLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    tool,
    status,
    details,
  };
  const current = listMcpActivityLogs();
  const updated = [newLog, ...current].slice(0, 50); // keep last 50
  const store = getStorage();
  try {
    store?.setItem(MCP_LOGS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage error
  }
}

export function clearMcpActivityLogs(): void {
  const store = getStorage();
  try {
    store?.setItem(MCP_LOGS_KEY, JSON.stringify([]));
  } catch {
    // Ignore storage error
  }
}

/* ------------------------------------------------------------- App Passwords */

export function listAppPasswords(): AppPassword[] {
  const store = getStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(APP_PASSWORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Generates a standard 16-character app password split into 4 segments: xxxx-xxxx-xxxx-xxxx.
 */
export function generateAppPassword(name: string): { entry: AppPassword; rawPassword: string } {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // unambiguous characters
  let cleanPass = '';
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : (globalThis.crypto as Crypto | undefined);
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < 16; i++) {
      cleanPass += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 16; i++) {
      cleanPass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  const rawPassword = `${cleanPass.slice(0, 4)}-${cleanPass.slice(4, 8)}-${cleanPass.slice(8, 12)}-${cleanPass.slice(12, 16)}`;
  const passwordPreview = `${cleanPass.slice(0, 4)}-****-****-${cleanPass.slice(12, 16)}`;

  const entry: AppPassword = {
    id: `app_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: name.trim() || 'Email Client',
    passwordPreview,
    createdAt: new Date().toISOString(),
    lastUsedAt: 'Never',
  };

  const current = listAppPasswords();
  const updated = [entry, ...current];
  const store = getStorage();
  try {
    store?.setItem(APP_PASSWORDS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore error
  }

  return { entry, rawPassword };
}

export function revokeAppPassword(id: string): void {
  const current = listAppPasswords();
  const updated = current.filter((p) => p.id !== id);
  const store = getStorage();
  try {
    store?.setItem(APP_PASSWORDS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore error
  }
}

/* ------------------------------------------------------------- Email Forwarding */

export const FORWARDING_SCRIPT_NAME = 'affinmail-forward';

export function buildForwardingSieve(destination: string, keepCopy: boolean): string {
  const safeDest = destination.trim().replace(/["\\]/g, '\\$&');
  if (!safeDest) {
    return '# Forwarding disabled\n';
  }
  if (keepCopy) {
    return `# AffinMail Automatic Forwarding\nredirect "${safeDest}";\nkeep;\n`;
  }
  return `# AffinMail Automatic Forwarding\nredirect "${safeDest}";\n`;
}

export function getStoredForwardingSettings(): ForwardingSettings {
  const store = getStorage();
  if (!store) return { isEnabled: false, destination: '', keepCopy: true };
  try {
    const raw = store.getItem(FORWARDING_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { isEnabled: false, destination: '', keepCopy: true };
}

export async function saveForwardingSettings(
  settings: ForwardingSettings
): Promise<void> {
  // 1. Store in local settings cache
  const store = getStorage();
  try {
    store?.setItem(FORWARDING_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }

  // 2. Wire directly into Sieve script
  try {
    const scripts = await listSieveScripts();
    const existing = scripts.find((s) => s.name === FORWARDING_SCRIPT_NAME);

    if (settings.isEnabled && settings.destination.trim()) {
      const content = buildForwardingSieve(settings.destination, settings.keepCopy);
      await saveSieveScript(FORWARDING_SCRIPT_NAME, content, existing?.id);
    } else if (existing) {
      await deleteSieveScript(existing.id);
    }
  } catch {
    // Best-effort Sieve sync when Sieve capabilities are restricted
  }
}

/* ---------------------------------------------------- Apple .mobileconfig Profile */

export function generateMobileConfig(
  userEmail: string,
  displayName?: string,
  serverHost?: string
): string {
  const host = serverHost || (userEmail.includes('@') ? `mail.${userEmail.split('@')[1]}` : 'mail.hostaffin.com');
  const accountName = displayName?.trim() || userEmail;
  const org = 'AffinMail';
  const uuid1 = '3b865584-9a3b-4632-9cb5-9831' + Math.random().toString(16).substring(2, 10);
  const uuid2 = '7f914b10-6819-48fe-a521-4328' + Math.random().toString(16).substring(2, 10);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadDisplayName</key>
    <string>${org} - ${userEmail}</string>
    <key>PayloadIdentifier</key>
    <string>com.affinmail.profile.${userEmail.replace(/[^a-zA-Z0-9]/g, '.')}</string>
    <key>PayloadOrganization</key>
    <string>${org}</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${uuid1}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.mail.managed</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>PayloadIdentifier</key>
            <string>com.affinmail.mail.${userEmail.replace(/[^a-zA-Z0-9]/g, '.')}</string>
            <key>PayloadUUID</key>
            <string>${uuid2}</string>
            <key>PayloadDisplayName</key>
            <string>${accountName}</string>
            <key>EmailAccountType</key>
            <string>EmailAccountTypeIMAP</string>
            <key>EmailAccountName</key>
            <string>${accountName}</string>
            <key>EmailAddress</key>
            <string>${userEmail}</string>
            <key>IncomingMailServerHostName</key>
            <string>${host}</string>
            <key>IncomingMailServerPortNumber</key>
            <integer>993</integer>
            <key>IncomingMailServerUseSSL</key>
            <true/>
            <key>IncomingMailServerUsername</key>
            <string>${userEmail}</string>
            <key>OutgoingMailServerHostName</key>
            <string>${host}</string>
            <key>OutgoingMailServerPortNumber</key>
            <integer>465</integer>
            <key>OutgoingMailServerUseSSL</key>
            <true/>
            <key>OutgoingMailServerUsername</key>
            <string>${userEmail}</string>
        </dict>
    </array>
</dict>
</plist>`;
}

export function downloadMobileConfigFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/x-apple-aspen-config;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mobileconfig') ? filename : `${filename}.mobileconfig`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------- DNS Verification */

export function getDefaultDnsRecords(domain: string): DnsRecordItem[] {
  return [
    {
      type: 'MX',
      name: '@',
      value: `mail.${domain}`,
      priority: 10,
      purpose: 'Inbound mail routing (handles receiving emails)',
      status: 'pending',
    },
    {
      type: 'TXT',
      name: '@',
      value: 'v=spf1 mx include:_spf.hostaffin.com ~all',
      purpose: 'SPF authentication (prevents spoofing of your sender domain)',
      status: 'pending',
    },
    {
      type: 'TXT',
      name: `affinmail._domainkey.${domain}`,
      value:
        'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0X1z5p7...affinmail...AQAB',
      purpose: 'DKIM signature (cryptographically verifies message authenticity)',
      status: 'pending',
    },
    {
      type: 'TXT',
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; adkim=r; aspf=r`,
      purpose: 'DMARC policy (specifies how receivers handle failed checks)',
      status: 'pending',
    },
  ];
}
