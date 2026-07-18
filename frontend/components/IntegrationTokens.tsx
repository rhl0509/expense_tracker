'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIntegrationTokens, createIntegrationToken, revokeIntegrationToken,
  type IntegrationToken,
} from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';

export default function IntegrationTokens() {
  const qc = useQueryClient();
  const toast = useToast();
  const tokensQ = useQuery({ queryKey: ['integration-tokens'], queryFn: getIntegrationTokens });
  const tokens = tokensQ.data?.tokens ?? [];

  const [label, setLabel] = useState('');
  // 발급 직후 평문 토큰. 이 응답에서만 볼 수 있어 화면에 한 번 강조해 보여준다.
  const [issued, setIssued] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<IntegrationToken | null>(null);

  const createMut = useMutation({
    mutationFn: () => createIntegrationToken(label.trim() || 'stock-app'),
    onSuccess: (r) => {
      setIssued(r.token);
      setLabel('');
      qc.invalidateQueries({ queryKey: ['integration-tokens'] });
    },
    onError: (e) => toast((e as Error).message || '발급에 실패했습니다.', 'error'),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => revokeIntegrationToken(id),
    onSuccess: () => {
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ['integration-tokens'] });
      toast('토큰을 취소했습니다.', 'success');
    },
    onError: (e) => toast((e as Error).message || '취소에 실패했습니다.', 'error'),
  });

  async function copy() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued); toast('복사했습니다.', 'success'); }
    catch { toast('복사에 실패했습니다. 직접 선택해 복사하세요.', 'error'); }
  }

  const active = tokens.filter((t) => t.enabled);

  return (
    <>
      <div className="card" style={{ padding: 18 }}>
        <div style={sectionTitle}>주식 앱 연동</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.6 }}>
          주식 앱의 매매·배당을 이 가계부에 자동으로 기록합니다. 토큰을 발급해 주식 앱 설정에
          붙여넣으면 연동됩니다. <b>토큰은 이 장부에만</b> 기록할 수 있고, 다른 작업(로그인·삭제)에는
          쓸 수 없습니다.
        </div>

        {/* 발급 직후 평문 — 다시 볼 수 없다 */}
        {issued && (
          <div style={issuedBox} role="alert">
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--income)', marginBottom: 6 }}>
              ✓ 발급되었습니다 — 지금만 표시됩니다. 주식 앱에 저장하세요.
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="field font-mono" readOnly value={issued} onFocus={(e) => e.target.select()}
                style={{ flex: 1, minWidth: 0, fontSize: '0.78rem' }} />
              <button className="btn btn-primary btn-sm" onClick={copy} style={{ flexShrink: 0 }}>복사</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setIssued(null)} style={{ flexShrink: 0 }}>닫기</button>
            </div>
          </div>
        )}

        {/* 발급 폼 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: active.length ? 14 : 0 }}>
          <input className="field" placeholder="토큰 이름 (예: 내 데스크탑 주식앱)" value={label}
            onChange={(e) => setLabel(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <button className="btn btn-primary btn-sm" onClick={() => createMut.mutate()}
            disabled={createMut.isPending} style={{ flexShrink: 0 }}>
            {createMut.isPending ? '발급 중…' : '토큰 발급'}
          </button>
        </div>

        {/* 활성 토큰 목록 */}
        {tokensQ.isLoading ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>불러오는 중…</div>
        ) : active.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {active.map((t) => (
              <div key={t.id} style={rowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 1 }}>
                    {t.last_used_at ? `마지막 사용 ${fmtDate(t.last_used_at)}` : '아직 사용 안 함'}
                    {t.expires_at && ` · 만료 ${fmtDate(t.expires_at)}`}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--expense)', flexShrink: 0 }}
                  onClick={() => setRevoking(t)}>취소</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={revoking !== null}
        variant="danger"
        icon="🔌"
        title="이 토큰을 취소할까요?"
        message={<>「{revoking?.label}」 토큰이 즉시 끊깁니다.<br />주식 앱에서 그 토큰으로는 더 이상 기록되지 않습니다.<br />이미 기록된 거래는 남습니다.</>}
        confirmText="토큰 취소"
        onConfirm={() => revoking && revokeMut.mutate(revoking.id)}
        onCancel={() => setRevoking(null)}
      />
    </>
  );
}

// ISO 문자열(백엔드가 timespec 없이 내려줄 수 있음)을 YYYY-MM-DD 로. 파싱 실패 시 앞 10자.
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toISOString().slice(0, 10);
}

const sectionTitle: React.CSSProperties = { fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10,
  border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '9px 12px',
};
const issuedBox: React.CSSProperties = {
  borderRadius: 10, border: '1px solid var(--income)', background: 'rgba(16,185,129,0.08)',
  padding: '10px 12px', marginBottom: 14,
};
