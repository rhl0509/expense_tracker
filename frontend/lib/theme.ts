// 모바일 주소창/상태바 색. globals.css의 --body-bg와 같은 값을 유지한다.
export const THEME_COLORS = { dark: '#0d0f12', light: '#f4f5f7' } as const;

export type ThemeName = keyof typeof THEME_COLORS;
