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
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {withGlow && (
        <div
          className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-600/35 to-teal-400/25 blur-md -z-10 pointer-events-none"
          aria-hidden="true"
        />
      )}
      <img
        src="/logo-mark.png"
        alt="AffinMail"
        width={size}
        height={size}
        className="w-full h-full object-contain rounded-2xl shadow-xs transition-transform duration-200 select-none pointer-events-none"
        loading="eager"
      />
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
