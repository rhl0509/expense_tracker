'use client';

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
  const iconBg = variant === 'danger' ? 'rgba(244,63,94,0.12)' : 'rgba(245,158,11,0.12)';

  return (
    <div className="overlay" style={{ zIndex: 2000 }} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" style={{ maxWidth: 340, textAlign: 'center', padding: '28px 24px 22px' }} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            margin: '0 auto 14px',
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            fontSize: '1.4rem',
            background: iconBg,
            border: `1px solid ${accent}55`,
          }}
        >
          {icon ?? (variant === 'danger' ? '⚠' : '⚠')}
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
        <p style={{ margin: '0 0 20px', fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-2)' }}>{message}</p>
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
