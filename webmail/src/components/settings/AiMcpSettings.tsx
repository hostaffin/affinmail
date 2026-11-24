import React, { useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Key,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  AlertCircle,
  Clock,
  Sparkles,
} from 'lucide-react';
import {
  McpToken,
  McpActivityLog,
  listMcpTokens,
  generateMcpToken,
  revokeMcpToken,
  listMcpActivityLogs,
  clearMcpActivityLogs,
  addMcpActivityLog,
} from '../../lib/clientSelfService';

interface AiMcpSettingsProps {
  userEmail: string;
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
}

type AssistantTarget = 'claude' | 'gemini' | 'cursor';

export const AiMcpSettings: React.FC<AiMcpSettingsProps> = ({ userEmail, onNotify }) => {
  const [tokens, setTokens] = useState<McpToken[]>(() => listMcpTokens());
  const [logs, setLogs] = useState<McpActivityLog[]>(() => listMcpActivityLogs());

  // Token form state
  const [tokenName, setTokenName] = useState('');
  const [scopeRead, setScopeRead] = useState(true);
  const [scopeWrite, setScopeWrite] = useState(true);
  const [scopeSend, setScopeSend] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Newly minted token display
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // AI Assistant Setup state
  const [assistantTarget, setAssistantTarget] = useState<AssistantTarget>('claude');
  const [selectedTokenId, setSelectedTokenId] = useState<string>(tokens[0]?.id ?? '');

  const domain = userEmail.includes('@') ? userEmail.split('@')[1] : 'affinmail.com';
  const mailHost = `mail.${domain}`;
  const jmapUrl = typeof window !== 'undefined' ? `${window.location.origin}/jmap` : `https://${mailHost}/jmap`;
  const adminApiUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : `https://${mailHost}/api/v1`;

  const copyToClipboard = async (text: string, id: string, label = 'Copied to clipboard') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      onNotify(label, 'success');
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      onNotify('Failed to copy', 'error');
    }
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName.trim()) {
      onNotify('Please enter a name for the MCP token', 'error');
      return;
    }
    const scopes: ('mcp:read' | 'mcp:write' | 'mcp:send')[] = [];
    if (scopeRead) scopes.push('mcp:read');
    if (scopeWrite) scopes.push('mcp:write');
    if (scopeSend) scopes.push('mcp:send');

    if (scopes.length === 0) {
      onNotify('Select at least one scope', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      const { token, rawSecret } = generateMcpToken(tokenName.trim(), scopes);
      setTokens(listMcpTokens());
      setCreatedSecret(rawSecret);
      setSelectedTokenId(token.id);
      setTokenName('');
      onNotify('MCP Token generated successfully', 'success');
    } catch {
      onNotify('Failed to generate token', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevoke = (id: string) => {
    if (!window.confirm('Are you sure you want to revoke this MCP token? Any AI assistant using it will lose access.')) {
      return;
    }
    revokeMcpToken(id);
    setTokens(listMcpTokens());
    if (selectedTokenId === id) {
      setSelectedTokenId(tokens.find((t) => t.id !== id)?.id ?? '');
    }
    onNotify('MCP Token revoked', 'info');
  };

  const handleClearLogs = () => {
    clearMcpActivityLogs();
    setLogs([]);
    onNotify('Activity log cleared', 'info');
  };

  const handleSimulateLog = () => {
    const sampleTools = ['affinmail_search_emails', 'affinmail_get_thread', 'affinmail_draft_email', 'affinmail_get_quota'];
    const tool = sampleTools[Math.floor(Math.random() * sampleTools.length)];
    addMcpActivityLog(tool, 'success', 'Tool executed via MCP JSON-RPC stdio');
    setLogs(listMcpActivityLogs());
    onNotify('Simulated MCP test call recorded', 'info');
  };

  // Build snippet config
  const activeToken = tokens.find((t) => t.id === selectedTokenId) ?? tokens[0];
  const tokenSecretVal = activeToken ? (createdSecret && activeToken.id === tokens[0]?.id ? createdSecret : activeToken.token) : 'YOUR_MCP_TOKEN_HERE';

  const getAssistantSnippet = (): { filename: string; snippet: string } => {
    if (assistantTarget === 'claude') {
      return {
        filename: 'claude_desktop_config.json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              affinmail: {
                command: 'affinmail-mcp-server',
                env: {
                  AFFINMAIL_JMAP_URL: jmapUrl,
                  AFFINMAIL_API_TOKEN: `${userEmail}:${tokenSecretVal}`,
                  AFFINMAIL_ADMIN_API_URL: adminApiUrl,
                  AFFINMAIL_AGENT_ID: 'claude-desktop',
                },
              },
            },
          },
          null,
          2
        ),
      };
    }

    if (assistantTarget === 'cursor') {
      return {
        filename: '.cursor/mcp.json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              affinmail: {
                command: 'affinmail-mcp-server',
                env: {
                  AFFINMAIL_JMAP_URL: jmapUrl,
                  AFFINMAIL_API_TOKEN: `${userEmail}:${tokenSecretVal}`,
                  AFFINMAIL_AGENT_ID: 'cursor-ide',
                },
              },
            },
          },
          null,
          2
        ),
      };
    }

    // Gemini CLI
    return {
      filename: 'gemini-cli-mcp.json',
      snippet: JSON.stringify(
        {
          mcpServers: {
            affinmail: {
              command: 'affinmail-mcp-server',
              args: [],
              env: {
                AFFINMAIL_JMAP_URL: jmapUrl,
                AFFINMAIL_API_TOKEN: `${userEmail}:${tokenSecretVal}`,
                AFFINMAIL_AGENT_ID: 'gemini-cli',
              },
            },
          },
        },
        null,
        2
      ),
    };
  };

  const currentSnippet = getAssistantSnippet();

  const inputClass =
    'mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue';
  const labelClass = 'block text-xs font-medium text-[#444746] dark:text-[#C4C7C5]';

  return (
    <div className="max-w-3xl w-full space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-gmail-blue dark:text-gmail-dark-blue-text" />
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            AI & Model Context Protocol (MCP) Integration
          </h3>
        </div>
        <p className="mt-1 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
          Connect autonomous AI agents (Claude Desktop, Cursor, Gemini CLI) securely to your AffinMail mailbox using native MCP tool calls over JMAP.
        </p>
      </div>

      {/* Generated Token Banner */}
      {createdSecret && (
        <div className="rounded-xl border border-[#C2E7FF] dark:border-[#004A77] bg-[#EAF1FB] dark:bg-[#002744] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[#001D35] dark:text-[#C2E7FF]">
              <Sparkles className="w-4 h-4 text-gmail-blue dark:text-gmail-dark-blue-text" />
              New MCP Token Generated
            </span>
            <button
              onClick={() => setCreatedSecret(null)}
              className="text-xs text-[#5E5E5E] dark:text-[#8E918F] hover:underline"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-[#444746] dark:text-[#C4C7C5]">
            Copy this token now. For your security, this raw token will never be displayed in plain text again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-[#131314] border border-[#E0E2E7] dark:border-[#333538] font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3] break-all select-all">
              {createdSecret}
            </code>
            <button
              onClick={() => copyToClipboard(createdSecret, 'raw-new-secret', 'Token copied!')}
              className="h-9 px-3 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover text-white text-xs font-medium flex items-center gap-1.5 shrink-0 transition-colors"
            >
              {copiedId === 'raw-new-secret' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedId === 'raw-new-secret' ? 'Copied' : 'Copy Token'}
            </button>
          </div>
        </div>
      )}

      {/* 1. Generate MCP Token Form */}
      <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-4 space-y-4 bg-white dark:bg-[#1E1F20]">
        <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] flex items-center gap-2">
          <Key className="w-4 h-4 text-[#5E5E5E] dark:text-[#8E918F]" />
          Generate New MCP Token
        </h4>
        <form onSubmit={handleGenerate} className="space-y-3">
          <label className={labelClass}>
            Token Name / Description
            <input
              type="text"
              placeholder="e.g., Claude Desktop Workstation, Cursor Agent"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              className={inputClass}
            />
          </label>

          <div>
            <span className={labelClass}>Permissions & Scopes</span>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] cursor-pointer">
                <input
                  type="checkbox"
                  checked={scopeRead}
                  onChange={(e) => setScopeRead(e.target.checked)}
                  className="checkbox checkbox-sm checkbox-primary"
                />
                <div>
                  <span className="font-mono text-[11px] font-semibold text-gmail-blue dark:text-gmail-dark-blue-text">mcp:read</span>
                  <p className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">Search & read emails</p>
                </div>
              </label>

              <label className="flex items-center gap-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] cursor-pointer">
                <input
                  type="checkbox"
                  checked={scopeWrite}
                  onChange={(e) => setScopeWrite(e.target.checked)}
                  className="checkbox checkbox-sm checkbox-primary"
                />
                <div>
                  <span className="font-mono text-[11px] font-semibold text-gmail-blue dark:text-gmail-dark-blue-text">mcp:write</span>
                  <p className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">Create drafts & labels</p>
                </div>
              </label>

              <label className="flex items-center gap-2 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] cursor-pointer">
                <input
                  type="checkbox"
                  checked={scopeSend}
                  onChange={(e) => setScopeSend(e.target.checked)}
                  className="checkbox checkbox-sm checkbox-primary"
                />
                <div>
                  <span className="font-mono text-[11px] font-semibold text-gmail-blue dark:text-gmail-dark-blue-text">mcp:send</span>
                  <p className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">Send emails directly</p>
                </div>
              </label>
            </div>
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={isGenerating}
              className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover text-white text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-60"
            >
              <Plus className="w-4 h-4" />
              {isGenerating ? 'Generating…' : 'Generate MCP Token'}
            </button>
          </div>
        </form>
      </div>

      {/* 2. Active MCP Tokens List */}
      <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-4 space-y-3 bg-white dark:bg-[#1E1F20]">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
            Active MCP Tokens ({tokens.length})
          </h4>
          <span className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">
            Scoped Bearer access
          </span>
        </div>

        {tokens.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#5E5E5E] dark:text-[#8E918F] flex flex-col items-center gap-1.5">
            <AlertCircle className="w-5 h-5 opacity-40" />
            No active MCP tokens. Generate one above to connect an AI client.
          </div>
        ) : (
          <div className="divide-y divide-[#F2F4F7] dark:divide-[#333538] border border-[#E0E2E7] dark:border-[#333538] rounded-lg overflow-hidden">
            {tokens.map((token) => (
              <div key={token.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
                      {token.name}
                    </span>
                    <span className="text-[10px] text-[#5E5E5E] dark:text-[#8E918F]">
                      {new Date(token.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <code className="text-[11px] font-mono text-[#5E5E5E] dark:text-[#8E918F]">
                      {token.maskedToken}
                    </code>
                    {token.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[#EAF1FB] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF]"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                  <button
                    onClick={() => copyToClipboard(token.token, `copy-${token.id}`, 'Token copied')}
                    className="h-8 px-2.5 rounded-lg border border-[#E0E2E7] dark:border-[#333538] text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1 transition-colors"
                    title="Copy token"
                  >
                    {copiedId === `copy-${token.id}` ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === `copy-${token.id}` ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={() => handleRevoke(token.id)}
                    className="h-8 px-2.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1 transition-colors"
                    title="Revoke token"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Revoke</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. AI Assistant Setup */}
      <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-4 space-y-4 bg-white dark:bg-[#1E1F20]">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#5E5E5E] dark:text-[#8E918F]" />
            AI Assistant Setup
          </h4>
          <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">1-Click Copy Config</span>
        </div>

        {/* Tab selection */}
        <div className="flex items-center gap-2 border-b border-[#E0E2E7] dark:border-[#333538] pb-2">
          {(['claude', 'cursor', 'gemini'] as AssistantTarget[]).map((target) => (
            <button
              key={target}
              onClick={() => setAssistantTarget(target)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                assistantTarget === target
                  ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF]'
                  : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {target === 'claude' ? 'Claude Desktop' : target === 'cursor' ? 'Cursor IDE' : 'Gemini CLI'}
            </button>
          ))}
        </div>

        {/* Active token selector for snippet */}
        {tokens.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F]">Populate with token:</span>
            <select
              value={selectedTokenId}
              onChange={(e) => setSelectedTokenId(e.target.value)}
              className="h-8 px-2 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-xs text-[#1F1F1F] dark:text-[#E3E3E3] outline-none"
            >
              {tokens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.maskedToken})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Snippet box */}
        <div className="relative rounded-lg bg-[#F6F8FC] dark:bg-[#131314] border border-[#E0E2E7] dark:border-[#333538] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#EEF2F6] dark:bg-[#1D1E20] border-b border-[#E0E2E7] dark:border-[#333538] text-[11px] text-[#5E5E5E] dark:text-[#8E918F] font-mono">
            <span>{currentSnippet.filename}</span>
            <button
              onClick={() => copyToClipboard(currentSnippet.snippet, 'snippet-box', 'Configuration copied')}
              className="flex items-center gap-1 hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] transition-colors"
            >
              {copiedId === 'snippet-box' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedId === 'snippet-box' ? 'Copied' : 'Copy JSON'}</span>
            </button>
          </div>
          <pre className="p-3 font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3] overflow-x-auto leading-relaxed">
            {currentSnippet.snippet}
          </pre>
        </div>

        <p className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">
          {assistantTarget === 'claude'
            ? 'Paste this config into %APPDATA%\\Claude\\claude_desktop_config.json on Windows, or ~/Library/Application Support/Claude/claude_desktop_config.json on macOS.'
            : assistantTarget === 'cursor'
            ? 'Paste this into your project root under .cursor/mcp.json or in Cursor Settings > Features > MCP.'
            : 'Save this configuration file or pass the command arguments to Gemini CLI to bind AffinMail tools.'}
        </p>
      </div>

      {/* 4. MCP Activity Log */}
      <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-4 space-y-3 bg-white dark:bg-[#1E1F20]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#5E5E5E] dark:text-[#8E918F]" />
            <h4 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
              MCP Activity Log
            </h4>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSimulateLog}
              className="text-xs text-gmail-blue dark:text-gmail-dark-blue-text hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Test Call
            </button>
            {logs.length > 0 && (
              <button
                onClick={handleClearLogs}
                className="text-xs text-[#5E5E5E] dark:text-[#8E918F] hover:text-red-600 dark:hover:text-red-400 hover:underline"
              >
                Clear Log
              </button>
            )}
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="py-4 text-center text-xs text-[#5E5E5E] dark:text-[#8E918F]">
            No recent MCP tool calls recorded.
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#E0E2E7] dark:border-[#333538] rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F6F8FC] dark:bg-[#131314] text-[#444746] dark:text-[#C4C7C5] border-b border-[#E0E2E7] dark:border-[#333538]">
                <tr>
                  <th className="py-2 px-3 font-medium">Timestamp</th>
                  <th className="py-2 px-3 font-medium">Tool Name</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2F4F7] dark:divide-[#333538] text-[#1F1F1F] dark:text-[#E3E3E3]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td className="py-2 px-3 font-mono text-[11px] whitespace-nowrap text-[#5E5E5E] dark:text-[#8E918F]">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] font-semibold text-gmail-blue dark:text-gmail-dark-blue-text whitespace-nowrap">
                      {log.tool}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          log.status === 'success'
                            ? 'bg-[#E6F4EA] dark:bg-[#0F5223]/30 text-[#137333] dark:text-[#81C995]'
                            : 'bg-[#FCE8E6] dark:bg-[#5C1D18]/30 text-[#C5221F] dark:text-[#F28B82]'
                        }`}
                      >
                        {log.status === 'success' ? 'Success' : 'Failed'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-[#5E5E5E] dark:text-[#8E918F] truncate max-w-xs" title={log.details}>
                      {log.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
