'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement,
} from 'chart.js';
import { getMonthlySummary, getCategoryChart, getRecent } from '@/lib/api';
import { fmt, categoryColor } from '@/lib/utils';
import AddTransactionModal from '@/components/AddTransactionModal';
import type { MonthlySummary, CategoryChart, Transaction } from '@/lib/types';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const EXCLUDE = ['저축', '투자'];
const GOAL_RATE = 20;

function KpiCard({ label, value, color, sub, subColor }: { label: string; value: number; color: string; sub?: string; subColor?: string }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: value < 0 ? 'var(--expense)' : color, lineHeight: 1 }}>{fmt(value)}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: subColor ?? 'var(--text-3)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [showAdd, setShowAdd] = useState(false);
  const year = new Date().getFullYear();
  const { data: monthly = [] } = useQuery({ queryKey: ['monthly-summary', year], queryFn: () => getMonthlySummary(year) });
  const { data: catChart = [] } = useQuery({ queryKey: ['category-chart'], queryFn: getCategoryChart });
  const { data: recent = [] } = useQuery({ queryKey: ['recent', 8], queryFn: () => getRecent(8) });

  const m = new Date().getMonth() + 1;
  const prev = m === 1 ? 12 : m - 1;

  const sum = (month: number, type: 'income' | 'expense', kw?: string, excludeSavings = false) =>
    (monthly as MonthlySummary[])
      .filter((d) => {
        if (d.month !== month || d.type !== type) return false;
        if (kw) return !!d.category_name && d.category_name.includes(kw);
        if (excludeSavings) return !EXCLUDE.some((c) => d.category_name?.includes(c));
        return true;
      })
      .reduce((s, d) => s + Math.floor(d.total), 0);

  const income = sum(m, 'income');
  const expense = sum(m, 'expense', undefined, true);
  const saving = sum(m, 'expense', '저축');
  const surplus = income - expense - saving;
  const prevExp = sum(prev, 'expense', undefined, true);
  const expDiff = prevExp > 0 ? (((expense - prevExp) / prevExp) * 100).toFixed(1) : null;
  const savingRate = income > 0 ? ((saving / income) * 100).toFixed(1) : '0';
  const savingPct = income > 0 ? Math.min((saving / ((income * GOAL_RATE) / 100)) * 100, 100) : 0;

  // 지출 도넛
  const exCat = (catChart as CategoryChart[]).filter((d) => d.type === 'expense');
  const donutTotal = exCat.reduce((s, d) => s + d.value, 0);
  const donutData = {
    labels: exCat.map((d) => d.label),
    datasets: [{ data: exCat.map((d) => d.value), backgroundColor: exCat.map((d, i) => categoryColor(d.label, i)), borderWidth: 0 }],
  };

  // 6개월 막대
  const monthBars = useMemo(() => {
    const now = new Date();
    const labels: string[] = []; const inc: number[] = []; const exp: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mo = d.getMonth() + 1;
      labels.push(`${mo}월`);
      inc.push(sum(mo, 'income'));
      exp.push(sum(mo, 'expense', undefined, true));
    }
    return { labels, inc, exp };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly]);

  // 전월 비교
  const maxCmp = Math.max(expense, prevExp, 1);
  const diff = expense - prevExp;

  // 예산 미니바
  const budgets: Record<string, number> = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('category_budgets') || '{}'); } catch { return {}; }
  }, []);
  const budgetRows = exCat.filter((d) => !EXCLUDE.some((c) => d.label?.includes(c))).slice(0, 4);

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const, labels: { boxWidth: 10, color: 'var(--text-2)', font: { size: 11 }, padding: 12 } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'var(--text-3)', font: { size: 10 } } },
      y: { grid: { color: 'var(--card-border)' }, ticks: { color: 'var(--text-3)', font: { size: 10 }, callback: (v: unknown) => fmt(v as number) } },
    },
  };

  return (
    <>
      {showAdd && <AddTransactionModal onClose={() => setShowAdd(false)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>대시보드</h1>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 2 }}>{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })} 현황</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ 거래 추가</button>
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 14 }} className="md:grid-cols-4">
        <KpiCard label="이번달 수입" value={income} color="var(--income)" />
        <KpiCard label="이번달 지출" value={expense} color="var(--expense)" sub={expDiff !== null ? `${Number(expDiff) > 0 ? '▲' : '▼'} ${Math.abs(Number(expDiff))}% 전달 대비` : undefined} subColor={expDiff !== null ? (Number(expDiff) > 0 ? 'var(--expense)' : 'var(--income)') : undefined} />
        <KpiCard label="저축" value={saving} color="#3b82f6" sub={`저축률 ${savingRate}%`} />
        <KpiCard label="잉여금" value={surplus} color="#8b5cf6" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14, marginBottom: 14 }} className="lg:grid-cols-2">
        {/* 지출 분포 도넛 */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>이번 달 지출 분포</div>
          {exCat.length ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative', width: 150, height: 150, flexShrink: 0 }}>
                <Doughnut data={donutData} options={{ cutout: '72%', plugins: { legend: { display: false } } }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-3)' }}>총 지출</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>{fmt(donutTotal)}</div>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {exCat.slice(0, 5).map((c, i) => (
                  <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: categoryColor(c.label, i), flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)' }}>{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div style={{ color: 'var(--text-3)', fontSize: '0.82rem', padding: '24px 0' }}>지출 데이터가 없습니다.</div>}
        </div>

        {/* 6개월 막대 */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>최근 6개월 수입·지출</div>
          <div style={{ height: 180 }}>
            <Bar
              data={{
                labels: monthBars.labels,
                datasets: [
                  { label: '수입', data: monthBars.inc, backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 5 },
                  { label: '지출', data: monthBars.exp, backgroundColor: 'rgba(244,63,94,0.7)', borderRadius: 5 },
                ],
              }}
              options={chartOpts}
            />
          </div>
        </div>

        {/* 전월 비교 */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>전달 대비 지출</div>
          <CompareRow label={`${m}월`} amount={expense} pct={(expense / maxCmp) * 100} color={diff > 0 ? '#f43f5e' : '#10b981'} />
          <CompareRow label={`${prev}월`} amount={prevExp} pct={(prevExp / maxCmp) * 100} color="#94a3b8" />
          <div style={{ marginTop: 14, borderRadius: 10, padding: 12, fontSize: '0.78rem', color: 'var(--text-2)', background: 'var(--accent-soft)' }}>
            {diff > 0 ? `⚠️ 이번달 지출이 지난달보다 ${fmt(Math.abs(diff))} 더 많습니다.`
              : diff < 0 ? `🎉 이번달 지출이 지난달보다 ${fmt(Math.abs(diff))} 적습니다!`
              : '📊 지난달과 지출이 동일합니다.'}
          </div>
        </div>

        {/* 저축 목표 */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>저축 현황</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginBottom: 4 }}>이달 저축액</div>
              <div className="font-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)' }}>{fmt(saving)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: Number(savingRate) >= GOAL_RATE ? '#34d399' : '#fbbf24' }}>{savingRate}%</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>저축률</div>
            </div>
          </div>
          <div className="prog-track" style={{ margin: '14px 0 8px' }}><div className="prog-fill prog-safe" style={{ width: `${savingPct}%` }} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-3)' }}>
            <span>목표 {GOAL_RATE}% 달성도</span>
            <span>{savingPct.toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* 예산 + 최근거래 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }} className="lg:grid-cols-2">
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>카테고리 예산</div>
          {budgetRows.length ? budgetRows.map((d) => {
            const budget = budgets[d.label] || 200000;
            const pct = Math.min((d.value / budget) * 100, 100);
            const cls = pct >= 90 ? 'prog-danger' : pct >= 70 ? 'prog-warn' : 'prog-safe';
            return (
              <div key={d.label} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 5 }}>
                  <span style={{ color: 'var(--text-2)' }}>{d.label}</span>
                  <span style={{ color: 'var(--text-3)' }}><b style={{ color: 'var(--text)' }}>{fmt(d.value)}</b> / {fmt(budget)}</span>
                </div>
                <div className="prog-track"><div className={`prog-fill ${cls}`} style={{ width: `${pct}%` }} /></div>
              </div>
            );
          }) : <div style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>이번달 지출 데이터가 없습니다.</div>}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>최근 거래</div>
            <a href="/transactions" style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}>전체 보기 →</a>
          </div>
          {(recent as Transaction[]).length ? (recent as Transaction[]).map((t) => {
            const d = t.transaction_date || t.date || '';
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--card-border)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.type === 'income' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)', fontSize: '0.8rem', flexShrink: 0 }}>{t.type === 'income' ? '↑' : '↓'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.memo || t.title || t.category_name || '-'}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 1 }}>{t.category_name ?? '미분류'} · {d.slice(5)}</div>
                </div>
                <div className="font-mono" style={{ fontWeight: 700, fontSize: '0.85rem', color: t.type === 'income' ? 'var(--income)' : 'var(--expense)', whiteSpace: 'nowrap' }}>{t.type === 'income' ? '+' : '-'}{fmt(t.amount)}</div>
              </div>
            );
          }) : <div style={{ color: 'var(--text-3)', fontSize: '0.82rem' }}>최근 거래가 없습니다.</div>}
        </div>
      </div>
    </>
  );
}

function CompareRow({ label, amount, pct, color }: { label: string; amount: number; pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: 36, fontSize: '0.76rem', color: 'var(--text-3)' }}>{label}</div>
      <div style={{ height: 20, flex: 1, borderRadius: 6, overflow: 'hidden', background: 'var(--hover-bg)' }}>
        <div style={{ height: '100%', width: `${pct.toFixed(1)}%`, background: color, borderRadius: 6, transition: 'width 0.6s' }} />
      </div>
      <div className="font-mono" style={{ width: 80, textAlign: 'right', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>{fmt(amount)}</div>
    </div>
  );
}
