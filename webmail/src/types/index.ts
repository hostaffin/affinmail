export interface Attachment {
  id: string;
  name: string;
  size: number; // in bytes
  type: string;
  url?: string;
  blobId?: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  senderName: string;
  senderEmail: string;
  recipientTo: string[];
  recipientCc?: string[];
  subject: string;
  snippet: string;
  bodyHtml?: string;
  bodyText?: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  attachments?: Attachment[];
  labels: string[];
  securityStatus: {
    spfPass: boolean;
    dkimPass: boolean;
    dmarcPass: boolean;
    tlsVersion: string;
  };
}

export interface EmailThread {
  id: string;
  subject: string;
  snippet: string;
  senderName: string;
  senderEmail: string;
  messageCount: number;
  hasAttachments: boolean;
  isStarred: boolean;
  isUnread: boolean;
  latestReceivedAt: string;
  labels: string[];
  category?: 'primary' | 'promotions' | 'social';
  messages?: EmailMessage[];
  /** JMAP ids / state (server-backed threads). */
  emailId?: string;
  threadId?: string;
  receivedAtIso?: string;
  isDraft?: boolean;
  mailboxIds?: Record<string, true>;
}

export type MailboxFolderId =
  | 'inbox'
  | 'starred'
  | 'snoozed'
  | 'sent'
  | 'drafts'
  | 'important'
  | 'scheduled'
  | 'archive'
  | 'spam'
  | 'trash';

export interface MailboxFolder {
  id: MailboxFolderId;
  name: string;
  icon: string;
  unreadCount?: number;
}

export interface PlanQuota {
  usedBytes: number;
  limitBytes: number;
  usedFormatted: string;
  limitFormatted: string;
  percent: number;
  maxAttachmentSizeMb: number;
  outboundRoute: string;
  assignedIp?: string;
  isDedicatedIp: boolean;
}

export interface UserProfile {
  email: string;
  displayName: string;
  avatarUrl?: string;
  domain: string;
}
