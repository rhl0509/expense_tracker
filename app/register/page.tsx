'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ user_id: '', password: '', name: '', email: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      router.replace('/login');
    } catch (err: unknown) {
      setError((err as Error).message || '회원가입에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = 'text', placeholder = '') => (
    <div>
      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <input
        className="field"
        type={type}
        placeholder={placeholder}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        required
      />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>✦</div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            가계부 Pro
          </h1>
        </div>

        <div className="card" style={{ padding: 32 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 24, marginTop: 0 }}>
            회원가입
          </h2>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {field('user_id', '아이디', 'text', '사용할 아이디')}
            {field('password', '비밀번호', 'password', '비밀번호')}
            {field('name', '이름', 'text', '이름')}
            {field('email', '이메일', 'email', 'example@email.com')}

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
    </div>
  );
}
