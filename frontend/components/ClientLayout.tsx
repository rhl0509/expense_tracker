'use client';

import { usePathname } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';

const NO_SHELL_PATHS = new Set(['/login', '/register']);

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (NO_SHELL_PATHS.has(pathname)) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
