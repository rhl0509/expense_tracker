import type {
  User, Transaction, Category, Summary, CategoryChart,
  CategorySummary, PaymentSummary, MonthlySummary,
  RecurringTransaction, AddTransactionPayload,
} from './types';

export const API_BASE = 'http://localhost:5000';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────
export const getMe = () => req<User>('/auth/me');

export const login = (user_id: string, password: string) =>
  req<{ message: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user_id, password }),
  });

export const register = (data: { user_id: string; password: string; name: string; email: string }) =>
  req<{ message: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const logout = () => fetch(`${API_BASE}/auth/logout`, { credentials: 'include' });

// ── Transactions ──────────────────────────────────────────────────────
export const getTransactions = () => req<Transaction[]>('/transaction/data');
export const getSummary = () => req<Summary>('/transaction/summary');
export const getYearlySummary = () => req<Summary>('/transaction/yearly-summary');
export const getCategoryChart = () => req<CategoryChart[]>('/transaction/category-chart');
export const getCategorySummary = () => req<CategorySummary[]>('/transaction/category-summary');
export const getPaymentSummary = () => req<PaymentSummary[]>('/transaction/payment-summary');
export const getMonthlySummary = (year: number) =>
  req<MonthlySummary[]>(`/transaction/monthly-summary?year=${year}`);

export const getRecent = (limit = 10) =>
  req<Transaction[]>(`/transaction/recent?limit=${limit}`);

export const getList = (year?: number, month?: number) => {
  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (month) params.set('month', String(month));
  const qs = params.toString();
  return req<Transaction[]>(`/transaction/list${qs ? `?${qs}` : ''}`);
};

export const addTransaction = (data: AddTransactionPayload) =>
  req<{ message: string }>('/transaction/add', { method: 'POST', body: JSON.stringify(data) });

export const deleteTransaction = (id: number) =>
  req<{ message: string }>(`/transaction/delete/${id}`, { method: 'DELETE' });

export const resetData = () =>
  req<{ message: string }>('/transaction/reset', { method: 'POST' });

export const exportCsv = () =>
  fetch(`${API_BASE}/transaction/export`, { credentials: 'include' });

// ── Categories ────────────────────────────────────────────────────────
export const getCategories = () => req<Category[]>('/transaction/categories');

export const addCategory = (data: { name: string; type: string; parent_id?: number | null }) =>
  req<{ message: string }>('/transaction/category/add', { method: 'POST', body: JSON.stringify(data) });

export const deleteCategory = (id: number) =>
  req<{ message: string }>(`/transaction/category/delete/${id}`, { method: 'DELETE' });

export const reorderCategories = (type: string, ids: number[]) =>
  req<{ message: string }>('/transaction/category/reorder', { method: 'POST', body: JSON.stringify({ type, ids }) });

// ── Settings (서버 저장: 사용자 라벨 / 결제수단) ────────────────────────
export const getUserLabels = () => req<string[]>('/transaction/settings/user-labels');
export const saveUserLabels = (labels: string[]) =>
  req<{ message: string; labels: string[] }>('/transaction/settings/user-labels', {
    method: 'POST', body: JSON.stringify({ labels }),
  });

export const getPaymentMethods = () => req<string[]>('/transaction/settings/payment-methods');
export const savePaymentMethods = (methods: string[]) =>
  req<{ message: string; methods: string[] }>('/transaction/settings/payment-methods', {
    method: 'POST', body: JSON.stringify({ methods }),
  });

// ── Recurring ─────────────────────────────────────────────────────────
export const getRecurring = () => req<RecurringTransaction[]>('/transaction/recurring/list');

export const addRecurring = (data: {
  category_id: number | null;
  title: string;
  type: string;
  repeat_day: number;
  user: string;
  amount: number;
}) => req<{ message: string }>('/transaction/recurring/add', { method: 'POST', body: JSON.stringify(data) });

export const deleteRecurring = (id: number) =>
  req<{ message: string }>(`/transaction/recurring/delete/${id}`, { method: 'DELETE' });

export const processRecurring = () =>
  req<{ status: string; processed: number }>('/transaction/process-recurring', { method: 'POST' });

// ── AI ────────────────────────────────────────────────────────────────
export const streamAgent = (message: string): Promise<Response> =>
  fetch(`${API_BASE}/ai/agent`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

/** text/plain 스트림을 onChunk로 흘려보낸다. (AI analyze/chat 공용) */
export async function streamText(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`스트림 요청 실패 (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

export const aiAnalyze = (prompt: string, onChunk: (t: string) => void, signal?: AbortSignal) =>
  streamText('/ai/analyze', { prompt }, onChunk, signal);

export const aiChat = (
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  onChunk: (t: string) => void,
  signal?: AbortSignal,
) => streamText('/ai/chat', { system, messages }, onChunk, signal);
