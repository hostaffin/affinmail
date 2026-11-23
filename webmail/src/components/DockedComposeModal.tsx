import React, { useState, useRef, useEffect } from 'react';
import {
  Minus,
  Maximize2,
  Minimize2,
  X,
  Paperclip,
  Trash2,
  Send,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Code,
  Link2,
  ChevronDown,
  Smile,
  HardDrive,
  Image,
  Lock,
  PenTool,
  Clock,
  Check,
} from 'lucide-react';
import { validateAttachment, formatFileSize } from '../utils/attachmentValidator';

export interface ComposePayload {
  to: string;
  cc: string;
  subject: string;
  body: string;
  attachments: File[];
}

interface DockedComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (message: ComposePayload) => Promise<void> | void;
  /** Persist the current contents server-side (Drafts). Returns the draft email id. */
  onSaveDraft?: (message: ComposePayload, draftId?: string) => Promise<string | undefined>;
  onDiscardDraft?: (draftId: string) => void;
  planLimitMb: number;
  onErrorToast: (msg: string) => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  initialDraftId?: string;
}

export const DockedComposeModal: React.FC<DockedComposeModalProps> = ({
  isOpen,
  onClose,
  onSend,
  onSaveDraft,
  onDiscardDraft,
  planLimitMb,
  onErrorToast,
  initialTo,
  initialSubject,
  initialBody,
  initialDraftId,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const [toInput, setToInput] = useState('');
  const [toChips, setToChips] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [ccChips, setCcChips] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [bccInput, setBccInput] = useState('');
  const [bccChips, setBccChips] = useState<string[]>([]);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showFormatting, setShowFormatting] = useState(false);
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scheduleMenuRef = useRef<HTMLDivElement>(null);

  const wasOpen = useRef(false);

  useEffect(() => {
    // Fresh compose: nothing to prefill and no draft to resume → clear whatever was left behind.
    if (isOpen && !wasOpen.current && !initialTo && !initialSubject && !initialBody && !initialDraftId) {
      setToChips([]);
      setSubject('');
      setBody('');
      setAttachments([]);
      setDraftId(undefined);
    }
    wasOpen.current = isOpen;
    if (!isOpen) return;
    if (initialTo) {
      setToChips((prev) => (prev.includes(initialTo) ? prev : [...prev, initialTo]));
    }
    if (initialSubject !== undefined) setSubject(initialSubject);
    if (initialBody !== undefined) setBody(initialBody);
    if (initialDraftId !== undefined) setDraftId(initialDraftId);
  }, [initialTo, initialSubject, initialBody, initialDraftId, isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (scheduleMenuRef.current && !scheduleMenuRef.current.contains(e.target as Node)) {
        setShowScheduleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = validateAttachment(file, planLimitMb);
      if (!validation.valid) {
        onErrorToast(validation.error || 'Attachment size limit exceeded.');
        return;
      }
      newFiles.push(file);
    }

    setAttachments((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const addRecipientChip = (type: 'to' | 'cc' | 'bcc', val: string) => {
    const clean = val.trim().replace(/,$/, '');
    if (!clean) return;

    if (type === 'to') {
      if (!toChips.includes(clean)) setToChips((prev) => [...prev, clean]);
      setToInput('');
    } else if (type === 'cc') {
      if (!ccChips.includes(clean)) setCcChips((prev) => [...prev, clean]);
      setCcInput('');
    } else if (type === 'bcc') {
      if (!bccChips.includes(clean)) setBccChips((prev) => [...prev, clean]);
      setBccInput('');
    }
  };

  const currentPayload = (): ComposePayload => {
    const allTo = [...toChips];
    if (toInput.trim()) allTo.push(toInput.trim());
    const allCc = [...ccChips];
    if (ccInput.trim()) allCc.push(ccInput.trim());
    const allBcc = [...bccChips];
    if (bccInput.trim()) allBcc.push(bccInput.trim());
    return {
      to: allTo.join(', '),
      cc: [...allCc, ...allBcc].join(', '),
      subject: subject || '(no subject)',
      body,
      attachments,
    };
  };

  const resetFields = () => {
    setToInput('');
    setToChips([]);
    setCcInput('');
    setCcChips([]);
    setBccInput('');
    setBccChips([]);
    setSubject('');
    setBody('');
    setAttachments([]);
    setDraftId(undefined);
  };

  const hasContent = () =>
    Boolean(toChips.length || toInput.trim() || subject.trim() || body.trim() || attachments.length);

  const handleSend = async () => {
    const payload = currentPayload();
    if (!payload.to.trim()) {
      onErrorToast('Please specify at least one recipient.');
      return;
    }
    setIsSending(true);
    try {
      await onSend(payload);
      resetFields();
      onClose();
    } catch (err) {
      onErrorToast(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = async () => {
    if (hasContent() && onSaveDraft) {
      try {
        const id = await onSaveDraft(currentPayload(), draftId);
        if (id) setDraftId(id);
      } catch {
        // onSaveDraft already reports failures.
      }
    }
    onClose();
  };

  const handleScheduleSend = async (scheduledTime: string) => {
    setShowScheduleMenu(false);
    onErrorToast(`Scheduled send unavailable (${scheduledTime}); sending now.`);
    await handleSend();
  };

  return (
    <div
      className={`fixed z-50 transition-all duration-150 border border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] flex flex-col shadow-gmail-modal select-none ${
        isMaximized
          ? 'inset-0 sm:inset-4 rounded-none sm:rounded-2xl'
          : isMinimized
          ? 'bottom-0 right-6 w-72 h-10 rounded-t-xl'
          : 'bottom-0 right-6 w-full sm:w-[580px] h-full sm:h-[540px] rounded-t-2xl'
      }`}
    >
      {/* 1. Modal Top Bar */}
      <div className="bg-[#F2F6FC] dark:bg-[#282A2C] px-4 h-10 flex items-center justify-between select-none shrink-0 rounded-t-2xl border-b border-[#E0E2E7] dark:border-[#333538]">
        <span className="font-semibold text-xs text-[#1F1F1F] dark:text-[#E3E3E3] truncate">
          {subject ? subject : 'New Message'}
        </span>
        <div className="flex items-center gap-1 text-[#444746] dark:text-[#C4C7C5]">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#E0E2E7] dark:hover:bg-[#333538] p-1.5 rounded-full transition-colors"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            <Minus className="w-3.5 h-3.5 stroke-[2]" />
          </button>
          <button
            onClick={() => {
              setIsMaximized(!isMaximized);
              setIsMinimized(false);
            }}
            className="hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#E0E2E7] dark:hover:bg-[#333538] p-1.5 rounded-full transition-colors hidden sm:block"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <Minimize2 className="w-3.5 h-3.5 stroke-[2]" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 stroke-[2]" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] hover:bg-[#E0E2E7] dark:hover:bg-[#333538] p-1.5 rounded-full transition-colors"
            title="Save & close"
          >
            <X className="w-3.5 h-3.5 stroke-[2]" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#1E1F20]">
          {/* 2. Recipients & Subject Inputs */}
          <div className="divide-y divide-[#F2F4F7] dark:divide-[#2D2F31] text-xs">
            {/* To Line */}
            <div className="flex flex-wrap items-center px-4 py-2 gap-1.5 min-h-[40px]">
              <span className="text-[#5E5E5E] dark:text-[#8E918F] w-8 font-medium">To</span>
              <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-[120px]">
                {toChips.map((chip, idx) => (
                  <span
                    key={idx}
                    className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8F0FE] dark:bg-[#004A77]/40 text-gmail-blue text-xs font-medium border border-[#D2E3FC] dark:border-[#004A77]"
                  >
                    <span>{chip}</span>
                    <button
                      onClick={() => setToChips((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-gmail-blue hover:text-red-600 ml-0.5"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="email"
                  value={toInput}
                  onChange={(e) => setToInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addRecipientChip('to', toInput);
                    } else if (e.key === 'Backspace' && !toInput && toChips.length > 0) {
                      setToChips((prev) => prev.slice(0, -1));
                    }
                  }}
                  onBlur={() => addRecipientChip('to', toInput)}
                  placeholder={toChips.length === 0 ? 'Recipients' : ''}
                  className="flex-1 bg-transparent border-none outline-none text-[#1F1F1F] dark:text-[#E3E3E3] text-xs min-w-[100px] placeholder:text-[#5E5E5E]"
                />
              </div>

              <div className="flex items-center gap-2 text-[#5E5E5E] dark:text-[#8E918F] shrink-0 font-medium">
                {!showCc && (
                  <button
                    onClick={() => setShowCc(true)}
                    className="hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] text-xs"
                  >
                    Cc
                  </button>
                )}
                {!showBcc && (
                  <button
                    onClick={() => setShowBcc(true)}
                    className="hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] text-xs"
                  >
                    Bcc
                  </button>
                )}
              </div>
            </div>

            {/* Cc Line */}
            {showCc && (
              <div className="flex flex-wrap items-center px-4 py-2 gap-1.5 min-h-[40px]">
                <span className="text-[#5E5E5E] dark:text-[#8E918F] w-8 font-medium">Cc</span>
                <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-[120px]">
                  {ccChips.map((chip, idx) => (
                    <span
                      key={idx}
                      className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8F0FE] dark:bg-[#004A77]/40 text-gmail-blue text-xs font-medium border border-[#D2E3FC] dark:border-[#004A77]"
                    >
                      <span>{chip}</span>
                      <button
                        onClick={() => setCcChips((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-gmail-blue hover:text-red-600 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="email"
                    value={ccInput}
                    onChange={(e) => setCcInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addRecipientChip('cc', ccInput);
                      }
                    }}
                    onBlur={() => addRecipientChip('cc', ccInput)}
                    className="flex-1 bg-transparent border-none outline-none text-[#1F1F1F] dark:text-[#E3E3E3] text-xs min-w-[100px]"
                  />
                </div>
              </div>
            )}

            {/* Bcc Line */}
            {showBcc && (
              <div className="flex flex-wrap items-center px-4 py-2 gap-1.5 min-h-[40px]">
                <span className="text-[#5E5E5E] dark:text-[#8E918F] w-8 font-medium">Bcc</span>
                <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-[120px]">
                  {bccChips.map((chip, idx) => (
                    <span
                      key={idx}
                      className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E8F0FE] dark:bg-[#004A77]/40 text-gmail-blue text-xs font-medium border border-[#D2E3FC] dark:border-[#004A77]"
                    >
                      <span>{chip}</span>
                      <button
                        onClick={() => setBccChips((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-gmail-blue hover:text-red-600 ml-0.5"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="email"
                    value={bccInput}
                    onChange={(e) => setBccInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addRecipientChip('bcc', bccInput);
                      }
                    }}
                    onBlur={() => addRecipientChip('bcc', bccInput)}
                    className="flex-1 bg-transparent border-none outline-none text-[#1F1F1F] dark:text-[#E3E3E3] text-xs min-w-[100px]"
                  />
                </div>
              </div>
            )}

            {/* Subject Line */}
            <div className="flex items-center px-4 py-2 gap-2">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full bg-transparent border-none outline-none text-[#1F1F1F] dark:text-[#E3E3E3] text-xs font-medium placeholder:text-[#5E5E5E]"
              />
            </div>
          </div>

          {/* 3. Formatting Toolbar (Toggleable) */}
          {showFormatting && (
            <div className="h-9 border-y border-[#E0E2E7] dark:border-[#333538] bg-[#F2F6FC] dark:bg-[#282A2C] px-3 flex items-center gap-1 select-none shrink-0 overflow-x-auto text-[#444746] dark:text-[#C4C7C5]">
              <button className="p-1.5 hover:bg-white dark:hover:bg-[#1E1F20] rounded" title="Bold">
                <Bold className="w-3.5 h-3.5 stroke-[2]" />
              </button>
              <button className="p-1.5 hover:bg-white dark:hover:bg-[#1E1F20] rounded" title="Italic">
                <Italic className="w-3.5 h-3.5 stroke-[2]" />
              </button>
              <button className="p-1.5 hover:bg-white dark:hover:bg-[#1E1F20] rounded" title="Underline">
                <Underline className="w-3.5 h-3.5 stroke-[2]" />
              </button>
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-600 mx-1 shrink-0"></div>
              <button className="p-1.5 hover:bg-white dark:hover:bg-[#1E1F20] rounded" title="Bulleted list">
                <List className="w-3.5 h-3.5 stroke-[2]" />
              </button>
              <button className="p-1.5 hover:bg-white dark:hover:bg-[#1E1F20] rounded" title="Numbered list">
                <ListOrdered className="w-3.5 h-3.5 stroke-[2]" />
              </button>
              <button className="p-1.5 hover:bg-white dark:hover:bg-[#1E1F20] rounded" title="Code">
                <Code className="w-3.5 h-3.5 stroke-[2]" />
              </button>
            </div>
          )}

          {/* 4. Email Body Area */}
          <div className="flex-1 p-4 flex flex-col min-h-0">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your email here..."
              className="w-full flex-1 bg-transparent border-none outline-none resize-none text-xs leading-relaxed text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5E5E5E]"
            ></textarea>

            {/* Attached Files Chips */}
            {attachments.length > 0 && (
              <div className="pt-2 border-t border-[#F2F4F7] dark:border-[#2D2F31] flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {attachments.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 px-3 py-1 bg-[#F2F6FC] dark:bg-[#282A2C] rounded-lg text-xs border border-[#E0E2E7] dark:border-[#333538] font-mono tabular-nums text-[#1F1F1F] dark:text-[#E3E3E3]"
                  >
                    <Paperclip className="w-3.5 h-3.5 stroke-[2] text-gmail-blue" />
                    <span className="truncate max-w-[140px] font-sans font-medium">{file.name}</span>
                    <span className="text-[10px] text-[#5E5E5E] dark:text-[#8E918F]">
                      ({formatFileSize(file.size)})
                    </span>
                    <button
                      onClick={() => removeAttachment(idx)}
                      className="text-[#5E5E5E] hover:text-red-600 ml-1 font-bold"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          {/* 5. Authentic Gmail Bottom Action Bar */}
          <div className="px-4 py-3 border-t border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#1E1F20] flex items-center justify-between gap-3 shrink-0">
            {/* Left: Split Send Button & Toolbar Icons */}
            <div className="flex items-center gap-1.5">
              {/* Split Send Pill Button */}
              <div className="relative flex items-center mr-2" ref={scheduleMenuRef}>
                <button
                  onClick={handleSend}
                  disabled={isSending}
                  className="bg-gmail-blue hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold px-4 h-9 rounded-l-full flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <span>{isSending ? 'Sending…' : 'Send'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowScheduleMenu((prev) => !prev)}
                  className="bg-gmail-blue hover:bg-blue-700 text-white h-9 px-2 rounded-r-full border-l border-blue-400 flex items-center justify-center transition-colors shadow-sm"
                  title="Schedule send"
                >
                  <ChevronDown className="w-3.5 h-3.5 stroke-[2]" />
                </button>

                {/* Schedule Send Popup Menu */}
                {showScheduleMenu && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-[#1E1F20] rounded-2xl shadow-xl border border-[#E0E2E7] dark:border-[#333538] py-2 z-50 text-xs text-[#1F1F1F] dark:text-[#E3E3E3]">
                    <div className="px-4 py-1.5 text-[11px] font-semibold text-[#5E5E5E] dark:text-[#8E918F] uppercase tracking-wider">
                      Schedule send
                    </div>
                    <button
                      onClick={() => handleScheduleSend('Tomorrow morning (8:00 AM)')}
                      className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] flex items-center justify-between"
                    >
                      <span>Tomorrow morning</span>
                      <span className="text-[#5E5E5E] font-mono text-[11px]">8:00 AM</span>
                    </button>
                    <button
                      onClick={() => handleScheduleSend('Tomorrow afternoon (1:00 PM)')}
                      className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] flex items-center justify-between"
                    >
                      <span>Tomorrow afternoon</span>
                      <span className="text-[#5E5E5E] font-mono text-[11px]">1:00 PM</span>
                    </button>
                    <button
                      onClick={() => handleScheduleSend('Monday morning (8:00 AM)')}
                      className="w-full text-left px-4 py-2 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] flex items-center justify-between"
                    >
                      <span>Monday morning</span>
                      <span className="text-[#5E5E5E] font-mono text-[11px]">8:00 AM</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Formatting Toggle */}
              <button
                onClick={() => setShowFormatting(!showFormatting)}
                className={`p-2 rounded-full transition-colors ${
                  showFormatting
                    ? 'bg-[#C2E7FF] text-gmail-blue'
                    : 'text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]'
                }`}
                title="Formatting options"
              >
                <Underline className="w-4 h-4 stroke-[2]" />
              </button>

              {/* Attach File */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                title={`Attach files (Max ${planLimitMb}MB)`}
              >
                <Paperclip className="w-4 h-4 stroke-[2]" />
              </button>

              {/* Insert Link */}
              <button
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden sm:inline-flex"
                title="Insert link"
              >
                <Link2 className="w-4 h-4 stroke-[2]" />
              </button>

              {/* Insert Emoji */}
              <button
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden sm:inline-flex"
                title="Insert emoji"
              >
                <Smile className="w-4 h-4 stroke-[2]" />
              </button>

              {/* Insert Files using Drive */}
              <button
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden sm:inline-flex"
                title="Insert files from Storage Box"
              >
                <HardDrive className="w-4 h-4 stroke-[2]" />
              </button>

              {/* Insert Photo */}
              <button
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden md:inline-flex"
                title="Insert photo"
              >
                <Image className="w-4 h-4 stroke-[2]" />
              </button>

              {/* Confidential Mode */}
              <button
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors hidden md:inline-flex"
                title="Toggle confidential mode"
              >
                <Lock className="w-4 h-4 stroke-[2]" />
              </button>
            </div>

            {/* Right: Discard Draft */}
            <button
              onClick={() => {
                if (confirm('Discard this draft?')) {
                  if (draftId) onDiscardDraft?.(draftId);
                  resetFields();
                  onClose();
                }
              }}
              className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:text-red-600 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
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
