'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getMonthlySummary } from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import { fmt, CATEGORY_ICONS } from '@/lib/utils';
import type { MonthlySummary } from '@/lib/types';

const EXCLUDE = ['저축', '투자'];
const STORAGE_KEY = 'category_budgets';

export default function BudgetPage() {
  const toast = useToast();
  const year = new Date().getFullYear();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: monthly = [] } = useQuery({ queryKey: ['monthly-summary', year], queryFn: () => getMonthlySummary(year) });

  useEffect(() => {
    try { setBudgets(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch { /* ignore */ }
  }, []);

  const spent = useMemo(() => {
    const map: Record<string, number> = {};
    (monthly as MonthlySummary[])
      .filter((d) => d.month === month && d.type === 'expense' && !EXCLUDE.some((c) => d.category_name?.includes(c)))
      .forEach((d) => { map[d.category_name || '기타'] = (map[d.category_name || '기타'] ?? 0) + Math.floor(d.total); });
    return map;
  }, [monthly, month]);

  function saveBudget(cat: string) {
    const raw = drafts[cat];
    const val = Number(raw);
    if (raw === undefined || isNaN(val) || val < 0) { toast('올바른 금액을 입력하세요.', 'error'); return; }
    const next = { ...budgets, [cat]: val };
    setBudgets(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    toast('예산이 저장되었습니다.', 'success');
  }

  const cats = [...new Set([...Object.keys(spent), ...Object.keys(budgets)])];
  const totalSpent = Object.values(spent).reduce((s, v) => s + v, 0);
  const totalBudget = Object.values(budgets).reduce((s, v) => s + (+v || 0), 0) || 1000000;
  const totalPct = Math.min((totalSpent / totalBudget) * 100, 100);
  const totalCls = totalPct >= 90 ? 'prog-danger' : totalPct >= 70 ? 'prog-warn' : 'prog-safe';

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>예산 관리</h1>
        <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-3)' }}>카테고리별 예산을 설정하고 지출을 추적하세요</p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <button key={m} onClick={() => setMonth(m)} className="btn btn-sm" style={{ background: m === month ? 'var(--accent)' : 'var(--hover-bg)', color: m === month ? 'var(--text-inv)' : 'var(--text-2)', border: 'none' }}>{m}월</button>
        ))}
      </div>

      <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 10 }}>
          <div><span style={{ color: 'var(--text-3)' }}>사용 </span><b style={{ color: 'var(--text)' }}>{fmt(totalSpent)}</b><span style={{ color: 'var(--text-3)' }}> / {fmt(totalBudget)}</span></div>
          <div style={{ color: 'var(--text-3)' }}>남은 예산 <b style={{ color: 'var(--income)' }}>{fmt(Math.max(totalBudget - totalSpent, 0))}</b></div>
        </div>
        <div className="prog-track" style={{ height: 10 }}><div className={`prog-fill ${totalCls}`} style={{ width: `${totalPct}%` }} /></div>
      </div>

      {cats.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>이번달 지출 데이터가 없습니다.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }} className="md:grid-cols-2 lg:grid-cols-3">
          {cats.map((cat) => {
            const sp = spent[cat] || 0;
            const bg = +budgets[cat] || 200000;
            const pct = Math.min((sp / bg) * 100, 100);
            const remain = bg - sp;
            const cls = pct >= 90 ? 'prog-danger' : pct >= 70 ? 'prog-warn' : 'prog-safe';
            return (
              <div key={cat} className="card" style={{ padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--hover-bg)', fontSize: '1.05rem' }}>{CATEGORY_ICONS[cat] || '💳'}</div>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>{cat}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}><b style={{ color: 'var(--text-2)' }}>{fmt(sp)}</b> / {fmt(bg)}</div>
                  </div>
                </div>
                <div className="prog-track" style={{ marginBottom: 8 }}><div className={`prog-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: 10 }}>
                  <span style={{ color: remain >= 0 ? 'var(--income)' : 'var(--expense)' }}>{remain >= 0 ? '남은 예산 ' + fmt(remain) : '초과 ' + fmt(Math.abs(remain))}</span>
                  <span style={{ color: 'var(--text-3)' }}>{pct.toFixed(0)}%</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="field" type="number" min={0} placeholder="예산 금액" defaultValue={bg} onChange={(e) => setDrafts((d) => ({ ...d, [cat]: e.target.value }))} style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" onClick={() => saveBudget(cat)}>저장</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
