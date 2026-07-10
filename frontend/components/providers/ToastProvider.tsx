'use client';

import { createContext, useCallback, useContext, useState } from 'react';

type ToastType = 'success' | 'error' | 'warning' | '';
interface ToastState {
  msg: string;
  type: ToastType;
  show: boolean;
}

const ToastContext = createContext<(msg: string, type?: ToastType) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const TONE: Record<string, { bg: string; border: string; color: string }> = {
  success: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.35)', color: '#10b981' },
  error: { bg: 'rgba(244,63,94,0.15)', border: 'rgba(244,63,94,0.35)', color: '#f43f5e' },
  warning: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.35)', color: '#f59e0b' },
  '': { bg: 'var(--card-bg)', border: 'var(--card-border)', color: 'var(--text)' },
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ msg: '', type: '', show: false });

  const showToast = useCallback((msg: string, type: ToastType = '') => {
    setToast({ msg, type, show: true });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  }, []);

  const tone = TONE[toast.type];

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 76,
          right: 20,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '11px 16px',
          borderRadius: 12,
          border: `1px solid ${tone.border}`,
          background: tone.bg,
          color: tone.color,
          fontSize: '0.83rem',
          fontWeight: 600,
          boxShadow: '0 12px 32px rgba(0,0,0,0.3)',
          transition: 'all 0.2s',
          transform: toast.show ? 'translateY(0)' : 'translateY(8px)',
          opacity: toast.show ? 1 : 0,
          pointerEvents: toast.show ? 'auto' : 'none',
        }}
      >
        {toast.msg}
      </div>
    </ToastContext.Provider>
  );
}
