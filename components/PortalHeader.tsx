import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import SignOutButton from '@/components/SignOutButton';
import { PORTAL_LINKS, ROLE_LABEL } from '@/lib/portals';
import type { Scope } from '@/lib/scope';

/** Top bar shared by every portal: title, links to the portals this role may open, theme, sign out. */
export default function PortalHeader({
  title,
  subtitle,
  current,
  scope,
}: {
  title: string;
  subtitle: string;
  current: string;
  scope: Scope | null;
}) {
  const links = scope ? PORTAL_LINKS[scope.role] ?? [] : [];
  return (
    <div className="topbar">
      <div className="brand">
        <strong>
          <span className="livedot" />
          {title}
        </strong>
        <span>{subtitle}</span>
      </div>
      {links.length > 1 && (
        <nav className="roleswitch" aria-label="Portals">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.href === current ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
      )}
      {scope && (
        <span className="whoami">
          {scope.full_name} · {ROLE_LABEL[scope.role] ?? scope.role}
        </span>
      )}
      <ThemeToggle />
      <SignOutButton />
    </div>
  );
}
