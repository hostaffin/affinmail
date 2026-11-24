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
  /** Kept for API compatibility; the mark carries no glow. */
  withGlow?: boolean;
  /** Whether to render inside the dark squircle app tile (like in the browser tab) */
  withTile?: boolean;
  /** Whether to play the staggered entrance animation */
  animated?: boolean;
}

export const AFFINMAIL_DEFAULT_TAGLINE = 'Optimized Workspace of Efficient Business.';

const sizeConfig = {
  xs: { icon: 20, text: 'text-base', gap: 'gap-2' },
  sm: { icon: 26, text: 'text-lg', gap: 'gap-2' },
  md: { icon: 34, text: 'text-xl', gap: 'gap-2.5' },
  lg: { icon: 42, text: 'text-2xl', gap: 'gap-3' },
  xl: { icon: 54, text: 'text-3xl', gap: 'gap-3' },
};

export const AffinMailIcon: React.FC<{
  size?: number;
  className?: string;
  withGlow?: boolean;
  withTile?: boolean;
  animated?: boolean;
}> = ({ size = 32, className = '', withTile = false, animated = false }) => {
  const uniqueId = React.useId().replace(/:/g, '');
  const idClipA = `clipA-${uniqueId}`;
  const idClipFlap = `clipFlap-${uniqueId}`;

  // Small sizes (<=40px: header, lists): simplified mark — solid fills, no dark
  // cavity, no filters or hairlines — so the envelope flap stays legible.
  if (size <= 40 && !withTile) {
    return (
      <div
        className={`relative inline-flex items-center justify-center shrink-0 dark:rounded-[22%] dark:bg-white/95 dark:shadow-sm ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="147 124 960 960"
          width={size}
          height={size}
          role="img"
          aria-label="AffinMail Logo"
          className="w-full h-full select-none"
        >
          <path d="M743 352 Q723 318 688 318 H600 V422 L694 578 H880 Z" fill="#0553E8" />
          <path d="M513 352 Q533 318 568 318 H690 Q719 318 706 339 L562 578 H376 Z" fill="#0A78FF" />
          <rect x="400" y="578" width="456" height="238" fill="#0B57D0" />
          <path d="M376 578 L188 890 H330 C378 890 400 862 412 826 L562 578 Z" fill="#0653F2" />
          <path d="M880 578 L1068 890 H926 C878 890 856 862 844 826 L694 578 Z" fill="#0A78FF" />
          <path d="M376 578 H880 L670 714 Q628 742 586 714 Z" fill="#FFFFFF" />
        </svg>
      </div>
    );
  }

  // One accent, two neutral steps. No gradients, no filters, no glow.
  const accent = 'fill-[#0B57D0] dark:fill-[#A8C7FA]';
  const accentDeep = 'fill-[#0842A0] dark:fill-[#0B57D0]';
  const paper = 'fill-white';

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={withTile ? '0 0 1254 1254' : '147 124 960 960'}
        width={size}
        height={size}
        role="img"
        aria-label="AffinMail logo"
        className="w-full h-full select-none"
      >
        <defs>
          <clipPath id={idClipA}>
            <path d="M376 578 L188 890 H1068 L880 578 Z" />
          </clipPath>
          <clipPath id={idClipFlap}>
            <path d="M376 578 H880 L670 714 Q628 742 586 714 Z" />
          </clipPath>
        </defs>

        {withTile && (
          <path
            d="M325 65 H930 C1085 65 1195 175 1195 325 V925 C1195 1075 1085 1185 930 1185 H325 C175 1185 60 1075 60 925 V325 C60 175 175 65 325 65 Z"
            className={accent}
          />
        )}

        {/* Cavity behind the apex */}
        <path
          d="M555 580 L600 422 L688 318 L700 580 Z"
          className={accentDeep}
        />

        {/* Crossbar */}
        <rect
          x="400"
          y="578"
          width="456"
          height="238"
          className={animated ? `anim-crossbar ${accentDeep}` : accentDeep}
        />

        {/* Upper right stroke */}
        <path
          d="M743 352 Q723 318 688 318 H600 V422 L694 578 H880 Z"
          className={animated ? `anim-fold-back ${accent}` : accent}
        />

        {/* Upper left stroke */}
        <path
          d="M513 352 Q533 318 568 318 H690 Q719 318 706 339 L562 578 H376 Z"
          className={animated ? `anim-fold-front ${accent}` : accent}
        />

        {/* Lower legs */}
        <path
          d="M376 578 L188 890 H330 C378 890 400 862 412 826 L562 578 Z"
          className={animated ? `anim-leg-left ${accent}` : accent}
        />
        <path
          d="M880 578 L1068 890 H926 C878 890 856 862 844 826 L694 578 Z"
          className={animated ? `anim-leg-right ${accent}` : accent}
        />

        {/* Envelope flap sits on the crossbar as the one piece of paper */}
        <g className={animated ? 'anim-envelope' : undefined}>
          <g clipPath={`url(#${idClipA})`}>
            <path d="M400 578 H856 L670 714 Q628 742 586 714 Z" className={accentDeep} opacity="0.18" />
          </g>
          <path d="M376 578 H880 L670 714 Q628 742 586 714 Z" className={paper} />
          <g clipPath={`url(#${idClipFlap})`}>
            <rect x="370" y="570" width="520" height="180" className={accent} opacity="0.06" />
          </g>
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
  withTile = false,
  animated = false,
}) => {
  const conf = sizeConfig[size];

  if (variant === 'icon') {
    return (
      <AffinMailIcon
        size={conf.icon}
        className={className}
        withTile={withTile}
        animated={animated}
      />
    );
  }

  return (
    <div className={`flex items-center ${conf.gap} ${className} select-none`}>
      <AffinMailIcon
        size={conf.icon}
        withTile={withTile}
        animated={animated}
      />

      <div className="flex flex-col justify-center min-w-0">
        <span
          className={`${conf.text} font-medium tracking-normal text-[#1F1F1F] dark:text-[#E3E3E3] font-sans leading-none`}
        >
          AffinMail
        </span>

        {tagline && (
          <span className="text-xs text-[#5E5E5E] dark:text-[#8E918F] font-normal tracking-normal mt-1 truncate">
            {tagline}
          </span>
        )}
      </div>
    </div>
  );
};
