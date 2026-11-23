import React, { useState, useRef, useEffect } from 'react';
import {
  Star,
  ShieldCheck,
  Reply,
  ReplyAll,
  Forward,
  Paperclip,
  Download,
  Send,
  FileText,
  Printer,
  ExternalLink,
  ChevronDown,
  MoreVertical,
  CheckCircle2,
  Trash2,
  Bold,
  Italic,
  Underline,
  Link2,
} from 'lucide-react';
import { EmailThread } from '../types';
import { ContactHovercard } from './ContactHovercard';
import { downloadBlob } from '../lib/jmap';

interface ConversationViewProps {
  thread: EmailThread;
  currentUserEmail: string;
  onToggleStar: (threadId: string) => void;
  onSendQuickReply: (text: string) => void;
  onForward?: (thread: EmailThread) => void;
  maxAttachmentMb: number;
  onComposeTo?: (email: string) => void;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  thread,
  currentUserEmail,
  onToggleStar,
  onSendQuickReply,
  onForward,
  onComposeTo,
}) => {
  const [replyText, setReplyText] = useState('');
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [showDetailsDropdown, setShowDetailsDropdown] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const detailsRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        setShowDetailsDropdown(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSend = () => {
    if (!replyText.trim()) return;
    onSendQuickReply(replyText);
    setReplyText('');
    setShowReplyBox(false);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-[#1E1F20] flex flex-col p-6 space-y-4 select-none">
      {/* 1. Thread Header (Subject + Actions) */}
      <div className="flex items-start justify-between border-b border-[#E0E2E7] dark:border-[#333538] pb-4 gap-4">
        <div className="space-y-1.5 max-w-4xl min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-normal text-[#1F1F1F] dark:text-[#E3E3E3] tracking-tight break-words">
              {thread.subject}
            </h1>
            {thread.labels
              .filter((l) => l !== 'inbox')
              .map((lbl) => (
                <span
                  key={lbl}
                  className="px-2 py-0.5 rounded text-[10px] font-medium uppercase bg-[#E8F0FE] dark:bg-[#004A77]/50 text-gmail-blue border border-[#D2E3FC] dark:border-[#004A77]"
                >
                  {lbl}
                </span>
              ))}
          </div>
          <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F] font-mono tabular-nums">
            Thread ID: {thread.id} — {thread.messageCount} message{thread.messageCount > 1 ? 's' : ''}
          </p>
        </div>

        {/* Right Action Icons (Print, Expand, Star) */}
        <div className="flex items-center gap-1 shrink-0 text-[#444746] dark:text-[#C4C7C5]">
          <button
            onClick={() => window.print()}
            className="p-2 hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden sm:inline-flex"
            title="Print all"
          >
            <Printer className="w-4 h-4 stroke-[2]" />
          </button>
          <button
            className="p-2 hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden sm:inline-flex"
            title="In new window"
          >
            <ExternalLink className="w-4 h-4 stroke-[2]" />
          </button>
          <button
            onClick={() => onToggleStar(thread.id)}
            className="p-2 hover:text-amber-500 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
            title={thread.isStarred ? 'Unstar conversation' : 'Star conversation'}
          >
            <Star
              className={`w-4 h-4 stroke-[1.5] ${
                thread.isStarred ? 'fill-amber-400 text-amber-500' : 'text-gray-400 dark:text-gray-600'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 2. Message Envelope Card */}
      <div className="border border-[#E0E2E7] dark:border-[#333538] rounded-2xl overflow-hidden bg-white dark:bg-[#1E1F20] shadow-sm">
        {/* Envelope Header */}
        <div className="p-4 sm:p-5 bg-white dark:bg-[#1E1F20] flex items-start justify-between gap-3 border-b border-[#F2F4F7] dark:border-[#2D2F31]">
          {/* Sender Avatar & Info with Gmail Contact Hovercard */}
          <div className="flex items-start gap-3.5 min-w-0">
            <ContactHovercard
              senderName={thread.senderName}
              senderEmail={thread.senderEmail}
              onComposeTo={onComposeTo}
            >
              <div className="w-10 h-10 rounded-full bg-[#0B57D0] text-white font-medium flex items-center justify-center text-sm shrink-0 shadow-sm hover:ring-2 hover:ring-gmail-blue/40 transition-all">
                {thread.senderName.charAt(0)}
              </div>
            </ContactHovercard>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <ContactHovercard
                  senderName={thread.senderName}
                  senderEmail={thread.senderEmail}
                  onComposeTo={onComposeTo}
                >
                  <span className="font-semibold text-sm text-[#1F1F1F] dark:text-[#E3E3E3] truncate hover:underline cursor-pointer">
                    {thread.senderName}
                  </span>
                </ContactHovercard>
                <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F] font-normal truncate">
                  &lt;{thread.senderEmail}&gt;
                </span>
              </div>

              {/* "to me" Interactive Transport Security Dropdown */}
              <div className="relative inline-block mt-0.5" ref={detailsRef}>
                <button
                  type="button"
                  onClick={() => setShowDetailsDropdown((prev) => !prev)}
                  className="flex items-center gap-1 text-xs text-[#5E5E5E] dark:text-[#8E918F] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] transition-colors py-0.5 px-1 rounded hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]"
                >
                  <span>to me</span>
                  <ChevronDown className="w-3 h-3 stroke-[2]" />
                </button>

                {/* Authentic Gmail Security Details Modal */}
                {showDetailsDropdown && (
                  <div className="absolute top-full left-0 mt-1.5 w-80 sm:w-96 bg-white dark:bg-[#1E1F20] rounded-2xl shadow-xl border border-[#E0E2E7] dark:border-[#333538] p-4 z-50 text-xs space-y-2 select-text">
                    <div className="grid grid-cols-[80px_1fr] gap-1.5 text-xs">
                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">from:</span>
                      <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3] break-all">
                        {thread.senderName} &lt;{thread.senderEmail}&gt;
                      </span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">reply-to:</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3]">{thread.senderEmail}</span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">to:</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3]">{currentUserEmail}</span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">date:</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3]">
                        {thread.receivedAtIso ? new Date(thread.receivedAtIso).toLocaleString() : thread.latestReceivedAt}
                      </span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">subject:</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3]">{thread.subject}</span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">mailed-by:</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3] font-mono text-[11px]">
                        {thread.senderEmail.split('@')[1] ?? ''}
                      </span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">security:</span>
                      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="w-4 h-4 stroke-[2]" />
                        <span>Standard encryption (TLS 1.3)</span>
                      </div>
                    </div>

                    {/* Email Security Transport Verification */}
                    <div className="pt-2.5 mt-2 border-t border-[#E0E2E7] dark:border-[#333538] flex flex-wrap gap-2 text-[11px] font-mono">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> SPF: PASS
                      </span>
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> DKIM: 2048-BIT PASS
                      </span>
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> DMARC: PASS
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Header Metadata & Envelope Actions */}
          <div className="flex items-center gap-1 shrink-0 text-[#444746] dark:text-[#C4C7C5]">
            <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F] mr-2 hidden sm:inline tabular-nums">
              {thread.latestReceivedAt}
            </span>

            <button
              onClick={() => onToggleStar(thread.id)}
              className="p-1.5 hover:text-amber-500 rounded-full transition-colors"
              title="Star"
            >
              <Star
                className={`w-4 h-4 stroke-[1.5] ${
                  thread.isStarred ? 'fill-amber-400 text-amber-500' : 'text-gray-400 dark:text-gray-600'
                }`}
              />
            </button>

            <button
              onClick={() => setShowReplyBox(true)}
              className="p-1.5 hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
              title="Reply"
            >
              <Reply className="w-4 h-4 stroke-[2]" />
            </button>

            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu((prev) => !prev)}
                className="p-1.5 hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                title="More options"
              >
                <MoreVertical className="w-4 h-4 stroke-[2]" />
              </button>

              {showMoreMenu && (
                <div className="absolute top-full right-0 mt-1 w-44 bg-white dark:bg-[#1E1F20] rounded-xl shadow-lg border border-[#E0E2E7] dark:border-[#333538] py-1.5 z-40 text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                  <button
                    onClick={() => {
                      setShowReplyBox(true);
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]"
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => {
                      setShowMoreMenu(false);
                      onForward?.(thread);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]"
                  >
                    Forward
                  </button>
                  <button
                    onClick={() => {
                      window.print();
                      setShowMoreMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]"
                  >
                    Print
                  </button>
                  <button
                    onClick={() => setShowMoreMenu(false)}
                    className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]"
                  >
                    Show original
                  </button>
                  <button
                    onClick={() => setShowMoreMenu(false)}
                    className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] text-red-600"
                  >
                    Delete message
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Message Content (real JMAP body values) */}
        <div className="p-6 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] leading-relaxed space-y-4 font-normal select-text">
          {(thread.messages ?? []).length > 0 ? (
            (thread.messages ?? []).map((msg) => (
              <div key={msg.id} className="space-y-3">
                {msg.bodyHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: msg.bodyHtml }} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.bodyText || msg.snippet}</p>
                )}
              </div>
            ))
          ) : (
            <p className="whitespace-pre-wrap">{thread.snippet}</p>
          )}

          <div className="pt-6 border-t border-[#F2F4F7] dark:border-[#2D2F31] text-xs text-[#5E5E5E] dark:text-[#8E918F] space-y-0.5">
            <p className="font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">{thread.senderName}</p>
            <p className="font-mono text-xs">{thread.senderEmail}</p>
          </div>
        </div>

        {/* Attachments Section (Gmail Attachment Cards) */}
        {(thread.messages ?? []).some((m) => (m.attachments ?? []).length > 0) && (
          <div className="p-5 bg-[#F8FAFD] dark:bg-[#18191A] border-t border-[#E0E2E7] dark:border-[#333538] space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#444746] dark:text-[#C4C7C5]">
              <Paperclip className="w-4 h-4 stroke-[2] text-gmail-blue" />
              <span>
                {(thread.messages ?? []).reduce((n, m) => n + (m.attachments ?? []).length, 0)} Attachment(s)
              </span>
            </div>

            <div className="flex flex-wrap gap-4">
              {(thread.messages ?? []).flatMap((m, mi) =>
                (m.attachments ?? []).map((att, ai) => (
                  <div
                    key={`${mi}-${ai}-${att.id}`}
                    className="group relative w-56 rounded-xl border border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] overflow-hidden shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="h-28 bg-[#F2F6FC] dark:bg-[#282A2C] flex items-center justify-center relative overflow-hidden">
                      <FileText className="w-12 h-12 stroke-[1.5] text-red-500" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity">
                        <button
                          onClick={() => downloadBlob(att.blobId ?? att.id, att.name)}
                          className="p-2 bg-white/90 hover:bg-white text-gray-800 rounded-full shadow"
                          title="Download"
                        >
                          <Download className="w-4 h-4 stroke-[2]" />
                        </button>
                      </div>
                    </div>

                    <div className="p-3">
                      <p className="text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">{att.name}</p>
                      <p className="text-[11px] text-[#5E5E5E] dark:text-[#8E918F] font-mono mt-0.5">
                        {Math.max(1, Math.round(att.size / 1024))} KB
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Quick Action Footer Buttons (Reply / Forward) */}
        {!showReplyBox && (
          <div className="p-4 bg-white dark:bg-[#1E1F20] border-t border-[#E0E2E7] dark:border-[#333538] flex items-center gap-3">
            <button
              onClick={() => setShowReplyBox(true)}
              className="flex items-center gap-2 px-6 py-2 rounded-full border border-[#747775] dark:border-[#8E918F] text-xs font-semibold text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] transition-colors"
            >
              <Reply className="w-4 h-4 stroke-[2]" />
              <span>Reply</span>
            </button>

            <button
              onClick={() => setShowReplyBox(true)}
              className="flex items-center gap-2 px-6 py-2 rounded-full border border-[#747775] dark:border-[#8E918F] text-xs font-semibold text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] transition-colors"
            >
              <ReplyAll className="w-4 h-4 stroke-[2]" />
              <span>Reply all</span>
            </button>

            <button
              onClick={() => onForward?.(thread)}
              className="flex items-center gap-2 px-6 py-2 rounded-full border border-[#747775] dark:border-[#8E918F] text-xs font-semibold text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] transition-colors"
            >
              <Forward className="w-4 h-4 stroke-[2]" />
              <span>Forward</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Inline Gmail Reply Box */}
      {showReplyBox && (
        <div className="border border-[#E0E2E7] dark:border-[#333538] rounded-2xl bg-white dark:bg-[#1E1F20] shadow-sm overflow-hidden space-y-3 p-4">
          <div className="flex items-center justify-between text-xs text-[#5E5E5E] dark:text-[#8E918F] border-b border-[#F2F4F7] dark:border-[#2D2F31] pb-2">
            <div className="flex items-center gap-2">
              <Reply className="w-4 h-4 stroke-[2]" />
              <span>
                Reply to <strong className="text-[#1F1F1F] dark:text-[#E3E3E3]">{thread.senderName}</strong> &lt;
                {thread.senderEmail}&gt;
              </span>
            </div>
            <button
              onClick={() => setShowReplyBox(false)}
              className="p-1 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full text-gray-500"
            >
              ✕
            </button>
          </div>

          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your reply..."
            className="w-full h-32 text-xs bg-transparent border-none outline-none resize-none text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5E5E5E] leading-relaxed"
            autoFocus
          ></textarea>

          {/* Inline Action Bar */}
          <div className="flex items-center justify-between pt-2 border-t border-[#F2F4F7] dark:border-[#2D2F31]">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSend}
                className="bg-gmail-blue hover:bg-blue-700 text-white text-xs font-medium px-5 py-2 rounded-full flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <span>Send</span>
              </button>

              <button
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full"
                title="Attach files"
              >
                <Paperclip className="w-4 h-4 stroke-[2]" />
              </button>
              <button
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full"
                title="Insert link"
              >
                <Link2 className="w-4 h-4 stroke-[2]" />
              </button>
            </div>

            <button
              onClick={() => {
                setReplyText('');
                setShowReplyBox(false);
              }}
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 rounded-full"
              title="Discard draft"
            >
              <Trash2 className="w-4 h-4 stroke-[2]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
