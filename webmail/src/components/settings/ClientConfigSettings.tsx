import React, { useState } from 'react';
import {
  Download,
  Mail,
  Copy,
  Check,
  Server,
  Smartphone,
  Laptop,
  Layers,
  ExternalLink,
} from 'lucide-react';
import {
  generateMobileConfig,
  downloadMobileConfigFile,
} from '../../lib/clientSelfService';

interface ClientConfigSettingsProps {
  userEmail: string;
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
}

type ClientTab = 'apple' | 'thunderbird' | 'outlook';

export const ClientConfigSettings: React.FC<ClientConfigSettingsProps> = ({
  userEmail,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<ClientTab>('apple');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const domain = userEmail.includes('@') ? userEmail.split('@')[1] : 'affinmail.com';
  const mailHost = `mail.${domain}`;

  const copyVal = async (text: string, key: string, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      onNotify(label, 'success');
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      onNotify('Could not copy', 'error');
    }
  };

  const handleDownloadMobileConfig = () => {
    try {
      const xml = generateMobileConfig(userEmail, userEmail, mailHost);
      const filename = `${userEmail.replace(/[^a-zA-Z0-9.-]/g, '_')}.mobileconfig`;
      downloadMobileConfigFile(filename, xml);
      onNotify('Apple Configuration Profile downloaded', 'success');
    } catch {
      onNotify('Failed to generate configuration profile', 'error');
    }
  };

  return (
    <div className="max-w-3xl w-full space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-gmail-blue dark:text-gmail-dark-blue-text" />
          <h3 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
            Email Client Auto-Configuration
          </h3>
        </div>
        <p className="mt-1 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
          Connect desktop and mobile email clients to your AffinMail account with 1-click profiles or standard IMAP/SMTP parameters.
        </p>
      </div>

      {/* Client selector tabs */}
      <div className="flex items-center gap-2 border-b border-[#E0E2E7] dark:border-[#333538] pb-2">
        <button
          onClick={() => setActiveTab('apple')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === 'apple'
              ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF]'
              : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>iOS / macOS (Apple Mail)</span>
        </button>

        <button
          onClick={() => setActiveTab('thunderbird')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === 'thunderbird'
              ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF]'
              : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <Laptop className="w-3.5 h-3.5" />
          <span>Mozilla Thunderbird</span>
        </button>

        <button
          onClick={() => setActiveTab('outlook')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === 'outlook'
              ? 'bg-[#D3E3FD] dark:bg-[#004A77] text-[#001D35] dark:text-[#C2E7FF]'
              : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Microsoft Outlook</span>
        </button>
      </div>

      {/* Apple Tab */}
      {activeTab === 'apple' && (
        <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-5 space-y-4 bg-white dark:bg-[#1E1F20]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                1-Click Apple Configuration Profile
              </h4>
              <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
                Download a signed .mobileconfig profile to automatically set up Apple Mail on iPhone, iPad, and Mac.
              </p>
            </div>
            <button
              onClick={handleDownloadMobileConfig}
              className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover text-white text-xs font-medium flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download .mobileconfig
            </button>
          </div>

          <div className="rounded-lg bg-[#F6F8FC] dark:bg-[#131314] border border-[#E0E2E7] dark:border-[#333538] p-3 text-xs space-y-1.5 text-[#444746] dark:text-[#C4C7C5]">
            <p className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">Installation Steps for Apple Devices:</p>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">
              <li>Click <strong>Download .mobileconfig</strong> above.</li>
              <li>On iOS: Go to <em>Settings → Profile Downloaded</em> and tap <em>Install</em>.</li>
              <li>On macOS: Open the downloaded file in <em>System Settings → Profiles</em> and click <em>Install</em>.</li>
              <li>Enter your mailbox password or generated App Password when prompted.</li>
            </ol>
          </div>
        </div>
      )}

      {/* Thunderbird Tab */}
      {activeTab === 'thunderbird' && (
        <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-5 space-y-4 bg-white dark:bg-[#1E1F20]">
          <div>
            <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Mozilla Thunderbird Setup Guide
            </h4>
            <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              Thunderbird automatically discovers AffinMail settings. If prompted for manual configuration, use the values below:
            </p>
          </div>

          <div className="rounded-lg bg-[#F6F8FC] dark:bg-[#131314] border border-[#E0E2E7] dark:border-[#333538] p-3 text-xs space-y-1 text-[#5E5E5E] dark:text-[#8E918F]">
            <p>1. Open Thunderbird → Account Settings → Add Mail Account.</p>
            <p>2. Enter your Name, Email address (<code className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">{userEmail}</code>), and Password.</p>
            <p>3. Select <strong>IMAP</strong> and verify the incoming and outgoing server parameters below.</p>
          </div>
        </div>
      )}

      {/* Outlook Tab */}
      {activeTab === 'outlook' && (
        <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-5 space-y-4 bg-white dark:bg-[#1E1F20]">
          <div>
            <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
              Microsoft Outlook Manual Setup
            </h4>
            <p className="mt-0.5 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
              To add your AffinMail account in Outlook (Windows or Mac), choose <em>Advanced Options → Let me set up my account manually</em> and select <em>IMAP</em>.
            </p>
          </div>
        </div>
      )}

      {/* Standard IMAP & SMTP Parameters Card */}
      <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] p-5 space-y-4 bg-white dark:bg-[#1E1F20]">
        <div className="flex items-center justify-between border-b border-[#F2F4F7] dark:border-[#333538] pb-3">
          <h4 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] flex items-center gap-2">
            <Server className="w-4 h-4 text-[#5E5E5E] dark:text-[#8E918F]" />
            Standard Connection Parameters
          </h4>
          <span className="text-[11px] font-mono text-[#5E5E5E] dark:text-[#8E918F]">TLS Encrypted</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Incoming IMAP */}
          <div className="rounded-lg border border-[#E0E2E7] dark:border-[#333538] p-3 space-y-2 bg-[#F6F8FC] dark:bg-[#131314]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Incoming Mail (IMAP)</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gmail-blue/10 text-gmail-blue dark:text-gmail-dark-blue-text font-bold">Port 993</span>
            </div>
            <div className="text-xs space-y-1 text-[#444746] dark:text-[#C4C7C5]">
              <div className="flex justify-between items-center">
                <span>Server:</span>
                <button
                  onClick={() => copyVal(mailHost, 'imap-host', 'IMAP server copied')}
                  className="font-mono text-xs text-gmail-blue dark:text-gmail-dark-blue-text flex items-center gap-1 hover:underline"
                >
                  {copiedKey === 'imap-host' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {mailHost}
                </button>
              </div>
              <div className="flex justify-between">
                <span>Security:</span>
                <span className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">SSL / TLS</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Username:</span>
                <button
                  onClick={() => copyVal(userEmail, 'imap-user', 'Username copied')}
                  className="font-mono text-xs text-gmail-blue dark:text-gmail-dark-blue-text flex items-center gap-1 hover:underline"
                >
                  {copiedKey === 'imap-user' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {userEmail}
                </button>
              </div>
              <div className="flex justify-between">
                <span>Authentication:</span>
                <span className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Normal Password / App Password</span>
              </div>
            </div>
          </div>

          {/* Outgoing SMTP */}
          <div className="rounded-lg border border-[#E0E2E7] dark:border-[#333538] p-3 space-y-2 bg-[#F6F8FC] dark:bg-[#131314]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Outgoing Mail (SMTP)</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gmail-blue/10 text-gmail-blue dark:text-gmail-dark-blue-text font-bold">Port 465 / 587</span>
            </div>
            <div className="text-xs space-y-1 text-[#444746] dark:text-[#C4C7C5]">
              <div className="flex justify-between items-center">
                <span>Server:</span>
                <button
                  onClick={() => copyVal(mailHost, 'smtp-host', 'SMTP server copied')}
                  className="font-mono text-xs text-gmail-blue dark:text-gmail-dark-blue-text flex items-center gap-1 hover:underline"
                >
                  {copiedKey === 'smtp-host' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {mailHost}
                </button>
              </div>
              <div className="flex justify-between">
                <span>Security:</span>
                <span className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">SSL/TLS (465) or STARTTLS (587)</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Username:</span>
                <button
                  onClick={() => copyVal(userEmail, 'smtp-user', 'Username copied')}
                  className="font-mono text-xs text-gmail-blue dark:text-gmail-dark-blue-text flex items-center gap-1 hover:underline"
                >
                  {copiedKey === 'smtp-user' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {userEmail}
                </button>
              </div>
              <div className="flex justify-between">
                <span>Authentication:</span>
                <span className="font-mono text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">Required (Same as IMAP)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
