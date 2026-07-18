'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
  // localStorage 는 외부 저장소다. effect 로 읽어 setState 하면 첫 렌더가 빈 예산으로
  // 그려진 뒤 한 번 더 렌더된다 — lazy initializer 로 첫 렌더부터 값을 갖는다.
  // 서버엔 localStorage 가 없으므로 typeof 가드(이 페이지는 클라이언트 컴포넌트지만 SSR 됨).
  const [budgets, setBudgets] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: monthly = [] } = useQuery({ queryKey: ['monthly-summary', year], queryFn: () => getMonthlySummary(year) });

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
    // 0 이하는 막는다 — 예산 0은 "미설정"과 구분이 안 되고 진행바가 0으로 나눠진다.
    if (raw === undefined || raw === '' || isNaN(val) || val <= 0) { toast('0보다 큰 금액을 입력하세요.', 'error'); return; }
    const next = { ...budgets, [cat]: val };
    setBudgets(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    toast('예산이 저장되었습니다.', 'success');
  }

  const cats = [...new Set([...Object.keys(spent), ...Object.keys(budgets)])].sort();
  // 예산을 실제로 잡은 카테고리와 안 잡은 것을 나눈다. 안 잡은 걸 가짜 20만원으로
  // 채우면 잡은 적 없는 예산을 지어내고 진행바가 의미를 잃는다.
  const hasBudget = (c: string) => budgets[c] !== undefined && +budgets[c] > 0;
  const budgetedCats = cats.filter(hasBudget);
  const unbudgetedCats = cats.filter((c) => !hasBudget(c) && (spent[c] || 0) > 0);

  const totalSpent = Object.values(spent).reduce((s, v) => s + v, 0);
  // 총계는 예산을 잡은 카테고리만 합산한다 — 없는 예산을 || 100만원으로 지어내지 않는다.
  const totalBudget = budgetedCats.reduce((s, c) => s + (+budgets[c] || 0), 0);
  const budgetedSpent = budgetedCats.reduce((s, c) => s + (spent[c] || 0), 0);
  const hasAnyBudget = totalBudget > 0;
  const totalPct = hasAnyBudget ? Math.min((budgetedSpent / totalBudget) * 100, 100) : 0;
  const totalCls = totalPct >= 90 ? 'prog-danger' : totalPct >= 70 ? 'prog-warn' : 'prog-safe';

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>예산 관리</h1>
        <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-3)' }}>예산은 한 번 정하면 매달 공통으로 적용됩니다. 월을 바꾸면 그 달 지출만 예산과 비교합니다.</p>
      </div>

      {/* 이 버튼은 "어느 달 지출을 볼지"만 고른다 — 예산 자체는 달과 무관하다.
          그래서 라벨을 '지출 기준: N월'로 명시해 매달 예산이 다르다는 오해를 막는다. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6, alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginRight: 4 }}>지출 기준</span>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <button key={m} onClick={() => setMonth(m)} className="btn btn-sm" style={{ background: m === month ? 'var(--accent)' : 'var(--hover-bg)', color: m === month ? 'var(--text-inv)' : 'var(--text-2)', border: 'none' }}>{m}월</button>
        ))}
      </div>
      <div style={{ height: 8 }} />

      <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
        {hasAnyBudget ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: '0.82rem', marginBottom: 10 }}>
              <div><span style={{ color: 'var(--text-3)' }}>사용 </span><b style={{ color: 'var(--text)' }}>{fmt(budgetedSpent)}</b><span style={{ color: 'var(--text-3)' }}> / {fmt(totalBudget)} (예산 설정한 카테고리)</span></div>
              <div style={{ color: 'var(--text-3)' }}>{budgetedSpent <= totalBudget ? <>남은 예산 <b style={{ color: 'var(--income)' }}>{fmt(totalBudget - budgetedSpent)}</b></> : <>초과 <b style={{ color: 'var(--expense)' }}>{fmt(budgetedSpent - totalBudget)}</b></>}</div>
            </div>
            <div className="prog-track" style={{ height: 10 }}><div className={`prog-fill ${totalCls}`} style={{ width: `${totalPct}%` }} /></div>
          </>
        ) : (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>
            이번 달 지출 <b style={{ color: 'var(--text)' }}>{fmt(totalSpent)}</b>
            <span style={{ color: 'var(--text-3)' }}> · 아직 설정한 예산이 없습니다. 아래에서 카테고리별 예산을 정하세요.</span>
          </div>
        )}
      </div>

      {cats.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>이번 달 지출 데이터가 없습니다.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 12 }} className="grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {budgetedCats.map((cat) => {
              const sp = spent[cat] || 0;
              const bg = +budgets[cat];
              const pct = Math.min((sp / bg) * 100, 100);
              const remain = bg - sp;
              const cls = pct >= 90 ? 'prog-danger' : pct >= 70 ? 'prog-warn' : 'prog-safe';
              return (
                <div key={cat} className="card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={iconBox}>{CATEGORY_ICONS[cat] || '💳'}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>{cat}</div>
                      <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}><b style={{ color: 'var(--text-2)' }}>{fmt(sp)}</b> / {fmt(bg)}</div>
                    </div>
                  </div>
                  <div className="prog-track" style={{ marginBottom: 8 }}><div className={`prog-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: 10 }}>
                    <span style={{ color: remain >= 0 ? 'var(--income)' : 'var(--expense)' }}>{remain >= 0 ? '남은 예산 ' + fmt(remain) : '초과 ' + fmt(Math.abs(remain))}</span>
                    <span style={{ color: 'var(--text-3)' }}>{pct.toFixed(0)}%</span>
                  </div>
                  {/* key={month} 로 월을 바꾸면 입력칸이 새로 마운트돼 그 달 예산으로 갱신된다.
                      defaultValue 는 마운트 때만 반영되므로 key 가 없으면 월을 바꿔도 안 바뀐다. */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input key={`${cat}-${month}`} className="field" type="number" min={0} placeholder="예산 금액" defaultValue={bg} onChange={(e) => setDrafts((d) => ({ ...d, [cat]: e.target.value }))} style={{ flex: 1 }} />
                    <button className="btn btn-primary btn-sm" onClick={() => saveBudget(cat)}>저장</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 예산 미설정 — 진행바 없이, 지출만 보여주고 예산을 유도한다. 가짜 20만원을
              지어내 진행바를 채우던 것을 대체한다. */}
          {unbudgetedCats.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginBottom: 8 }}>예산 미설정 · 지출은 있으나 예산을 아직 안 정한 카테고리</div>
              <div style={{ display: 'grid', gap: 12 }} className="grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {unbudgetedCats.map((cat) => (
                  <div key={cat} className="card" style={{ padding: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={iconBox}>{CATEGORY_ICONS[cat] || '💳'}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)' }}>{cat}</div>
                        <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{fmt(spent[cat] || 0)} 지출 · <span style={{ fontFamily: 'inherit' }}>예산 미설정</span></div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input key={`${cat}-${month}`} className="field" type="number" min={0} placeholder="예산을 정하세요" onChange={(e) => setDrafts((d) => ({ ...d, [cat]: e.target.value }))} style={{ flex: 1 }} />
                      <button className="btn btn-primary btn-sm" onClick={() => saveBudget(cat)}>설정</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

const iconBox: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--hover-bg)', fontSize: '1.05rem',
};
