import { useEffect } from 'react';

export interface ShortcutHandlers {
  onCompose?: () => void;
  onNextThread?: () => void;
  onPrevThread?: () => void;
  onOpenThread?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onToggleStar?: () => void;
  onReply?: () => void;
  onReplyAll?: () => void;
  onSearchFocus?: () => void;
  onEscape?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept shortcuts when typing in inputs or textareas
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === 'Escape') {
        if (handlers.onEscape) {
          e.preventDefault();
          handlers.onEscape();
        }
        return;
      }

      if (isInput) return;

      switch (e.key) {
        case 'c':
        case 'C':
          e.preventDefault();
          handlers.onCompose?.();
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          handlers.onNextThread?.();
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          handlers.onPrevThread?.();
          break;
        case 'o':
        case 'O':
        case 'Enter':
          e.preventDefault();
          handlers.onOpenThread?.();
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          handlers.onArchive?.();
          break;
        case '#':
          e.preventDefault();
          handlers.onDelete?.();
          break;
        case 's':
        case 'S':
          e.preventDefault();
          handlers.onToggleStar?.();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          handlers.onReply?.();
          break;
        case 'a':
        case 'A':
          e.preventDefault();
          handlers.onReplyAll?.();
          break;
        case '/':
          e.preventDefault();
          handlers.onSearchFocus?.();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers, enabled]);
}
