/**
 * Which portals each role may open, for the navigation links in the page
 * header. This mirrors ALLOWED in middleware.ts. If you change one,
 * change the other. Middleware is what actually enforces it (and RLS
 * behind that); this list only decides which links are shown.
 */
export const PORTAL_LINKS: Record<string, { href: string; label: string }[]> = {
  agent:            [{ href: '/agent', label: 'Submit result' }],
  ward_coordinator: [{ href: '/ward', label: 'My ward' }, { href: '/agent', label: 'Submit result' }],
  lga_coordinator:  [{ href: '/lga', label: 'My LGA' }, { href: '/ward', label: 'Wards' }],
  admin: [
    { href: '/control', label: 'Control room' },
    { href: '/lga', label: 'LGA' },
    { href: '/ward', label: 'Ward' },
    { href: '/agent', label: 'Submit result' },
  ],
  observer: [{ href: '/control', label: 'Control room' }],
};

export const ROLE_LABEL: Record<string, string> = {
  agent: 'Polling agent',
  ward_coordinator: 'Ward coordinator',
  lga_coordinator: 'LGA coordinator',
  admin: 'Admin',
  observer: 'Observer',
};

/** tel: link for an E.164 number. */
export function telHref(phone: string): string {
  return `tel:${phone}`;
}

/** WhatsApp chat link with an optional prefilled message. */
export function waHref(phone: string, text?: string): string {
  const n = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
