'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getSummary, getPaymentSummary, addTransaction } from '@/lib/api';
import { useCategories } from '@/hooks/useCategories';
import { useUserLabels, usePaymentMethods } from '@/hooks/useSettings';
import { useToast } from '@/components/providers/ToastProvider';
import { fmt, fmtFull, commaInput, unComma, todayStr } from '@/lib/utils';

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

type SegOption = { value: string; label: string; tone?: 'expense' | 'income' };

// on/off 버튼 묶음. role="radio"가 아니라 aria-pressed를 쓴다 — 라디오그룹은
// 화살표 키로 이동하는 규약이 따라붙는데, 그걸 구현하지 않고 role만 붙이면
// 스크린리더 사용자에게 없는 동작을 약속하는 셈이 된다. 실제 동작은 토글 버튼이다.
function Segmented({ options, value, onChange, ariaLabel, wrap, empty }: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  wrap?: boolean;   // 항목이 많으면 균등분할 대신 내용 폭으로
  empty?: string;   // 고를 게 없을 때 보여줄 문구
}) {
  if (!options.length && empty) return <div className="seg-empty">{empty}</div>;
  return (
    <div className={`segmented${wrap ? ' is-wrap' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            className={`seg-btn${on ? ' is-on' : ''}${on && o.tone ? ` seg-${o.tone}` : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

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
  const { data: paySummary = [] } = useQuery({ queryKey: ['payment-summary'], queryFn: () => getPaymentSummary() });

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


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>기록하기</h1>

      {/* 스탯 카드 — 올해 수입/지출은 대시보드로 옮겼다 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
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
          <div style={{ display: 'grid', gap: 10 }} className="grid-cols-2 md:grid-cols-4">
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
        <div style={{ display: 'grid', gap: 12 }} className="grid-cols-2 md:grid-cols-3">
          <Field label="사용자">
            <Segmented
              ariaLabel="사용자"
              value={form.user}
              onChange={(v) => setF('user', v)}
              options={labels.map((l) => ({ value: l, label: l }))}
            />
          </Field>
          <Field label="날짜">
            <input className="field" type="date" value={form.date} onChange={(e) => setF('date', e.target.value)} />
          </Field>
          <Field label="유형">
            <Segmented
              ariaLabel="유형"
              value={form.type}
              onChange={(v) => setF('type', v)}
              options={[
                { value: 'expense', label: '지출', tone: 'expense' },
                { value: 'income', label: '수입', tone: 'income' },
              ]}
            />
          </Field>
          {/* 지출이면 대분류가 10개라 한 칸에 넣으면 잘게 접힌다. 2열/3열 어느 쪽이든
              전체 폭을 쓰게 '1 / -1'로 편다. */}
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="대분류">
              <Segmented
                ariaLabel="대분류"
                wrap
                value={form.parent}
                onChange={(v) => setF('parent', v)}
                options={parentOpts.map((p) => ({ value: String(p.id), label: p.name }))}
                empty="이 유형에 대분류가 없습니다"
              />
            </Field>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="소분류">
              <Segmented
                ariaLabel="소분류"
                wrap
                value={form.category_id}
                onChange={(v) => setF('category_id', v)}
                options={subOpts.map((s) => ({ value: String(s.id), label: s.name }))}
                empty={form.parent ? '소분류 없음' : '대분류를 먼저 고르세요'}
              />
            </Field>
          </div>
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
