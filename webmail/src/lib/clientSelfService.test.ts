import { describe, expect, it, beforeEach } from 'vitest';
import {
  generateMcpToken,
  listMcpTokens,
  revokeMcpToken,
  generateAppPassword,
  listAppPasswords,
  revokeAppPassword,
  buildForwardingSieve,
  generateMobileConfig,
  listMcpActivityLogs,
  addMcpActivityLog,
  clearMcpActivityLogs,
  getDefaultDnsRecords,
} from './clientSelfService';

const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, val: string) => {
    mockStorage[key] = String(val);
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    for (const k in mockStorage) {
      delete mockStorage[k];
    }
  },
  key: (i: number) => Object.keys(mockStorage)[i] ?? null,
  length: 0,
};

// Set on globalThis
(globalThis as unknown as { localStorage: Storage }).localStorage = mockLocalStorage as unknown as Storage;

describe('clientSelfService', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  describe('MCP Tokens', () => {
    it('generates a new MCP token with affmcp_ prefix and given scopes', () => {
      const { token, rawSecret } = generateMcpToken('Claude Agent', ['mcp:read', 'mcp:send']);
      expect(rawSecret.startsWith('affmcp_')).toBe(true);
      expect(token.name).toBe('Claude Agent');
      expect(token.scopes).toEqual(['mcp:read', 'mcp:send']);
      expect(token.maskedToken.startsWith('affmcp_')).toBe(true);

      const list = listMcpTokens();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(token.id);
    });

    it('revokes an MCP token', () => {
      const { token } = generateMcpToken('Cursor IDE', ['mcp:read']);
      expect(listMcpTokens().length).toBe(1);

      revokeMcpToken(token.id);
      expect(listMcpTokens().length).toBe(0);
    });
  });

  describe('App Passwords', () => {
    it('generates a formatted 16-character app password (4 groups of 4 chars)', () => {
      const { entry, rawPassword } = generateAppPassword('Thunderbird');
      // format: xxxx-xxxx-xxxx-xxxx
      expect(rawPassword).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(entry.name).toBe('Thunderbird');
      expect(entry.passwordPreview).toMatch(/^[a-z0-9]{4}-\*\*\*\*-\*\*\*\*-[a-z0-9]{4}$/);

      const list = listAppPasswords();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(entry.id);
    });

    it('revokes an app password', () => {
      const { entry } = generateAppPassword('iOS Mail');
      expect(listAppPasswords().length).toBe(1);

      revokeAppPassword(entry.id);
      expect(listAppPasswords().length).toBe(0);
    });
  });

  describe('Forwarding Sieve Builder', () => {
    it('builds forwarding Sieve keeping a local copy', () => {
      const sieve = buildForwardingSieve('dest@example.com', true);
      expect(sieve).toContain('redirect "dest@example.com";');
      expect(sieve).toContain('keep;');
    });

    it('builds forwarding Sieve without local copy', () => {
      const sieve = buildForwardingSieve('dest@example.com', false);
      expect(sieve).toContain('redirect "dest@example.com";');
      expect(sieve).not.toContain('keep;');
    });

    it('handles empty destination gracefully', () => {
      const sieve = buildForwardingSieve('', true);
      expect(sieve).toContain('# Forwarding disabled');
    });
  });

  describe('Apple .mobileconfig generator', () => {
    it('generates valid mobileconfig XML with standard IMAP 993 and SMTP 465 ports', () => {
      const xml = generateMobileConfig('user@example.com', 'User Name', 'mail.example.com');
      expect(xml).toContain('<plist version="1.0">');
      expect(xml).toContain('<string>user@example.com</string>');
      expect(xml).toContain('<string>mail.example.com</string>');
      expect(xml).toContain('<integer>993</integer>');
      expect(xml).toContain('<integer>465</integer>');
      expect(xml).toContain('EmailAccountTypeIMAP');
    });
  });

  describe('MCP Activity Logs', () => {
    it('logs MCP activity and allows clearing', () => {
      addMcpActivityLog('affinmail_send_email', 'success', 'Sent to test@example.com');
      const logs = listMcpActivityLogs();
      expect(logs.some((l) => l.tool === 'affinmail_send_email')).toBe(true);

      clearMcpActivityLogs();
      expect(listMcpActivityLogs().length).toBe(0);
    });
  });

  describe('DNS Records guide', () => {
    it('returns default records for domain including MX, SPF, DKIM, and DMARC', () => {
      const records = getDefaultDnsRecords('testdomain.com');
      expect(records.length).toBe(4);
      expect(records.find((r) => r.type === 'MX')).toBeDefined();
      expect(records.find((r) => r.value.includes('v=spf1'))).toBeDefined();
      expect(records.find((r) => r.name.includes('_domainkey'))).toBeDefined();
      expect(records.find((r) => r.name.includes('_dmarc'))).toBeDefined();
    });
  });
});
