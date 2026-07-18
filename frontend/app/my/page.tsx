'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { changePassword, getProfile, updatePhone } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/providers/ToastProvider';
import CardCredentials from '@/components/CardCredentials';

// 백엔드 auth.py 의 _PW_RULES 와 같은 규칙. 가입 화면(register/page.tsx)과도 쌍이다.
// 셋 중 하나만 바꾸면 안 된다.
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

/** DB엔 E.164(+821012345678)로 저장된다. 그대로 보여주면 읽기 나쁘니 국내 표기로 되돌린다.
 *  parse 가 실패하면(형식이 낡은 기존 행 등) 저장된 값을 그대로 보여준다 — 감추지 않는다. */
function prettyPhone(e164: string | null): string {
  if (!e164) return '미등록';
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  // 국내 번호는 국내 표기(010-1234-5678), 해외는 국가번호를 살린 국제 표기
  return parsed.country === 'KR' ? parsed.formatNational() : parsed.formatInternational();
}

export default function MyPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: getProfile });

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent(''); setNext(''); setConfirm(''); setError('');
      toast('비밀번호가 변경되었습니다.', 'success');
    },
    onError: (e) => setError((e as Error).message || '변경에 실패했습니다.'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    // 서버도 같은 규칙을 강제하지만, 왕복 전에 알려준다.
    const err = passwordError(next);
    if (err) return setError(err);
    if (next !== confirm) return setError('새 비밀번호가 일치하지 않습니다.');
    if (next === current) return setError('현재 비밀번호와 다른 비밀번호를 입력하세요.');
    mut.mutate();
  }

  return (
    <>
      <h1 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>마이페이지</h1>

      <div style={{ display: 'grid', gap: 14, alignItems: 'start' }} className="grid-cols-1 lg:grid-cols-2">
        {/* 계정 정보 */}
        <div className="card" style={{ padding: 18 }}>
          <div style={sectionTitle}>계정</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="이름" value={profile?.name ?? user?.user_name ?? '-'} />
            <Row label="아이디" value={profile?.user_id ?? user?.user_id ?? '-'} />
            <Row label="이메일" value={profile?.email ?? '-'} />
            <PhoneEditor
              phone={profile?.phone ?? null}
              onSaved={() => qc.invalidateQueries({ queryKey: ['profile'] })}
              disabled={!profile}
            />
          </div>
          <div style={noticeStyle}>
            ⓘ 이름·아이디·이메일은 지금 화면에서 바꿀 수 없습니다.
          </div>
        </div>

        {/* 비밀번호 변경 */}
        <div className="card" style={{ padding: 18 }}>
          <div style={sectionTitle}>비밀번호 변경</div>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>현재 비밀번호</label>
              <input className="field" type="password" autoComplete="current-password"
                value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </div>
            <div>
              <label style={labelStyle}>새 비밀번호</label>
              <input className="field" type="password" autoComplete="new-password"
                value={next} onChange={(e) => setNext(e.target.value)} required />
              <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-3)' }}>{PW_HINT}</p>
            </div>
            <div>
              <label style={labelStyle}>새 비밀번호 확인</label>
              <input className="field" type="password" autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>

            {/* 토스트는 사라지지만 이 문구는 남는다 — 무엇을 고쳐야 하는지 보면서 다시 입력한다. */}
            {error && (
              <div style={errorStyle} role="alert">{error}</div>
            )}

            <button type="submit" className="btn btn-primary" disabled={mut.isPending} style={{ marginTop: 2 }}>
              {mut.isPending ? '변경 중...' : '비밀번호 변경'}
            </button>
          </form>
        </div>

        {/* 내 정보(구 /settings)에 있던 카드 연동. 계정 관련이 한 곳에 모이도록 옮겼다.
            두 곳에 나눠두면 어느 쪽이 진짜인지 헷갈린다. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <CardCredentials />
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10,
      border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '9px 12px',
    }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', width: 56, flexShrink: 0 }}>{label}</span>
      {/* 이메일이 길면 카드를 밀어내지 않고 말줄임 */}
      <span style={{ fontSize: '0.85rem', color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

// 핸드폰 등록·수정. 기본은 값만 보여주고, '수정'을 누르면 입력칸이 열린다.
// 국내(010) 전용으로 단순화한다 — 회원가입의 245개국 select 는 여기 과하다.
// 입력하는 대로 하이픈을 넣고, E.164(+82…)로 정규화해 서버에 보낸다.
const KR_PHONE_RE = /^01\d-?\d{3,4}-?\d{4}$/;

function formatKr(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function PhoneEditor({ phone, onSaved, disabled }: {
  phone: string | null;
  onSaved: () => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  // 저장된 E.164 를 국내 표기로 되돌려 입력칸 초기값으로 (해외 번호면 있는 그대로).
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: (e164: string) => updatePhone(e164),
    onSuccess: () => { setEditing(false); setError(''); onSaved(); toast('핸드폰 번호가 저장되었습니다.', 'success'); },
    onError: (e) => setError((e as Error).message || '저장에 실패했습니다.'),
  });

  function open() {
    const parsed = phone ? parsePhoneNumberFromString(phone) : null;
    setValue(parsed?.country === 'KR' ? parsed.formatNational() : (phone ?? ''));
    setError('');
    setEditing(true);
  }

  function save() {
    const v = value.trim();
    if (!v) return mut.mutate('');   // 빈 값 = 등록 해제
    if (!KR_PHONE_RE.test(v)) return setError('010-1234-5678 형식으로 입력하세요.');
    // 국내 통화용 앞 0을 떼고 +82 를 붙인다(회원가입과 같은 규칙).
    const national = v.replace(/\D/g, '').replace(/^0+/, '');
    mut.mutate(`+82${national}`);
  }

  if (!editing) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10,
        border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '9px 12px',
      }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', width: 56, flexShrink: 0 }}>핸드폰</span>
        <span style={{ fontSize: '0.85rem', color: phone ? 'var(--text)' : 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prettyPhone(phone)}</span>
        <button className="btn btn-ghost btn-sm" onClick={open} disabled={disabled} style={{ flexShrink: 0 }}>
          {phone ? '수정' : '등록'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', width: 32, flexShrink: 0 }}>+82</span>
        <input
          className="field" type="tel" autoFocus placeholder="010-1234-5678"
          value={value}
          onChange={(e) => setValue(formatKr(e.target.value))}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="btn btn-primary btn-sm" onClick={save} disabled={mut.isPending} style={{ flexShrink: 0 }}>
          {mut.isPending ? '저장…' : '저장'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} style={{ flexShrink: 0 }}>취소</button>
      </div>
      {error && <div style={{ marginTop: 6, fontSize: '0.74rem', color: 'var(--expense)' }} role="alert">{error}</div>}
      <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-3)' }}>비우고 저장하면 등록이 해제됩니다.</div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)', marginBottom: 5 };
const noticeStyle: React.CSSProperties = {
  fontSize: '0.74rem', color: 'var(--text-3)', lineHeight: 1.6, borderRadius: 10,
  background: 'var(--accent-soft)', padding: '8px 12px', marginTop: 10,
};
const errorStyle: React.CSSProperties = {
  fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--expense)', borderRadius: 10,
  background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)', padding: '8px 12px',
};
