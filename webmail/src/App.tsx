import React, { useState, useEffect, useRef, useMemo } from 'react';
import { HeaderBar } from './components/HeaderBar';
import { NavigationSidebar } from './components/NavigationSidebar';
import { ActionToolbar } from './components/ActionToolbar';
import { EmailThreadList } from './components/EmailThreadList';
import { ConversationView } from './components/ConversationView';
import { DockedComposeModal } from './components/DockedComposeModal';
import { ToastAlert, ToastMessage } from './components/ToastAlert';
import { AdminPanel } from './components/AdminPanel';
import { SplashScreen } from './components/SplashScreen';
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
    category: 'primary',
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
    category: 'primary',
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
    category: 'primary',
  },
  {
    id: 'th-canva-enterprise',
    subject: 'Canva Pro: Your Enterprise Team Brand Kit is ready',
    snippet: 'Explore newly published typography guidelines, high-res assets, and vector logo lockups.',
    senderName: 'Canva Design',
    senderEmail: 'updates@canva.com',
    messageCount: 1,
    hasAttachments: false,
    isStarred: false,
    isUnread: true,
    latestReceivedAt: 'Nov 22',
    labels: ['inbox', 'promotions'],
    category: 'promotions',
  },
  {
    id: 'th-youtube-dev',
    subject: 'Google Developers: New DevTools & Web Platform features',
    snippet: 'Watch the recap of Chrome DevTools 2026 performance profiling improvements and Gemini debugging.',
    senderName: 'YouTube Developers',
    senderEmail: 'noreply@youtube.com',
    messageCount: 2,
    hasAttachments: false,
    isStarred: false,
    isUnread: false,
    latestReceivedAt: 'Nov 20',
    labels: ['inbox', 'social'],
    category: 'social',
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
    category: 'primary',
  },
];

export const App: React.FC = () => {
  // Admin Mode detection (Port 2087, /admin, or ?mode=admin)
  const [isAdminMode, setIsAdminMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return (
        window.location.port === '2087' ||
        window.location.pathname.startsWith('/admin') ||
        window.location.search.includes('mode=admin')
      );
    }
    return false;
  });

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
  const [activeCategoryTab, setActiveCategoryTab] = useState<'primary' | 'promotions' | 'social'>('primary');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sidebar Collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Gmail-Style Splash Loading State
  const [isAppLoading, setIsAppLoading] = useState(true);

  useEffect(() => {
    // Initial workspace load / mail daemon sync
    const timer = setTimeout(() => {
      setIsAppLoading(false);
    }, 850);
    return () => clearTimeout(timer);
  }, []);

  // Threads State
  const [threads, setThreads] = useState<EmailThread[]>(INITIAL_THREADS);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [activeThread, setActiveThread] = useState<EmailThread | null>(null);
  const [cursorIndex, setCursorIndex] = useState(0);

  // Compose Modal State
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeInitialTo, setComposeInitialTo] = useState<string | undefined>(undefined);

  const handleComposeTo = (email: string) => {
    setComposeInitialTo(email);
    setIsComposeOpen(true);
  };

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
      if (currentFolder === 'inbox') {
        const itemCat = th.category || 'primary';
        if (itemCat !== activeCategoryTab) return false;
        return th.labels.includes('inbox');
      }
      if (currentFolder === 'archive') return !th.labels.includes('inbox') && !th.labels.includes('trash');
      if (currentFolder === 'trash') return th.labels.includes('trash');
      if (currentFolder === 'spam') return th.labels.includes('spam');
      if (currentFolder === 'sent') return th.labels.includes('sent');
      if (currentFolder === 'drafts') return th.labels.includes('drafts');

      return true;
    });
  }, [threads, currentFolder, selectedLabel, searchQuery, activeCategoryTab]);

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

  const handleSelectSpecific = (type: 'all' | 'none' | 'read' | 'unread' | 'starred' | 'unstarred') => {
    if (type === 'all') {
      setSelectedThreadIds(new Set(filteredThreads.map((t) => t.id)));
    } else if (type === 'none') {
      setSelectedThreadIds(new Set());
    } else if (type === 'read') {
      setSelectedThreadIds(new Set(filteredThreads.filter((t) => !t.isUnread).map((t) => t.id)));
    } else if (type === 'unread') {
      setSelectedThreadIds(new Set(filteredThreads.filter((t) => t.isUnread).map((t) => t.id)));
    } else if (type === 'starred') {
      setSelectedThreadIds(new Set(filteredThreads.filter((t) => t.isStarred).map((t) => t.id)));
    } else if (type === 'unstarred') {
      setSelectedThreadIds(new Set(filteredThreads.filter((t) => !t.isStarred).map((t) => t.id)));
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
    addToast(`${targetIds.length} conversation(s) moved to trash`, 'info');
  };

  const handleMarkRead = () => {
    const targetIds = activeThread
      ? [activeThread.id]
      : Array.from(selectedThreadIds);

    if (targetIds.length === 0 && filteredThreads[cursorIndex]) {
      targetIds.push(filteredThreads[cursorIndex].id);
    }

    if (targetIds.length === 0) return;

    setThreads((prev) =>
      prev.map((t) => (targetIds.includes(t.id) ? { ...t, isUnread: false } : t))
    );
    setSelectedThreadIds(new Set());
    addToast('Marked as read', 'info');
  };

  const handleMarkUnread = () => {
    const targetIds = activeThread
      ? [activeThread.id]
      : Array.from(selectedThreadIds);

    if (targetIds.length === 0 && filteredThreads[cursorIndex]) {
      targetIds.push(filteredThreads[cursorIndex].id);
    }

    if (targetIds.length === 0) return;

    setThreads((prev) =>
      prev.map((t) => (targetIds.includes(t.id) ? { ...t, isUnread: true } : t))
    );
    setSelectedThreadIds(new Set());
    if (activeThread) setActiveThread(null);
    addToast('Marked as unread', 'info');
  };

  // Hover quick actions for individual thread row
  const handleArchiveSingle = (threadId: string) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, labels: t.labels.filter((l) => l !== 'inbox') } : t
      )
    );
    addToast('Conversation archived', 'info');
  };

  const handleDeleteSingle = (threadId: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, labels: ['trash'] } : t))
    );
    addToast('Conversation moved to trash', 'info');
  };

  const handleToggleReadSingle = (threadId: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, isUnread: !t.isUnread } : t))
    );
  };

  const handleSnoozeSingle = (threadId: string) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, labels: [...t.labels, 'snoozed'] } : t
      )
    );
    addToast('Conversation snoozed until tomorrow 8:00 AM', 'info');
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
    addToast('Message sent', 'success');
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
    addToast('Reply sent', 'success');
  };

  // Keyboard Shortcuts Binding (Authentic Gmail Shortcuts)
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
      onToggleSelect: () => {
        if (!activeThread && filteredThreads[cursorIndex]) {
          handleToggleSelectCheckbox(filteredThreads[cursorIndex].id);
        }
      },
      onMarkSpam: () => addToast('Reported as spam', 'info'),
      onBackToList: () => {
        if (activeThread) setActiveThread(null);
      },
      onSearchFocus: () => searchInputRef.current?.focus(),
      onEscape: () => {
        if (activeThread) setActiveThread(null);
        else if (isComposeOpen) setIsComposeOpen(false);
      },
    },
    true
  );

  if (isAdminMode) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-base-100">
        <AdminPanel
          theme={theme}
          onToggleTheme={toggleTheme}
          onSwitchToWebmail={() => setIsAdminMode(false)}
          onNotify={addToast}
        />
        <ToastAlert toasts={toasts} onDismiss={removeToast} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gmail-canvas dark:bg-gmail-dark-canvas select-none">
      {/* 1. Header Bar */}
      <HeaderBar
        theme={theme}
        onToggleTheme={toggleTheme}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        user={user}
        quota={quota}
        onSwitchToAdmin={() => setIsAdminMode(true)}
        onToggleSidebar={() => {
          if (window.innerWidth < 768) {
            setIsMobileNavOpen((prev) => !prev);
          } else {
            setIsSidebarCollapsed((prev) => !prev);
          }
        }}
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
          isCollapsed={isSidebarCollapsed}
          isOpenMobile={isMobileNavOpen}
          onCloseMobile={() => setIsMobileNavOpen(false)}
        />

        {/* Central Content Area (Gmail Rounded Card) */}
        <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#1E1F20] rounded-2xl overflow-hidden shadow-sm mr-2 sm:mr-4 mb-2 sm:mb-4 border border-[#E0E2E7] dark:border-[#333538]">
          {/* Action Toolbar */}
          <ActionToolbar
            selectedCount={selectedThreadIds.size}
            totalCount={filteredThreads.length}
            allSelected={
              filteredThreads.length > 0 && selectedThreadIds.size === filteredThreads.length
            }
            onToggleSelectAll={handleToggleSelectAll}
            onSelectSpecific={handleSelectSpecific}
            onArchive={handleArchive}
            onReportSpam={() => addToast('Reported as spam', 'info')}
            onDelete={handleDelete}
            onMarkRead={handleMarkRead}
            onMarkUnread={handleMarkUnread}
            onSnooze={() => addToast('Conversation snoozed', 'info')}
            onRefresh={() => {
              setIsAppLoading(true);
              setTimeout(() => {
                setIsAppLoading(false);
                addToast('Synchronized with mail server', 'info');
              }, 700);
            }}
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
              onComposeTo={handleComposeTo}
            />
          ) : (
            <EmailThreadList
              threads={filteredThreads}
              selectedThreadIds={selectedThreadIds}
              cursorIndex={cursorIndex}
              currentFolder={currentFolder}
              activeTab={activeCategoryTab}
              onTabChange={setActiveCategoryTab}
              onSelectThread={handleSelectThread}
              onToggleSelectCheckbox={handleToggleSelectCheckbox}
              onToggleStar={handleToggleStar}
              onArchiveThread={handleArchiveSingle}
              onDeleteThread={handleDeleteSingle}
              onToggleReadThread={handleToggleReadSingle}
              onSnoozeThread={handleSnoozeSingle}
              onComposeTo={handleComposeTo}
            />
          )}
        </main>
      </div>

      {/* 3. Docked Compose Window */}
      <DockedComposeModal
        isOpen={isComposeOpen}
        onClose={() => {
          setIsComposeOpen(false);
          setComposeInitialTo(undefined);
        }}
        onSend={handleSendCompose}
        planLimitMb={quota.maxAttachmentSizeMb}
        onErrorToast={(msg) => addToast(msg, 'error')}
        initialTo={composeInitialTo}
      />

      {/* 4. Alert Toasts */}
      <ToastAlert toasts={toasts} onDismiss={removeToast} />

      {/* 5. Gmail-Style Startup Splash Screen */}
      <SplashScreen isLoading={isAppLoading} />
    </div>
  );
};
