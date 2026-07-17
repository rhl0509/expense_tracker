'use client';

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
  const iconBg = variant === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)';

  return (
    <div className="overlay" style={{ zIndex: 2000 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal"
        style={{ maxWidth: 340, textAlign: 'center', padding: '28px 24px 22px' }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
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
            color: accent,
            background: iconBg,
            border: `1px solid ${accent}`,
          }}
        >
          {variant === 'success' ? '✓' : '✕'}
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
        <p style={{ margin: '0 0 20px', fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-2)' }}>{message}</p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose} autoFocus>
          확인
        </button>
      </div>
    </div>
  );
}
