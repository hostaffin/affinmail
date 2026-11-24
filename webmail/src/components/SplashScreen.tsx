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
  statusMessage = 'Loading your conversations',
  onFinished,
}) => {
  const [shouldRender, setShouldRender] = useState(true);

  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => {
        setShouldRender(false);
        onFinished?.();
      }, 550);
      return () => clearTimeout(timer);
    } else {
      setShouldRender(true);
    }
  }, [isLoading, onFinished]);

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between py-16 px-6 select-none bg-white dark:bg-gmail-dark-canvas transition-opacity duration-300 ease-out ${
        isLoading ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      aria-label="Loading AffinMail"
      role="progressbar"
      aria-busy={isLoading}
    >
      <div className="h-6" />

      <div className="flex flex-col items-center max-w-sm w-full">
        <div className="mb-6">
          <AffinMailLogo
            variant="full"
            size="lg"
            animated={true}
          />
        </div>

        <div className="w-64 sm:w-72 h-1 bg-[#E0E2E7] dark:bg-[#333538] rounded-full overflow-hidden relative mt-2">
          <div className="animate-gmail-progress" />
        </div>

        <p className="text-xs text-[#5E5E5E] dark:text-[#8E918F] mt-4 text-center">
          {statusMessage}
        </p>
      </div>

      <div className="flex flex-col items-center gap-1 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#137333] dark:bg-[#81C995]" />
          <span>Stalwart mail engine</span>
        </div>
        <span className="text-xs text-[#5E5E5E]/70 dark:text-[#8E918F]/70">
          Hostaffin cloud infrastructure
        </span>
      </div>
    </div>
  );
};
