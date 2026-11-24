import React from 'react';

const HUES = [210, 160, 265, 20, 340, 120, 45, 190, 300, 85, 0, 230];

function senderHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return HUES[h % HUES.length];
}

function senderInitials(name: string, email: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (email.trim().charAt(0) || '?').toUpperCase();
}

interface SenderAvatarProps {
  name: string;
  email: string;
  /** Tailwind size + text classes, e.g. 'w-8 h-8 text-[11px]' */
  className?: string;
}

/**
 * Small round sender avatar: initials on a soft colour derived from the
 * sender address, so the same sender always gets the same colour.
 */
export const SenderAvatar: React.FC<SenderAvatarProps> = ({
  name,
  email,
  className = 'w-8 h-8 text-[11px]',
}) => {
  const hue = senderHue((email || name).toLowerCase());
  return (
    <div
      aria-hidden
      className={`rounded-full flex items-center justify-center font-medium shrink-0 select-none ${className}`}
      style={{
        backgroundColor: `hsl(${hue} 65% 82%)`,
        color: `hsl(${hue} 55% 30%)`,
      }}
    >
      {senderInitials(name, email)}
    </div>
  );
};
