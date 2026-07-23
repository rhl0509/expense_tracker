'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getTransactions, deleteTransaction, importCardStatement } from '@/lib/api';
import { usePaymentMethods } from '@/hooks/useSettings';
import { fmtFull, invalidateTx } from '@/lib/utils';
import type { Transaction } from '@/lib/types';

const TYPE_LABEL: Record<string, string> = { income: '수입', expense: '지출' };
const TYPE_CHIPS = [{ label: '전체', type: 'all' }, { label: '수입', type: 'income' }, { label: '지출', type: 'expense' }];
const DAY_CHIPS = [{ label: '7일', days: 7 }, { label: '30일', days: 30 }, { label: '90일', days: 90 }, { label: '1년', days: 365 }];

function dateRange(days: number) {
  const to = new Date(); const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** 'YYYY-MM' → 그 달 1일~말일. new Date(y, m, 0)은 m이 1-based일 때 이번 달 말일이다. */
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** 기준 월 앞뒤 3개월씩, 총 7개. */
function monthChips(anchor: string) {
  const [y, m] = anchor.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(y, m - 1 + (i - 3), 1);
    // 해가 다른 달은 연도를 붙인다 — 안 그러면 12월 옆의 '1월'이 언제인지 모른다.
    const label = d.getFullYear() === y ? `${d.getMonth() + 1}월`
      : `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}월`;
    return { month: ym(d), label };
  });
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
  // 기간은 "최근 N일" 아니면 "특정 월" 둘 중 하나다. 어느 쪽이 켜져 있는지를 들고 있는다.
  const [rangeMode, setRangeMode] = useState<'days' | 'month'>('days');
  // 달력이 고른 달이자 월 버튼 줄의 기준. 월 버튼을 누르면 기준이 그 달로 옮겨간다.
  const [anchorMonth, setAnchorMonth] = useState(() => ym(new Date()));
  const [sortField, setSortField] = useState<'date' | 'amount' | 'type'>('date');
  const [sortDir, setSortDir] = useState(-1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const tableCardRef = useRef<HTMLDivElement>(null);

  const delMut = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => invalidateTx(qc),
  });

  const importMut = useMutation({
    mutationFn: () => importCardStatement(40),
    onSuccess: () => invalidateTx(qc),
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
    const { from: f, to: t } = rangeMode === 'month' ? monthRange(anchorMonth) : dateRange(activeDays);
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
  }, [rows, rangeMode, anchorMonth, activeDays, query, activeType, cat, payment, sortField, sortDir]);

  // 필터가 바뀌면 1페이지로 되돌린다. effect 가 아니라 렌더 중에 조정한다 —
  // effect 는 화면이 그려진 "뒤"에 돌기 때문에, 5페이지를 보다가 3건짜리 달로 옮기면
  // 빈 목록이 한 프레임 그려진 다음에야 1페이지로 고쳐진다.
  // (React 공식 "값이 바뀔 때 state 조정" 패턴. setState 를 렌더 중에 부르면 React 가
  //  커밋 없이 즉시 다시 렌더하므로 잘못된 화면이 나가지 않는다.)
  // pageSize 는 일부러 뺐다 — 창 크기를 바꿀 때마다 1페이지로 튕기면 안 된다.
  const filterKey = [query, cat, payment, activeType, activeDays, rangeMode, anchorMonth].join('|');
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  // 화면 높이에 맞춰 한 페이지 행 수를 자동 계산(항상 목록이 뷰포트를 꽉 채우도록).
  useEffect(() => {
    function calc() {
      const el = tableCardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const rowEl = el.querySelector('tbody tr') as HTMLElement | null;
      const rowH = rowEl && rowEl.offsetHeight > 24 && rowEl.offsetHeight < 80 ? rowEl.offsetHeight : 43;
      const THEAD = 40, FOOTER = 49, MARGIN = 24;
      const avail = window.innerHeight - top - THEAD - FOOTER - MARGIN;
      setPageSize(Math.max(5, Math.floor(avail / rowH)));
    }
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [isLoading, filtered.length]);

  const totals = useMemo(() => {
    const income = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, net: income - expense, count: filtered.length };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // 필터를 안 바꿔도 페이지가 넘칠 수 있다(거래를 지웠거나, 창이 커져 pageSize 가 늘었을 때).
  // 렌더 중에 잘라서 어떤 경우에도 빈 목록이 그려지지 않게 한다.
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(offset, offset + pageSize);

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => importMut.mutate()} disabled={importMut.isPending}>
            {importMut.isPending ? '가져오는 중…' : '카드명세서 가져오기'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportCsvLocal}>↓ CSV</button>
        </div>
      </div>
      {(importMut.isSuccess || importMut.isError) && (
        <div style={{ marginBottom: 12, fontSize: '0.82rem', color: importMut.isError ? 'var(--expense)' : 'var(--text-2)' }}>
          {importMut.isError
            ? `가져오기 실패: ${(importMut.error as Error).message}`
            : `명세서 ${importMut.data!.parsed}건 중 ${importMut.data!.inserted}건 추가, ${importMut.data!.skipped}건 중복 제외`}
        </div>
      )}

      {/* 요약 */}
      <div style={{ display: 'grid', gap: 10, marginBottom: 14 }} className="grid-cols-2 md:grid-cols-4">
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
        {/* 유형 + 기준 월. 달력은 오른쪽 끝에 띄우지 않는다 — 띄우면 무엇의 기준인지
            안 보이고, 자기가 기준이 되는 아래 월 버튼 줄과도 멀어진다. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
          {TYPE_CHIPS.map((c) => (
            <Chip key={c.type} active={activeType === c.type} onClick={() => setActiveType(c.type)}>{c.label}</Chip>
          ))}
          <input
            type="month"
            className="field"
            style={{ width: 'auto' }}
            aria-label="기준 월"
            value={anchorMonth}
            onChange={(e) => { if (e.target.value) { setAnchorMonth(e.target.value); setRangeMode('month'); } }}
          />
        </div>

        {/* 최근 N일 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
          {DAY_CHIPS.map((c) => (
            <Chip
              key={c.days}
              active={rangeMode === 'days' && activeDays === c.days}
              onClick={() => { setActiveDays(c.days); setRangeMode('days'); }}
            >{c.label}</Chip>
          ))}
        </div>

        {/* 기준 월 앞뒤 3개월씩. 누르면 그 달이 새 기준이 되어 줄이 다시 그려진다. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
          {monthChips(anchorMonth).map((c) => (
            <Chip
              key={c.month}
              active={rangeMode === 'month' && c.month === anchorMonth}
              onClick={() => { setAnchorMonth(c.month); setRangeMode('month'); }}
            >{c.label}</Chip>
          ))}
        </div>
      </div>

      {/* 테이블 */}
      <div ref={tableCardRef} className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="hidden md:block" style={{ overflowX: 'auto' }}>
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

        {/* 모바일 리스트 */}
        <div className="md:hidden">
          {isLoading ? (
            <div style={tdEmpty}>불러오는 중...</div>
          ) : pageRows.length === 0 ? (
            <div style={tdEmpty}>조건에 맞는 거래 내역이 없습니다.</div>
          ) : pageRows.map((tx) => (
            <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--card-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.name}</span>
                  <span className="badge" style={{ flexShrink: 0, background: tx.type === 'income' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)', color: tx.type === 'income' ? 'var(--income)' : 'var(--expense)' }}>{TYPE_LABEL[tx.type]}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tx.date.replace(/-/g, '.')} · {tx.cat}{tx.payment ? ` · ${tx.payment}` : ''}
                </div>
              </div>
              <div className="font-mono" style={{ fontWeight: 700, fontSize: '0.9rem', color: tx.type === 'income' ? 'var(--income)' : 'var(--expense)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {tx.type === 'income' ? '+' : '-'}{fmtFull(tx.amount)}
              </div>
              <button onClick={() => delMut.mutate(tx.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '0.85rem', flexShrink: 0, padding: 4 }}>✕</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--card-border)' }}>
          <small style={{ color: 'var(--text-3)' }}>{filtered.length ? `${filtered.length}건 중 ${offset + 1}–${Math.min(offset + pageSize, filtered.length)}` : '0건'}</small>
          <div style={{ display: 'flex', gap: 4 }}>
            {/* 목록과 같은 safePage 를 쓴다 — page 를 그대로 쓰면 목록은 1페이지인데
                버튼은 5페이지가 눌린 것처럼 보인다. */}
            <PageBtn label="‹" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} />
            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, safePage - 3), Math.max(0, safePage - 3) + 5).map((i) => (
              <PageBtn key={i} label={String(i)} active={i === safePage} onClick={() => setPage(i)} />
            ))}
            <PageBtn label="›" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} />
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
