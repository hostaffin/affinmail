import React, { useEffect, useState } from 'react';
import { AffinMailLogo } from './AffinMailLogo';

export interface SplashScreenProps {
  /** Whether the app is still loading */
  isLoading: boolean;
  /** Optional loading message */
  statusMessage?: string;
  /** Callback fired after the fade-out transition finishes */
  onFinished?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  isLoading,
  statusMessage = 'Loading your conversations...',
  onFinished,
}) => {
  const [shouldRender, setShouldRender] = useState(true);
  const [fadeComplete, setFadeComplete] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      // Allow 500ms for smooth fade-out animation before unmounting
      const timer = setTimeout(() => {
        setFadeComplete(true);
        setShouldRender(false);
        onFinished?.();
      }, 550);
      return () => clearTimeout(timer);
    } else {
      setShouldRender(true);
      setFadeComplete(false);
    }
  }, [isLoading, onFinished]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between py-12 px-6 select-none bg-white dark:bg-[#0B0F19] transition-opacity duration-500 ease-in-out ${
        isLoading ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      aria-label="Loading AffinMail Workspace"
      role="progressbar"
      aria-busy={isLoading}
    >
      {/* Top Spacer */}
      <div className="h-6" />

      {/* Center: Brand Mark, Wordmark & Animated Gmail Progress Bar */}
      <div className="flex flex-col items-center max-w-sm w-full animate-pulse-subtle">
        <div className="mb-6 transform transition-transform">
          <AffinMailLogo
            variant="full"
            size="lg"
            tagline="Optimized Workspace of Efficient Business."
            withGlow
          />
        </div>

        {/* Gmail Iconic Progress Bar */}
        <div className="w-64 sm:w-72 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden relative shadow-inner mt-2">
          <div className="animate-gmail-progress" />
        </div>

        {/* Dynamic Status Text */}
        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium tracking-normal mt-4 text-center">
          {statusMessage}
        </p>
      </div>

      {/* Bottom Footer Watermark (Google Workspace / Gmail Style) */}
      <div className="flex flex-col items-center gap-1 text-[11px] text-slate-400 dark:text-slate-600 font-mono">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
          <span>Sovereign Rust Stalwart Engine</span>
        </div>
        <span className="text-[10px] text-slate-400/70 dark:text-slate-600/70">
          Hostaffin Cloud Infrastructure
        </span>
      </div>
    </div>
  );
};
