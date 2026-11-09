'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Light/dark switch. The initial theme is already on <html> by the time
 * this mounts (see the inline script in app/layout.tsx); this just reads
 * it, flips it, and remembers the choice for this browser.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // storage unavailable — the switch still works for this visit
    }
    setTheme(next);
  }

  // Render nothing until mounted, so the label never disagrees with the
  // theme that's actually showing.
  if (theme === null) return <span className="iconbtn" style={{ visibility: 'hidden' }}>Dark mode</span>;

  return (
    <button
      className="iconbtn"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
    </button>
  );
}
