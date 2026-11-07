export const metadata = {
  title: 'Election Control Room — Ondo North',
  description: 'Polling-unit result collection and monitoring for Ondo North senatorial district.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
