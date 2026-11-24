import React, { useState } from 'react';
import { AlertCircle, Loader2, Lock, Mail } from 'lucide-react';
import { login } from '../lib/jmap';
import { AffinMailLogo } from './AffinMailLogo';

interface LoginProps {
  onSuccess: () => void;
}

export const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldClass =
    'flex items-center gap-2 h-10 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-white dark:bg-[#282A2C] focus-within:border-gmail-blue dark:focus-within:border-gmail-dark-blue-text';

  return (
    <div className="min-h-dvh w-full flex items-center justify-center bg-gmail-canvas dark:bg-gmail-dark-canvas p-4 select-none overflow-y-auto">
      <div className="w-full max-w-sm bg-white dark:bg-[#1E1F20] border border-[#E0E2E7] dark:border-[#333538] rounded-xl shadow-sm p-6 sm:p-8">
        <div className="flex justify-center mb-6 min-w-0">
          <AffinMailLogo variant="full" size="lg" />
        </div>

        <h1 className="text-lg font-medium text-[#1F1F1F] dark:text-[#E3E3E3] text-center mb-1">
          Sign in
        </h1>
        <p className="text-sm text-[#5E5E5E] dark:text-[#8E918F] text-center mb-6">
          Use your AffinMail address and password
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1 block">Email</span>
            <div className={fieldClass}>
              <Mail className="w-4 h-4 stroke-[1.5] text-[#5E5E5E] dark:text-[#8E918F]" />
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@affinmail.local"
                className="flex-1 bg-transparent outline-none text-sm text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5E5E5E] dark:placeholder:text-[#8E918F]"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[#444746] dark:text-[#C4C7C5] mb-1 block">Password</span>
            <div className={fieldClass}>
              <Lock className="w-4 h-4 stroke-[1.5] text-[#5E5E5E] dark:text-[#8E918F]" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="flex-1 bg-transparent outline-none text-sm text-[#1F1F1F] dark:text-[#E3E3E3] placeholder:text-[#5E5E5E] dark:placeholder:text-[#8E918F]"
              />
            </div>
          </label>

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 stroke-[1.5] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-10 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover disabled:opacity-60 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 stroke-[1.5] animate-spin" />}
            <span>{isSubmitting ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
