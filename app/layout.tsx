import './globals.css';

export const metadata = {
  title: 'Election Control Room — Ondo North',
  description: 'Polling-unit result collection and monitoring for Ondo North senatorial district.',
};

/**
 * Sets data-theme on <html> before the first paint, so a dark-mode user
 * never sees a white flash while React loads. Order of preference: the
 * choice saved by ThemeToggle on this browser, then the device setting.
 * Wrapped in try/catch because localStorage can throw (private mode,
 * storage disabled) and a theme must never be what breaks the page.
 */
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script above changes data-theme before
    // React hydrates, which is intended, so React shouldn't warn about it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
