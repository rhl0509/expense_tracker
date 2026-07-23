'use client';

import ModalRobotIcon from '@/components/ModalRobotIcon';

interface Props {
  open: boolean;
  variant?: 'danger' | 'warning';
  icon?: string;
  title: string;
  message: React.ReactNode;
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  variant = 'danger',
  icon,
  title,
  message,
  confirmText,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;
  const accent = variant === 'danger' ? '#f43f5e' : '#f59e0b';

  return (
    <div className="overlay" style={{ zIndex: 2000 }} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" style={{ maxWidth: 340, textAlign: 'center', padding: '28px 24px 22px' }} onClick={(e) => e.stopPropagation()}>
        <ModalRobotIcon badge={icon ?? '⚠'} accent={accent} />
        <h3 style={{ margin: message ? '0 0 6px' : '0 0 20px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
        {message ? (
          <p style={{ margin: '0 0 20px', fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-2)' }}>{message}</p>
        ) : null}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>취소</button>
          <button
            className="btn"
            style={{ flex: 1, background: accent, color: '#fff', fontWeight: 700 }}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
