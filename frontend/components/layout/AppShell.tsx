'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';
import { logout, resetData } from '@/lib/api';
import { THEME_COLORS } from '@/lib/theme';

interface NavItem { href: string; icon: string; label: string; }

const NAV_MAIN: NavItem[] = [
  { href: '/record',        icon: '✎',  label: '기록하기' },
  { href: '/dashboard',     icon: '◈',  label: '대시보드' },
  { href: '/transactions',  icon: '≡',  label: '거래 내역' },
  { href: '/search',        icon: '⌕',  label: '검색' },
  { href: '/subscriptions', icon: '↻',  label: '정기결제' },
];
const NAV_ANALYSIS: NavItem[] = [
  { href: '/analytics',     icon: '▲',  label: '분석 차트' },
  { href: '/report',        icon: '▤',  label: '리포트' },
  { href: '/budget',        icon: '◎',  label: '예산' },
  { href: '/categories',    icon: '◫',  label: '카테고리' },
  { href: '/household',     icon: '⌂',  label: '가구 관리' },
  { href: '/settings',      icon: '⚙',  label: '내 정보' },
  { href: '/ai-advisor',    icon: '✦',  label: 'AI 어드바이저' },
];
const BOTTOM_TABS: NavItem[] = [
  { href: '/record',       icon: '✎',  label: '기록' },
  { href: '/transactions', icon: '≡',  label: '내역' },
  { href: '/dashboard',    icon: '◈',  label: '대시보드' },
  { href: '/analytics',    icon: '▲',  label: '분석' },
  { href: '/ai-advisor',   icon: '✦',  label: 'AI' },
];

const TITLES: Record<string, string> = {
  '/record': '기록하기', '/dashboard': '대시보드', '/transactions': '거래 내역',
  '/search': '검색', '/subscriptions': '정기결제', '/analytics': '분석 차트',
  '/report': '리포트', '/budget': '예산', '/categories': '카테고리',
  '/household': '가구 관리', '/settings': '내 정보', '/ai-advisor': 'AI 어드바이저',
};

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    // FOUC 스크립트가 저장값/기기설정을 반영해 이미 확정한 결과를 그대로 읽는다.
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[next]);
  };
  return (
    <button
      onClick={toggle}
      style={{
        background: 'var(--accent-soft)', border: '1px solid var(--card-border)', borderRadius: 99,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
        fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', fontFamily: 'inherit',
      }}
    >
      {theme === 'dark' ? '☀ 라이트' : '◑ 다크'}
    </button>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10,
        fontSize: '0.85rem', fontWeight: active ? 700 : 500,
        color: active ? 'var(--accent)' : 'var(--text-2)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        textDecoration: 'none', transition: 'all 0.15s', marginBottom: 2,
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: '1rem', width: 20, textAlign: 'center' }}>{item.icon}</span>
      {item.label}
    </Link>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, padding: '12px 12px 6px' }}>
      {children}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, isLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<'logout' | 'reset' | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [user, isLoading, router]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const handleReset = async () => {
    try {
      await resetData();
      setModal(null);
      qc.invalidateQueries();
      toast('데이터가 초기화되었습니다.', 'success');
      router.push('/dashboard');
    } catch {
      toast('초기화에 실패했습니다.', 'error');
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>로딩 중...</div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* ── Desktop Sidebar ── */}
      <aside
        style={{
          width: 220, flexShrink: 0, background: 'var(--nav-bg)',
          borderRight: '1px solid var(--nav-border)', flexDirection: 'column',
          padding: '20px 0', overflowY: 'auto',
        }}
        className="hidden md:flex"
      >
        <div style={{ padding: '0 20px 18px', borderBottom: '1px solid var(--nav-border)' }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)', letterSpacing: '-0.5px' }}>
            <span style={{ color: 'var(--lime)' }}>✦</span> 가계부 Pro
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 3 }}>{user.user_name}</div>
        </div>

        <nav style={{ padding: '4px 10px', flex: 1 }}>
          <GroupLabel>가계부</GroupLabel>
          {NAV_MAIN.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} />)}
          <GroupLabel>분석</GroupLabel>
          {NAV_ANALYSIS.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} />)}
        </nav>

        <div style={{ padding: '12px 10px', borderTop: '1px solid var(--nav-border)', position: 'relative' }}>
          <a
            href="http://localhost:5001/stock_live"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10,
              fontSize: '0.82rem', fontWeight: 600, color: 'var(--lime)', textDecoration: 'none',
              background: 'var(--accent-soft)', marginBottom: 8,
            }}
          >
            <span>📈</span> 주식 앱
          </a>

          {menuOpen && (
            <div
              style={{
                position: 'absolute', bottom: '100%', left: 10, right: 10, marginBottom: 6,
                background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12,
                overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.3)', zIndex: 10,
              }}
            >
              <button
                className="menu-item"
                style={menuItemStyle}
                onClick={() => { setMenuOpen(false); setModal('reset'); }}
              >
                ↺ 데이터 초기화
              </button>
              <div style={{ height: 1, background: 'var(--card-border)' }} />
              <button
                style={{ ...menuItemStyle, color: 'var(--expense)' }}
                onClick={() => { setMenuOpen(false); setModal('logout'); }}
              >
                ⎋ 로그아웃
              </button>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <ThemeToggle />
            <button className="btn btn-ghost btn-sm" onClick={() => setMenuOpen((v) => !v)}>계정 ▾</button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Desktop header title */}
        <header
          style={{
            background: 'var(--nav-bg)', borderBottom: '1px solid var(--nav-border)',
            padding: '14px 24px', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}
          className="hidden md:flex"
        >
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>{TITLES[pathname] ?? '가계부 Pro'}</span>
        </header>

        {/* Mobile header */}
        <header
          style={{
            background: 'var(--nav-bg)', borderBottom: '1px solid var(--nav-border)',
            padding: '12px 16px', paddingTop: 'calc(12px + env(safe-area-inset-top))',
            alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}
          className="flex md:hidden"
        >
          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text)' }}>
            <span style={{ color: 'var(--lime)' }}>✦</span> 가계부 Pro
          </div>
          <ThemeToggle />
        </header>

        <main style={{ flex: 1, overflow: 'hidden auto', padding: '20px 16px 24px' }} className="md:p-6">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav
          style={{ background: 'var(--nav-bg)', borderTop: '1px solid var(--nav-border)', padding: '8px 4px', paddingBottom: 'calc(8px + env(safe-area-inset-bottom))', flexShrink: 0 }}
          className="flex md:hidden"
        >
          {BOTTOM_TABS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  padding: '6px 4px', fontSize: '0.6rem', fontWeight: active ? 700 : 500,
                  color: active ? 'var(--accent)' : 'var(--text-3)', textDecoration: 'none', borderRadius: 8,
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <ConfirmModal
        open={modal === 'logout'}
        variant="danger"
        icon="⎋"
        title="로그아웃 하시겠어요?"
        message={<>현재 세션이 종료되고<br />로그인 페이지로 이동합니다.</>}
        confirmText="로그아웃"
        onConfirm={handleLogout}
        onCancel={() => setModal(null)}
      />
      <ConfirmModal
        open={modal === 'reset'}
        variant="warning"
        icon="↺"
        title="데이터를 초기화 하시겠어요?"
        message={<>모든 거래 내역이 <strong>영구적으로 삭제</strong>됩니다.<br />이 작업은 되돌릴 수 없습니다.</>}
        confirmText="초기화"
        onConfirm={handleReset}
        onCancel={() => setModal(null)}
      />
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px',
  background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem',
  fontWeight: 600, color: 'var(--text-2)', fontFamily: 'inherit',
};
