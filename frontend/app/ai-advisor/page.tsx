'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { getMonthlySummary, getCategoryChart, getRecent, aiAnalyze, aiChat } from '@/lib/api';
import { fmt } from '@/lib/utils';
import { useChartTheme } from '@/lib/chartTheme';
import type { MonthlySummary, CategoryChart } from '@/lib/types';

const EXCLUDE = ['저축', '투자'];
const QUICK = ['이번 달 지출을 어떻게 줄일 수 있을까?', '저축률을 높이려면?', '다음 달 예산을 추천해줘'];

interface FinCtx {
  month: number; income: number; expense: number; saving: number; surplus: number;
  expenseChange: string | null; categories: CategoryChart[]; savingRate: string;
}
interface ChatMsg { role: 'user' | 'assistant'; content: string; }

export default function AiAdvisorPage() {
  const theme = useChartTheme();
  const year = new Date().getFullYear();
  const { data: monthly = [] } = useQuery({ queryKey: ['monthly-summary', year], queryFn: () => getMonthlySummary(year) });
  const { data: catChart = [] } = useQuery({ queryKey: ['category-chart'], queryFn: () => getCategoryChart() });
  useQuery({ queryKey: ['recent', 20], queryFn: () => getRecent(20) });

  const ctx = useMemo<FinCtx | null>(() => {
    if (!monthly.length && !catChart.length) return null;
    const m = new Date().getMonth() + 1;
    const lastM = m === 1 ? 12 : m - 1;
    const inc = (mo: number, type: 'income' | 'expense', kw?: string, excl = false) =>
      (monthly as MonthlySummary[])
        .filter((d) => {
          if (d.month !== mo || d.type !== type) return false;
          if (kw) return !!d.category_name && d.category_name.includes(kw);
          if (excl) return !EXCLUDE.some((c) => d.category_name?.includes(c));
          return true;
        })
        .reduce((s, d) => s + Math.floor(d.total), 0);
    const income = inc(m, 'income');
    const expense = inc(m, 'expense', undefined, true);
    const saving = inc(m, 'expense', '저축');
    const prevExp = inc(lastM, 'expense', undefined, true);
    return {
      month: m, income, expense, saving, surplus: income - expense - saving,
      expenseChange: prevExp > 0 ? (((expense - prevExp) / prevExp) * 100).toFixed(1) : null,
      categories: (catChart as CategoryChart[]).filter((d) => d.type === 'expense'),
      savingRate: income > 0 ? ((saving / income) * 100).toFixed(1) : '0',
    };
  }, [monthly, catChart]);

  // ── AI 분석 (사용자가 눌러야 실행) ──
  // 화면에 들어오기만 해도 자동 호출하지 않는다. AI 키는 BYOK라 호출 비용이 사용자
  // 지갑에서 나가고, 페이지 진입은 "분석해 달라"는 의사 표시가 아니다.
  // 프롬프트·재정 컨텍스트는 서버가 세션의 가구로 직접 조립한다.
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);

  async function runAnalysis() {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzed(true);
    setAnalysis('');
    try {
      await aiAnalyze((chunk) => setAnalysis((a) => a + chunk));
    } catch (e) {
      setAnalysis(`⚠️ AI 분석 중 오류가 발생했습니다: ${(e as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  }

  // ── 챗봇 ──
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  async function send(text: string) {
    if (!text.trim() || sending) return;
    const history = [...messages, { role: 'user' as const, content: text.trim() }];
    setMessages(history);
    setInput('');
    setSending(true);
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);
    try {
      await aiChat(history, (chunk) =>
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: copy[copy.length - 1].content + chunk };
          return copy;
        }),
      );
    } catch (e) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: `⚠️ 오류가 발생했습니다: ${(e as Error).message}` };
        return copy;
      });
    } finally {
      setSending(false);
    }
  }

  // ── 경고 ──
  const alerts: { danger: boolean; msg: string }[] = [];
  if (ctx && ctx.income > 0) {
    if (ctx.expense > ctx.income * 0.9) alerts.push({ danger: true, msg: `이번달 지출이 수입의 ${((ctx.expense / ctx.income) * 100).toFixed(0)}%에 달합니다. 지출을 줄여보세요!` });
    else if (ctx.expense > ctx.income * 0.7) alerts.push({ danger: false, msg: `지출이 수입의 ${((ctx.expense / ctx.income) * 100).toFixed(0)}%입니다. 절약을 고려해보세요.` });
  }
  if (ctx && ctx.expenseChange !== null && parseFloat(ctx.expenseChange) > 20) alerts.push({ danger: false, msg: `지난달보다 지출이 ${ctx.expenseChange}% 증가했습니다.` });

  const trendMax = ctx ? Math.max(...ctx.categories.map((c) => c.value), 1) : 1;

  return (
    <>
      <h1 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>AI 재무 어드바이저</h1>

      {/* 인사이트 카드 */}
      <div style={{ display: 'grid', gap: 12, marginBottom: 14 }} className="grid-cols-1 md:grid-cols-3">
        <Insight label="이번달 잉여금" value={ctx ? fmt(Math.max(ctx.surplus, 0)) : '—'} sub={ctx ? `저축률 ${ctx.savingRate}%` : ''} />
        <Insight label="전달 대비 지출" value={ctx ? fmt(ctx.expense) : '—'} sub={ctx?.expenseChange != null ? (Number(ctx.expenseChange) >= 0 ? `▲ ${ctx.expenseChange}%` : `▼ ${Math.abs(Number(ctx.expenseChange))}%`) : '비교 없음'} subColor={ctx?.expenseChange != null && Number(ctx.expenseChange) > 0 ? 'var(--expense)' : 'var(--income)'} />
        <Insight label="이번달 저축" value={ctx ? fmt(ctx.saving) : '—'} sub={ctx ? `수입의 ${ctx.savingRate}%` : ''} />
      </div>

      {/* 경고 배너 */}
      {alerts.map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 12, padding: '12px 16px', marginBottom: 10, fontSize: '0.85rem',
          background: a.danger ? 'rgba(244,63,94,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${a.danger ? 'rgba(244,63,94,0.3)' : 'rgba(245,158,11,0.3)'}`, color: a.danger ? 'var(--expense)' : '#d97706' }}>
          <span style={{ fontSize: '1.1rem' }}>{a.danger ? '⛔' : '⚠️'}</span>{a.msg}
        </div>
      ))}

      <div style={{ display: 'grid', gap: 14, marginBottom: 14 }} className="grid-cols-1 lg:grid-cols-2">
        {/* AI 분석 */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>✦ AI 분석 리포트</div>
            <button className="btn btn-ghost btn-sm" onClick={runAnalysis} disabled={analyzing}>
              {analyzing ? '분석 중…' : analyzed ? '다시 분석' : '분석 실행'}
            </button>
          </div>
          <div className="md" style={{ minHeight: 180, borderRadius: 12, background: 'var(--hover-bg)', padding: 16, fontSize: '0.88rem', lineHeight: 1.7, color: 'var(--text)' }}>
            {analyzing && !analysis ? (
              <span style={{ color: 'var(--text-3)' }}>AI가 분석 중입니다…</span>
            ) : analysis ? (
              <ReactMarkdown>{analysis}</ReactMarkdown>
            ) : (
              <span style={{ color: 'var(--text-3)' }}>
                「분석 실행」을 누르면 이번 달 데이터를 AI가 분석합니다. 등록하신 API 키로 호출되며 사용량이 발생합니다.
              </span>
            )}
          </div>
        </div>

        {/* 카테고리 트렌드 */}
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>카테고리 지출 트렌드</div>
          {ctx && ctx.categories.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ctx.categories.slice(0, 6).map((c) => (
                <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 64, fontSize: '0.78rem', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</div>
                  <div style={{ flex: 1, height: 16, borderRadius: 5, overflow: 'hidden', background: 'var(--hover-bg)' }}>
                    {/* 한 시리즈(카테고리별 지출)라 막대는 전부 한 색이다. 막대마다
                        색을 달리하면 길이가 이미 보여주는 크기를 색으로 또 부호화하고,
                        색이 아무 의미도 없는데 의미가 있는 것처럼 읽힌다. */}
                    <div style={{ height: '100%', width: `${((c.value / trendMax) * 100).toFixed(1)}%`, background: theme.series[0], borderRadius: 5 }} />
                  </div>
                  <div className="font-mono" style={{ width: 64, textAlign: 'right', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text)' }}>{fmt(c.value)}</div>
                </div>
              ))}
            </div>
          ) : <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>데이터 없음</div>}
        </div>
      </div>

      {/* 챗봇 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--card-border)', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>💬 AI 어드바이저와 대화</div>
        <div style={{ maxHeight: 380, minHeight: 200, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {QUICK.map((q) => <button key={q} className="btn btn-ghost btn-sm" onClick={() => send(q)}>{q}</button>)}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', background: m.role === 'user' ? 'var(--accent)' : 'rgba(99,102,241,0.2)', color: m.role === 'user' ? 'var(--text-inv)' : '#818cf8' }}>{m.role === 'user' ? '나' : 'AI'}</div>
              <div className="md" style={{ maxWidth: '76%', padding: '10px 14px', borderRadius: 14, fontSize: '0.86rem', lineHeight: 1.6, background: m.role === 'user' ? 'var(--accent)' : 'var(--hover-bg)', color: m.role === 'user' ? 'var(--text-inv)' : 'var(--text)' }}>
                {m.role === 'assistant' ? (m.content ? <ReactMarkdown>{m.content}</ReactMarkdown> : <span style={{ color: 'var(--text-3)' }}>…</span>) : m.content}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--card-border)' }}>
          <input className="field" placeholder="재정 관련 질문을 입력하세요…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(input)} disabled={sending} />
          <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={() => send(input)} disabled={sending || !input.trim()}>전송</button>
        </div>
      </div>

      <style>{`.md > :first-child{margin-top:0}.md > :last-child{margin-bottom:0}.md p{margin:0 0 8px}.md ul,.md ol{margin:0 0 8px;padding-left:18px}.md h1,.md h2,.md h3{font-size:0.95rem;margin:10px 0 6px}.md strong{font-weight:700}`}</style>
    </>
  );
}

function Insight({ label, value, sub, subColor }: { label: string; value: string; sub: string; subColor?: string }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginBottom: 6 }}>{label}</div>
      <div className="font-mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: '0.74rem', fontWeight: 600, color: subColor ?? 'var(--text-3)' }}>{sub}</div>
    </div>
  );
}
