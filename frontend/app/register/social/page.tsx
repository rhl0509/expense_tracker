'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSocialPending, sendEmailCode, socialComplete, verifyEmailCode } from '@/lib/api';
import NoticeModal from '@/components/NoticeModal';
import LegalAgreementModal from '@/components/LegalAgreementModal';
import TermsContent from '@/components/legal/TermsContent';
import PrivacyContent from '@/components/legal/PrivacyContent';
import styles from '../register.module.css';

// 브랜드 워드마크 — 로그인/회원가입과 같은 자산·규격·테마 전환.
const LOGO_RATIO = 763 / 288;
const LOGO_H = 34;
const LOGO_W = Math.round(LOGO_H * LOGO_RATIO);

const PROVIDER_NAMES: Record<string, string> = { google: '구글', kakao: '카카오', naver: '네이버' };

type Notice = { variant: 'success' | 'error'; title: string; message: string };

// 소셜 콜백 뒤의 가입 마무리 화면 — 이름 확인 + 약관 동의(+ 프로바이더가 검증된 이메일을
// 안 준 경우 이메일 인증). 아이디·비밀번호는 없다(소셜 전용 회원).
export default function SocialRegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: pending, isError } = useQuery({
    queryKey: ['social-pending'],
    queryFn: getSocialPending,
    retry: false,           // 400(만료·직접 접근)은 재시도해도 같다 — 바로 로그인으로 돌려보낸다
    refetchOnWindowFocus: false,
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [emailVerified, setEmailVerified] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [legalModal, setLegalModal] = useState<null | 'terms' | 'privacy'>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState('');
  const [errKey, setErrKey] = useState(0);
  const [loading, setLoading] = useState(false);

  const showError = (msg: string) => { setError(msg); setErrKey(k => k + 1); };

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 3000);
    return () => clearTimeout(t);
  }, [error, errKey]);

  // 대기 정보가 없으면(만료·직접 접근) 로그인으로 돌려보낸다.
  useEffect(() => {
    if (isError) router.replace('/login?social_error=state');
  }, [isError, router]);

  // 프로바이더가 준 이름을 초기값으로.
  useEffect(() => {
    if (pending?.name) setName(prev => prev || pending.name!);
  }, [pending]);

  // 이메일을 바꾸면 이전 발송·인증 상태를 무효화한다(register 와 같은 규칙).
  useEffect(() => {
    setCodeSent(false);
    setEmailCode('');
    setEmailVerified('');
    setResendIn(0);
  }, [email]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(s => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const emailValue = email.trim();
  const emailVerifiedOk = emailVerified !== '' && emailVerified === emailValue;

  const sendCode = async () => {
    if (!emailValue) { showError('이메일을 먼저 입력해주세요.'); return; }
    setSendingCode(true);
    try {
      await sendEmailCode(emailValue);
      setCodeSent(true);
      setEmailCode('');
      setResendIn(60);
      setNotice({ variant: 'success', title: '인증 코드를 보냈습니다', message: '메일함에서 6자리 코드를 확인해 입력해주세요.' });
    } catch (err: unknown) {
      setNotice({ variant: 'error', title: '발송하지 못했습니다', message: (err as Error).message || '잠시 후 다시 시도해주세요.' });
    } finally {
      setSendingCode(false);
    }
  };

  const verifyCode = async () => {
    const code = emailCode.trim();
    if (!code) { showError('인증 코드를 입력해주세요.'); return; }
    setVerifyingCode(true);
    try {
      await verifyEmailCode(emailValue, code);
      setEmailVerified(emailValue);
      setCodeSent(false);
      setNotice({ variant: 'success', title: '이메일 인증 완료', message: '이메일이 확인되었습니다.' });
    } catch (err: unknown) {
      setNotice({ variant: 'error', title: '인증하지 못했습니다', message: (err as Error).message || '코드를 다시 확인해주세요.' });
    } finally {
      setVerifyingCode(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { showError('이름을 입력해주세요.'); return; }
    if (pending?.needs_email && !emailVerifiedOk) { showError('이메일 인증을 완료해주세요.'); return; }
    if (!agreeTerms || !agreePrivacy) { showError('이용약관과 개인정보처리방침에 동의해주세요.'); return; }
    setLoading(true);
    try {
      await socialComplete({ name: name.trim(), terms_agreed: agreeTerms, privacy_agreed: agreePrivacy });
      // 가입과 동시에 로그인 세션이 발급된다 — 앱으로 바로 진입.
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/record');
    } catch (err: unknown) {
      showError((err as Error).message || '가입에 실패했습니다.');
      setLoading(false);
    }
  };

  if (!pending) return null; // 로딩 중이거나 리다이렉트 대기

  const providerName = PROVIDER_NAMES[pending.provider] ?? pending.provider;

  return (
    <main className={styles.wrap}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div className={styles.brand}>
            <Image src="/header_color.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-light" priority />
            <Image src="/header_white.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-dark" priority />
          </div>
          <p className={styles.subtitle}>{providerName} 계정으로 가입을 마무리해주세요</p>
        </div>

        <div className={styles.card}>
          <form onSubmit={submit} noValidate className={styles.form}>
            <div>
              <label className={styles.label}>이름</label>
              <input
                className={styles.input}
                type="text"
                placeholder="이름"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className={styles.label}>이메일</label>
              {pending.needs_email ? (
                <>
                  {/* 프로바이더가 검증된 이메일을 주지 않았다(카카오 등). 계정 복구 채널이
                      없으면 소셜 계정을 잃는 순간 가계부도 잃는다 — 인증을 요구한다. */}
                  <input
                    className={styles.input}
                    type="email"
                    placeholder="example@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                  {emailVerifiedOk ? (
                    <p className={styles.ok} style={{ margin: '8px 0 0' }}>✓ 이메일 인증 완료</p>
                  ) : codeSent ? (
                    <div className={styles.rowLine} style={{ marginTop: 8 }}>
                      <input
                        className={styles.input}
                        style={{ flex: 1, minWidth: 0 }}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="메일로 받은 6자리 코드"
                        value={emailCode}
                        onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      />
                      <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                        onClick={verifyCode} disabled={verifyingCode}>
                        {verifyingCode ? '확인 중...' : '확인'}
                      </button>
                      <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                        onClick={sendCode} disabled={sendingCode || resendIn > 0}>
                        {resendIn > 0 ? `재발송 ${resendIn}s` : '재발송'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnGhost}`}
                      onClick={sendCode}
                      disabled={sendingCode || !emailValue}
                      style={{ width: '100%', marginTop: 8, padding: '11px 16px', fontSize: '0.85rem' }}
                    >
                      {sendingCode ? '발송 중...' : '인증코드 발송'}
                    </button>
                  )}
                  {/* .hint 는 .form 직계(gap 14px)에서 -8px 로 당기는 전제라, gap 없는 이 안에서는
                      마진을 직접 준다 — 안 그러면 위 요소를 파고든다. */}
                  <p className={styles.hint} style={{ margin: '6px 0 0' }}>계정 찾기·복구에 쓰이는 이메일입니다.</p>
                </>
              ) : (
                <>
                  <input className={styles.input} type="email" value={pending.email ?? ''} disabled />
                  <p className={styles.hint} style={{ margin: '6px 0 0' }}>{providerName} 계정에서 확인된 이메일입니다.</p>
                </>
              )}
            </div>

            <div className={styles.agree}>
              {([
                { checked: agreeTerms, toggle: setAgreeTerms, label: '이용약관 동의', doc: 'terms' },
                { checked: agreePrivacy, toggle: setAgreePrivacy, label: '개인정보 수집·이용 동의', doc: 'privacy' },
              ] as const).map(({ checked, toggle, label, doc }) => (
                <div key={doc} className={styles.agreeRow}>
                  <label className={styles.agreeLabel}>
                    <input type="checkbox" checked={checked} onChange={e => toggle(e.target.checked)} />
                    <span>{label} <span className={styles.req}>(필수)</span></span>
                  </label>
                  <button type="button" className={styles.viewBtn} onClick={() => setLegalModal(doc)}>보기</button>
                </div>
              ))}
            </div>

            <div style={{ position: 'relative', marginTop: 4 }}>
              {error && (
                <div
                  key={errKey}
                  className="reg-error"
                  role="alert"
                  style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0,
                    background: 'var(--card-bg)', border: '1px solid rgba(244,63,94,0.5)',
                    borderRadius: 8, padding: '9px 12px', fontSize: '0.8rem', fontWeight: 600,
                    color: '#f43f5e', textAlign: 'center', boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
                    zIndex: 5,
                  }}
                >
                  {error}
                </div>
              )}
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={loading}>
                {loading ? '처리 중...' : '가입 완료'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <NoticeModal
        open={notice !== null}
        variant={notice?.variant}
        title={notice?.title ?? ''}
        message={notice?.message ?? ''}
        onClose={() => setNotice(null)}
      />

      <LegalAgreementModal
        open={legalModal === 'terms'}
        title="이용약관"
        onAgree={() => { setAgreeTerms(true); setLegalModal(null); }}
        onClose={() => setLegalModal(null)}
      >
        <TermsContent />
      </LegalAgreementModal>

      <LegalAgreementModal
        open={legalModal === 'privacy'}
        title="개인정보 수집·이용"
        onAgree={() => { setAgreePrivacy(true); setLegalModal(null); }}
        onClose={() => setLegalModal(null)}
      >
        <PrivacyContent />
      </LegalAgreementModal>
    </main>
  );
}
