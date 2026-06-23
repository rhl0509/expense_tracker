export function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100000000) return (abs / 100000000).toFixed(1).replace('.0', '') + '억원';
  if (abs >= 10000) return (abs / 10000).toFixed(1).replace('.0', '') + '만원';
  return abs.toLocaleString() + '원';
}

export function fmtFull(n: number): string {
  return Math.abs(n).toLocaleString() + '원';
}

export function fmtDate(s: string): string {
  return s?.replace(/-/g, '.') ?? '';
}

export function fmtMonthDay(s: string): string {
  const parts = s?.split('-');
  if (!parts || parts.length < 3) return s;
  return `${parts[1]}/${parts[2]}`;
}

export function currentYearMonth(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** 오늘 날짜 YYYY-MM-DD (로컬 타임존 기준) */
export function todayStr(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** 입력 문자열에 천단위 콤마 삽입 (숫자만 유지) */
export function commaInput(raw: string): string {
  const v = raw.replace(/[^0-9]/g, '');
  return v.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1,234" → 1234 */
export function unComma(raw: string): number {
  return parseInt(raw.replace(/,/g, ''), 10) || 0;
}

export function getMonthName(m: number): string {
  return `${m}월`;
}

export const CATEGORY_ICONS: Record<string, string> = {
  식비: '🍽',
  교통: '🚌',
  쇼핑: '🛍',
  문화: '🎬',
  의료: '💊',
  통신: '📱',
  교육: '📚',
  경조사: '🎁',
  기타: '💳',
  급여: '💰',
  용돈: '💵',
  부업: '🔧',
  투자: '📈',
  저축: '🏦',
};

export const CATEGORY_COLORS: Record<string, string> = {
  식비: '#ff6b6b',
  교통: '#4ecdc4',
  쇼핑: '#a78bfa',
  문화: '#34d399',
  의료: '#f87171',
  통신: '#38bdf8',
  교육: '#fbbf24',
  경조사: '#f472b6',
  기타: '#9ca3af',
  급여: '#10b981',
  용돈: '#3b82f6',
  부업: '#f59e0b',
  투자: '#6366f1',
  저축: '#06b6d4',
};

const CHART_PALETTE = [
  '#c6f24e', '#38bdf8', '#a78bfa', '#f472b6',
  '#34d399', '#fbbf24', '#f87171', '#4ade80',
  '#fb923c', '#60a5fa', '#e879f9', '#2dd4bf',
];

export function categoryColor(name: string, idx = 0): string {
  return CATEGORY_COLORS[name] ?? CHART_PALETTE[idx % CHART_PALETTE.length];
}
