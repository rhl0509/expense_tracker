'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getList } from '@/lib/api';
import { fmtFull } from '@/lib/utils';
import type { Transaction } from '@/lib/types';

const PERIODS = [
  { label: '1주', days: 7 }, { label: '1개월', days: 30 }, { label: '3개월', days: 90 },
  { label: '6개월', days: 180 }, { label: '1년', days: 365 },
];

function highlight(text: string, q: string): React.ReactNode {
  if (!q || !text) return text || '';
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(re);
  const lower = q.toLowerCase();
  return parts.map((p, i) =>
    p && p.toLowerCase() === lower
      ? <mark key={i} style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 3, padding: '0 2px' }}>{p}</mark>
      : <span key={i}>{p}</span>,
  );
}

export default function SearchPage() {
  const { data: all = [] } = useQuery({ queryKey: ['tx-list'], queryFn: () => getList() });
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [cat, setCat] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [period, setPeriod] = useState(30);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('date-desc');

  function selectPeriod(days: number) {
    setPeriod(days);
    const to = new Date(); const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  }
  useEffect(() => { selectPeriod(30); }, []);

  const dateOf = (t: Transaction) => t.date || t.transaction_date || '';
  const categories = useMemo(() => [...new Set((all as Transaction[]).map((t) => t.category_name).filter(Boolean))].sort() as string[], [all]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const minAmt = parseFloat(min) || 0;
    const maxAmt = parseFloat(max) || Infinity;
    const out = (all as Transaction[]).filter((tx) => {
      if (type && tx.type !== type) return false;
      if (cat && tx.category_name !== cat) return false;
      if (tx.amount < minAmt || tx.amount > maxAmt) return false;
      const d = dateOf(tx);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      if (q) {
        const hay = `${tx.memo || ''} ${tx.title || ''} ${tx.category_name || ''} ${tx.amount}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (sort === 'date-desc') return dateOf(b).localeCompare(dateOf(a));
      if (sort === 'date-asc') return dateOf(a).localeCompare(dateOf(b));
      if (sort === 'amount-desc') return b.amount - a.amount;
      if (sort === 'amount-asc') return a.amount - b.amount;
      return 0;
    });
    return out;
  }, [all, query, type, cat, min, max, dateFrom, dateTo, sort]);

  const totalInc = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExp = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  return (
    <>
      <h1 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>검색</h1>

      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {PERIODS.map((p) => (
            <button key={p.days} onClick={() => selectPeriod(p.days)} className="btn btn-sm"
              style={{ background: p.days === period ? 'var(--accent)' : 'var(--hover-bg)', color: p.days === period ? 'var(--text-inv)' : 'var(--text-2)', border: 'none' }}>{p.label}</button>
          ))}
        </div>
        <input className="field" placeholder="내용·카테고리·금액 검색" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 10 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }} className="md:grid-cols-4">
          <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">전체 유형</option><option value="income">수입</option><option value="expense">지출</option>
          </select>
          <select className="field" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">전체 카테고리</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="field" type="number" placeholder="최소 금액" value={min} onChange={(e) => setMin(e.target.value)} />
          <input className="field" type="number" placeholder="최대 금액" value={max} onChange={(e) => setMax(e.target.value)} />
          <input className="field" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input className="field" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <select className="field" style={{ gridColumn: 'span 2' }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="date-desc">최신순</option><option value="date-asc">오래된순</option>
            <option value="amount-desc">금액 높은순</option><option value="amount-asc">금액 낮은순</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>총 {filtered.length}건</span>
        <span style={{ fontSize: '0.82rem' }}>
          {totalInc > 0 && <span className="font-mono" style={{ marginRight: 12, fontWeight: 700, color: 'var(--income)' }}>+{fmtFull(totalInc)}</span>}
          {totalExp > 0 && <span className="font-mono" style={{ fontWeight: 700, color: 'var(--expense)' }}>-{fmtFull(totalExp)}</span>}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>검색 결과가 없습니다.</div>
        ) : filtered.map((tx, i) => (
          <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: i < filtered.length - 1 ? '1px solid var(--card-border)' : 'none' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tx.type === 'income' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)', fontSize: '0.85rem', flexShrink: 0 }}>{tx.type === 'income' ? '↑' : '↓'}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {highlight(tx.title || tx.memo || tx.category_name || '-', query.trim().toLowerCase())}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 1 }}>{tx.category_name || ''}{tx.payment_method ? ' · ' + tx.payment_method : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="font-mono" style={{ fontWeight: 700, fontSize: '0.9rem', color: tx.type === 'income' ? 'var(--income)' : 'var(--expense)', whiteSpace: 'nowrap' }}>{tx.type === 'income' ? '+' : '-'}{fmtFull(tx.amount)}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{dateOf(tx)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
