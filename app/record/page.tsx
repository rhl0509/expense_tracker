'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  getSummary, getYearlySummary, getTransactions, getPaymentSummary,
  addTransaction, deleteTransaction, exportCsv,
} from '@/lib/api';
import { useCategories } from '@/hooks/useCategories';
import { useUserLabels, usePaymentMethods } from '@/hooks/useSettings';
import { useToast } from '@/components/providers/ToastProvider';
import { fmt, fmtFull, commaInput, unComma, todayStr } from '@/lib/utils';
import type { Transaction } from '@/lib/types';

type FormState = {
  user: string;
  date: string;
  type: 'income' | 'expense';
  parent: string;
  category_id: string;
  payment_method: string;
  title: string;
  amount: string;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-3)', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

export default function RecordPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { parents, subs } = useCategories();
  const { labels } = useUserLabels();
  const { methods } = usePaymentMethods();

  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: getSummary });
  const { data: yearly } = useQuery({ queryKey: ['yearly-summary'], queryFn: getYearlySummary });
  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: getTransactions });
  const { data: paySummary = [] } = useQuery({ queryKey: ['payment-summary'], queryFn: getPaymentSummary });

  const [form, setForm] = useState<FormState>({
    user: '', date: todayStr(), type: 'expense', parent: '',
    category_id: '', payment_method: '', title: '', amount: '',
  });
  const setF = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // 라벨/결제수단 로드되면 기본값 채움
  useEffect(() => { if (labels[0] && !form.user) setF('user', labels[0]); }, [labels]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (methods[0] && !form.payment_method) setF('payment_method', methods[0]); }, [methods]); // eslint-disable-line react-hooks/exhaustive-deps

  const parentOpts = parents(form.type);
  const subOpts = useMemo(() => subs(form.parent), [subs, form.parent]);

  // 유형 변경 시 대/소분류 초기화
  useEffect(() => { setForm((f) => ({ ...f, parent: '', category_id: '' })); }, [form.type]);
  // 대분류 변경 시 첫 소분류 자동 선택
  useEffect(() => { setForm((f) => ({ ...f, category_id: subOpts[0] ? String(subOpts[0].id) : '' })); }, [subOpts]);

  const addMut = useMutation({
    mutationFn: addTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['yearly-summary'] });
      qc.invalidateQueries({ queryKey: ['payment-summary'] });
      qc.invalidateQueries({ queryKey: ['category-chart'] });
      setForm((f) => ({ ...f, title: '', amount: '' }));
      toast('저장되었습니다.', 'success');
    },
    onError: (e) => toast('저장 실패: ' + (e as Error).message, 'error'),
  });

  const delMut = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['payment-summary'] });
    },
  });

  function submit() {
    const amount = unComma(form.amount);
    const category_id = form.category_id || form.parent;
    if (!amount || !category_id || !form.date) {
      toast('필수 항목을 입력하세요.', 'error');
      return;
    }
    addMut.mutate({
      user: form.user, date: form.date, type: form.type,
      category_id, payment_method: form.payment_method,
      amount, description: form.title,
    });
  }

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const pct = income > 0 ? Math.min((expense / income) * 100, 100) : 0;
  const pctCls = pct >= 90 ? 'prog-danger' : pct >= 70 ? 'prog-warn' : 'prog-safe';

  async function handleExport() {
    const res = await exportCsv();
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'my_account_book.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const recent = (transactions as Transaction[]).slice(0, 8);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>기록하기</h1>

      {/* 스탯 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }} className="md:grid-cols-4">
        <Stat label="📈 올해 수입" value={yearly?.income ?? 0} color="var(--income)" />
        <Stat label="📉 올해 지출" value={yearly?.expense ?? 0} color="var(--expense)" />
        <Stat label="💰 이번 달 수입" value={income} color="var(--income)" />
        <Stat label="💸 이번 달 지출" value={expense} color="var(--expense)" />
      </div>

      {/* 예산 달성률 */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 10 }}>📊 예산 달성률 · 이번 달 수입 대비 지출</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="font-mono" style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{pct.toFixed(1)}%</div>
          <div className="prog-track" style={{ flex: 1 }}><div className={`prog-fill ${pctCls}`} style={{ width: `${pct}%` }} /></div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-2)', flexShrink: 0 }}>목표 <b style={{ color: 'var(--text)' }}>{fmt(income)}</b></div>
        </div>
      </div>

      {/* 결제수단별 지출 */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>결제수단별 지출</div>
        {paySummary.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }} className="md:grid-cols-4">
            {paySummary.map((p) => (
              <div key={p.payment_method || '기타'} style={{ borderRadius: 12, border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 4 }}>{p.payment_method || '기타'}</div>
                <div className="font-mono" style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)' }}>{fmtFull(p.total)}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>이번 달 지출 데이터가 없습니다.</div>}
      </div>

      {/* 새 내역 기록 */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>✎ 새 내역 기록</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }} className="md:grid-cols-3">
          <Field label="사용자">
            <select className="field" value={form.user} onChange={(e) => setF('user', e.target.value)}>
              {labels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="날짜">
            <input className="field" type="date" value={form.date} onChange={(e) => setF('date', e.target.value)} />
          </Field>
          <Field label="유형">
            <select className="field" value={form.type} onChange={(e) => setF('type', e.target.value)}>
              <option value="expense">지출</option>
              <option value="income">수입</option>
            </select>
          </Field>
          <Field label="대분류">
            <select className="field" value={form.parent} onChange={(e) => setF('parent', e.target.value)}>
              <option value="">대분류 선택</option>
              {parentOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="소분류">
            <select className="field" value={form.category_id} onChange={(e) => setF('category_id', e.target.value)}>
              {subOpts.length ? subOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>) : <option value="">소분류 없음</option>}
            </select>
          </Field>
          <Field label="결제수단">
            <select className="field" value={form.payment_method} onChange={(e) => setF('payment_method', e.target.value)}>
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <div style={{ gridColumn: 'span 2' }}>
            <Field label="내용">
              <input className="field" placeholder="예: 마트 장보기" value={form.title} onChange={(e) => setF('title', e.target.value)} />
            </Field>
          </div>
          <Field label="금액">
            <input
              className="field" inputMode="numeric" placeholder="0" style={{ textAlign: 'right', fontWeight: 700 }}
              value={form.amount}
              onChange={(e) => setF('amount', commaInput(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
          </Field>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={addMut.isPending} onClick={submit}>
          {addMut.isPending ? '저장 중...' : '기록하기'}
        </button>
      </div>

      {/* 최근 거래 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--card-border)' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>최근 거래 내역</div>
          <button className="btn btn-ghost btn-sm" onClick={handleExport}>↓ CSV</button>
        </div>
        {recent.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>등록된 거래 내역이 없습니다.</div>
        ) : recent.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--card-border)' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.type === 'income' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)', fontSize: '0.85rem', flexShrink: 0 }}>
              {t.type === 'income' ? '↑' : '↓'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title} <span style={{ fontSize: '0.65rem', color: 'var(--text-3)', marginLeft: 4 }}>{t.user || '공용'}</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 1 }}>{t.category_name ?? '미분류'} · {t.payment_method || '-'} · {t.transaction_date}</div>
            </div>
            <div className="font-mono" style={{ fontWeight: 700, fontSize: '0.88rem', color: t.type === 'income' ? 'var(--income)' : 'var(--expense)', whiteSpace: 'nowrap' }}>
              {t.type === 'income' ? '+' : '-'}{fmtFull(t.amount)}
            </div>
            <button onClick={() => delMut.mutate(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '0.8rem', padding: '4px 8px' }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 6 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{fmtFull(value)}</div>
    </div>
  );
}
