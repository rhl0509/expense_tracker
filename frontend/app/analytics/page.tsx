'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js';
import { getMonthlySummary, getCategoryChart, getPaymentSummary } from '@/lib/api';
import { fmt } from '@/lib/utils';
import { useChartTheme, foldTop } from '@/lib/chartTheme';
import type { MonthlySummary, CategoryChart } from '@/lib/types';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
// 막대는 바닥(0)에 붙어 있으므로 윗면만 둥글게 한다.
const BAR_RADIUS = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };

export default function AnalyticsPage() {
  const theme = useChartTheme();
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);

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

  // 10조각을 그리면 인접 조각이 뭉개진다. 상위 5 + '그 외'로 접는다.
  const exCat = foldTop((catChart as CategoryChart[]).filter((c) => c.type === 'expense'), theme);
  const inCat = foldTop((catChart as CategoryChart[]).filter((c) => c.type === 'income'), theme);
  const payCat = foldTop(payment.map((p) => ({ label: p.payment_method || '기타', value: p.total })), theme);

  // 색은 전부 해석된 실제 값이어야 한다. 'var(--text-2)' 를 넘기면 Chart.js 의 색 파서가
  // 파싱에 실패하고 조용히 기본값으로 떨어진다(테마를 안 따라간다).
  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const, labels: { color: theme.inkLegend, font: { size: 11 }, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, padding: 14 } } },
    scales: {
      x: { grid: { display: false }, border: { color: theme.grid }, ticks: { color: theme.ink, font: { size: 10 } } },
      y: {
        grid: { color: theme.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: theme.ink, font: { size: 10 }, padding: 8, maxTicksLimit: 5, callback: (v: unknown) => fmt(v as number) },
      },
    },
  };
  const donutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '64%',
    plugins: { legend: { position: 'right' as const, labels: { color: theme.inkLegend, font: { size: 11 }, boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, padding: 10 } } },
  };
  // 조각을 가르는 건 테두리가 아니라 표면색 2px 간격이다.
  const donutSet = (slices: { label: string; value: number; color: string }[]) => ({
    labels: slices.map((s) => s.label),
    datasets: [{ data: slices.map((s) => s.value), backgroundColor: slices.map((s) => s.color), borderColor: theme.surface, borderWidth: 2 }],
  });
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

      {/* 월별 추이·카테고리·결제수단을 한 페이지에 펼친다. 위의 연도 버튼 하나가
          세 섹션 전부를 같은 기간으로 스코프한다(필터는 한 줄에 모으고, 그 아래
          모든 차트가 같은 조각을 그린다). */}
      <div style={{ marginBottom: 14 }}>
        <div className="card" style={{ padding: 22 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>{year}년 월별 수입·지출·저축·투자</div>
          <div style={{ height: 320 }}>
            <Bar
              data={{
                labels: MONTHS,
                // 수입/지출은 앱 전체의 도메인 색을 쓴다(전엔 수입이 파스텔 파랑이라
                // 같은 개념에 색이 둘이었다). 저축·투자는 도메인 신호가 아니라
                // 카테고리라 검증된 series 슬롯을 쓴다.
                datasets: [
                  { label: '수입', data: series.income, backgroundColor: theme.income, borderRadius: BAR_RADIUS },
                  { label: '지출', data: series.expense, backgroundColor: theme.expense, borderRadius: BAR_RADIUS },
                  { label: '저축', data: series.saving, backgroundColor: theme.series[0], borderRadius: BAR_RADIUS },
                  { label: '투자', data: series.invest, backgroundColor: theme.series[2], borderRadius: BAR_RADIUS },
                ],
              }}
              options={opts}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, marginBottom: 14 }} className="grid-cols-1 md:grid-cols-2">
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>지출 카테고리</div>
            {exCat.length ? <div style={{ height: 260 }}><Doughnut data={donutSet(exCat)} options={donutOpts} /></div> : <Empty />}
          </div>
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>수입 카테고리</div>
            {/* 전엔 파란색 명도 램프(#3b82f6→#bfdbfe)를 썼다. 순서 없는 이름 카테고리에
                밝기 램프를 쓰면 크기를 색으로 이중 부호화하고, 인접 단계가 뭉개진다. */}
            {inCat.length ? <div style={{ height: 260 }}><Doughnut data={donutSet(inCat)} options={donutOpts} /></div> : <Empty />}
          </div>
      </div>

      <div style={{ display: 'grid', gap: 14 }} className="grid-cols-1 md:grid-cols-2">
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>결제수단별 비중</div>
            {payCat.length ? <div style={{ height: 260 }}><Doughnut data={donutSet(payCat)} options={donutOpts} /></div> : <Empty />}
          </div>
          <div className="card" style={{ padding: 22 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>결제수단 합계</div>
            {/* 도넛과 같은 색 점을 달아 둘을 잇는다. 금액은 값 자체지 지출 신호가
                아니므로 --expense 빨강이 아니라 본문 색으로 둔다. */}
            {payCat.map((p, i) => (
              <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: i < payCat.length - 1 ? '1px solid var(--card-border)' : 'none' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text)', flex: 1 }}>{p.label}</span>
                <span className="font-mono" style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmt(p.value)}</span>
              </div>
            ))}
          </div>
      </div>
    </>
  );
}

function Empty() {
  return <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>데이터가 없습니다.</div>;
}
