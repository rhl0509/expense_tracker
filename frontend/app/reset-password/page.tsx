'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { resetPwSendCode, resetPwVerify, resetPwConfirm } from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
// 공용 스타일은 아이디 찾기와 같은 파일을 쓴다(같은 카드 톤).
import styles from '../find-id/recover.module.css';

const LOGO_RATIO = 763 / 288;
const LOGO_H = 34;
const LOGO_W = Math.round(LOGO_H * LOGO_RATIO);

const EMAIL_DOMAINS = [
  'naver.com', 'gmail.com', 'daum.net', 'hanmail.net',
  'kakao.com', 'nate.com', 'outlook.com', 'icloud.com',
];

// 백엔드 auth.py 의 _PW_RULES 와 같은 규칙(회원가입과도 동일). 셋 중 하나만 바꾸면 안 된다.
const PW_HINT = '영문 대문자·소문자·숫자·특수문자를 포함해 8자 이상';
const PW_RULES: [RegExp, string][] = [
  [/[a-z]/, '영문 소문자'],
  [/[A-Z]/, '영문 대문자'],
  [/\d/, '숫자'],
  [/[^A-Za-z0-9]/, '특수문자'],
];
function passwordError(pw: string): string | null {
  if (pw.length < 8 || pw.length > 128) return '비밀번호는 8~128자여야 합니다.';
  const missing = PW_RULES.filter(([rx]) => !rx.test(pw)).map(([, label]) => label);
  return missing.length ? `비밀번호에 ${missing.join('·')}를 포함해야 합니다.` : null;
}

// 진행 단계: 정보 입력 → 코드 검증 → 새 비밀번호 설정.
type Step = 'request' | 'verify' | 'reset';

export default function ResetPasswordPage() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<Step>('request');
  const [userId, setUserId] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState('naver.com');
  const [domainPreset, setDomainPreset] = useState('naver.com');
  const [code, setCode] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const email = `${emailLocal.trim()}@${emailDomain.trim()}`;
  const emailComplete = emailLocal.trim() !== '' && emailDomain.trim() !== '';

  // 아이디·이메일을 바꾸면 발송/검증 단계를 처음으로 되돌린다(다른 계정으로 통과 방지).
  useEffect(() => {
    setStep('request');
    setCode('');
    setResendIn(0);
  }, [userId, emailLocal, emailDomain]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendCode = async () => {
    if (!userId.trim()) { toast('아이디를 입력하세요.', 'error'); return; }
    if (!emailComplete) { toast('이메일을 입력하세요.', 'error'); return; }
    setSending(true);
    try {
      await resetPwSendCode(userId.trim(), email);
      setStep('verify');
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
      await resetPwVerify(userId.trim(), email, code.trim());
      setStep('reset');
      toast('이메일 인증이 완료되었습니다.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '인증에 실패했습니다.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const confirm = async () => {
    const pwError = passwordError(newPw);
    if (pwError) { toast(pwError, 'error'); return; }
    if (newPw !== newPwConfirm) { toast('비밀번호가 일치하지 않습니다.', 'error'); return; }
    setSaving(true);
    try {
      await resetPwConfirm(newPw);
      toast('비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.', 'success');
      router.replace('/login');
    } catch (err) {
      toast(err instanceof Error ? err.message : '변경에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={styles.wrap}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <Image src="/header_color.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-light" priority />
          <Image src="/header_white.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-dark" priority />
        </div>
        <h1 className={styles.title}>비밀번호 찾기</h1>
        <p className={styles.subtitle}>아이디와 이메일로 인증한 뒤 새 비밀번호를 설정하세요</p>

        {step === 'reset' ? (
          <form onSubmit={(e) => { e.preventDefault(); confirm(); }} noValidate>
            <div className={styles.field}>
              <label htmlFor="newPw">새 비밀번호</label>
              <input
                id="newPw"
                className={styles.input}
                type={showPw ? 'text' : 'password'}
                placeholder="새 비밀번호"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
              />
              <p className={styles.hint}>{PW_HINT}</p>
            </div>
            <div className={styles.field}>
              <label htmlFor="newPwConfirm">새 비밀번호 확인</label>
              <input
                id="newPwConfirm"
                className={styles.input}
                type={showPw ? 'text' : 'password'}
                placeholder="새 비밀번호 재입력"
                value={newPwConfirm}
                onChange={(e) => setNewPwConfirm(e.target.value)}
                autoComplete="new-password"
              />
              <label className={styles.hint} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> 비밀번호 표시
              </label>
            </div>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving} style={{ marginTop: 4 }}>
              {saving ? '변경 중…' : '비밀번호 변경'}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); step === 'verify' ? verify() : sendCode(); }} noValidate>
            <div className={styles.field}>
              <label htmlFor="userId">아이디</label>
              <input
                id="userId"
                className={styles.input}
                type="text"
                placeholder="가입한 아이디"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                autoComplete="username"
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

            {step === 'verify' && (
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

            {step === 'verify' ? (
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={verifying} style={{ marginTop: 4 }}>
                {verifying ? '확인 중…' : '인증 확인'}
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
          <Link href="/find-id">아이디 찾기</Link>
        </p>
      </section>
    </main>
  );
}
