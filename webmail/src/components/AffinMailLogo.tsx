import React from 'react';

export interface AffinMailLogoProps {
  /** Visual variant: 'full' (logo + text), 'icon' (just icon mark), 'admin' (with admin badge) */
  variant?: 'full' | 'icon' | 'admin';
  /** Size preset */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Custom additional CSS classes */
  className?: string;
  /** Subtitle or version tag to show under/beside the wordmark */
  tagline?: string;
  /** Whether to show the glowing aura/shadow */
  withGlow?: boolean;
}

export const AFFINMAIL_DEFAULT_TAGLINE = 'Optimized Workspace of Efficient Business.';

const sizeConfig = {
  xs: { icon: 20, text: 'text-base', badge: 'text-[9px] px-1 py-0.2', gap: 'gap-1.5' },
  sm: { icon: 26, text: 'text-lg', badge: 'text-[10px] px-1.5 py-0.5', gap: 'gap-2' },
  md: { icon: 34, text: 'text-xl', badge: 'text-[11px] px-1.5 py-0.5', gap: 'gap-2.5' },
  lg: { icon: 42, text: 'text-2xl', badge: 'text-xs px-2 py-0.5', gap: 'gap-3' },
  xl: { icon: 54, text: 'text-3xl', badge: 'text-xs px-2.5 py-1', gap: 'gap-3.5' },
};

export const AffinMailIcon: React.FC<{ size?: number; className?: string; withGlow?: boolean }> = ({
  size = 32,
  className = '',
  withGlow = false,
}) => {
  const uniqueId = React.useId().replace(/:/g, '');
  const idBg = `bg-${uniqueId}`;
  const idGUL = `gUL-${uniqueId}`;
  const idGUR = `gUR-${uniqueId}`;
  const idGLL = `gLL-${uniqueId}`;
  const idGLR = `gLR-${uniqueId}`;
  const idGBase = `gBase-${uniqueId}`;
  const idGFlap = `gFlap-${uniqueId}`;
  const idGEdge = `gEdge-${uniqueId}`;
  const idBlur = `blur-${uniqueId}`;
  const idClipA = `clipA-${uniqueId}`;
  const idClipFlap = `clipFlap-${uniqueId}`;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {withGlow && (
        <div
          className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-600/35 to-cyan-400/25 blur-md -z-10 pointer-events-none"
          aria-hidden="true"
        />
      )}
      <svg
        viewBox="0 0 1254 1254"
        width={size}
        height={size}
        role="img"
        aria-label="AffinMail Logo"
        className="w-full h-full drop-shadow-xs transition-transform duration-200 select-none"
      >
        <defs>
          <radialGradient id={idBg} cx="50%" cy="0%" r="80%">
            <stop offset="0%" stopColor="#0D1D45" />
            <stop offset="50%" stopColor="#060E26" />
            <stop offset="100%" stopColor="#040A1D" />
          </radialGradient>
          <linearGradient id={idGUL} x1="0.15" y1="1" x2="0.85" y2="0">
            <stop offset="0%" stopColor="#0A78FF" />
            <stop offset="100%" stopColor="#19B4FF" />
          </linearGradient>
          <linearGradient id={idGUR} x1="0" y1="0.1" x2="0.9" y2="0.9">
            <stop offset="0%" stopColor="#0731BE" />
            <stop offset="30%" stopColor="#0553E8" />
            <stop offset="100%" stopColor="#0A6CFB" />
          </linearGradient>
          <linearGradient id={idGLL} x1="0.95" y1="0.05" x2="0.1" y2="0.95">
            <stop offset="0%" stopColor="#169BFF" />
            <stop offset="100%" stopColor="#0653F2" />
          </linearGradient>
          <linearGradient id={idGLR} x1="0.05" y1="0.1" x2="0.95" y2="0.9">
            <stop offset="0%" stopColor="#0B84FF" />
            <stop offset="60%" stopColor="#14AAFF" />
            <stop offset="100%" stopColor="#00EBFF" />
          </linearGradient>
          <linearGradient id={idGBase} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0932B8" />
            <stop offset="40%" stopColor="#1062EF" />
            <stop offset="100%" stopColor="#1C74F5" />
          </linearGradient>
          <linearGradient id={idGFlap} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#D6E4FA" />
          </linearGradient>
          <linearGradient id={idGEdge} gradientUnits="userSpaceOnUse" x1="376" y1="0" x2="880" y2="0">
            <stop offset="0%" stopColor="#3C9BFF" stopOpacity="0.9" />
            <stop offset="10%" stopColor="#5CB0FF" stopOpacity="0.5" />
            <stop offset="24%" stopColor="#8CC8FF" stopOpacity="0" />
            <stop offset="76%" stopColor="#8CC8FF" stopOpacity="0" />
            <stop offset="90%" stopColor="#5CB0FF" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#3C9BFF" stopOpacity="0.9" />
          </linearGradient>
          <filter id={idBlur} x="-20%" y="-30%" width="140%" height="160%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
          <clipPath id={idClipA}>
            <path d="M376 578 L188 890 H1068 L880 578 Z" />
          </clipPath>
          <clipPath id={idClipFlap}>
            <path d="M376 578 H880 L670 714 Q628 742 586 714 Z" />
          </clipPath>
        </defs>

        {/* Tile */}
        <path
          d="M325 65 H930 C1085 65 1195 175 1195 325 V925 C1195 1075 1085 1185 930 1185 H325 C175 1185 60 1075 60 925 V325 C60 175 175 65 325 65 Z"
          fill={`url(#${idBg})`}
        />

        {/* Ground shadow */}
        <ellipse cx="628" cy="905" rx="420" ry="22" fill="#000" opacity="0.55" filter={`url(#${idBlur})`} />

        {/* Crossbar */}
        <rect x="400" y="578" width="456" height="238" fill={`url(#${idGBase})`} />

        {/* Upper right stroke (behind) */}
        <path d="M743 352 Q723 318 688 318 H600 V422 L694 578 H880 Z" fill={`url(#${idGUR})`} />

        {/* Upper left stroke (front, folds over) */}
        <path d="M513 352 Q533 318 568 318 H690 Q719 318 706 339 L562 578 H376 Z" fill={`url(#${idGUL})`} />

        {/* Lower legs */}
        <path d="M376 578 L188 890 H330 C378 890 400 862 412 826 L562 578 Z" fill={`url(#${idGLL})`} />
        <path d="M880 578 L1068 890 H926 C878 890 856 862 844 826 L694 578 Z" fill={`url(#${idGLR})`} />

        {/* Shadow cast by envelope */}
        <g clipPath={`url(#${idClipA})`}>
          <path
            d="M400 578 H856 L670 714 Q628 742 586 714 Z"
            fill="#031047"
            opacity="0.6"
            filter={`url(#${idBlur})`}
            transform="translate(0 16)"
          />
        </g>

        {/* Envelope flap */}
        <path d="M376 578 H880 L670 714 Q628 742 586 714 Z" fill={`url(#${idGFlap})`} />
        <g clipPath={`url(#${idClipFlap})`}>
          <rect x="370" y="570" width="520" height="180" fill={`url(#${idGEdge})`} />
        </g>
      </svg>
    </div>
  );
};

export const AffinMailLogo: React.FC<AffinMailLogoProps> = ({
  variant = 'full',
  size = 'md',
  className = '',
  tagline,
  withGlow = false,
}) => {
  const conf = sizeConfig[size];

  if (variant === 'icon') {
    return (
      <AffinMailIcon
        size={conf.icon}
        className={className}
        withGlow={withGlow}
      />
    );
  }

  return (
    <div className={`flex items-center ${conf.gap} ${className} select-none`}>
      <AffinMailIcon
        size={conf.icon}
        withGlow={withGlow}
      />

      <div className="flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-1.5 leading-none">
          {/* Brand Wordmark */}
          <span className={`${conf.text} font-bold tracking-tight text-slate-800 dark:text-slate-100 font-sans`}>
            Affin<span className="text-blue-600 dark:text-blue-400">Mail</span>
          </span>

          {/* Contextual Badges */}
          {variant === 'admin' ? (
            <span className={`${conf.badge} rounded-md font-mono font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20`}>
              Control
            </span>
          ) : (
            <span className={`${conf.badge} rounded-md font-mono font-semibold uppercase tracking-wider bg-blue-600/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400 border border-blue-600/15`}>
              Enterprise
            </span>
          )}
        </div>

        {/* Optional Tagline or Subtext */}
        {tagline && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium tracking-normal mt-0.5 truncate">
            {tagline}
          </span>
        )}
      </div>
    </div>
  );
};
