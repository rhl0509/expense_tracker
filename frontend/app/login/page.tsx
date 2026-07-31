'use client';

import { useState, useEffect, FormEvent, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSocialProviders, login } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/providers/ToastProvider';
import styles from './login.module.css';

// 브랜드 워드마크(로봇 + "AI가계부"). 라이트=컬러 / 다크=화이트를 CSS(.logo-light/.logo-dark)로
// 전환한다 — AppShell 헤더 로고와 같은 단일 자산을 쓴다(별도 SVG 로고를 두지 않는다).
const LOGO_RATIO = 763 / 288;
const LOGO_H = 34;
const LOGO_W = Math.round(LOGO_H * LOGO_RATIO);

// 자동 로그인(세션 지속)은 백엔드 login() 이 지원하지 않는다. 대신 클라이언트에서 아이디만
// 기억해 다음 방문에 채운다 — 서버 변경 없이 실제로 동작하는 범위로 좁힌 것.
const SAVED_ID_KEY = 'login_saved_id';

// 소셜 콜백이 ?social_error=<code> 로 돌려보낸 실패를 사용자 문구로 옮긴다.
// 코드 상세(백엔드 routes/social_auth.py)와 쌍이다.
const SOCIAL_ERRORS: Record<string, string> = {
  denied: '로그인이 취소되었습니다.',
  state: '요청이 만료되었습니다. 다시 시도해주세요.',
  exchange: '로그인 처리에 실패했습니다. 잠시 후 다시 시도해주세요.',
  profile: '계정 정보를 가져오지 못했습니다.',
  email_taken: '이미 가입된 이메일입니다. 기존 아이디로 로그인한 뒤 마이페이지에서 연결해주세요.',
  disabled: '지원하지 않는 로그인 방식입니다.',
  inactive: '이용이 제한된 계정입니다.',
};

const SOCIAL_LABELS: Record<string, string> = {
  google: 'Google로 계속하기',
  kakao: '카카오로 계속하기',
  naver: '네이버로 계속하기',
};

// 각 프로바이더 브랜드 지침의 기본 색. 다크모드에서도 그대로 둔다(브랜드 색 변형 금지).
const SOCIAL_STYLES: Record<string, CSSProperties> = {
  google: { background: '#ffffff', color: '#1f1f1f', border: '1px solid #dadce0' },
  kakao: { background: '#FEE500', color: '#191919', border: '1px solid #FEE500' },
  naver: { background: '#03C75A', color: '#ffffff', border: '1px solid #03C75A' },
};

// 브랜드 로고는 인라인 SVG로 둔다 — 배포 CSP·오프라인에서도 깨지지 않고 파일이 늘지 않는다.
// 구글 브랜드 지침상 'G' 마크는 4색 원본을 그대로 쓰고 색을 바꾸지 않는다.
const SOCIAL_ICONS: Record<string, ReactNode> = {
  google: (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  ),
  // 네이버 N 마크. 초록 버튼 위라 흰색 단색으로 쓴다.
  naver: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#ffffff" d="M14.2 12.6 9.4 6H6v12h3.8v-6.6l4.8 6.6H18V6h-3.8z" />
    </svg>
  ),
  // 카카오 말풍선 심볼. 노란 버튼 위에 올라가므로 지정색(#191919) 단색으로 쓴다.
  kakao: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#191919" d="M12 3C6.48 3 2 6.48 2 10.8c0 2.79 1.86 5.24 4.65 6.62-.2.72-.74 2.66-.85 3.07-.13.51.19.5.4.36.16-.11 2.6-1.77 3.66-2.49.69.1 1.4.15 2.14.15 5.52 0 10-3.48 10-7.71S17.52 3 12 3z" />
    </svg>
  ),
};

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { isLoggedIn, isLoading } = useAuth();

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberId, setRememberId] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 이미 로그인된 사용자가 /login 에 오면 앱으로 돌려보낸다(다른 페이지 가드와 대칭).
  useEffect(() => {
    if (!isLoading && isLoggedIn) router.replace('/record');
  }, [isLoading, isLoggedIn, router]);

  // 저장된 아이디가 있으면 채워 넣는다.
  useEffect(() => {
    const saved = localStorage.getItem(SAVED_ID_KEY);
    if (saved) { setUserId(saved); setRememberId(true); }
  }, []);

  // 설정된 소셜 프로바이더만 버튼을 그린다(미설정이면 섹션 자체가 없다).
  const { data: social } = useQuery({ queryKey: ['social-providers'], queryFn: getSocialProviders });

  // 소셜 콜백 실패(?social_error=..)를 토스트로 알리고 URL 을 정리한다.
  // useSearchParams 는 Suspense 경계를 요구하므로 location 에서 직접 읽는다.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('social_error');
    if (code) {
      // hasOwn 가드: code 는 URL 에서 온 임의 문자열이라 '__proto__' 등 상속 멤버가
      // 인덱싱을 통과하면 toast 에 객체가 들어가 렌더가 죽는다.
      toast(Object.hasOwn(SOCIAL_ERRORS, code) ? SOCIAL_ERRORS[code] : '소셜 로그인에 실패했습니다.', 'error');
      router.replace('/login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const id = userId.trim();
    if (!id) { toast('아이디를 입력하세요.', 'error'); return; }
    if (!password) { toast('비밀번호를 입력하세요.', 'error'); return; }

    setSubmitting(true);
    try {
      await login(id, password);
      // 아이디 기억: 체크 상태에 따라 저장/삭제.
      if (rememberId) localStorage.setItem(SAVED_ID_KEY, id);
      else localStorage.removeItem(SAVED_ID_KEY);
      // 세션이 생겼으니 useAuth('me') 캐시를 무효화해 앱이 로그인 상태를 즉시 반영하게 한다.
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/record');
    } catch (err) {
      toast(err instanceof Error ? err.message : '로그인에 실패했습니다.', 'error');
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.wrap}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <Image src="/header_color.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-light" priority />
          <Image src="/header_white.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-dark" priority />
        </div>
        <p className={styles.subtitle}>똑똑한 소비 관리, 지금 시작하세요</p>

        <form onSubmit={handleSubmit} autoComplete="on" noValidate>
          <div className={styles.field}>
            <label htmlFor="userId">아이디</label>
            <div className={styles.input}>
              <span className={styles.ic} aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>
              </span>
              <input
                id="userId"
                name="userId"
                type="text"
                placeholder="아이디를 입력하세요"
                autoComplete="username"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="userPw">비밀번호</label>
            <div className={styles.input}>
              <span className={styles.ic} aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="10" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              </span>
              <input
                id="userPw"
                name="password"
                type={showPw ? 'text' : 'password'}
                placeholder="비밀번호를 입력하세요"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className={styles.toggle}
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 표시'}
                aria-pressed={showPw}
              >
                {showPw ? '숨김' : '표시'}
              </button>
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.check}>
              <input type="checkbox" checked={rememberId} onChange={(e) => setRememberId(e.target.checked)} /> 아이디 기억하기
            </label>
            <div className={styles.links}>
              <button type="button" className={styles.linkBtn} onClick={() => router.push('/find-id')}>아이디 찾기</button>
              <span className={styles.sep}>|</span>
              <button type="button" className={styles.linkBtn} onClick={() => router.push('/reset-password')}>비밀번호 찾기</button>
            </div>
          </div>

          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={submitting}>
            {submitting ? '로그인 중…' : '로그인'}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => router.push('/register')}>회원가입</button>
        </form>

        {(social?.providers?.length ?? 0) > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, height: 1, background: 'var(--card-border)' }} />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>또는</span>
              <span style={{ flex: 1, height: 1, background: 'var(--card-border)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {social!.providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={styles.btn}
                  style={{
                    ...SOCIAL_STYLES[p], fontWeight: 600,
                    // 로고와 문구를 한 덩어리로 가운데 정렬한다(로고 없는 프로바이더도 그대로 중앙).
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                  // XHR 이 아니라 전체 페이지 이동 — 서버가 프로바이더로 302 시킨다.
                  onClick={() => { window.location.href = `/auth/social/${p}/start`; }}
                >
                  {SOCIAL_ICONS[p]}
                  {SOCIAL_LABELS[p] ?? p}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className={styles.foot}>© 2026 AI가계부</p>
      </section>
    </main>
  );
}
