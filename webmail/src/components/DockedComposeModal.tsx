import React, { useState, useRef } from 'react';
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
  AlertTriangle,
} from 'lucide-react';
import { validateAttachment, formatFileSize } from '../utils/attachmentValidator';

interface DockedComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (message: { to: string; cc: string; subject: string; body: string; attachments: File[] }) => void;
  planLimitMb: number;
  onErrorToast: (msg: string) => void;
}

export const DockedComposeModal: React.FC<DockedComposeModalProps> = ({
  isOpen,
  onClose,
  onSend,
  planLimitMb,
  onErrorToast,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleSend = () => {
    if (!to.trim()) {
      onErrorToast('Please specify at least one recipient.');
      return;
    }

    onSend({
      to,
      cc,
      subject: subject || '(No Subject)',
      body,
      attachments,
    });

    // Reset fields
    setTo('');
    setCc('');
    setSubject('');
    setBody('');
    setAttachments([]);
    onClose();
  };

  return (
    <div
      className={`fixed z-50 transition-all duration-200 shadow-2xl rounded-t-xl overflow-hidden border border-base-300 bg-base-100 flex flex-col ${
        isMaximized
          ? 'inset-6 rounded-xl'
          : isMinimized
          ? 'bottom-0 right-10 w-72 h-11'
          : 'bottom-0 right-10 w-[580px] h-[540px]'
      }`}
    >
      {/* Modal Header */}
      <div className="bg-neutral text-neutral-content px-4 py-2.5 flex items-center justify-between select-none shrink-0">
        <span className="font-semibold text-xs truncate">
          {subject ? subject : 'New Message'}
        </span>
        <div className="flex items-center gap-1.5 text-neutral-content/70">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="hover:text-white p-1 rounded"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setIsMaximized(!isMaximized);
              setIsMinimized(false);
            }}
            className="hover:text-white p-1 rounded hidden sm:block"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onClose} className="hover:text-white p-1 rounded" title="Close (Esc)">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="flex-1 flex flex-col min-h-0 bg-base-100">
          {/* Recipients & Subject Bar */}
          <div className="divide-y divide-base-200 text-xs">
            {/* To Input */}
            <div className="flex items-center px-4 py-2 gap-2">
              <span className="text-base-content/50 w-12 font-medium">To:</span>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="client@enterprise.com"
                className="flex-1 bg-transparent border-none outline-none text-base-content text-xs placeholder:text-base-content/40"
              />
              {!showCc && (
                <button
                  onClick={() => setShowCc(true)}
                  className="text-base-content/50 hover:text-primary text-[11px] font-semibold"
                >
                  Cc
                </button>
              )}
            </div>

            {/* Cc Input if toggled */}
            {showCc && (
              <div className="flex items-center px-4 py-2 gap-2">
                <span className="text-base-content/50 w-12 font-medium">Cc:</span>
                <input
                  type="email"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="team@hostaffin.com"
                  className="flex-1 bg-transparent border-none outline-none text-base-content text-xs placeholder:text-base-content/40"
                />
              </div>
            )}

            {/* Subject Input */}
            <div className="flex items-center px-4 py-2 gap-2">
              <span className="text-base-content/50 w-12 font-medium">Subject:</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Project Handover & Documentation..."
                className="flex-1 bg-transparent border-none outline-none text-base-content text-xs font-semibold placeholder:text-base-content/40"
              />
            </div>
          </div>

          {/* Rich Text Toolbar (TipTap Simulation) */}
          <div className="h-9 border-y border-base-200 bg-base-200/40 px-3 flex items-center gap-1 select-none shrink-0">
            <button className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content" title="Bold">
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content" title="Italic">
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content" title="Underline">
              <Underline className="w-3.5 h-3.5" />
            </button>
            <div className="h-3.5 w-px bg-base-300 mx-1"></div>
            <button className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content" title="Bullet List">
              <List className="w-3.5 h-3.5" />
            </button>
            <button className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content" title="Numbered List">
              <ListOrdered className="w-3.5 h-3.5" />
            </button>
            <button className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content" title="Code Block">
              <Code className="w-3.5 h-3.5" />
            </button>
            <button className="btn btn-ghost btn-circle btn-xs text-base-content/70 hover:text-base-content" title="Insert Link">
              <Link2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Body Area */}
          <div className="flex-1 p-4 flex flex-col min-h-0">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your email here..."
              className="w-full flex-1 bg-transparent border-none outline-none resize-none text-sm leading-relaxed text-base-content placeholder:text-base-content/40"
            ></textarea>

            {/* Attachments Pill List */}
            {attachments.length > 0 && (
              <div className="pt-2 border-t border-base-200 flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {attachments.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-base-200 rounded-lg text-xs border border-base-300"
                  >
                    <Paperclip className="w-3 h-3 text-primary" />
                    <span className="font-medium truncate max-w-[140px]">{file.name}</span>
                    <span className="text-[10px] text-base-content/50 font-mono">
                      ({formatFileSize(file.size)})
                    </span>
                    <button
                      onClick={() => removeAttachment(idx)}
                      className="text-base-content/40 hover:text-error ml-1"
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

          {/* Bottom Action Footer */}
          <div className="p-3 border-t border-base-200 bg-base-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSend}
                className="btn btn-primary btn-sm px-5 gap-2 normal-case font-semibold shadow-sm shadow-primary/20"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-ghost btn-circle btn-sm text-base-content/70 hover:text-primary"
                title={`Attach files (Max ${planLimitMb}MB)`}
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <span className="text-[11px] text-base-content/50 font-mono">
                Plan Limit: {planLimitMb} MB
              </span>
            </div>

            <button
              onClick={() => {
                if (confirm('Discard this draft?')) {
                  onClose();
                }
              }}
              className="btn btn-ghost btn-circle btn-sm text-base-content/40 hover:text-error"
              title="Discard draft"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
