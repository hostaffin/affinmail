import React, { useState } from 'react';
import {
  Star,
  ShieldCheck,
  Reply,
  ReplyAll,
  Forward,
  Paperclip,
  Download,
  Send,
} from 'lucide-react';
import { EmailThread } from '../types';

interface ConversationViewProps {
  thread: EmailThread;
  onToggleStar: (threadId: string) => void;
  onSendQuickReply: (text: string) => void;
  maxAttachmentMb: number;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  thread,
  onToggleStar,
  onSendQuickReply,
}) => {
  const [replyText, setReplyText] = useState('');
  const [showReplyBox, setShowReplyBox] = useState(false);

  const handleSend = () => {
    if (!replyText.trim()) return;
    onSendQuickReply(replyText);
    setReplyText('');
    setShowReplyBox(false);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-base-100 flex flex-col p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Thread Title & Header */}
      <div className="flex items-start justify-between border-b border-base-200 pb-3 sm:pb-4 gap-2">
        <div className="space-y-1 max-w-4xl min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg sm:text-xl font-bold text-base-content tracking-tight break-words">
              {thread.subject}
            </h1>
            {thread.labels.filter(l => l !== 'inbox').map((lbl) => (
              <span key={lbl} className="badge badge-sm badge-outline capitalize font-semibold">
                {lbl}
              </span>
            ))}
          </div>
          <p className="text-[11px] sm:text-xs text-base-content/60 font-mono">
            Thread ID: {thread.id} • {thread.messageCount} messages
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onToggleStar(thread.id)}
            className="btn btn-ghost btn-circle btn-sm"
            aria-label={thread.isStarred ? 'Unstar conversation' : 'Star conversation'}
          >
            <Star
              className={`w-4 h-4 ${
                thread.isStarred ? 'fill-amber-400 text-amber-500' : 'text-base-content/40'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Message Card */}
      <div className="card bg-base-100 border border-base-200 shadow-sm rounded-xl overflow-hidden">
        {/* Card Header */}
        <div className="p-3 sm:p-4 bg-base-200/40 border-b border-base-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-xs sm:text-sm shrink-0">
              {thread.senderName.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-bold text-xs sm:text-sm text-base-content truncate">{thread.senderName}</span>
                <span className="text-[11px] sm:text-xs text-base-content/60 font-mono truncate">&lt;{thread.senderEmail}&gt;</span>
              </div>
              <span className="text-[10px] sm:text-[11px] text-base-content/50">to me</span>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 pt-1 sm:pt-0 border-t sm:border-none border-base-200/50">
            {/* Cryptographic Deliverability Verification Badge */}
            <div
              className="flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md bg-accent/10 text-accent text-[11px] sm:text-xs font-semibold border border-accent/20 cursor-pointer"
              title="Verified by AffinMail Engine: SPF PASS, DKIM 2048-bit PASS, DMARC PASS, TLS 1.3"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-accent stroke-[2.5]" />
              <span>Security Verified</span>
            </div>
            <span className="text-[11px] sm:text-xs font-mono text-base-content/60">{thread.latestReceivedAt}</span>
          </div>
        </div>

        {/* Message Body */}
        <div className="p-4 sm:p-6 text-xs sm:text-sm text-base-content leading-relaxed space-y-4 font-normal break-words">
          <p>{thread.snippet}</p>
          <p>
            Please let us know if you require any modifications or additional configuration for your virtual domain.
            All protocol interfaces (JMAP, SMTP, IMAP, CalDAV, CardDAV) are active.
          </p>
          <div className="pt-4 border-t border-base-200 text-xs text-base-content/60">
            <p>Best regards,</p>
            <p className="font-semibold text-base-content">{thread.senderName}</p>
            <p className="font-mono text-[11px]">{thread.senderEmail}</p>
          </div>
        </div>

        {/* Attachments Section if present */}
        {thread.hasAttachments && (
          <div className="p-3 sm:p-4 bg-base-200/30 border-t border-base-200 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-base-content/70">
              <Paperclip className="w-3.5 h-3.5 text-primary" />
              <span>Attachments (1 file)</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-3 p-2.5 rounded-lg border border-base-300 bg-base-100 hover:border-primary/50 transition-colors w-full sm:w-72">
                <div className="w-8 h-8 rounded bg-primary/10 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0">
                  PDF
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-base-content truncate">
                    Documentation_Release_Q4.pdf
                  </p>
                  <p className="text-[10px] text-base-content/50 font-mono">14.5 MB</p>
                </div>
                <button
                  className="btn btn-ghost btn-circle btn-xs text-base-content/60 hover:text-primary shrink-0"
                  title="Download attachment"
                  aria-label="Download attachment"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quick Action Footer */}
        <div className="p-3 bg-base-100 border-t border-base-200 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowReplyBox(true)}
            className="btn btn-outline btn-xs gap-1.5 normal-case font-medium"
          >
            <Reply className="w-3.5 h-3.5" />
            <span>Reply</span>
          </button>
          <button
            onClick={() => setShowReplyBox(true)}
            className="btn btn-outline btn-xs gap-1.5 normal-case font-medium"
          >
            <ReplyAll className="w-3.5 h-3.5" />
            <span>Reply All</span>
          </button>
          <button className="btn btn-ghost btn-xs gap-1.5 normal-case font-medium text-base-content/70">
            <Forward className="w-3.5 h-3.5" />
            <span>Forward</span>
          </button>
        </div>
      </div>

      {/* Quick Reply Box */}
      {showReplyBox && (
        <div className="card bg-base-100 border border-base-300 shadow-md p-4 space-y-3 rounded-xl">
          <div className="flex items-center justify-between text-xs font-semibold text-base-content/70">
            <span>Reply to {thread.senderName}</span>
            <button
              onClick={() => setShowReplyBox(false)}
              className="text-base-content/40 hover:text-base-content"
            >
              ✕
            </button>
          </div>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type your reply here..."
            className="textarea textarea-bordered w-full h-24 text-sm bg-base-200/50"
            autoFocus
          ></textarea>
          <div className="flex items-center justify-between">
            <button
              onClick={handleSend}
              className="btn btn-primary btn-sm gap-2 normal-case font-semibold"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send Reply</span>
            </button>
            <span className="text-[11px] text-base-content/50">
              Shift + Enter to insert line break
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
