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

export const AFFINMAIL_DEFAULT_TAGLINE = 'Business email for hosting customers';

const sizeConfig = {
  xs: { icon: 20, text: 'text-base', gap: 'gap-2' },
  sm: { icon: 26, text: 'text-lg', gap: 'gap-2' },
  md: { icon: 34, text: 'text-xl', gap: 'gap-2.5' },
  lg: { icon: 42, text: 'text-2xl', gap: 'gap-3' },
  xl: { icon: 54, text: 'text-3xl', gap: 'gap-3' },
};

// C3 mark (Rabbi's pick, kept simple): one solid "A" at every size, with a
// complete white envelope glyph on the crossbar — bold flap, no gradients,
// no filters, no cavity. Same geometry from 20px favicon to splash.
const A_PATHS = [
  'M743 352 Q723 318 688 318 H600 V422 L694 578 H880 Z',
  'M513 352 Q533 318 568 318 H690 Q719 318 706 339 L562 578 H376 Z',
  'M376 578 L188 890 H330 C378 890 400 862 412 826 L562 578 Z',
  'M880 578 L1068 890 H926 C878 890 856 862 844 826 L694 578 Z',
];
const FLAP_PATH = 'M424 622 L628 742 L832 622';

export const AffinMailIcon: React.FC<{
  size?: number;
  className?: string;
  withGlow?: boolean;
  withTile?: boolean;
  animated?: boolean;
}> = ({ size = 32, className = '', withTile = false, animated = false }) => {
  // One accent, one deep step. No gradients, no filters, no glow.
  const accent = 'fill-[#0B57D0] dark:fill-[#A8C7FA]';
  const accentDeep = 'fill-[#0842A0] dark:fill-[#0B57D0]';
  const paper = 'fill-white';

  if (withTile) {
    return (
      <div
        className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 1254 1254"
          width={size}
          height={size}
          role="img"
          aria-label="AffinMail logo"
          className="w-full h-full select-none"
        >
          <rect x="60" y="60" width="1134" height="1134" rx="255" className="fill-[#0B57D0]" />
          <g transform="translate(222 222) scale(0.84375)">
            {A_PATHS.map((d) => (
              <path key={d} d={d} className="fill-white" />
            ))}
            <rect x="400" y="578" width="456" height="238" className="fill-white" />
            <rect x="408" y="600" width="440" height="212" rx="18" className="fill-[#0B57D0]" />
            <path
              d={FLAP_PATH}
              stroke="#FFFFFF"
              strokeWidth={30}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
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
        {A_PATHS.map((d) => (
          <path key={d} d={d} className={accent} />
        ))}
        <rect x="400" y="578" width="456" height="238" className={accentDeep} />
        <g className={animated ? 'anim-envelope' : undefined}>
          <rect x="408" y="600" width="440" height="212" rx="18" className={paper} />
          <path
            d={FLAP_PATH}
            stroke="#0842A0"
            strokeWidth={30}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="dark:[stroke:#0B57D0]"
          />
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
