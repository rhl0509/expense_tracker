'use client';

import { useEffect, useRef, useState } from 'react';

// 약관/개인정보 동의 모달. 본문을 끝까지 스크롤해야 "동의하기"가 활성화되고, 누르면 onAgree로
// 해당 체크박스를 켠 뒤 닫힌다. 우상단 X 또는 배경 클릭·Esc 로도 닫을 수 있다.
interface Props {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onAgree: () => void;
  onClose: () => void;
}

export default function LegalAgreementModal({ open, title, children, onAgree, onClose }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);

  // 열릴 때마다 스크롤을 맨 위로 되돌리고 상태를 초기화한다. 내용이 짧아 스크롤이 없으면
  // 읽을 것이 없으므로 바로 활성화한다(다음 페인트에서 실제 높이로 판정).
  useEffect(() => {
    if (!open) return;
    setAtBottom(false);
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const id = requestAnimationFrame(() => {
      if (el.scrollHeight - el.clientHeight <= 4) setAtBottom(true);
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // 바닥에서 8px 이내면 끝까지 읽은 것으로 본다(소수점·여백 오차 여유).
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 8) setAtBottom(true);
  };

  return (
    <div
      className="overlay"
      style={{ zIndex: 2000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 20,
          width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        }}
      >
        {/* 헤더 + 닫기(X) */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '16px 20px', borderBottom: '1px solid var(--card-border)', flexShrink: 0,
        }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-3)',
              padding: 6, borderRadius: 8, display: 'flex', lineHeight: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 스크롤 본문 */}
        <div ref={bodyRef} onScroll={onScroll} style={{ padding: '4px 20px 20px', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>

        {/* 하단 동의 버튼 — 끝까지 스크롤해야 활성화 */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--card-border)', flexShrink: 0 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onAgree}
            disabled={!atBottom}
            style={{ width: '100%', opacity: atBottom ? 1 : 0.5, cursor: atBottom ? 'pointer' : 'not-allowed' }}
          >
            {atBottom ? '동의하기' : '끝까지 읽어주세요'}
          </button>
        </div>
      </div>
    </div>
  );
}
