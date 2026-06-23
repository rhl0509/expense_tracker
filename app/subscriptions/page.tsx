'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getRecurring, addRecurring, deleteRecurring, processRecurring } from '@/lib/api';
import { useCategories } from '@/hooks/useCategories';
import { useUserLabels } from '@/hooks/useSettings';
import { useToast } from '@/components/providers/ToastProvider';
import { fmtFull, commaInput, unComma } from '@/lib/utils';

export default function SubscriptionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { parents, subs } = useCategories();
  const { labels } = useUserLabels();
  const { data: recurring = [] } = useQuery({ queryKey: ['recurring'], queryFn: getRecurring });
  const [showAdd, setShowAdd] = useState(false);

  const [form, setForm] = useState({
    user: '', type: 'expense' as 'income' | 'expense',
    parent: '', category_id: '', repeat_day: '', amount: '', title: '',
  });
  const setF = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { if (labels[0]) setForm((f) => (f.user ? f : { ...f, user: labels[0] })); }, [labels]);

  const parentOpts = parents(form.type);
  const subOpts = useMemo(() => subs(form.parent), [subs, form.parent]);
  useEffect(() => { setForm((f) => ({ ...f, parent: '', category_id: '' })); }, [form.type]);
  useEffect(() => { setForm((f) => ({ ...f, category_id: subOpts[0] ? String(subOpts[0].id) : '' })); }, [subOpts]);

  const addMut = useMutation({
    mutationFn: addRecurring,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring'] });
      setShowAdd(false);
      setForm((f) => ({ ...f, repeat_day: '', amount: '', title: '' }));
      toast('정기 결제가 추가되었습니다.', 'success');
    },
    onError: (e) => toast('등록 실패: ' + (e as Error).message, 'error'),
  });
  const delMut = useMutation({ mutationFn: deleteRecurring, onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }) });
  const processMut = useMutation({
    mutationFn: processRecurring,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      toast(`${data.processed}건 처리 완료`, 'success');
    },
  });

  function submit() {
    const amount = unComma(form.amount);
    const category_id = form.category_id || form.parent;
    const day = parseInt(form.repeat_day, 10);
    if (!amount || !form.title.trim() || !category_id || !form.repeat_day) return toast('모든 항목을 입력해 주세요.', 'error');
    if (day < 1 || day > 28) return toast('결제일은 1~28 사이로 입력해 주세요.', 'error');
    addMut.mutate({ user: form.user, type: form.type, repeat_day: day, category_id: Number(category_id), amount, title: form.title.trim() });
  }

  const income = recurring.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const expense = recurring.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 8, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>정기 결제</h1>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 2 }}>매월 자동 반복되는 수입·지출</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => processMut.mutate()} disabled={processMut.isPending}>{processMut.isPending ? '처리 중...' : '이번 달 적용'}</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ 추가</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>월 정기 수입</div>
          <div className="font-mono" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--income)' }}>+{fmtFull(income)}</div>
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>월 정기 지출</div>
          <div className="font-mono" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--expense)' }}>-{fmtFull(expense)}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {recurring.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>정기 결제 내역이 없습니다.</div>
        ) : recurring.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: i < recurring.length - 1 ? '1px solid var(--card-border)' : 'none' }}>
            <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', flexShrink: 0 }}>매월 {r.repeat_day}일</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>{r.title}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 1 }}>{r.category_name ?? '미분류'} · {r.user}</div>
            </div>
            <div className="font-mono" style={{ fontWeight: 700, fontSize: '0.9rem', color: r.type === 'income' ? 'var(--income)' : 'var(--expense)', whiteSpace: 'nowrap' }}>{r.type === 'income' ? '+' : '-'}{fmtFull(r.amount)}</div>
            <button onClick={() => delMut.mutate(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '0.8rem', padding: '4px 8px' }}>✕</button>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>정기 결제 추가</h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-3)' }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {(['income', 'expense'] as const).map((t) => (
                <button key={t} onClick={() => setF('type', t)} className="btn" style={{ flex: 1, background: form.type === t ? (t === 'income' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)') : 'var(--hover-bg)', color: form.type === t ? (t === 'income' ? 'var(--income)' : 'var(--expense)') : 'var(--text-3)', border: `1px solid ${form.type === t ? (t === 'income' ? 'var(--income)' : 'var(--expense)') : 'var(--card-border)'}` }}>
                  {t === 'income' ? '+ 수입' : '- 지출'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input className="field" placeholder="내용 (예: 넷플릭스 구독)" value={form.title} onChange={(e) => setF('title', e.target.value)} />
              <input className="field" inputMode="numeric" placeholder="금액" style={{ textAlign: 'right', fontWeight: 700 }} value={form.amount} onChange={(e) => setF('amount', commaInput(e.target.value))} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <select className="field" value={form.parent} onChange={(e) => setF('parent', e.target.value)}>
                  <option value="">대분류</option>
                  {parentOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="field" value={form.category_id} onChange={(e) => setF('category_id', e.target.value)}>
                  {subOpts.length ? subOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>) : <option value="">소분류 없음</option>}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 4 }}>결제일 (1~28)</label>
                  <input className="field" type="number" min={1} max={28} placeholder="예: 25" value={form.repeat_day} onChange={(e) => setF('repeat_day', e.target.value)} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 4 }}>사용자</label>
                  <select className="field" value={form.user} onChange={(e) => setF('user', e.target.value)}>
                    {labels.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>취소</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={addMut.isPending} onClick={submit}>{addMut.isPending ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
