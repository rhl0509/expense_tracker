'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { register, checkUserId, sendEmailCode, verifyEmailCode } from '@/lib/api';
import NoticeModal from '@/components/NoticeModal';
import LegalAgreementModal from '@/components/LegalAgreementModal';
import TermsContent from '@/components/legal/TermsContent';
import PrivacyContent from '@/components/legal/PrivacyContent';
import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import { COUNTRY_GROUPS, DEFAULT_ISO, findCountry } from '@/lib/countries';
import styles from './register.module.css';

// 브랜드 워드마크 — 로그인과 같은 자산·테마 전환(라이트=컬러 / 다크=화이트).
const LOGO_RATIO = 1116 / 288;
const LOGO_H = 40;
const LOGO_W = Math.round(LOGO_H * LOGO_RATIO);

// 자릿수를 묶는 법이 나라마다 달라(한국 3-4-4, 미국 (201) 555-0123, 프랑스 2-2-2-2-2 …)
// 손으로 쓰지 않고 libphonenumber에 맡긴다. 검증·E.164 변환도 같은 출처를 쓴다.
const formatPhone = (raw: string, iso: string) => new AsYouType(iso as CountryCode).input(raw);

// 백엔드 auth.py의 _PW_RULES와 같은 규칙. 둘 중 하나만 바꾸면 안 된다.
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
const EMAIL_DOMAINS = [
  'naver.com', 'gmail.com', 'daum.net', 'hanmail.net',
  'kakao.com', 'nate.com', 'outlook.com', 'icloud.com',
];

type Notice = { variant: 'success' | 'error'; title: string; message: string };

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    user_id: '', password: '', password_confirm: '', name: '',
    email_local: '', email_domain: '', phone: '',
  });
  // '' = 직접입력(기본값). 프리셋을 고르면 도메인 칸이 그 값으로 잠긴다.
  const [domainPreset, setDomainPreset] = useState('');
  const [countryIso, setCountryIso] = useState(DEFAULT_ISO);
  // 검증 실패 문구. 제출 버튼 바로 위에 절대위치로 띄운다(카드 높이 불변). 3초 후 자동으로 사라진다.
  const [error, setError] = useState('');
  const [errKey, setErrKey] = useState(0); // 같은 문구를 다시 띄워도 타이머·흔들림이 재시작되게 하는 키
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checkingId, setCheckingId] = useState(false);
  // 이메일 인증(발송→코드입력→확인). emailVerified 에는 '인증 완료된 이메일 문자열'을 담아,
  // 그 뒤 이메일을 바꾸면 자동으로 무효화되게 한다(값 비교).
  const [codeSent, setCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [emailVerified, setEmailVerified] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resendIn, setResendIn] = useState(0); // 재발송 쿨다운(초)
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  // 열려 있는 약관 모달('terms'|'privacy'|null). '보기'를 누르면 새 페이지 대신 모달로 연다.
  const [legalModal, setLegalModal] = useState<null | 'terms' | 'privacy'>(null);
  // 중복확인을 통과한 아이디 값. 입력이 바뀌면 아래 idVerified가 저절로 풀린다.
  const [checkedId, setCheckedId] = useState('');
  const idVerified = checkedId !== '' && checkedId === form.user_id.trim();

  // 경고를 띄운다. errKey를 함께 올려 같은 문구여도 타이머 재시작 + 흔들림 재생이 되게 한다.
  const showError = (msg: string) => { setError(msg); setErrKey(k => k + 1); };

  // 경고는 3초 뒤 자동으로 사라진다(errKey가 바뀔 때마다 타이머 재설정).
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 3000);
    return () => clearTimeout(t);
  }, [error, errKey]);

  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));

  const emailValue = `${form.email_local.trim()}@${form.email_domain.trim()}`;
  const emailComplete = form.email_local.trim() !== '' && form.email_domain.trim() !== '';
  const emailVerifiedOk = emailVerified !== '' && emailVerified === emailValue;

  // 이메일을 바꾸면 이전 발송·인증 상태를 무효화한다(다른 주소로 통과하는 것 방지).
  useEffect(() => {
    setCodeSent(false);
    setEmailCode('');
    setEmailVerified('');
    setResendIn(0);
  }, [form.email_local, form.email_domain]);

  // 재발송 쿨다운 카운트다운.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(s => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendCode = async () => {
    if (!emailComplete) { showError('이메일을 먼저 입력해주세요.'); return; }
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

  const checkId = async () => {
    const uid = form.user_id.trim();
    if (uid.length < 3 || uid.length > 50) {
      setNotice({ variant: 'error', title: '아이디를 확인해주세요', message: '아이디는 3~50자여야 합니다.' });
      return;
    }
    setCheckingId(true);
    try {
      const { available } = await checkUserId(uid);
      setCheckedId(available ? uid : '');
      setNotice(available
        ? { variant: 'success', title: '사용 가능한 아이디입니다', message: `'${uid}' 로 가입할 수 있습니다.` }
        : { variant: 'error', title: '이미 사용 중인 아이디입니다', message: '다른 아이디를 입력해주세요.' });
    } catch (err: unknown) {
      setNotice({ variant: 'error', title: '확인하지 못했습니다', message: (err as Error).message || '잠시 후 다시 시도해주세요.' });
    } finally {
      setCheckingId(false);
    }
  };

  const checkPassword = () => {
    // 이 모달은 작은 설명 텍스트 없이 제목만 보여준다 — 오류 사유는 제목으로 올린다.
    const err = passwordError(form.password);
    if (err) {
      setNotice({ variant: 'error', title: err, message: '' });
      return;
    }
    if (form.password !== form.password_confirm) {
      setNotice({ variant: 'error', title: '비밀번호가 일치하지 않습니다', message: '' });
      return;
    }
    setNotice({ variant: 'success', title: '사용 가능한 비밀번호입니다', message: '' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.user_id.trim()) {
      showError('아이디를 입력해주세요.');
      return;
    }
    if (!idVerified) {
      showError('아이디 중복확인을 해주세요.');
      return;
    }
    const pwError = passwordError(form.password);
    if (pwError) {
      showError(pwError);
      return;
    }
    if (form.password !== form.password_confirm) {
      showError('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (!form.name.trim()) {
      showError('이름을 입력해주세요.');
      return;
    }
    const phone = form.phone.trim();
    let phoneE164 = '';
    if (phone) {
      const parsed = parsePhoneNumberFromString(phone, countryIso as CountryCode);
      if (!parsed?.isValid()) {
        const example = findCountry(countryIso)?.example;
        showError(`핸드폰 번호가 올바르지 않습니다.${example ? ` (예: ${example})` : ''}`);
        return;
      }
      phoneE164 = parsed.number; // 이미 E.164
    }
    const email = `${form.email_local.trim()}@${form.email_domain.trim()}`;
    if (!form.email_local.trim() || !form.email_domain.trim()) {
      showError('이메일을 입력해주세요.');
      return;
    }
    if (emailVerified !== email) {
      showError('이메일 인증을 완료해주세요.');
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      showError('이용약관과 개인정보처리방침에 동의해주세요.');
      return;
    }
    setLoading(true);
    try {
      await register({
        user_id: form.user_id,
        password: form.password,
        name: form.name,
        email,
        ...(phoneE164 ? { phone: phoneE164 } : {}),
        terms_agreed: agreeTerms,
        privacy_agreed: agreePrivacy,
      });
      router.replace('/login');
    } catch (err: unknown) {
      showError((err as Error).message || '회원가입에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const field = (
    key: keyof typeof form,
    label: string,
    type = 'text',
    placeholder = '',
    action?: React.ReactNode,
  ) => (
    <div>
      <label className={styles.label}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          className={styles.input}
          // 버튼이 입력칸 안에 겹쳐 있으므로 글자가 버튼 아래로 들어가지 않게 오른쪽을 비워둔다.
          style={action ? { paddingRight: 92 } : undefined}
          type={type}
          placeholder={placeholder}
          value={form[key]}
          onChange={e => set(key, e.target.value)}
          required={key !== 'phone'}
        />
        {action && (
          <div style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)' }}>
            {action}
          </div>
        )}
      </div>
    </div>
  );

  const checkBtn = (label: string, onClick: () => void, busy = false) => (
    <button
      type="button"
      className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
      onClick={onClick}
      disabled={busy}
    >
      {busy ? '확인 중...' : label}
    </button>
  );

  return (
    <main className={styles.wrap}>
      <div className={styles.shell}>
        <div className={styles.header}>
          <div className={styles.brand}>
            <Image src="/header_color.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-light" priority />
            <Image src="/header_white.png" alt="AI가계부" width={LOGO_W} height={LOGO_H} className="logo-dark" priority />
          </div>
          <p className={styles.subtitle}>몇 가지만 입력하면 바로 시작할 수 있어요</p>
        </div>

        <div className={styles.card}>
          {/* noValidate: 브라우저 기본 검증 말풍선(페이지와 안 어울림)을 끄고 아래 submit()의
              앱 스타일 경고로 안내한다. required 는 접근성 힌트로 남겨둔다. */}
          <form onSubmit={submit} noValidate className={styles.form}>
            {field('user_id', '아이디', 'text', '사용할 아이디', checkBtn('중복확인', checkId, checkingId))}
            {idVerified && <p className={styles.ok}>✓ 사용 가능한 아이디입니다</p>}
            {field('password', '비밀번호', 'password', '비밀번호')}
            <p className={styles.hint}>{PW_HINT}</p>
            {field('password_confirm', '비밀번호 확인', 'password', '비밀번호 재입력', checkBtn('확인', checkPassword))}
            {field('name', '이름', 'text', '이름')}

            <div>
              <label className={styles.label}>이메일</label>
              <div className={styles.rowLine}>
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 0 }}
                  type="text"
                  placeholder="아이디"
                  value={form.email_local}
                  onChange={e => set('email_local', e.target.value)}
                  required
                />
                <span className={styles.at}>@</span>
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 0 }}
                  type="text"
                  placeholder="example.com"
                  value={form.email_domain}
                  onChange={e => set('email_domain', e.target.value)}
                  disabled={domainPreset !== ''}
                  required
                />
                <select
                  className={styles.input}
                  style={{ flex: 1, minWidth: 0 }}
                  value={domainPreset}
                  onChange={e => {
                    // 직접입력('')을 고르면 도메인 칸을 비워 사용자가 새로 쓰게 한다.
                    setDomainPreset(e.target.value);
                    set('email_domain', e.target.value);
                  }}
                  aria-label="이메일 도메인 선택"
                >
                  <option value="">직접입력</option>
                  {EMAIL_DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* 이메일 인증 — 발송 → 코드 입력 → 확인. 인증 완료 시 배지. */}
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
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                    onClick={verifyCode}
                    disabled={verifyingCode}
                  >
                    {verifyingCode ? '확인 중...' : '확인'}
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost} ${styles.btnSm}`}
                    onClick={sendCode}
                    disabled={sendingCode || resendIn > 0}
                  >
                    {resendIn > 0 ? `재발송 ${resendIn}s` : '재발송'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={sendCode}
                  disabled={sendingCode || !emailComplete}
                  style={{ width: '100%', marginTop: 8, padding: '11px 16px', fontSize: '0.85rem' }}
                >
                  {sendingCode ? '발송 중...' : '인증코드 발송'}
                </button>
              )}
            </div>

            <div>
              <label className={styles.label}>핸드폰 번호 (선택)</label>
              <div className={styles.rowLine}>
                <select
                  className={styles.input}
                  style={{ flex: '0 0 170px' }}
                  value={countryIso}
                  onChange={e => {
                    const iso = e.target.value;
                    setCountryIso(iso);
                    // 이미 입력해 둔 번호를 새 나라의 표기법으로 다시 서식한다.
                    if (form.phone) set('phone', formatPhone(form.phone, iso));
                  }}
                  aria-label="국가 번호 선택"
                >
                  {COUNTRY_GROUPS.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.countries.map(c => (
                        <option key={c.iso} value={c.iso}>{c.name} {c.dial}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  className={styles.input}
                  style={{ flex: 1, minWidth: 0 }}
                  type="tel"
                  placeholder={findCountry(countryIso)?.example ?? '번호 입력'}
                  value={form.phone}
                  onChange={e => set('phone', formatPhone(e.target.value, countryIso))}
                />
              </div>
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
                  {/* 작성 중인 폼이 날아가지 않게 문서는 새 페이지가 아니라 모달로 연다. */}
                  <button type="button" className={styles.viewBtn} onClick={() => setLegalModal(doc)}>보기</button>
                </div>
              ))}
            </div>

            {/* 제출 버튼 바로 위 인라인 경고. 절대위치라 카드 높이를 밀지 않고, 방금 누른 버튼 위에
                떠서 바로 눈에 띈다(등장 시 살짝 흔들려 주의를 끈다). 3초 후 자동으로 사라진다. */}
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
                {loading ? '처리 중...' : '회원가입'}
              </button>
            </div>
          </form>

          <p className={styles.footer}>
            이미 계정이 있으신가요?{' '}
            <Link href="/login" className={styles.loginLink}>로그인</Link>
          </p>
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
