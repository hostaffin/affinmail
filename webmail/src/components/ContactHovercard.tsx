import React, { useState, useRef } from 'react';
import {
  Mail,
  MessageSquare,
  Video,
  Calendar,
  Copy,
  Check,
  Building2,
  Phone,
  BadgeCheck,
} from 'lucide-react';
import { Contact, findContactByEmail } from '../lib/collab';

interface ContactHovercardProps {
  senderName: string;
  senderEmail: string;
  domain?: string;
  onComposeTo?: (email: string) => void;
  children: React.ReactNode;
  position?: 'bottom' | 'top';
}

export const ContactHovercard: React.FC<ContactHovercardProps> = ({
  senderName,
  senderEmail,
  domain,
  onComposeTo,
  children,
  position = 'bottom',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
      findContactByEmail(senderEmail)
        .then(setContact)
        .catch(() => setContact(null));
    }, 280); // Gmail-like slight delay so moving mouse quickly across rows doesn't flash cards
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 200);
  };

  const handleCopyEmail = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(senderEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const derivedDomain = domain || senderEmail.split('@')[1] || 'domain.com';


  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger element (e.g. sender name or avatar) */}
      <div className="cursor-pointer">{children}</div>

      {/* Floating Gmail Contact Profile Card: hover-only chrome, so phones skip it */}
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`hidden md:block absolute left-0 z-50 w-72 sm:w-80 bg-white dark:bg-[#1E1F20] rounded-xl shadow-gmail-modal border border-[#E0E2E7] dark:border-[#333538] p-4 text-[#1F1F1F] dark:text-[#E3E3E3] select-text ${
            position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {/* Top Section: Avatar & Name */}
          <div className="flex items-start gap-3 pb-3 border-b border-[#F2F4F7] dark:border-[#333538]">
            <div
              className="w-12 h-12 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] text-white dark:text-[#042B5C] font-medium flex items-center justify-center text-lg shrink-0"
            >
              {senderName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-medium text-sm text-[#1F1F1F] dark:text-[#E3E3E3] truncate leading-tight">
                {senderName}
              </h4>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F] truncate font-normal">
                  {senderEmail}
                </span>
                <button
                  onClick={handleCopyEmail}
                  className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full text-[#8E918F] hover:text-[#1F1F1F] dark:hover:text-[#E3E3E3] transition-colors shrink-0"
                  title="Copy email address"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 stroke-[1.5] text-[#137333] dark:text-[#81C995]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 stroke-[1.5]" />
                  )}
                </button>
              </div>

              {/* Organization / Domain Badge */}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="text-xs px-2 py-0.5 rounded bg-[#F2F6FC] dark:bg-[#282A2C] text-[#444746] dark:text-[#C4C7C5] border border-[#E0E2E7] dark:border-[#333538] font-mono">
                  {contact?.organization || derivedDomain}
                </span>
                {contact && (
                  <span className="text-xs text-[#137333] dark:text-[#81C995] flex items-center gap-1">
                    <BadgeCheck className="w-3.5 h-3.5 stroke-[1.5]" />
                    Saved contact
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Saved contact details: only what the address book actually holds */}
          {contact && (contact.title || contact.phones.length > 0) && (
            <div className="py-2.5 px-1 border-b border-[#F2F4F7] dark:border-[#333538] space-y-1 text-xs text-[#444746] dark:text-[#C4C7C5]">
              {contact.title && (
                <div className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  <span className="truncate">{contact.title}</span>
                </div>
              )}
              {contact.phones.map((phone) => (
                <div key={phone} className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5" />
                  <span className="truncate">{phone}</span>
                </div>
              ))}
            </div>
          )}

          {/* Bottom Section: Gmail Quick Action Buttons */}
          <div className="pt-3 flex items-center justify-between gap-2">
            <button
              onClick={() => {
                onComposeTo?.(senderEmail);
                setIsOpen(false);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover text-white text-xs font-medium transition-colors"
              title="Send email"
            >
              <Mail className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Send message</span>
            </button>

            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  alert(`Starting audio/video call with ${senderName}...`);
                  setIsOpen(false);
                }}
                className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                title="Start video meeting"
              >
                <Video className="w-4 h-4 stroke-[1.5]" />
              </button>

              <button
                onClick={() => {
                  alert(`Scheduling calendar event with ${senderName}...`);
                  setIsOpen(false);
                }}
                className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                title="Schedule event"
              >
                <Calendar className="w-4 h-4 stroke-[1.5]" />
              </button>

              <button
                onClick={() => {
                  alert(`Opening chat with ${senderName}...`);
                  setIsOpen(false);
                }}
                className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                title="Open chat"
              >
                <MessageSquare className="w-4 h-4 stroke-[1.5]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
