export interface User {
  user_no: number;
  user_id: string;
  user_name: string;
  account_book_id: number | null;
}

export interface Book {
  id: number;
  title: string;
  role: 'owner' | 'member';
}

export interface BookMember {
  member_id: number;
  role: 'owner' | 'member';
  user_id: string;
  name: string;
}

export interface Invite {
  id: number;
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string | null;
  created_at: string;
  accepted_by_name: string | null;
}

export interface Transaction {
  id: number;
  transaction_date?: string;
  date?: string; // /transaction/list 는 date 별칭으로 반환
  type: 'income' | 'expense';
  amount: number;
  title: string;
  memo?: string;
  payment_method: string;
  user: string;
  category_name: string | null;
}

export interface Category {
  id: number;
  name: string;
  type: 'income' | 'expense';
  parent_id: number | null;
  sort_order?: number;
}

export interface Summary {
  income: number;
  expense: number;
}

export interface CategoryChart {
  label: string;
  value: number;
  type: 'income' | 'expense';
}

export interface CategorySummary {
  category_name: string;
  total_amount: number;
  type: 'income' | 'expense';
}

export interface PaymentSummary {
  payment_method: string;
  total: number;
}

export interface MonthlySummary {
  month: number;
  category_name: string | null;
  type: 'income' | 'expense';
  total: number;
}

export interface RecurringTransaction {
  id: number;
  account_book_id: number;
  category_id: number | null;
  category_name: string | null;
  title: string;
  type: 'income' | 'expense';
  repeat_day: number;
  user: string;
  amount: number;
  created_at: string;
  last_processed_month: string | null;
}

export interface AddTransactionPayload {
  type: 'income' | 'expense';
  category_id?: number | string;
  amount: number;
  description: string;
  memo?: string;
  payment_method?: string;
  user?: string;
  date?: string;
}
