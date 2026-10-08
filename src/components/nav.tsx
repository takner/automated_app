'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'امروز', icon: '☀' },
  { href: '/tasks', label: 'کارها', icon: '☑' },
  { href: '/dates', label: 'تاریخ‌ها', icon: '🗓' },
  { href: '/settings', label: 'تنظیمات', icon: '⚙' },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <>
      <nav aria-label="منوی اصلی" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-lg">
          {ITEMS.map((i) => (
            <li key={i.href} className="flex-1">
              <Link
                href={i.href}
                aria-current={active(i.href) ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs ${active(i.href) ? 'font-semibold text-accent' : 'text-muted'}`}
              >
                <span aria-hidden className="text-lg leading-none">
                  {i.icon}
                </span>
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="منوی اصلی" className="sticky top-0 z-20 hidden border-b border-line bg-surface/95 backdrop-blur md:block">
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-6 py-3">
          <span className="ml-6 text-lg font-bold text-accent">هم‌روز</span>
          {ITEMS.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active(i.href) ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm ${active(i.href) ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-surface-2'}`}
            >
              {i.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
