'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register, checkUserId } from '@/lib/api';
import NoticeModal from '@/components/NoticeModal';
import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';
import { COUNTRY_GROUPS, DEFAULT_ISO, findCountry } from '@/lib/countries';

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

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', display: 'block', marginBottom: 6,
};

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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checkingId, setCheckingId] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  // 중복확인을 통과한 아이디 값. 입력이 바뀌면 아래 idVerified가 저절로 풀린다.
  const [checkedId, setCheckedId] = useState('');
  const idVerified = checkedId !== '' && checkedId === form.user_id.trim();

  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));

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
    const err = passwordError(form.password);
    if (err) {
      setNotice({ variant: 'error', title: '비밀번호를 확인해주세요', message: err });
      return;
    }
    if (form.password !== form.password_confirm) {
      setNotice({ variant: 'error', title: '비밀번호가 일치하지 않습니다', message: '두 입력란에 같은 비밀번호를 입력해주세요.' });
      return;
    }
    setNotice({ variant: 'success', title: '사용 가능한 비밀번호입니다', message: `${PW_HINT} — 규칙을 모두 만족하고 두 입력란이 일치합니다.` });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!idVerified) {
      setError('아이디 중복확인을 해주세요.');
      return;
    }
    const pwError = passwordError(form.password);
    if (pwError) {
      setError(pwError);
      return;
    }
    if (form.password !== form.password_confirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
    const phone = form.phone.trim();
    let phoneE164 = '';
    if (phone) {
      const parsed = parsePhoneNumberFromString(phone, countryIso as CountryCode);
      if (!parsed?.isValid()) {
        const example = findCountry(countryIso)?.example;
        setError(`핸드폰 번호가 올바르지 않습니다.${example ? ` (예: ${example})` : ''}`);
        return;
      }
      phoneE164 = parsed.number; // 이미 E.164
    }
    const email = `${form.email_local.trim()}@${form.email_domain.trim()}`;
    if (!form.email_local.trim() || !form.email_domain.trim()) {
      setError('이메일을 입력해주세요.');
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      setError('이용약관과 개인정보처리방침에 동의해주세요.');
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
      setError((err as Error).message || '회원가입에 실패했습니다.');
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
      <label style={labelStyle}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input
          className="field"
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
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      disabled={busy}
      // '확인 중...'으로 라벨이 바뀔 때 버튼 폭이 흔들리지 않게 고정한다.
      style={{ whiteSpace: 'nowrap', minWidth: 78 }}
    >
      {busy ? '확인 중...' : label}
    </button>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* 이메일 줄이 아이디·@·도메인·도메인선택 4단이라 로그인(400)보다 넓게 잡는다. */}
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>✦</div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            AI 가계부
          </h1>
        </div>

        <div className="card" style={{ padding: 32 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 24, marginTop: 0 }}>
            회원가입
          </h2>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {field('user_id', '아이디', 'text', '사용할 아이디', checkBtn('중복확인', checkId, checkingId))}
            {idVerified && (
              <p style={{ margin: '-8px 0 0', fontSize: '0.75rem', color: 'var(--success)' }}>
                ✓ 사용 가능한 아이디입니다
              </p>
            )}
            {field('password', '비밀번호', 'password', '비밀번호')}
            <p style={{ margin: '-8px 0 0', fontSize: '0.72rem', color: 'var(--text-3)' }}>
              {PW_HINT}
            </p>
            {field('password_confirm', '비밀번호 확인', 'password', '비밀번호 재입력', checkBtn('확인', checkPassword))}
            {field('name', '이름', 'text', '이름')}

            <div>
              <label style={labelStyle}>이메일</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="field"
                  style={{ flex: 1, minWidth: 0 }}
                  type="text"
                  placeholder="아이디"
                  value={form.email_local}
                  onChange={e => set('email_local', e.target.value)}
                  required
                />
                <span style={{ flexShrink: 0, fontSize: '0.85rem', color: 'var(--text-3)' }}>@</span>
                <input
                  className="field"
                  style={{ flex: 1, minWidth: 0, opacity: domainPreset ? 0.6 : 1 }}
                  type="text"
                  placeholder="example.com"
                  value={form.email_domain}
                  onChange={e => set('email_domain', e.target.value)}
                  disabled={domainPreset !== ''}
                  required
                />
                <select
                  className="field"
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
            </div>

            <div>
              <label style={labelStyle}>핸드폰 번호 (선택)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  className="field"
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
                  className="field"
                  style={{ flex: 1, minWidth: 0 }}
                  type="tel"
                  placeholder={findCountry(countryIso)?.example ?? '번호 입력'}
                  value={form.phone}
                  onChange={e => set('phone', formatPhone(e.target.value, countryIso))}
                />
              </div>
            </div>

            <div style={{ border: '1px solid var(--card-border)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                { checked: agreeTerms, toggle: setAgreeTerms, label: '이용약관 동의', href: '/terms' },
                { checked: agreePrivacy, toggle: setAgreePrivacy, label: '개인정보 수집·이용 동의', href: '/privacy' },
              ] as const).map(({ checked, toggle, label, href }) => (
                <div key={href} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text)', cursor: 'pointer', flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => toggle(e.target.checked)}
                      style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
                    />
                    <span>{label} <span style={{ color: 'var(--text-3)' }}>(필수)</span></span>
                  </label>
                  {/* 작성 중인 폼이 날아가지 않게 문서는 새 탭으로 연다. */}
                  <Link href={href} target="_blank" style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
                    보기
                  </Link>
                </div>
              ))}
            </div>

            {error && (
              <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: '0.82rem', color: '#f43f5e' }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
              {loading ? '처리 중...' : '회원가입'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: 0 }}>
            이미 계정이 있으신가요?{' '}
            <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
              로그인
            </Link>
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
    </div>
  );
}
