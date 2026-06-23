'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { getMonthlySummary, getList } from '@/lib/api';
import { fmt, fmtFull, categoryColor } from '@/lib/utils';
import type { MonthlySummary, Transaction } from '@/lib/types';

ChartJS.register(ArcElement, Tooltip, Legend);

const EXCLUDE = ['저축', '투자'];

export default function ReportPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: monthly = [] } = useQuery({ queryKey: ['monthly-summary', year], queryFn: () => getMonthlySummary(year) });
  const { data: txns = [] } = useQuery({ queryKey: ['tx-list', year, month], queryFn: () => getList(year, month) });

  const mData = useMemo(() => (monthly as MonthlySummary[]).filter((d) => d.month === month), [monthly, month]);
  const income = mData.filter((d) => d.type === 'income').reduce((s, d) => s + Math.floor(d.total), 0);
  const expense = mData.filter((d) => d.type === 'expense' && !EXCLUDE.some((c) => d.category_name?.includes(c))).reduce((s, d) => s + Math.floor(d.total), 0);
  const surplus = income - expense;
  const exData = mData.filter((d) => d.type === 'expense' && !EXCLUDE.some((c) => d.category_name?.includes(c)));

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const list = txns as Transaction[];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', marginRight: 8 }}>리포트</h1>
        <select className="field" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
          <button key={mm} onClick={() => setMonth(mm)} className="btn btn-sm" style={{ background: mm === month ? 'var(--accent)' : 'var(--hover-bg)', color: mm === month ? 'var(--text-inv)' : 'var(--text-2)', border: 'none' }}>{mm}월</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        <Card label="수입" value={income} color="var(--income)" />
        <Card label="지출" value={expense} color="var(--expense)" />
        <Card label="잉여금" value={surplus} color={surplus >= 0 ? 'var(--income)' : 'var(--expense)'} />
      </div>

      <div className="card" style={{ padding: 22, marginBottom: 14 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>카테고리별 지출</div>
        {exData.length ? (
          <div style={{ height: 260 }}>
            <Doughnut
              data={{ labels: exData.map((d) => d.category_name || '기타'), datasets: [{ data: exData.map((d) => Math.floor(d.total)), backgroundColor: exData.map((d, i) => categoryColor(d.category_name || '', i)), borderWidth: 0 }] }}
              options={{ responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { color: 'var(--text-2)', font: { size: 11 }, boxWidth: 10 } } } }}
            />
          </div>
        ) : <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>데이터가 없습니다.</div>}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--card-border)', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>총 {list.length}건</div>
        {list.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>거래 내역이 없습니다.</div>
        ) : list.map((t, i) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: i < list.length - 1 ? '1px solid var(--card-border)' : 'none' }}>
            <span style={{ width: 52, fontSize: '0.74rem', color: 'var(--text-3)', flexShrink: 0 }}>{(t.date || t.transaction_date || '').slice(5)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>{t.title || t.memo || '-'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{t.category_name || '-'} · {t.payment_method || '-'}</div>
            </div>
            <span className="font-mono" style={{ fontWeight: 700, fontSize: '0.86rem', color: t.type === 'income' ? 'var(--income)' : 'var(--expense)', whiteSpace: 'nowrap' }}>{t.type === 'income' ? '+' : '-'}{fmtFull(t.amount)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Card({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: '1rem', fontWeight: 700, color }}>{fmt(value)}</div>
    </div>
  );
}
