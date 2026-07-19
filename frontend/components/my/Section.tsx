import type { ReactNode, CSSProperties } from 'react';

// 마이페이지 카드들이 공유하는 스타일·구성요소. 이전엔 각 컴포넌트가 sectionTitle·rowStyle·
// labelStyle 을 제각각 하드코딩해 값이 미묘하게 어긋났다(패딩 8 vs 9, 라벨 0.72 vs 0.75rem 등).
// 여기 한 곳으로 단일화한다.

// ── 아이콘 (인라인 SVG, 의존성 없이 통일된 아이콘 언어) ──────────────
const ICON_PATHS: Record<string, ReactNode> = {
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  sparkles: <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></>,
  trend: <><path d="M22 7l-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></>,
  alert: <><path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

// ── 연동 상태 배지 (색 + 점 + 라벨 — 색맹 대응) ───────────────────────
export function StatusBadge({ on }: { on: boolean }) {
  const color = on ? 'var(--income)' : 'var(--text-3)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 600, color }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flexShrink: 0 }} />
      {on ? '연동됨' : '미연동'}
    </span>
  );
}

// ── 섹션 카드 (아이콘 + h2 제목 + 우측 배지 + 설명 + 본문) ────────────
export function SectionCard({ icon, title, badge, desc, children }: {
  icon: string;
  title: string;
  badge?: ReactNode;
  desc?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: desc ? 8 : 14 }}>
        <span style={{ display: 'inline-flex', color: 'var(--brand)', flexShrink: 0 }}><Icon name={icon} /></span>
        <h2 style={sectionTitle}>{title}</h2>
        {badge && <span style={{ marginLeft: 'auto', flexShrink: 0 }}>{badge}</span>}
      </div>
      {desc && <div style={cardDesc}>{desc}</div>}
      {children}
    </div>
  );
}

// ── 공유 스타일 상수 (확정값) ─────────────────────────────────────────
export const sectionTitle: CSSProperties = { margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' };
export const cardDesc: CSSProperties = { fontSize: '0.8rem', color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 14 };
export const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10,
  border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '8px 12px',
};
export const labelStyle: CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 };
export const noticeStyle: CSSProperties = {
  fontSize: '0.74rem', color: 'var(--text-2)', lineHeight: 1.6, borderRadius: 10,
  background: 'var(--accent-soft)', padding: '9px 12px',
};
export const errorStyle: CSSProperties = {
  fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--expense)', borderRadius: 10,
  background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)', padding: '9px 12px', marginTop: 6,
};
