'use client';

import ModalRobotIcon from '@/components/ModalRobotIcon';

interface Props {
  open: boolean;
  variant?: 'success' | 'error';
  title: string;
  message: React.ReactNode;
  onClose: () => void;
}

export default function NoticeModal({ open, variant = 'success', title, message, onClose }: Props) {
  if (!open) return null;
  const accent = variant === 'success' ? 'var(--success)' : 'var(--danger)';

  return (
    <div className="overlay" style={{ zIndex: 2000 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal"
        style={{ maxWidth: 340, textAlign: 'center', padding: '28px 24px 22px' }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <ModalRobotIcon badge={variant === 'success' ? '✓' : '✕'} accent={accent} />
        <h3 style={{ margin: message ? '0 0 6px' : '0 0 20px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
        {message ? (
          <p style={{ margin: '0 0 20px', fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-2)' }}>{message}</p>
        ) : null}
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose} autoFocus>
          확인
        </button>
      </div>
    </div>
  );
}
