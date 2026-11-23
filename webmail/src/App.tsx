import React, { useState, useEffect, useRef, useMemo } from 'react';
import { HeaderBar } from './components/HeaderBar';
import { NavigationSidebar } from './components/NavigationSidebar';
import { ActionToolbar } from './components/ActionToolbar';
import { EmailThreadList } from './components/EmailThreadList';
import { ConversationView } from './components/ConversationView';
import { DockedComposeModal } from './components/DockedComposeModal';
import { ToastAlert, ToastMessage } from './components/ToastAlert';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { EmailThread, MailboxFolderId, PlanQuota, UserProfile } from './types';

// Initial Demo Seed Threads
const INITIAL_THREADS: EmailThread[] = [
  {
    id: 'th-stripe-1092',
    subject: 'Payment Receipt #AF-1092 - AffinMail Hosting Plan',
    snippet: 'Your payment of $45.00 for the AffinMail Enterprise Plan was received successfully.',
    senderName: 'Stripe Billing',
    senderEmail: 'billing@stripe.com',
    messageCount: 1,
    hasAttachments: true,
    isStarred: true,
    isUnread: true,
    latestReceivedAt: '11:20 AM',
    labels: ['inbox', 'billing'],
  },
  {
    id: 'th-github-sec-2918',
    subject: '[Security Alert] New SSH key registered to hostaffin-prod',
    snippet: 'A new public key was added to your cluster infrastructure by marcus@apexlogistics.com.',
    senderName: 'GitHub Security',
    senderEmail: 'security@github.com',
    messageCount: 1,
    hasAttachments: false,
    isStarred: false,
    isUnread: true,
    latestReceivedAt: '10:05 AM',
    labels: ['inbox', 'security'],
  },
  {
    id: 'th-sarah-design-final',
    subject: 'AffinMail Final Design Handover & Release Docs',
    snippet: 'Hi Marcus, attached is the release documentation and design mockups for the Q4 rollout.',
    senderName: 'Sarah Chen',
    senderEmail: 'sarah@chen.design',
    messageCount: 3,
    hasAttachments: true,
    isStarred: true,
    isUnread: false,
    latestReceivedAt: 'Yesterday',
    labels: ['inbox', 'operations'],
  },
  {
    id: 'th-hetzner-nov26',
    subject: 'Hetzner Cloud: Monthly Statement for Account #H-90128',
    snippet: 'Your monthly invoice for November 2026 is ready for download. Total balance: €14.28.',
    senderName: 'Hetzner Cloud',
    senderEmail: 'support@hetzner.com',
    messageCount: 1,
    hasAttachments: true,
    isStarred: false,
    isUnread: false,
    latestReceivedAt: 'Nov 21',
    labels: ['inbox', 'billing'],
  },
];

export const App: React.FC = () => {
  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('affinmail_theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('affinmail_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // User & Quota State
  const [user] = useState<UserProfile>({
    displayName: 'Marcus Vance',
    email: 'marcus@apexlogistics.com',
    domain: 'apexlogistics.com',
  });

  const [quota] = useState<PlanQuota>({
    usedBytes: 3435973836, // ~3.2 GB
    limitBytes: 10737418240, // 10 GB
    usedFormatted: '3.2 GB',
    limitFormatted: '10 GB',
    percent: 32.0,
    maxAttachmentSizeMb: 25,
    outboundRoute: 'direct',
    assignedIp: '195.201.10.102',
    isDedicatedIp: true,
  });

  // Navigation & Filtering
  const [currentFolder, setCurrentFolder] = useState<MailboxFolderId>('inbox');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Threads State
  const [threads, setThreads] = useState<EmailThread[]>(INITIAL_THREADS);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [activeThread, setActiveThread] = useState<EmailThread | null>(null);
  const [cursorIndex, setCursorIndex] = useState(0);

  // Compose Modal State
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  // Toast Alerts State
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (message: string, type: 'error' | 'success' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Filtered Threads
  const filteredThreads = useMemo(() => {
    return threads.filter((th) => {
      // Search matching
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          th.subject.toLowerCase().includes(q) ||
          th.snippet.toLowerCase().includes(q) ||
          th.senderName.toLowerCase().includes(q) ||
          th.senderEmail.toLowerCase().includes(q);
        if (!match) return false;
      }

      // Label filter
      if (selectedLabel) {
        return th.labels.includes(selectedLabel);
      }

      // Folder filter
      if (currentFolder === 'starred') return th.isStarred;
      if (currentFolder === 'inbox') return th.labels.includes('inbox');
      if (currentFolder === 'archive') return !th.labels.includes('inbox') && !th.labels.includes('trash');
      if (currentFolder === 'trash') return th.labels.includes('trash');
      if (currentFolder === 'spam') return th.labels.includes('spam');
      if (currentFolder === 'sent') return th.labels.includes('sent');
      if (currentFolder === 'drafts') return th.labels.includes('drafts');

      return true;
    });
  }, [threads, currentFolder, selectedLabel, searchQuery]);

  const unreadCount = useMemo(() => {
    return threads.filter((t) => t.isUnread && t.labels.includes('inbox')).length;
  }, [threads]);

  // Actions
  const handleToggleStar = (threadId: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, isStarred: !t.isStarred } : t))
    );
    if (activeThread && activeThread.id === threadId) {
      setActiveThread((prev) => (prev ? { ...prev, isStarred: !prev.isStarred } : null));
    }
  };

  const handleToggleSelectCheckbox = (threadId: string) => {
    setSelectedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedThreadIds.size === filteredThreads.length) {
      setSelectedThreadIds(new Set());
    } else {
      setSelectedThreadIds(new Set(filteredThreads.map((t) => t.id)));
    }
  };

  const handleArchive = () => {
    const targetIds = activeThread
      ? [activeThread.id]
      : Array.from(selectedThreadIds);

    if (targetIds.length === 0 && filteredThreads[cursorIndex]) {
      targetIds.push(filteredThreads[cursorIndex].id);
    }

    if (targetIds.length === 0) return;

    setThreads((prev) =>
      prev.map((t) =>
        targetIds.includes(t.id) ? { ...t, labels: t.labels.filter((l) => l !== 'inbox') } : t
      )
    );
    setSelectedThreadIds(new Set());
    setActiveThread(null);
    addToast(`${targetIds.length} conversation(s) archived`, 'info');
  };

  const handleDelete = () => {
    const targetIds = activeThread
      ? [activeThread.id]
      : Array.from(selectedThreadIds);

    if (targetIds.length === 0 && filteredThreads[cursorIndex]) {
      targetIds.push(filteredThreads[cursorIndex].id);
    }

    if (targetIds.length === 0) return;

    setThreads((prev) =>
      prev.map((t) =>
        targetIds.includes(t.id) ? { ...t, labels: ['trash'] } : t
      )
    );
    setSelectedThreadIds(new Set());
    setActiveThread(null);
    addToast(`${targetIds.length} conversation(s) moved to Trash`, 'info');
  };

  const handleMarkRead = () => {
    const targetIds = activeThread
      ? [activeThread.id]
      : Array.from(selectedThreadIds);

    if (targetIds.length === 0) return;

    setThreads((prev) =>
      prev.map((t) => (targetIds.includes(t.id) ? { ...t, isUnread: false } : t))
    );
    setSelectedThreadIds(new Set());
    addToast('Marked as read', 'success');
  };

  const handleSelectThread = (thread: EmailThread) => {
    setActiveThread(thread);
    // Mark as read optimistically
    if (thread.isUnread) {
      setThreads((prev) =>
        prev.map((t) => (t.id === thread.id ? { ...t, isUnread: false } : t))
      );
    }
  };

  const handleSendCompose = (msg: { to: string; subject: string; body: string }) => {
    const newThread: EmailThread = {
      id: `th-${Date.now()}`,
      subject: msg.subject,
      snippet: msg.body.substring(0, 80) || 'Sent message from AffinMail.',
      senderName: user.displayName,
      senderEmail: user.email,
      messageCount: 1,
      hasAttachments: false,
      isStarred: false,
      isUnread: false,
      latestReceivedAt: 'Just now',
      labels: ['sent'],
    };

    setThreads((prev) => [newThread, ...prev]);
    addToast('Message dispatched via clean Port 25 outbound route', 'success');
  };

  const handleQuickReply = (text: string) => {
    if (!activeThread) return;
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThread.id
          ? { ...t, messageCount: t.messageCount + 1, snippet: text.substring(0, 80) }
          : t
      )
    );
    addToast('Quick reply sent successfully', 'success');
  };

  // Keyboard Shortcuts Binding
  useKeyboardShortcuts(
    {
      onCompose: () => setIsComposeOpen(true),
      onNextThread: () => {
        if (!activeThread) {
          setCursorIndex((prev) => Math.min(prev + 1, filteredThreads.length - 1));
        }
      },
      onPrevThread: () => {
        if (!activeThread) {
          setCursorIndex((prev) => Math.max(prev - 1, 0));
        }
      },
      onOpenThread: () => {
        if (!activeThread && filteredThreads[cursorIndex]) {
          handleSelectThread(filteredThreads[cursorIndex]);
        }
      },
      onArchive: handleArchive,
      onDelete: handleDelete,
      onToggleStar: () => {
        if (activeThread) {
          handleToggleStar(activeThread.id);
        } else if (filteredThreads[cursorIndex]) {
          handleToggleStar(filteredThreads[cursorIndex].id);
        }
      },
      onSearchFocus: () => searchInputRef.current?.focus(),
      onEscape: () => {
        if (activeThread) setActiveThread(null);
        else if (isComposeOpen) setIsComposeOpen(false);
      },
    },
    true
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-100 select-none">
      {/* 1. Header Bar */}
      <HeaderBar
        theme={theme}
        onToggleTheme={toggleTheme}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        user={user}
        quota={quota}
      />

      {/* 2. Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <NavigationSidebar
          currentFolder={currentFolder}
          onSelectFolder={(folder) => {
            setCurrentFolder(folder);
            setActiveThread(null);
          }}
          selectedLabel={selectedLabel}
          onSelectLabel={(lbl) => {
            setSelectedLabel(lbl);
            setActiveThread(null);
          }}
          onOpenCompose={() => setIsComposeOpen(true)}
          unreadCount={unreadCount}
          quota={quota}
        />

        {/* Central Content Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-base-100 overflow-hidden">
          {/* Action Toolbar */}
          <ActionToolbar
            selectedCount={selectedThreadIds.size}
            totalCount={filteredThreads.length}
            allSelected={
              filteredThreads.length > 0 && selectedThreadIds.size === filteredThreads.length
            }
            onToggleSelectAll={handleToggleSelectAll}
            onArchive={handleArchive}
            onReportSpam={() => addToast('Reported as Spam. Sieve rule created.', 'error')}
            onDelete={handleDelete}
            onMarkRead={handleMarkRead}
            onRefresh={() => addToast('Synchronized with Stalwart JMAP daemon', 'info')}
            isDetailView={!!activeThread}
            onBackToList={() => setActiveThread(null)}
          />

          {/* Thread List or Conversation View */}
          {activeThread ? (
            <ConversationView
              thread={activeThread}
              onToggleStar={handleToggleStar}
              onSendQuickReply={handleQuickReply}
              maxAttachmentMb={quota.maxAttachmentSizeMb}
            />
          ) : (
            <EmailThreadList
              threads={filteredThreads}
              selectedThreadIds={selectedThreadIds}
              cursorIndex={cursorIndex}
              onSelectThread={handleSelectThread}
              onToggleSelectCheckbox={handleToggleSelectCheckbox}
              onToggleStar={handleToggleStar}
            />
          )}
        </main>
      </div>

      {/* 3. Docked Compose Window */}
      <DockedComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        onSend={handleSendCompose}
        planLimitMb={quota.maxAttachmentSizeMb}
        onErrorToast={(msg) => addToast(msg, 'error')}
      />

      {/* 4. Alert Toasts */}
      <ToastAlert toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};
