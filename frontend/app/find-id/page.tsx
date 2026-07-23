'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { findIdSendCode, findIdVerify } from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import styles from './recover.module.css';

// 브랜드 워드마크 — 로그인/회원가입과 같은 자산·규격·테마 전환(라이트=컬러 / 다크=화이트).
const LOGO_RATIO = 763 / 288;
const LOGO_H = 34;
const LOGO_W = Math.round(LOGO_H * LOGO_RATIO);

// 회원가입과 같은 도메인 프리셋.
const EMAIL_DOMAINS = [
  'naver.com', 'gmail.com', 'daum.net', 'hanmail.net',
  'kakao.com', 'nate.com', 'outlook.com', 'icloud.com',
];

export default function FindIdPage() {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('naver.com');
  const [domainPreset, setDomainPreset] = useState('naver.com');
  const [code, setCode] = useState('');

  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  // 찾은 아이디. null 이면 아직 결과 없음.
  const [found, setFound] = useState<{ user_id: string; created_at: string | null } | null>(null);

  const email = `${emailLocal.trim()}@${emailDomain.trim()}`;
  const emailComplete = emailLocal.trim() !== '' && emailDomain.trim() !== '';

  // 이름·이메일을 바꾸면 진행 중이던 발송 상태를 무효화한다.
  useEffect(() => {
    setCodeSent(false);
    setCode('');
    setResendIn(0);
  }, [name, emailLocal, emailDomain]);

  // 재발송 쿨다운 카운트다운.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendCode = async () => {
    if (!name.trim()) { toast('이름을 입력하세요.', 'error'); return; }
    if (!emailComplete) { toast('이메일을 입력하세요.', 'error'); return; }
    setSending(true);
    try {
      await findIdSendCode(name.trim(), email);
      setCodeSent(true);
      setCode('');
      setResendIn(60);
      toast('인증 코드를 보냈습니다. 메일함을 확인하세요.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '발송에 실패했습니다.', 'error');
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (!code.trim()) { toast('인증 코드를 입력하세요.', 'error'); return; }
    setVerifying(true);
    try {
      const res = await findIdVerify(name.trim(), email, code.trim());
      setFound(res);
    } catch (err) {
      toast(err instanceof Error ? err.message : '인증에 실패했습니다.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main className={styles.wrap}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <Image src="/header_color.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-light" priority />
          <Image src="/header_white.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-dark" priority />
        </div>
        <h1 className={styles.title}>아이디 찾기</h1>
        <p className={styles.subtitle}>가입할 때 쓴 이름과 이메일로 인증하면 아이디를 알려드려요</p>

        {found ? (
          <div className={styles.stack}>
            <div className={styles.result}>
              <p className={styles.resultLabel}>회원님의 아이디</p>
              <div className={styles.resultId}>{found.user_id}</div>
              {found.created_at && <p className={styles.resultMeta}>가입일 {found.created_at}</p>}
            </div>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => router.push('/login')}>
              로그인하러 가기
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => router.push('/reset-password')}>
              비밀번호 찾기
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); codeSent ? verify() : sendCode(); }} noValidate>
            <div className={styles.field}>
              <label htmlFor="name">이름</label>
              <input
                id="name"
                className={styles.input}
                type="text"
                placeholder="가입할 때 입력한 이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div className={styles.field}>
              <label>이메일</label>
              <div className={styles.rowLine}>
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 0 }}
                  type="text"
                  placeholder="아이디"
                  value={emailLocal}
                  onChange={(e) => setEmailLocal(e.target.value)}
                />
                <span className={styles.at}>@</span>
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 0 }}
                  type="text"
                  placeholder=""
                  value={emailDomain}
                  onChange={(e) => setEmailDomain(e.target.value)}
                  disabled={domainPreset !== ''}
                />
                <select
                  className={styles.input}
                  style={{ flex: '0 0 118px' }}
                  value={domainPreset}
                  onChange={(e) => { setDomainPreset(e.target.value); setEmailDomain(e.target.value); }}
                  aria-label="이메일 도메인 선택"
                >
                  <option value="">직접입력</option>
                  {EMAIL_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>

            {codeSent && (
              <div className={styles.field}>
                <label htmlFor="code">인증 코드</label>
                <div className={styles.rowLine}>
                  <input
                    id="code"
                    className={styles.input}
                    style={{ flex: 1, minWidth: 0 }}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="메일로 받은 6자리 코드"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                    onClick={sendCode}
                    disabled={sending || resendIn > 0}
                  >
                    {resendIn > 0 ? `재발송 ${resendIn}s` : '재발송'}
                  </button>
                </div>
              </div>
            )}

            {codeSent ? (
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={verifying} style={{ marginTop: 4 }}>
                {verifying ? '확인 중…' : '아이디 확인'}
              </button>
            ) : (
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={sending} style={{ marginTop: 4 }}>
                {sending ? '발송 중…' : '인증코드 발송'}
              </button>
            )}
          </form>
        )}

        <p className={styles.foot}>
          <Link href="/login">로그인</Link>
          <span style={{ margin: '0 8px', color: 'var(--card-border)' }}>|</span>
          <Link href="/reset-password">비밀번호 찾기</Link>
        </p>
      </section>
    </main>
  );
}
