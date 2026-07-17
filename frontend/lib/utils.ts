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

