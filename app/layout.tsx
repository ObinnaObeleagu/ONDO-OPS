import './globals.css';

export const metadata = {
  title: 'Election Control Room — Ondo North',
  description: 'Polling-unit result collection and monitoring for Ondo North senatorial district.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
