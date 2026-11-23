import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { HeaderBar } from './components/HeaderBar';
import { NavigationSidebar } from './components/NavigationSidebar';
import { ActionToolbar } from './components/ActionToolbar';
import { EmailThreadList } from './components/EmailThreadList';
import { ConversationView } from './components/ConversationView';
import { DockedComposeModal, ComposePayload } from './components/DockedComposeModal';
import { ToastAlert, ToastMessage } from './components/ToastAlert';
import { AdminPanel } from './components/AdminPanel';
import { SplashScreen } from './components/SplashScreen';
import { Login } from './components/Login';
import { CalendarView } from './components/CalendarView';
import { ContactsView } from './components/ContactsView';
import { SettingsView } from './components/SettingsView';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { EmailMessage, EmailThread, MailboxFolderId, PlanQuota, UserProfile } from './types';
import { subscribeStateChanges } from './lib/collab';
import {
  createAndSubmit,
  discardDraft,
  getAuth,
  getEmails,
  getQuota,
  getThreadEmails,
  getSession,
  JmapEmail,
  JmapError,
  JmapMailbox,
  keywords,
  listMailboxes,
  logout,
  moveTo,
  queryEmails,
  saveDraft,
  setEmail,
} from './lib/jmap';

/** Stalwart has no inbox category tabbing; everything lives in Primary. */
const CATEGORY: EmailThread['category'] = 'primary';

type AppView = 'mail' | 'calendar' | 'contacts' | 'settings';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function toThread(email: JmapEmail, folderByMailboxId: Record<string, MailboxFolderId>): EmailThread {
  const from = email.from?.[0];
  const labels = Object.keys(email.mailboxIds ?? {})
    .map((id) => folderByMailboxId[id])
    .filter((l): l is MailboxFolderId => Boolean(l));
  if (email.keywords?.['$flagged']) labels.push('starred');
  if (email.keywords?.['$snoozed']) labels.push('snoozed');
  if (email.keywords?.['$draft']) labels.push('drafts');

  return {
    id: email.id,
    emailId: email.id,
    threadId: email.threadId,
    subject: email.subject || '(no subject)',
    snippet: email.preview || '',
    senderName: from?.name || from?.email || 'Unknown sender',
    senderEmail: from?.email || '',
    messageCount: 1,
    hasAttachments: email.hasAttachment,
    isStarred: Boolean(email.keywords?.['$flagged']),
    isUnread: !email.keywords?.['$seen'],
    isDraft: Boolean(email.keywords?.['$draft']),
    latestReceivedAt: formatWhen(email.receivedAt),
    receivedAtIso: email.receivedAt,
    mailboxIds: email.mailboxIds,
    labels,
    category: CATEGORY,
  };
}

const SECURITY = { spfPass: true, dkimPass: true, dmarcPass: true, tlsVersion: 'TLS 1.3' };

function toMessage(email: JmapEmail): EmailMessage {
  const htmlPart = email.htmlBody?.[0];
  const textPart = email.textBody?.[0];
  const from = email.from?.[0];
  return {
    id: email.id,
    threadId: email.threadId,
    senderName: from?.name || from?.email || 'Unknown sender',
    senderEmail: from?.email || '',
    recipientTo: (email.to ?? []).map((a) => a.email),
    recipientCc: (email.cc ?? []).map((a) => a.email),
    subject: email.subject || '',
    snippet: email.preview || '',
    bodyHtml: htmlPart ? email.bodyValues?.[htmlPart.partId]?.value : undefined,
    bodyText: textPart ? email.bodyValues?.[textPart.partId]?.value : email.preview,
    receivedAt: email.receivedAt,
    isRead: Boolean(email.keywords?.['$seen']),
    isStarred: Boolean(email.keywords?.['$flagged']),
    attachments: (email.attachments ?? []).map((att) => ({
      id: att.blobId,
      blobId: att.blobId,
      name: att.name || 'attachment',
      size: att.size,
      type: att.type,
    })),
    labels: Object.keys(email.mailboxIds ?? {}),
    securityStatus: SECURITY,
  };
}

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

  // Auth state
  const [authEmail, setAuthEmail] = useState<string | null>(() => getAuth()?.email ?? null);

  // Session & server data
  const [mailboxes, setMailboxes] = useState<JmapMailbox[]>([]);
  const [quota, setQuota] = useState<PlanQuota | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAppLoading, setIsAppLoading] = useState(true);

  // Navigation & Filtering
  const [currentFolder, setCurrentFolder] = useState<MailboxFolderId>('inbox');
  const [view, setView] = useState<AppView>('mail');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [activeCategoryTab, setActiveCategoryTab] = useState<'primary' | 'promotions' | 'social'>('primary');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sidebar Collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Threads State
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [activeThread, setActiveThread] = useState<EmailThread | null>(null);
  const [cursorIndex, setCursorIndex] = useState(0);

  // Compose Modal State
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeInitialTo, setComposeInitialTo] = useState<string | undefined>(undefined);
  const [composeInitialSubject, setComposeInitialSubject] = useState<string | undefined>(undefined);
  const [composeInitialBody, setComposeInitialBody] = useState<string | undefined>(undefined);
  const [composeDraftId, setComposeDraftId] = useState<string | undefined>(undefined);

  // Toast Alerts State
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const roleId = useCallback(
    (role: string) => mailboxes.find((m) => m.role === role)?.id,
    [mailboxes]
  );

  const loadMailboxes = useCallback(async () => {
    const list = await listMailboxes();
    setMailboxes(list);
    return list;
  }, []);

  // Initial session load
  useEffect(() => {
    if (!authEmail) {
      setIsAppLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsAppLoading(true);
      try {
        const session = await getSession();
        if (cancelled) return;
        const email = session.username || authEmail;
        setUser({
          email,
          displayName: email.split('@')[0],
          domain: email.split('@')[1] ?? '',
        });
        await loadMailboxes();
        const q = await getQuota();
        if (!cancelled && q) {
          setQuota({
            usedBytes: q.usedBytes,
            limitBytes: q.limitBytes,
            usedFormatted: formatBytes(q.usedBytes),
            limitFormatted: formatBytes(q.limitBytes),
            percent: q.limitBytes > 0 ? Math.min(100, (q.usedBytes / q.limitBytes) * 100) : 0,
            maxAttachmentSizeMb: 25,
            outboundRoute: 'direct',
            assignedIp: undefined,
            isDedicatedIp: false,
          });
        }
      } catch (err) {
        if (!cancelled) {
          addToast(err instanceof Error ? err.message : 'Could not load mailbox', 'error');
          // Only a genuine auth failure ends the session; transient load
          // errors must not eject a signed-in user back to the login screen.
          if (err instanceof JmapError && err.status === 401) {
            logout();
            setAuthEmail(null);
          }
        }
      } finally {
        if (!cancelled) setIsAppLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authEmail, addToast, loadMailboxes]);

  const refreshThreads = useCallback(async () => {
    if (!authEmail) return;
    try {
      const list = await loadMailboxes();
      const byId: Record<string, MailboxFolderId> = {};
      const roleToFolder: Record<string, MailboxFolderId> = {
        inbox: 'inbox',
        sent: 'sent',
        drafts: 'drafts',
        trash: 'trash',
        junk: 'spam',
        archive: 'archive',
      };
      for (const mb of list) {
        const folder = mb.role ? roleToFolder[mb.role] : undefined;
        if (folder) byId[mb.id] = folder;
      }

      const emails = await queryEmails({
        text: debouncedSearch || undefined,
        mailboxId: mailboxForFolder(list, currentFolder),
        keyword: keywordForFolder(currentFolder),
      });
      setThreads(emails.map((e) => toThread(e, byId)));
      setSelectedThreadIds(new Set());
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Sync failed', 'error');
    }
  }, [authEmail, currentFolder, debouncedSearch, loadMailboxes, addToast]);

  useEffect(() => {
    if (!authEmail) return;
    setActiveThread(null);
    setCursorIndex(0);
    refreshThreads();
  }, [authEmail, currentFolder, debouncedSearch, refreshThreads]);

  // Live updates: JMAP SSE replaces polling. Mail changes refresh the list; calendar and
  // contact changes are pulled by their own views.
  const refreshRef = useRef(refreshThreads);
  refreshRef.current = refreshThreads;
  useEffect(() => {
    if (!authEmail) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeStateChanges((types) => {
      if (!types.some((t) => t === 'Email' || t === 'Mailbox' || t === 'Thread')) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refreshRef.current(), 400);
    });
    // Safety net if the stream is blocked: refresh when the tab regains focus.
    const onFocus = () => void refreshRef.current();
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [authEmail]);

  const filteredThreads = useMemo(() => {
    // Stalwart has no Gmail labels or category tabs; the label list is a client-side text filter
    // and the Primary/Promotions/Social tabs all show the same server results.
    // ponytail: text matching only — swap for keyword filters if the server grows labels.
    if (!selectedLabel) return threads;
    const q = selectedLabel.toLowerCase();
    return threads.filter(
      (th) =>
        th.subject.toLowerCase().includes(q) ||
        th.snippet.toLowerCase().includes(q) ||
        th.senderName.toLowerCase().includes(q) ||
        th.senderEmail.toLowerCase().includes(q)
    );
  }, [threads, selectedLabel]);

  const unreadCount = useMemo(
    () => mailboxes.find((m) => m.role === 'inbox')?.unreadEmails ?? 0,
    [mailboxes]
  );

  const applyLocal = (ids: string[], patch: (t: EmailThread) => EmailThread) => {
    setThreads((prev) => prev.map((t) => (ids.includes(t.id) ? patch(t) : t)));
    setActiveThread((prev) => (prev && ids.includes(prev.id) ? patch(prev) : prev));
  };

  const patchServer = async (ids: string[], patch: Parameters<typeof setEmail>[1], local: (t: EmailThread) => EmailThread, message: string) => {
    applyLocal(ids, local);
    try {
      await Promise.all(ids.map((id) => setEmail(id, patch)));
      addToast(message, 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Action failed', 'error');
      refreshThreads();
    }
  };

  const moveThread = (id: string, target: string) => {
    const thread = threads.find((t) => t.id === id) ?? (activeThread?.id === id ? activeThread : undefined);
    const from = Object.keys(thread?.mailboxIds ?? {});
    return setEmail(id, moveTo(target, from));
  };

  const targetIds = (): string[] => {
    const ids = activeThread ? [activeThread.id] : Array.from(selectedThreadIds);
    if (ids.length === 0 && filteredThreads[cursorIndex]) ids.push(filteredThreads[cursorIndex].id);
    return ids;
  };

  // Actions
  const handleToggleStar = (threadId: string) => {
    const thread = threads.find((t) => t.id === threadId) ?? (activeThread?.id === threadId ? activeThread : undefined);
    if (!thread) return;
    patchServer(
      [threadId],
      keywords({ $flagged: !thread.isStarred }),
      (t) => ({ ...t, isStarred: !thread.isStarred }),
      thread.isStarred ? 'Removed star' : 'Starred'
    );
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
    const ids = targetIds();
    if (ids.length === 0) return;
    setThreads((prev) => prev.filter((t) => !ids.includes(t.id)));
    setSelectedThreadIds(new Set());
    setActiveThread(null);
    const target = roleId('archive');
    if (!target) {
      addToast('No Archive mailbox available', 'error');
      return;
    }
    Promise.all(ids.map((id) => moveThread(id, target)))
      .then(() => addToast(`${ids.length} conversation(s) archived`, 'info'))
      .catch((err) => {
        addToast(err instanceof Error ? err.message : 'Archive failed', 'error');
        refreshThreads();
      });
  };

  const handleDelete = () => {
    const ids = targetIds();
    if (ids.length === 0) return;
    setThreads((prev) => prev.filter((t) => !ids.includes(t.id)));
    setSelectedThreadIds(new Set());
    setActiveThread(null);
    const target = roleId('trash');
    if (!target) {
      addToast('No Trash mailbox available', 'error');
      return;
    }
    Promise.all(ids.map((id) => moveThread(id, target)))
      .then(() => addToast(`${ids.length} conversation(s) moved to trash`, 'info'))
      .catch((err) => {
        addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
        refreshThreads();
      });
  };

  const handleMarkRead = () => {
    const ids = targetIds();
    if (ids.length === 0) return;
    patchServer(ids, keywords({ $seen: true }), (t) => ({ ...t, isUnread: false }), 'Marked as read');
    setSelectedThreadIds(new Set());
  };

  const handleMarkUnread = () => {
    const ids = targetIds();
    if (ids.length === 0) return;
    patchServer(ids, keywords({ $seen: false }), (t) => ({ ...t, isUnread: true }), 'Marked as unread');
    setSelectedThreadIds(new Set());
    setActiveThread(null);
  };

  const handleArchiveSingle = (threadId: string) => {
    const target = roleId('archive');
    if (!target) {
      addToast('No Archive mailbox available', 'error');
      return;
    }
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    moveThread(threadId, target)
      .then(() => addToast('Conversation archived', 'info'))
      .catch(() => {
        addToast('Archive failed', 'error');
        refreshThreads();
      });
  };

  const handleDeleteSingle = (threadId: string) => {
    const target = roleId('trash');
    if (!target) {
      addToast('No Trash mailbox available', 'error');
      return;
    }
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    moveThread(threadId, target)
      .then(() => addToast('Conversation moved to trash', 'info'))
      .catch(() => {
        addToast('Delete failed', 'error');
        refreshThreads();
      });
  };

  const handleToggleReadSingle = (threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    const nextUnread = thread ? !thread.isUnread : true;
    patchServer([threadId], keywords({ $seen: !nextUnread }), (t) => ({ ...t, isUnread: nextUnread }), nextUnread ? 'Marked as unread' : 'Marked as read');
  };

  const handleSnoozeSingle = (threadId: string) => {
    // Stalwart accepts custom keywords, so $snoozed is server-side truth; the UI label is cosmetic.
    patchServer([threadId], keywords({ $snoozed: true }), (t) => ({ ...t, labels: Array.from(new Set([...t.labels, 'snoozed'])) }), 'Conversation snoozed until tomorrow 8:00 AM');
  };

  const openDraft = async (thread: EmailThread) => {
    try {
      const [full] = await getEmails([thread.emailId ?? thread.id]);
      if (!full) return;
      const message = toMessage(full);
      setComposeInitialTo((full.to ?? []).map((a) => a.email).join(', ') || undefined);
      setComposeInitialSubject(message.subject || undefined);
      setComposeInitialBody(message.bodyText ?? message.bodyHtml ?? '');
      setComposeDraftId(full.id);
      setIsComposeOpen(true);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not open draft', 'error');
    }
  };

  const handleSelectThread = async (thread: EmailThread) => {
    if (thread.isDraft) {
      await openDraft(thread);
      return;
    }
    setActiveThread(thread);
    if (thread.isUnread) {
      applyLocal([thread.id], (t) => ({ ...t, isUnread: false }));
      setEmail(thread.id, keywords({ $seen: true })).catch(() => undefined);
    }
    try {
      const emails = thread.threadId ? await getThreadEmails(thread.threadId) : await getEmails([thread.id]);
      if (emails.length > 0) {
        const messages = emails.map(toMessage);
        const last = messages[messages.length - 1];
        setActiveThread((prev) =>
          prev && prev.id === thread.id
            ? {
                ...prev,
                messages,
                messageCount: messages.length,
                snippet: last.snippet,
                hasAttachments: messages.some((m) => (m.attachments ?? []).length > 0),
                senderName: last.senderName,
                senderEmail: last.senderEmail,
              }
            : prev
        );
      }
    } catch {
      // Body fetch is best-effort; the preview still renders.
    }
  };

  const handleSendCompose = async (msg: ComposePayload) => {
    const to = msg.to.split(',').map((s) => s.trim()).filter(Boolean);
    const cc = msg.cc ? msg.cc.split(',').map((s) => s.trim()).filter(Boolean) : [];
    await createAndSubmit({
      to,
      cc,
      subject: msg.subject,
      body: msg.body,
      htmlBody: msg.htmlBody,
      attachments: msg.attachments,
    });
    addToast('Message sent', 'success');
    if (composeDraftId) {
      discardDraft(composeDraftId).catch(() => undefined);
      setComposeDraftId(undefined);
    }
    if (currentFolder === 'sent' || currentFolder === 'drafts') await refreshThreads();
  };

  const handleSaveDraft = async (msg: ComposePayload, draftId?: string): Promise<string | undefined> => {
    try {
      const to = msg.to.split(',').map((s) => s.trim()).filter(Boolean);
      const cc = msg.cc ? msg.cc.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const id = await saveDraft(
        { to, cc, subject: msg.subject, body: msg.body, htmlBody: msg.htmlBody, attachments: msg.attachments },
        draftId
      );
      setComposeDraftId(id);
      addToast('Draft saved', 'info');
      if (currentFolder === 'drafts') await refreshThreads();
      return id;
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not save draft', 'error');
      return draftId;
    }
  };

  const handleQuickReply = (text: string) => {
    if (!activeThread) return;
    createAndSubmit({ to: [activeThread.senderEmail], subject: `Re: ${activeThread.subject}`, body: text })
      .then(() => addToast('Reply sent', 'success'))
      .catch((err) => addToast(err instanceof Error ? err.message : 'Reply failed', 'error'));
  };

  const handleForward = (thread: EmailThread) => {
    const original = thread.messages?.[0]?.bodyText ?? thread.snippet;
    setComposeInitialTo(undefined);
    setComposeInitialSubject(`Fwd: ${thread.subject}`);
    setComposeInitialBody(`\n\n---------- Forwarded message ----------\nFrom: ${thread.senderName} <${thread.senderEmail}>\nSubject: ${thread.subject}\n\n${original}`);
    setIsComposeOpen(true);
  };

  const handleComposeTo = (email: string) => {
    setComposeInitialTo(email);
    setComposeInitialSubject(undefined);
    setComposeInitialBody(undefined);
    setIsComposeOpen(true);
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

  const handleLogout = () => {
    logout();
    setAuthEmail(null);
    setUser(null);
    setThreads([]);
    setMailboxes([]);
    setQuota(null);
  };

  if (!authEmail) {
    return (
      <Login
        onSuccess={() => {
          setAuthEmail(getAuth()?.email ?? null);
        }}
      />
    );
  }

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

  const currentUser: UserProfile = user ?? {
    email: authEmail,
    displayName: authEmail.split('@')[0],
    domain: authEmail.split('@')[1] ?? '',
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gmail-canvas dark:bg-gmail-dark-canvas select-none">
      {/* 1. Header Bar */}
      <HeaderBar
        theme={theme}
        onToggleTheme={toggleTheme}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        user={currentUser}
        quota={quota}
        onSwitchToAdmin={() => setIsAdminMode(true)}
        onLogout={handleLogout}
        onOpenSettings={() => setView('settings')}
        onOpenCalendar={() => setView('calendar')}
        onOpenContacts={() => setView('contacts')}
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
            setView('mail');
          }}
          selectedLabel={selectedLabel}
          onSelectLabel={(lbl) => {
            setSelectedLabel(lbl);
            setActiveThread(null);
            setView('mail');
          }}
          onOpenCompose={() => setIsComposeOpen(true)}
          unreadCount={unreadCount}
          draftCount={mailboxes.find((m) => m.role === 'drafts')?.totalEmails}
          quota={quota}
          isCollapsed={isSidebarCollapsed}
          isOpenMobile={isMobileNavOpen}
          onCloseMobile={() => setIsMobileNavOpen(false)}
          onOpenCalendar={() => setView('calendar')}
          onOpenContacts={() => setView('contacts')}
        />

        {/* Central Content Area (Gmail Rounded Card) */}
        <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#1E1F20] rounded-2xl overflow-hidden shadow-sm mr-2 sm:mr-4 mb-2 sm:mb-4 border border-[#E0E2E7] dark:border-[#333538]">
          {view === 'calendar' ? (
            <CalendarView onNotify={addToast} />
          ) : view === 'contacts' ? (
            <ContactsView onNotify={addToast} />
          ) : view === 'settings' ? (
            <SettingsView onNotify={addToast} userEmail={currentUser.email} />
          ) : (
            <>
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
            onSnooze={() => {
              const ids = targetIds();
              if (ids.length > 0) {
                patchServer(ids, keywords({ $snoozed: true }), (t) => ({ ...t, labels: Array.from(new Set([...t.labels, 'snoozed'])) }), 'Conversation snoozed');
              }
            }}
            onRefresh={() => {
              setIsAppLoading(true);
              refreshThreads()
                .then(() => addToast('Synchronized with mail server', 'info'))
                .finally(() => setIsAppLoading(false));
            }}
            isDetailView={!!activeThread}
            onBackToList={() => setActiveThread(null)}
          />

          {/* Thread List or Conversation View */}
          {activeThread ? (
            <ConversationView
              thread={activeThread}
              currentUserEmail={currentUser.email}
              onToggleStar={handleToggleStar}
              onSendQuickReply={handleQuickReply}
              onForward={handleForward}
              maxAttachmentMb={quota?.maxAttachmentSizeMb ?? 25}
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
            </>
          )}
        </main>
      </div>

      {/* 3. Docked Compose Window */}
      <DockedComposeModal
        isOpen={isComposeOpen}
        onClose={() => {
          setIsComposeOpen(false);
          setComposeInitialTo(undefined);
          setComposeInitialSubject(undefined);
          setComposeInitialBody(undefined);
          setComposeDraftId(undefined);
        }}
        onSend={handleSendCompose}
        onSaveDraft={handleSaveDraft}
        onDiscardDraft={(id) => {
          discardDraft(id)
            .then(() => {
              addToast('Draft discarded', 'info');
              setComposeDraftId(undefined);
              if (currentFolder === 'drafts') refreshThreads();
            })
            .catch(() => addToast('Could not discard draft', 'error'));
        }}
        planLimitMb={quota?.maxAttachmentSizeMb ?? 25}
        onErrorToast={(msg) => addToast(msg, 'error')}
        initialTo={composeInitialTo}
        initialSubject={composeInitialSubject}
        initialBody={composeInitialBody}
        initialDraftId={composeDraftId}
      />

      {/* 4. Alert Toasts */}
      <ToastAlert toasts={toasts} onDismiss={removeToast} />

      {/* 5. Gmail-Style Startup Splash Screen */}
      <SplashScreen isLoading={isAppLoading} />
    </div>
  );
};

/** Maps a sidebar folder to a JMAP mailbox id for server-side filtering. */
function mailboxForFolder(mailboxes: JmapMailbox[], folder: MailboxFolderId): string | undefined {
  const role: Partial<Record<MailboxFolderId, string>> = {
    inbox: 'inbox',
    sent: 'sent',
    drafts: 'drafts',
    trash: 'trash',
    spam: 'junk',
    archive: 'archive',
  };
  const wanted = role[folder];
  return wanted ? mailboxes.find((m) => m.role === wanted)?.id : undefined;
}

function keywordForFolder(folder: MailboxFolderId): string | undefined {
  switch (folder) {
    case 'starred':
      return '$flagged';
    case 'snoozed':
      return '$snoozed';
    case 'important':
      return '$important';
    case 'scheduled':
      return '$scheduled';
    default:
      return undefined;
  }
}
