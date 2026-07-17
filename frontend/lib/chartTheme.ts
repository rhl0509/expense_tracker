'use client';

import { useSyncExternalStore } from 'react';

/**
 * 차트 색은 CSS 변수를 그대로 넘길 수 없다.
 * Chart.js 의 색 파서(@kurkle/color)는 `var(--text-3)` 를 파싱하지 못하고(valid:false)
 * 조용히 기본값으로 떨어진다 — 그래서 지금까지 축·눈금·그리드가 테마를 안 따라갔다.
 * 여기서 실제 값으로 해석해서 넘긴다.
 */

// dataviz 레퍼런스 카테고리 팔레트에서 **초록·빨강을 뺀** 6슬롯.
// 이 앱은 초록=수입 / 빨강=지출이 도메인 신호라, 그 색을 지출 카테고리에 쓰면
// 지출 항목이 수입처럼 읽힌다(status 색을 series 로 쓰지 않는다).
// 앱 표면색(다크 카드 #13151a / 라이트 카드 #ffffff)으로 검증기 전 항목 통과:
//   다크  최악 인접 CVD ΔE 8.4 / 정상시력 19.3 / 대비 전부 3:1 이상
//   라이트 최악 인접 CVD ΔE 9.1 / 정상시력 19.6 (3색은 3:1 미만 → 도넛 옆 직접 라벨로 보완)
const SERIES = {
  light: ['#2a78d6', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7'],
  dark: ['#3987e5', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9'],
} as const;

// "그 외"는 카테고리가 아니라 꼬리를 접은 것이므로 채도 없는 회색이 맞다.
const OTHER = { light: '#9ca3af', dark: '#6b7280' } as const;

export type ChartTheme = {
  mode: 'light' | 'dark';
  series: readonly string[];
  other: string;
  surface: string;   // 세그먼트 사이 2px 간격용 — 테두리가 아니라 표면색이다
  ink: string;       // 축 눈금
  inkLegend: string; // 범례
  grid: string;
  income: string;
  expense: string;
};

const FALLBACK: ChartTheme = {
  mode: 'dark',
  series: SERIES.dark,
  other: OTHER.dark,
  surface: '#13151a',
  ink: '#606570',
  inkLegend: '#9aa0ab',
  grid: 'rgba(255,255,255,0.06)',
  income: '#10b981',
  expense: '#f43f5e',
};

function read(): ChartTheme {
  const root = document.documentElement;
  const mode = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const cs = getComputedStyle(root);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    mode,
    series: SERIES[mode],
    other: OTHER[mode],
    surface: v('--card-bg', mode === 'light' ? '#ffffff' : '#13151a'),
    ink: v('--text-3', FALLBACK.ink),
    inkLegend: v('--text-2', FALLBACK.inkLegend),
    grid: v('--card-border', FALLBACK.grid),
    income: v('--income', FALLBACK.income),
    expense: v('--expense', FALLBACK.expense),
  };
}

// 테마는 React 밖(문서의 data-theme 속성)에 있는 상태라 외부 저장소로 구독한다.
// getSnapshot 은 매번 같은 참조를 돌려줘야 한다 — read() 를 그대로 부르면 호출마다
// 새 객체라 무한 렌더가 된다. 그래서 캐시해두고 토글 때만 무효화한다.
let cache: ChartTheme | null = null;

function subscribe(onChange: () => void) {
  const ob = new MutationObserver(() => { cache = null; onChange(); });
  ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => ob.disconnect();
}

function getSnapshot(): ChartTheme {
  if (!cache) cache = read();
  return cache;
}

// 서버엔 DOM 이 없다. 어차피 AppShell 이 인증 확인 전엔 차트를 렌더하지 않는다.
const getServerSnapshot = () => FALLBACK;

/** 현재 테마의 차트 색. 테마 토글(data-theme 변경)에 맞춰 다시 읽는다. */
export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * 도넛/파이는 6조각까지다. 그 이상은 인접 조각이 뭉개져 읽히지 않는다.
 * 상위 n개만 두고 꼬리는 "그 외"로 접는다.
 * 라벨을 '기타'가 아니라 '그 외 N개'로 하는 이유: '기타'라는 실제 카테고리가 있어서
 * 그대로 쓰면 같은 이름이 두 개 나온다.
 */
export function foldTop<T extends { label: string; value: number }>(
  items: T[], theme: ChartTheme, n = 5,
): { label: string; value: number; color: string }[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, n).map((d, i) => ({ label: d.label, value: d.value, color: theme.series[i] }));
  const tail = sorted.slice(n);
  const rest = tail.reduce((s, d) => s + d.value, 0);
  return rest > 0
    ? [...head, { label: `그 외 ${tail.length}개`, value: rest, color: theme.other }]
    : head;
}
