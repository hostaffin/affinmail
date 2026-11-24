import React, { useState, useRef, useEffect } from 'react';
import {
  Star,
  ShieldCheck,
  Reply,
  ReplyAll,
  Forward,
  Paperclip,
  Download,
  FileText,
  Printer,
  ExternalLink,
  ChevronDown,
  MoreVertical,
  CheckCircle2,
  Trash2,
  Link2,
  X,
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

const ICON_BTN =
  'h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors';
const MENU_ITEM =
  'w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] transition-colors';
const OUTLINED_BUTTON =
  'flex items-center gap-2 px-5 py-2 rounded-lg border border-[#C4C7C5] dark:border-[#5F6368] text-sm font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] transition-colors';

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

  const attachmentCount = (thread.messages ?? []).reduce(
    (n, m) => n + (m.attachments ?? []).length,
    0
  );

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden bg-white dark:bg-[#1E1F20] flex flex-col p-3 sm:p-6 space-y-4 select-none">
      {/* Thread header */}
      <div className="flex items-start justify-between border-b border-[#E0E2E7] dark:border-[#333538] pb-4 gap-2 sm:gap-4">
        <div className="space-y-2 max-w-4xl min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg sm:text-xl font-normal text-[#1F1F1F] dark:text-[#E3E3E3] break-words min-w-0">
              {thread.subject}
            </h1>
            {thread.labels
              .filter((l) => l !== 'inbox')
              .map((lbl) => (
                <span
                  key={lbl}
                  className="px-2 py-0.5 rounded bg-[#F2F6FC] dark:bg-[#282A2C] text-xs font-normal text-[#444746] dark:text-[#C4C7C5] border border-[#E0E2E7] dark:border-[#333538]"
                >
                  {lbl}
                </span>
              ))}
          </div>
          <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F] tabular-nums">
            {thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0 text-[#444746] dark:text-[#C4C7C5]">
          <button
            onClick={() => window.print()}
            className={`${ICON_BTN} hidden sm:inline-flex`}
            title="Print all"
          >
            <Printer className="w-4 h-4 stroke-[1.5]" />
          </button>
          <button
            className={`${ICON_BTN} hidden sm:inline-flex`}
            title="Open in new window"
          >
            <ExternalLink className="w-4 h-4 stroke-[1.5]" />
          </button>
          <button
            onClick={() => onToggleStar(thread.id)}
            className={`${ICON_BTN} hover:text-[#B06000] dark:hover:text-[#F4B400]`}
            title={thread.isStarred ? 'Unstar conversation' : 'Star conversation'}
          >
            <Star
              className={`w-4 h-4 stroke-[1.5] ${
                thread.isStarred
                  ? 'fill-[#F4B400] text-[#B06000] dark:fill-[#F4B400] dark:text-[#F4B400]'
                  : 'text-[#8E918F]'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Message card */}
      <div className="border border-[#E0E2E7] dark:border-[#333538] rounded-xl overflow-hidden bg-white dark:bg-[#1E1F20]">
        <div className="p-3 sm:p-5 bg-white dark:bg-[#1E1F20] flex items-start justify-between gap-2 sm:gap-3 border-b border-[#F2F4F7] dark:border-[#333538]">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <ContactHovercard
              senderName={thread.senderName}
              senderEmail={thread.senderEmail}
              onComposeTo={onComposeTo}
            >
              <div className="w-10 h-10 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] text-white dark:text-[#042B5C] font-medium flex items-center justify-center text-sm shrink-0 hover:ring-2 hover:ring-gmail-blue/40 dark:hover:ring-white/20 transition-[box-shadow]">
                {thread.senderName.charAt(0).toUpperCase()}
              </div>
            </ContactHovercard>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                <ContactHovercard
                  senderName={thread.senderName}
                  senderEmail={thread.senderEmail}
                  onComposeTo={onComposeTo}
                >
                  <span className="font-medium text-sm text-[#1F1F1F] dark:text-[#E3E3E3] block max-w-full truncate hover:underline cursor-pointer">
                    {thread.senderName}
                  </span>
                </ContactHovercard>
                <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F] font-normal truncate max-w-full">
                  &lt;{thread.senderEmail}&gt;
                </span>
              </div>

              {/* Transport details */}
              <div className="relative inline-block mt-0.5" ref={detailsRef}>
                <button
                  type="button"
                  onClick={() => setShowDetailsDropdown((prev) => !prev)}
                  className="flex items-center gap-1 text-xs text-[#5E5E5E] dark:text-[#8E918F] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] transition-colors py-0.5 px-1 rounded-md hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]"
                >
                  <span>to me</span>
                  <ChevronDown className="w-3.5 h-3.5 stroke-[1.5]" />
                </button>

                {showDetailsDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-[min(24rem,calc(100vw-2rem))] bg-white dark:bg-[#1E1F20] rounded-xl shadow-gmail-modal border border-[#E0E2E7] dark:border-[#333538] p-4 z-50 text-xs space-y-2 select-text">
                    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-1.5 text-xs">
                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">From</span>
                      <span className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3] break-all">
                        {thread.senderName} &lt;{thread.senderEmail}&gt;
                      </span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">Reply-to</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3]">{thread.senderEmail}</span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">To</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3]">{currentUserEmail}</span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">Date</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3]">
                        {thread.receivedAtIso ? new Date(thread.receivedAtIso).toLocaleString() : thread.latestReceivedAt}
                      </span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">Subject</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3]">{thread.subject}</span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">Mailed by</span>
                      <span className="text-[#1F1F1F] dark:text-[#E3E3E3] font-mono text-xs">
                        {thread.senderEmail.split('@')[1] ?? ''}
                      </span>

                      <span className="text-[#5E5E5E] dark:text-[#8E918F]">Security</span>
                      <div className="flex items-center gap-1.5 text-[#137333] dark:text-[#81C995]">
                        <ShieldCheck className="w-4 h-4 stroke-[1.5]" />
                        <span>Standard encryption (TLS 1.3)</span>
                      </div>
                    </div>

                    <div className="pt-2.5 mt-2 border-t border-[#E0E2E7] dark:border-[#333538] flex flex-wrap gap-3 text-xs font-mono">
                      <span className="flex items-center gap-1 text-[#137333] dark:text-[#81C995]">
                        <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.5]" /> SPF pass
                      </span>
                      <span className="flex items-center gap-1 text-[#137333] dark:text-[#81C995]">
                        <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.5]" /> DKIM 2048-bit pass
                      </span>
                      <span className="flex items-center gap-1 text-[#137333] dark:text-[#81C995]">
                        <CheckCircle2 className="w-3.5 h-3.5 stroke-[1.5]" /> DMARC pass
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 text-[#444746] dark:text-[#C4C7C5]">
            <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F] mr-2 hidden sm:inline tabular-nums">
              {thread.latestReceivedAt}
            </span>

            <button
              onClick={() => onToggleStar(thread.id)}
              className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center hover:text-[#B06000] dark:hover:text-[#F4B400] rounded-full transition-colors"
              title="Star"
            >
              <Star
                className={`w-4 h-4 stroke-[1.5] ${
                  thread.isStarred
                    ? 'fill-[#F4B400] text-[#B06000] dark:fill-[#F4B400] dark:text-[#F4B400]'
                    : 'text-[#8E918F]'
                }`}
              />
            </button>

            <button
              onClick={() => setShowReplyBox(true)}
              className={ICON_BTN}
              title="Reply"
            >
              <Reply className="w-4 h-4 stroke-[1.5]" />
            </button>

            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu((prev) => !prev)}
                className={ICON_BTN}
                title="More options"
              >
                <MoreVertical className="w-4 h-4 stroke-[1.5]" />
              </button>

              {showMoreMenu && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-[#1E1F20] rounded-xl shadow-gmail-modal border border-[#E0E2E7] dark:border-[#333538] py-1.5 z-40 text-xs font-normal text-[#1F1F1F] dark:text-[#E3E3E3]">
                  <button
                    onClick={() => {
                      setShowReplyBox(true);
                      setShowMoreMenu(false);
                    }}
                    className={MENU_ITEM}
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => {
                      setShowMoreMenu(false);
                      onForward?.(thread);
                    }}
                    className={MENU_ITEM}
                  >
                    Forward
                  </button>
                  <button
                    onClick={() => {
                      window.print();
                      setShowMoreMenu(false);
                    }}
                    className={MENU_ITEM}
                  >
                    Print
                  </button>
                  <button
                    onClick={() => setShowMoreMenu(false)}
                    className={MENU_ITEM}
                  >
                    Show original
                  </button>
                  <button
                    onClick={() => setShowMoreMenu(false)}
                    className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] text-red-600 dark:text-red-400 transition-colors"
                  >
                    Delete message
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 text-sm text-[#1F1F1F] dark:text-[#E3E3E3] leading-relaxed space-y-4 font-normal select-text break-words [&_img]:max-w-full [&_table]:max-w-full">
          {(thread.messages ?? []).length > 0 ? (
            (thread.messages ?? []).map((msg) => (
              <div key={msg.id} className="space-y-3 min-w-0">
                {msg.bodyHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: msg.bodyHtml }} />
                ) : (
                  <p className="whitespace-pre-wrap break-words">{msg.bodyText || msg.snippet}</p>
                )}
              </div>
            ))
          ) : (
            <p className="whitespace-pre-wrap break-words">{thread.snippet}</p>
          )}

          <div className="pt-6 border-t border-[#F2F4F7] dark:border-[#333538] text-xs text-[#5E5E5E] dark:text-[#8E918F] space-y-0.5">
            <p className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{thread.senderName}</p>
            <p className="font-mono text-xs">{thread.senderEmail}</p>
          </div>
        </div>

        {/* Attachments */}
        {attachmentCount > 0 && (
          <div className="p-5 bg-[#F6F8FC] dark:bg-[#131314] border-t border-[#E0E2E7] dark:border-[#333538] space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#444746] dark:text-[#C4C7C5]">
              <Paperclip className="w-4 h-4 stroke-[1.5]" />
              <span>
                {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-4">
              {(thread.messages ?? []).flatMap((m, mi) =>
                (m.attachments ?? []).map((att, ai) => (
                  <div
                    key={`${mi}-${ai}-${att.id}`}
                    className="group relative w-full max-w-[14rem] sm:w-56 rounded-xl border border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] overflow-hidden transition-colors hover:border-[#C4C7C5] dark:hover:border-[#4A4D51]"
                  >
                    <div className="h-28 bg-[#F2F6FC] dark:bg-[#282A2C] flex items-center justify-center relative overflow-hidden">
                      <FileText className="w-12 h-12 stroke-[1.5] text-[#5E5E5E] dark:text-[#8E918F]" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity">
                        <button
                          onClick={() => downloadBlob(att.blobId ?? att.id, att.name)}
                          className="p-2 bg-white/90 hover:bg-white text-[#1F1F1F] rounded-full shadow"
                          title="Download"
                        >
                          <Download className="w-4 h-4 stroke-[1.5]" />
                        </button>
                      </div>
                    </div>

                    <div className="p-3">
                      <p className="text-xs font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">{att.name}</p>
                      <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F] font-mono tabular-nums mt-0.5">
                        {Math.max(1, Math.round(att.size / 1024))} KB
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Reply / forward */}
        {!showReplyBox && (
          <div className="p-4 bg-white dark:bg-[#1E1F20] border-t border-[#E0E2E7] dark:border-[#333538] flex flex-wrap items-center gap-2 sm:gap-3">
            <button onClick={() => setShowReplyBox(true)} className={OUTLINED_BUTTON}>
              <Reply className="w-4 h-4 stroke-[1.5]" />
              <span>Reply</span>
            </button>

            <button onClick={() => setShowReplyBox(true)} className={OUTLINED_BUTTON}>
              <ReplyAll className="w-4 h-4 stroke-[1.5]" />
              <span>Reply all</span>
            </button>

            <button onClick={() => onForward?.(thread)} className={OUTLINED_BUTTON}>
              <Forward className="w-4 h-4 stroke-[1.5]" />
              <span>Forward</span>
            </button>
          </div>
        )}
      </div>

      {/* Inline reply */}
      {showReplyBox && (
        <div className="border border-[#E0E2E7] dark:border-[#333538] rounded-xl bg-white dark:bg-[#1E1F20] overflow-hidden space-y-3 p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-[#5E5E5E] dark:text-[#8E918F] border-b border-[#F2F4F7] dark:border-[#333538] pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <Reply className="w-4 h-4 stroke-[1.5] shrink-0" />
              <span className="truncate">
                Reply to <strong className="font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">{thread.senderName}</strong> &lt;
                {thread.senderEmail}&gt;
              </span>
            </div>
            <button
              onClick={() => setShowReplyBox(false)}
              className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center shrink-0 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full text-[#5E5E5E] dark:text-[#8E918F]"
              title="Close reply"
              aria-label="Close reply"
            >
              <X className="w-4 h-4 stroke-[1.5]" />
            </button>
          </div>

          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your reply"
            className="w-full h-32 text-sm bg-transparent border-none outline-none resize-none text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5E5E5E] dark:placeholder:text-[#8E918F] leading-relaxed"
            autoFocus
          ></textarea>

          <div className="flex items-center justify-between pt-2 border-t border-[#F2F4F7] dark:border-[#333538]">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSend}
                className="bg-gmail-blue hover:bg-gmail-blue-hover text-white text-sm font-medium px-5 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <span>Send</span>
              </button>

              <button
                className={ICON_BTN}
                title="Attach files"
              >
                <Paperclip className="w-4 h-4 stroke-[1.5]" />
              </button>
              <button
                className={ICON_BTN}
                title="Insert link"
              >
                <Link2 className="w-4 h-4 stroke-[1.5]" />
              </button>
            </div>

            <button
              onClick={() => {
                setReplyText('');
                setShowReplyBox(false);
              }}
              className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 dark:hover:text-red-400 rounded-full transition-colors"
              title="Discard reply"
            >
              <Trash2 className="w-4 h-4 stroke-[1.5]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
