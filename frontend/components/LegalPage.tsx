import Link from 'next/link';

// 약관·개인정보처리방침 공용 레이아웃. 로그인 없이 볼 수 있는 정적 문서 페이지라
// AppShell 밖에서 쓴다(서버 컴포넌트).

export const LEGAL_EFFECTIVE_DATE = '2026-07-20'; // 시행일 = 약관 버전. 백엔드 auth.py의 *_VERSION과 함께 올린다.
export const LEGAL_OPERATOR = 'rho';
export const LEGAL_CONTACT = 'rhl0509@gmail.com';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
        {title}
      </h2>
      <div style={{ fontSize: '0.85rem', lineHeight: 1.7, color: 'var(--text-2, var(--text))' }}>
        {children}
      </div>
    </section>
  );
}

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '48px 16px' }}>
      <div style={{ width: '100%', maxWidth: 760 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>✦</div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            {title}
          </h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 8 }}>
            시행일: {LEGAL_EFFECTIVE_DATE}
          </p>
        </div>

        <div className="card" style={{ padding: 32 }}>
          {children}
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.82rem', color: 'var(--text-3)' }}>
          <Link href="/register" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            회원가입으로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  );
}
