'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import ConfirmModal from '@/components/ConfirmModal';
import { logout, getAiCredential } from '@/lib/api';
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
  { href: '/ai-advisor',    icon: '✦',  label: 'AI 어드바이저' },
];
const BOTTOM_TABS: NavItem[] = [
  { href: '/record',       icon: '✎',  label: '기록' },
  { href: '/transactions', icon: '≡',  label: '내역' },
  { href: '/dashboard',    icon: '◈',  label: '대시보드' },
  { href: '/analytics',    icon: '▲',  label: '분석' },
  { href: '/ai-advisor',   icon: '✦',  label: 'AI' },
];

// 로고는 홈(기록하기) 링크다. <button>이 아니라 <Link>인 이유: 하는 일이 페이지 이동이라
// 새 탭 열기·가운데 클릭이 되고 스크린리더가 목적지 있는 링크로 읽는다.
const logoStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
};

// 가로형 워드마크(로봇 + "AI가계부"). 라이트=컬러, 다크=화이트를 CSS(.logo-light/.logo-dark)로
// 전환한다. data-theme는 FOUC 부트스트랩이 페인트 전에 확정하므로 깜빡임이 없다. 원본 1116×288.
const LOGO_RATIO = 763 / 288;
// fill=true 면 부모 폭에 꽉 차게(height auto, 비율 유지) 채운다. 아니면 height 기준 고정 크기.
// fill 일 때는 원본 해상도(763×288)를 intrinsic 으로 넘겨야 한다 — 작은 값을 주면 next/image 가
// 저해상 최적화본을 만든 뒤 CSS 로 늘려 깨져 보인다(업스케일). sizes 로 실제 슬롯 폭을 힌트한다.
function HeaderLogo({ height = 28, fill }: { height?: number; fill?: boolean }) {
  if (fill) {
    const fillStyle = { width: '100%', height: 'auto' } as const;
    return (
      <>
        <Image src="/header_color.png" alt="" width={763} height={288} sizes="220px" className="logo-light" style={fillStyle} priority />
        <Image src="/header_white.png" alt="" width={763} height={288} sizes="220px" className="logo-dark" style={fillStyle} priority />
      </>
    );
  }
  const width = Math.round(height * LOGO_RATIO);
  return (
    <>
      <Image src="/header_color.png" alt="" width={width} height={height} className="logo-light" priority />
      <Image src="/header_white.png" alt="" width={width} height={height} className="logo-dark" priority />
    </>
  );
}

const TITLES: Record<string, string> = {
  '/record': '기록하기', '/dashboard': '대시보드', '/transactions': '거래 내역',
  '/search': '검색', '/subscriptions': '정기결제', '/analytics': '분석 차트',
  '/report': '리포트', '/budget': '예산', '/categories': '카테고리',
  '/household': '가구 관리', '/ai-advisor': 'AI 어드바이저',
  '/my': '마이페이지',   // 내 정보(구 /settings)를 여기로 합쳤다
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

function LockIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.75 }} aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function NavLink({ item, active, locked, onLockedClick }: {
  item: NavItem; active: boolean; locked?: boolean; onLockedClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={locked ? (e) => { e.preventDefault(); onLockedClick?.(); } : undefined}
      aria-disabled={locked || undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10,
        fontSize: '0.85rem', fontWeight: active ? 700 : 500,
        color: locked ? 'var(--text-3)' : active ? 'var(--accent)' : 'var(--text-2)',
        background: active && !locked ? 'var(--accent-soft)' : 'transparent',
        textDecoration: 'none', transition: 'all 0.15s', marginBottom: 2,
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: '1rem', width: 20, textAlign: 'center' }}>{item.icon}</span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {locked && <LockIcon />}
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
  const qc = useQueryClient();
  const { user, isLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<'logout' | 'ai-locked' | null>(null);
  // AI 어드바이저는 본인 API 키가 있어야 쓸 수 있다. 미등록이면 사이드탭에서 자물쇠로 막고
  // 등록을 안내한다. 로드 전(undefined)엔 잠그지 않는다 — 링크가 잠깐 잠겼다 풀리는 깜빡임 방지.
  const { data: aiCred } = useQuery({ queryKey: ['ai-credential'], queryFn: getAiCredential });
  const aiLocked = aiCred ? !aiCred.configured : false;

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [user, isLoading, router]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const handleLogout = async () => {
    await logout();
    // 세션을 지웠으니 캐시된 사용자 데이터(me·거래·카테고리 등)를 모두 비운다.
    // 이걸 안 하면 stale 'me' 캐시가 아직 로그인 상태로 읽혀 /login 이 다시 /record 로 튕긴다.
    qc.clear();
    router.replace('/login');
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
          <Link href="/record" className="logo-link" style={{ display: 'inline-flex', textDecoration: 'none' }} aria-label="AI 가계부 홈 — 기록하기로 이동">
            <HeaderLogo height={54} />
          </Link>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 3 }}>{user.user_name}</div>
        </div>

        <nav style={{ padding: '4px 10px', flex: 1 }}>
          <GroupLabel>가계부</GroupLabel>
          {NAV_MAIN.map((item) => <NavLink key={item.href} item={item} active={isActive(item.href)} />)}
          <GroupLabel>분석</GroupLabel>
          {NAV_ANALYSIS.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)}
              locked={item.href === '/ai-advisor' && aiLocked}
              onLockedClick={() => setModal('ai-locked')} />
          ))}
        </nav>

        <div style={{ padding: '12px 10px', borderTop: '1px solid var(--nav-border)', position: 'relative' }}>
          {menuOpen && (
            <div
              style={{
                position: 'absolute', bottom: '100%', left: 10, right: 10, marginBottom: 6,
                background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12,
                overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.3)', zIndex: 10,
              }}
            >
              {/* 페이지 이동이라 button 이 아니라 Link 다 — 새 탭 열기·가운데 클릭이
                  되고 스크린리더가 목적지 있는 링크로 읽는다. */}
              <Link
                href="/my"
                className="menu-item"
                style={{ ...menuItemStyle, display: 'block', textDecoration: 'none' }}
                onClick={() => setMenuOpen(false)}
              >
                ⚙ 마이페이지
              </Link>
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
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>{TITLES[pathname] ?? 'AI 가계부'}</span>
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
          <Link href="/record" className="logo-link" style={logoStyle} aria-label="AI 가계부 홈 — 기록하기로 이동">
            <HeaderLogo height={24} />
          </Link>
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
            const locked = item.href === '/ai-advisor' && aiLocked;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={locked ? (e) => { e.preventDefault(); setModal('ai-locked'); } : undefined}
                aria-disabled={locked || undefined}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  padding: '6px 4px', fontSize: '0.6rem', fontWeight: active ? 700 : 500,
                  color: active && !locked ? 'var(--accent)' : 'var(--text-3)', textDecoration: 'none', borderRadius: 8,
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>{locked ? '🔒' : item.icon}</span>
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
        message=""
        confirmText="로그아웃"
        onConfirm={handleLogout}
        onCancel={() => setModal(null)}
      />
      <ConfirmModal
        open={modal === 'ai-locked'}
        variant="warning"
        icon="🔒"
        title="AI 어드바이저를 쓰려면 API 키가 필요해요"
        message={<>AI 어드바이저는 <strong>본인의 API 키</strong>로 작동합니다.<br />마이페이지에서 키를 등록하면 바로 이용할 수 있습니다.</>}
        confirmText="키 등록하러 가기"
        onConfirm={() => { setModal(null); router.push('/my'); }}
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
