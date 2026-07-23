'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { addTransaction } from '@/lib/api';
import { useCategories } from '@/hooks/useCategories';
import { useUserLabels, usePaymentMethods } from '@/hooks/useSettings';
import { useToast } from '@/components/providers/ToastProvider';
import { commaInput, unComma, todayStr, invalidateTx } from '@/lib/utils';

export default function AddTransactionModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { parents, subs } = useCategories();
  const { labels } = useUserLabels();
  const { methods } = usePaymentMethods();

  const [form, setForm] = useState({
    user: '', date: todayStr(), type: 'expense' as 'income' | 'expense',
    parent: '', category_id: '', payment_method: '', title: '', amount: '',
  });
  const setF = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { if (labels[0]) setForm((f) => (f.user ? f : { ...f, user: labels[0] })); }, [labels]);
  useEffect(() => { if (methods[0]) setForm((f) => (f.payment_method ? f : { ...f, payment_method: methods[0] })); }, [methods]);

  const parentOpts = parents(form.type);
  const subOpts = useMemo(() => subs(form.parent), [subs, form.parent]);
  useEffect(() => { setForm((f) => ({ ...f, parent: '', category_id: '' })); }, [form.type]);
  useEffect(() => { setForm((f) => ({ ...f, category_id: subOpts[0] ? String(subOpts[0].id) : '' })); }, [subOpts]);

  const mutation = useMutation({
    mutationFn: addTransaction,
    onSuccess: () => {
      invalidateTx(qc);
      toast('저장되었습니다.', 'success');
      onClose();
    },
    onError: (e) => toast('저장 실패: ' + (e as Error).message, 'error'),
  });

  function submit() {
    const amount = unComma(form.amount);
    const category_id = form.category_id || form.parent;
    if (!amount || !category_id) { toast('금액과 카테고리를 입력하세요.', 'error'); return; }
    mutation.mutate({
      user: form.user, date: form.date, type: form.type,
      category_id, payment_method: form.payment_method, amount, description: form.title,
    });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>거래 추가</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-3)' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['income', 'expense'] as const).map((t) => (
            <button key={t} onClick={() => setF('type', t)} className="btn"
              style={{ flex: 1, background: form.type === t ? (t === 'income' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)') : 'var(--hover-bg)', color: form.type === t ? (t === 'income' ? 'var(--income)' : 'var(--expense)') : 'var(--text-3)', border: `1px solid ${form.type === t ? (t === 'income' ? 'var(--income)' : 'var(--expense)') : 'var(--card-border)'}` }}>
              {t === 'income' ? '+ 수입' : '- 지출'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="field" inputMode="numeric" placeholder="금액" style={{ textAlign: 'right', fontWeight: 700 }}
            value={form.amount} onChange={(e) => setF('amount', commaInput(e.target.value))} />
          <input className="field" placeholder="내용" value={form.title} onChange={(e) => setF('title', e.target.value)} />
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
            <select className="field" value={form.payment_method} onChange={(e) => setF('payment_method', e.target.value)}>
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="field" value={form.user} onChange={(e) => setF('user', e.target.value)}>
              {labels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <input className="field" type="date" value={form.date} onChange={(e) => setF('date', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>취소</button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
