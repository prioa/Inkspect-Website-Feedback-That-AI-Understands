/**
 * Debug logging with an [Inkspect] prefix for every context (page, content
 * script, service worker). Can be switched off without a rebuild via
 * `globalThis.__INK_DEBUG__ = false` or localStorage 'ink-debug' = '0'.
 */

const PREFIX = '[Inkspect]';

function enabled(): boolean {
  const g = globalThis as { __INK_DEBUG__?: boolean };
  if (typeof g.__INK_DEBUG__ === 'boolean') return g.__INK_DEBUG__;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('ink-debug') === '0') {
      return false;
    }
  } catch {
    // localStorage can throw in some contexts — default to on if it does.
  }
  return true;
}

/** Context tag, e.g. 'bg', 'content', 'app'. */
export function createLogger(scope: string) {
  const tag = `${PREFIX}[${scope}]`;
  return {
    debug: (...args: unknown[]) => {
      if (enabled()) console.debug(tag, ...args);
    },
    info: (...args: unknown[]) => {
      if (enabled()) console.info(tag, ...args);
    },
    warn: (...args: unknown[]) => {
      console.warn(tag, ...args);
    },
    error: (...args: unknown[]) => {
      console.error(tag, ...args);
    },
    /** Measures how long an action takes and logs it. */
    time: async <T>(label: string, fn: () => T | Promise<T>): Promise<T> => {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        if (enabled()) console.debug(tag, `${label} — ${(performance.now() - start).toFixed(1)}ms`);
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
