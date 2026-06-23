'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { login } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({ user_id: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.user_id, form.password);
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError((err as Error).message || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>✦</div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>
            가계부 Pro
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 6 }}>
            스마트한 가계부 관리를 시작하세요
          </p>
        </div>

        <div className="card" style={{ padding: 32 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 24, marginTop: 0 }}>
            로그인
          </h2>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                아이디
              </label>
              <input
                className="field"
                type="text"
                placeholder="아이디를 입력하세요"
                value={form.user_id}
                onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                비밀번호
              </label>
              <input
                className="field"
                type="password"
                placeholder="비밀번호를 입력하세요"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div style={{
                background: 'rgba(244,63,94,0.1)',
                border: '1px solid rgba(244,63,94,0.2)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: '0.82rem',
                color: '#f43f5e',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', marginTop: 4 }}
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: 0 }}>
            계정이 없으신가요?{' '}
            <Link href="/register" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
              회원가입
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
