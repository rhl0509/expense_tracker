'use client';

import Image from 'next/image';

// 모달 상단 아이콘 — 브랜드 로봇 캐릭터에 상태 기호(✓/✕/⚠/⎋ 등)를 작은 배지로 결합한다.
// 컬러 로봇은 자체 배경(초록 그라디언트)이 있어 라이트·다크 모달 모두에서 잘 보인다.
export default function ModalRobotIcon({ badge, accent }: { badge: React.ReactNode; accent: string }) {
  const S = 60;
  return (
    <div style={{ position: 'relative', width: S, height: S, margin: '0 auto 16px' }}>
      <Image src="/robot.png" alt="" width={S} height={S} style={{ borderRadius: 16, display: 'block' }} priority />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', right: -4, bottom: -4,
          minWidth: 24, height: 24, padding: '0 4px', borderRadius: 999,
          background: accent, color: '#fff', fontSize: '0.82rem', fontWeight: 800, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid var(--card-bg)',
        }}
      >
        {badge}
      </span>
    </div>
  );
}
