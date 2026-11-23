import React, { useState, useRef } from 'react';
import {
  Mail,
  MessageSquare,
  Video,
  Calendar,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';

interface ContactHovercardProps {
  senderName: string;
  senderEmail: string;
  domain?: string;
  isVerified?: boolean;
  onComposeTo?: (email: string) => void;
  children: React.ReactNode;
  position?: 'bottom' | 'top';
}

export const ContactHovercard: React.FC<ContactHovercardProps> = ({
  senderName,
  senderEmail,
  domain,
  isVerified = true,
  onComposeTo,
  children,
  position = 'bottom',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
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

  // Deterministic color based on sender name
  const avatarBgColors = [
    'bg-[#0B57D0]',
    'bg-[#7B1FA2]',
    'bg-[#C2185B]',
    'bg-[#00796B]',
    'bg-[#D84315]',
    'bg-[#303F9F]',
  ];
  const charCode = senderName.charCodeAt(0) || 0;
  const avatarColor = avatarBgColors[charCode % avatarBgColors.length];

  return (
    <div
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Trigger element (e.g. sender name or avatar) */}
      <div className="cursor-pointer">{children}</div>

      {/* Floating Gmail Contact Profile Card */}
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute left-0 z-50 w-72 sm:w-80 bg-white dark:bg-[#1E1F20] rounded-2xl shadow-gmail-modal border border-[#E0E2E7] dark:border-[#333538] p-4 text-[#1F1F1F] dark:text-[#E3E3E3] animate-in fade-in zoom-in-95 duration-150 select-text ${
            position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          {/* Top Section: Avatar & Name */}
          <div className="flex items-start gap-3.5 pb-3 border-b border-[#F2F4F7] dark:border-[#2D2F31]">
            <div
              className={`w-12 h-12 rounded-full ${avatarColor} text-white font-medium flex items-center justify-center text-lg shrink-0 shadow-sm`}
            >
              {senderName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-sm text-[#1F1F1F] dark:text-[#E3E3E3] truncate leading-tight">
                {senderName}
              </h4>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F] truncate font-normal">
                  {senderEmail}
                </span>
                <button
                  onClick={handleCopyEmail}
                  className="p-1 hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors shrink-0"
                  title="Copy email address"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>

              {/* Organization / Domain Badge */}
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#F2F6FC] dark:bg-[#282A2C] text-[#444746] dark:text-[#C4C7C5] border border-[#E0E2E7] dark:border-[#333538] font-mono">
                  {derivedDomain}
                </span>
              </div>
            </div>
          </div>

          {/* Middle Section: Security & Delivery Status */}
          <div className="py-2.5 px-1 border-b border-[#F2F4F7] dark:border-[#2D2F31] flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 stroke-[2]" />
              <span>Verified Sender</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-mono text-[#5E5E5E] dark:text-[#8E918F]">
              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              <span>SPF · DKIM valid</span>
            </div>
          </div>

          {/* Bottom Section: Gmail Quick Action Buttons */}
          <div className="pt-3 flex items-center justify-between gap-2">
            <button
              onClick={() => {
                onComposeTo?.(senderEmail);
                setIsOpen(false);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-full bg-[#E8F0FE] dark:bg-[#004A77]/40 hover:bg-[#D2E3FC] dark:hover:bg-[#004A77]/70 text-gmail-blue text-xs font-semibold transition-colors"
              title="Send email"
            >
              <Mail className="w-3.5 h-3.5 stroke-[2]" />
              <span>Send message</span>
            </button>

            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  alert(`Starting audio/video call with ${senderName}...`);
                  setIsOpen(false);
                }}
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                title="Start video meeting"
              >
                <Video className="w-4 h-4 stroke-[2]" />
              </button>

              <button
                onClick={() => {
                  alert(`Scheduling calendar event with ${senderName}...`);
                  setIsOpen(false);
                }}
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                title="Schedule event"
              >
                <Calendar className="w-4 h-4 stroke-[2]" />
              </button>

              <button
                onClick={() => {
                  alert(`Opening chat with ${senderName}...`);
                  setIsOpen(false);
                }}
                className="p-2 text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C] rounded-full transition-colors"
                title="Open chat"
              >
                <MessageSquare className="w-4 h-4 stroke-[2]" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
