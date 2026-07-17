'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js';
import { getMonthlySummary, getCategoryChart, getPaymentSummary } from '@/lib/api';
import { fmt, categoryColor } from '@/lib/utils';
import type { MonthlySummary, CategoryChart } from '@/lib/types';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);

export default function AnalyticsPage() {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const [tab, setTab] = useState<'trend' | 'category' | 'payment'>('trend');

  const { data: monthly = [] } = useQuery({ queryKey: ['monthly-summary', year], queryFn: () => getMonthlySummary(year) });
  const { data: catChart = [] } = useQuery({ queryKey: ['category-chart', year], queryFn: () => getCategoryChart(year) });
  const { data: payment = [] } = useQuery({ queryKey: ['payment-summary', year], queryFn: () => getPaymentSummary(year) });

  const sumMonth = (monthIdx: number, type: 'income' | 'expense', kw?: string) =>
    (monthly as MonthlySummary[])
      .filter((d) => d.month === monthIdx + 1 && d.type === type && (kw ? d.category_name?.includes(kw) : true))
      .reduce((s, d) => s + Math.floor(d.total), 0);

  const series = useMemo(() => ({
    income: MONTHS.map((_, i) => sumMonth(i, 'income')),
    expense: MONTHS.map((_, i) => sumMonth(i, 'expense')),
    saving: MONTHS.map((_, i) => sumMonth(i, 'expense', '저축') + sumMonth(i, 'income', '저축')),
    invest: MONTHS.map((_, i) => sumMonth(i, 'expense', '투자') + sumMonth(i, 'income', '투자')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [monthly]);

  const exCat = (catChart as CategoryChart[]).filter((c) => c.type === 'expense').slice(0, 10);
  const inCat = (catChart as CategoryChart[]).filter((c) => c.type === 'income').slice(0, 10);

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const, labels: { color: 'var(--text-2)', font: { size: 11 }, boxWidth: 10, padding: 12 } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: 'var(--text-3)', font: { size: 10 } } },
      y: { grid: { color: 'var(--card-border)' }, ticks: { color: 'var(--text-3)', font: { size: 10 }, callback: (v: unknown) => fmt(v as number) } },
    },
  };
  const donutOpts = { cutout: '64%', plugins: { legend: { position: 'right' as const, labels: { color: 'var(--text-2)', font: { size: 11 }, boxWidth: 10 } } } };
  const years = Array.from({ length: 5 }, (_, i) => nowYear - i);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>분석 차트</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {years.map((y) => (
            <button key={y} onClick={() => setYear(y)} className="btn btn-sm" style={{ background: y === year ? 'var(--accent)' : 'var(--hover-bg)', color: y === year ? 'var(--text-inv)' : 'var(--text-2)', border: 'none' }}>{y}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['trend', 'category', 'payment'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="btn btn-sm" style={{ background: tab === t ? 'var(--accent)' : 'var(--hover-bg)', color: tab === t ? 'var(--text-inv)' : 'var(--text-2)', border: 'none' }}>
            {t === 'trend' ? '월별 추이' : t === 'category' ? '카테고리' : '결제수단'}
          </button>
        ))}
      </div>

      {tab === 'trend' && (
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>{year}년 월별 수입·지출·저축·투자</div>
          <div style={{ height: 320 }}>
            <Bar
              data={{
                labels: MONTHS,
                datasets: [
                  { label: '수입', data: series.income, backgroundColor: '#93c5fd', borderRadius: 5 },
                  { label: '지출', data: series.expense, backgroundColor: '#fca5a5', borderRadius: 5 },
                  { label: '저축', data: series.saving, backgroundColor: '#86efac', borderRadius: 5 },
                  { label: '투자', data: series.invest, backgroundColor: '#fde68a', borderRadius: 5 },
                ],
              }}
              options={opts}
            />
          </div>
        </div>
      )}

      {tab === 'category' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }} className="md:grid-cols-2">
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>지출 카테고리</div>
            {exCat.length ? <div style={{ height: 260 }}><Doughnut data={{ labels: exCat.map((c) => c.label), datasets: [{ data: exCat.map((c) => c.value), backgroundColor: exCat.map((c, i) => categoryColor(c.label, i)), borderWidth: 0 }] }} options={donutOpts} /></div> : <Empty />}
          </div>
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>수입 카테고리</div>
            {inCat.length ? <div style={{ height: 260 }}><Doughnut data={{ labels: inCat.map((c) => c.label), datasets: [{ data: inCat.map((c) => c.value), backgroundColor: ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#34d399', '#6ee7b7'], borderWidth: 0 }] }} options={donutOpts} /></div> : <Empty />}
          </div>
        </div>
      )}

      {tab === 'payment' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }} className="md:grid-cols-2">
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>결제수단별 비중</div>
            {payment.length ? <div style={{ height: 260 }}><Doughnut data={{ labels: payment.map((p) => p.payment_method || '기타'), datasets: [{ data: payment.map((p) => p.total), backgroundColor: ['#6c9bc0', '#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'], borderWidth: 0 }] }} options={donutOpts} /></div> : <Empty />}
          </div>
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>결제수단 합계</div>
            {payment.map((p, i) => (
              <div key={p.payment_method || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < payment.length - 1 ? '1px solid var(--card-border)' : 'none' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{p.payment_method || '기타'}</span>
                <span className="font-mono" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--expense)' }}>{fmt(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Empty() {
  return <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>데이터가 없습니다.</div>;
}
