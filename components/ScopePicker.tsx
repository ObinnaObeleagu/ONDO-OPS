'use client';

import { useRouter, usePathname } from 'next/navigation';

export interface PickerGroup {
  label?: string;
  options: { value: string; label: string }[];
}

/**
 * A dropdown that changes one URL parameter (?lga=, ?ward=, ?pu=) and
 * reloads the page for it. Used where a user covers more than one LGA,
 * ward or unit and has to choose which one to look at.
 */
export default function ScopePicker({
  label,
  param,
  value,
  groups,
  placeholder,
  keep,
}: {
  label: string;
  param: string;
  value: string | null;
  groups: PickerGroup[];
  placeholder?: string;
  /** other URL parameters to carry over, e.g. the ward when choosing a unit */
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function onChange(v: string) {
    const params = new URLSearchParams(keep ?? {});
    if (v) params.set(param, v);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="row">
      <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</label>
      <select className="sel" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {groups.map((g, gi) =>
          g.label ? (
            <optgroup key={gi} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))
          ),
        )}
      </select>
    </div>
  );
}
