'use client';

import { usePathname } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';

// AppShell 은 마운트 시 /auth/me 로 가드하고 401 이면 /login 으로 보낸다.
// 약관·방침은 가입 전(=비로그인) 사용자가 읽어야 하는 문서라 셸 밖에 둔다 —
// 셸 안에 두면 동의 링크를 누른 가입 희망자가 로그인 화면으로 튕긴다.
const NO_SHELL_PATHS = new Set(['/login', '/register', '/terms', '/privacy', '/find-id', '/reset-password']);

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (NO_SHELL_PATHS.has(pathname)) return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
