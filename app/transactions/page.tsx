'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { getTransactions, deleteTransaction } from '@/lib/api';
import { usePaymentMethods } from '@/hooks/useSettings';
import { fmtFull } from '@/lib/utils';
import type { Transaction } from '@/lib/types';

const PAGE_SIZE = 8;
const TYPE_LABEL: Record<string, string> = { income: '수입', expense: '지출' };
const TYPE_CHIPS = [{ label: '전체', type: 'all' }, { label: '수입', type: 'income' }, { label: '지출', type: 'expense' }];
const DAY_CHIPS = [{ label: '7일', days: 7 }, { label: '30일', days: 30 }, { label: '90일', days: 90 }, { label: '1년', days: 365 }];

function dateRange(days: number) {
  const to = new Date(); const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function TransactionsPage() {
  const qc = useQueryClient();
  const { data: transactions = [], isLoading } = useQuery({ queryKey: ['transactions'], queryFn: getTransactions });
  const { methods } = usePaymentMethods();

  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [payment, setPayment] = useState('');
  const [activeType, setActiveType] = useState('all');
  const [activeDays, setActiveDays] = useState(30);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<'date' | 'amount' | 'type'>('date');
  const [sortDir, setSortDir] = useState(-1);
  const [page, setPage] = useState(1);

  const delMut = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['summary'] }); },
  });

  const rows = (transactions as Transaction[]).map((t) => ({
    id: t.id,
    date: t.transaction_date || t.date || '',
    name: t.title || '',
    payment: t.payment_method || '',
    type: t.type,
    cat: t.category_name || '기타',
    amount: t.amount,
  }));

  const categories = useMemo(() => [...new Set(rows.map((t) => t.cat).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    let f = dateFrom, t = dateTo;
    if (!f || !t) { const r = dateRange(activeDays); f = r.from; t = r.to; }
    const q = query.toLowerCase();
    const out = rows.filter((tx) => {
      if (tx.date < f || tx.date > t) return false;
      if (activeType !== 'all' && tx.type !== activeType) return false;
      if (cat && tx.cat !== cat) return false;
      if (payment && tx.payment !== payment) return false;
      if (q && !tx.name.toLowerCase().includes(q) && !tx.payment.toLowerCase().includes(q)) return false;
      return true;
    });
    out.sort((a, b) => {
      if (sortField === 'date') return sortDir * (a.date > b.date ? 1 : -1);
      if (sortField === 'amount') return sortDir * (a.amount - b.amount);
      return sortDir * a.type.localeCompare(b.type);
    });
    return out;
  }, [rows, dateFrom, dateTo, activeDays, query, activeType, cat, payment, sortField, sortDir]);

  useEffect(() => setPage(1), [filtered.length, query, cat, payment, activeType, activeDays]);

  const totals = useMemo(() => {
    const income = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, net: income - expense, count: filtered.length };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(offset, offset + PAGE_SIZE);

  function sortBy(field: 'date' | 'amount' | 'type') {
    if (sortField === field) setSortDir((d) => d * -1);
    else { setSortField(field); setSortDir(-1); }
  }
  const sortArrow = (f: string) => (f === sortField ? (sortDir === -1 ? ' ↓' : ' ↑') : '');

  function exportCsvLocal() {
    const head = ['날짜', '거래처', '유형', '카테고리', '결제수단', '금액'];
    const lines = [head, ...filtered.map((t) => [t.date, t.name, TYPE_LABEL[t.type], t.cat, t.payment, String(t.type === 'income' ? t.amount : -t.amount)])];
    const csv = lines.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '내역조회_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>거래 내역</h1>
        <button className="btn btn-ghost btn-sm" onClick={exportCsvLocal}>↓ CSV</button>
      </div>

      {/* 요약 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }} className="md:grid-cols-4">
        <Sum label="잔액" value={(totals.net >= 0 ? '+' : '-') + fmtFull(totals.net)} color={totals.net >= 0 ? 'var(--income)' : 'var(--expense)'} />
        <Sum label="수입" value={'+' + fmtFull(totals.income)} color="var(--income)" />
        <Sum label="지출" value={'-' + fmtFull(totals.expense)} color="var(--expense)" />
        <Sum label="건수" value={totals.count + '건'} color="var(--text)" />
      </div>

      {/* 필터 */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input className="field" style={{ flex: 1, minWidth: 180, maxWidth: 280 }} placeholder="거래처·결제수단 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="field" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">전체 카테고리</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="field" style={{ width: 'auto' }} value={payment} onChange={(e) => setPayment(e.target.value)}>
            <option value="">전체 결제수단</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
          {TYPE_CHIPS.map((c) => (
            <Chip key={c.type} active={activeType === c.type} onClick={() => setActiveType(c.type)}>{c.label}</Chip>
          ))}
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--card-border)', margin: '0 4px' }} />
          {DAY_CHIPS.map((c) => (
            <Chip key={c.days} active={!dateFrom && activeDays === c.days} onClick={() => { setActiveDays(c.days); setDateFrom(''); setDateTo(''); }}>{c.label}</Chip>
          ))}
          <input type="date" className="field" style={{ width: 'auto' }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" className="field" style={{ width: 'auto' }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      {/* 테이블 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--card-border)', background: 'var(--hover-bg)' }}>
                <Th onClick={() => sortBy('date')}>날짜{sortArrow('date')}</Th>
                <Th>내역</Th>
                <Th onClick={() => sortBy('type')}>유형{sortArrow('type')}</Th>
                <Th>카테고리</Th>
                <Th>결제수단</Th>
                <Th align="right" onClick={() => sortBy('amount')}>금액{sortArrow('amount')}</Th>
                <Th align="center">관리</Th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} style={tdEmpty}>불러오는 중...</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={7} style={tdEmpty}>조건에 맞는 거래 내역이 없습니다.</td></tr>
              ) : pageRows.map((tx) => (
                <tr key={tx.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td style={{ ...td, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{tx.date.replace(/-/g, '.')}</td>
                  <td style={{ ...td, fontWeight: 600, color: 'var(--text)' }}>{tx.name}</td>
                  <td style={td}>
                    <span className="badge" style={{ background: tx.type === 'income' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)', color: tx.type === 'income' ? 'var(--income)' : 'var(--expense)' }}>{TYPE_LABEL[tx.type]}</span>
                  </td>
                  <td style={{ ...td, color: 'var(--text-2)' }}>{tx.cat}</td>
                  <td style={{ ...td, color: 'var(--text-2)' }}>{tx.payment || '-'}</td>
                  <td className="font-mono" style={{ ...td, textAlign: 'right', fontWeight: 700, color: tx.type === 'income' ? 'var(--income)' : 'var(--expense)', whiteSpace: 'nowrap' }}>{tx.type === 'income' ? '+' : '-'}{fmtFull(tx.amount)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <button onClick={() => delMut.mutate(tx.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '0.8rem' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--card-border)' }}>
          <small style={{ color: 'var(--text-3)' }}>{filtered.length ? `${filtered.length}건 중 ${offset + 1}–${Math.min(offset + PAGE_SIZE, filtered.length)}` : '0건'}</small>
          <div style={{ display: 'flex', gap: 4 }}>
            <PageBtn label="‹" disabled={page === 1} onClick={() => setPage((p) => p - 1)} />
            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.max(0, page - 3) + 5).map((i) => (
              <PageBtn key={i} label={String(i)} active={i === page} onClick={() => setPage(i)} />
            ))}
            <PageBtn label="›" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} />
          </div>
        </div>
      </div>
    </>
  );
}

const td: React.CSSProperties = { padding: '11px 14px', fontSize: '0.84rem', textAlign: 'left' };
const tdEmpty: React.CSSProperties = { padding: '40px', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' };

function Th({ children, align = 'left', onClick }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; onClick?: () => void }) {
  return (
    <th onClick={onClick} style={{ padding: '10px 14px', textAlign: align, fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>{children}</th>
  );
}

function Sum({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card" style={{ padding: '13px 16px' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: '0.95rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn btn-sm" style={{ background: active ? 'var(--accent)' : 'var(--hover-bg)', color: active ? 'var(--text-inv)' : 'var(--text-2)', border: 'none' }}>{children}</button>
  );
}

function PageBtn({ label, active, disabled, onClick }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick}
      style={{ height: 28, minWidth: 28, padding: '0 8px', borderRadius: 8, fontSize: '0.78rem', cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--card-border)'}`,
        background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-2)', opacity: disabled ? 0.4 : 1, fontFamily: 'inherit' }}>
      {label}
    </button>
  );
}
