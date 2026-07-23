'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useQueryClient } from '@tanstack/react-query';
import { login } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/providers/ToastProvider';
import styles from './login.module.css';

// 브랜드 워드마크(로봇 + "AI가계부"). 라이트=컬러 / 다크=화이트를 CSS(.logo-light/.logo-dark)로
// 전환한다 — AppShell 헤더 로고와 같은 단일 자산을 쓴다(별도 SVG 로고를 두지 않는다).
const LOGO_RATIO = 1116 / 288;
const LOGO_H = 40;
const LOGO_W = Math.round(LOGO_H * LOGO_RATIO);

// 자동 로그인(세션 지속)은 백엔드 login() 이 지원하지 않는다. 대신 클라이언트에서 아이디만
// 기억해 다음 방문에 채운다 — 서버 변경 없이 실제로 동작하는 범위로 좁힌 것.
const SAVED_ID_KEY = 'login_saved_id';

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
              <button type="button" className={styles.linkBtn} onClick={() => toast('아이디 찾기는 준비 중입니다.')}>아이디 찾기</button>
              <span className={styles.sep}>|</span>
              <button type="button" className={styles.linkBtn} onClick={() => toast('비밀번호 찾기는 준비 중입니다.')}>비밀번호 찾기</button>
            </div>
          </div>

          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={submitting}>
            {submitting ? '로그인 중…' : '로그인'}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => router.push('/register')}>회원가입</button>
        </form>

        <p className={styles.foot}>© 2026 AI가계부</p>
      </section>
    </main>
  );
}
