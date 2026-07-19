'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { resetData, getResetBatches, restoreResetBatch, type ResetBatch } from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';
import { SectionCard, rowStyle } from '@/components/my/Section';

export default function DangerZone() {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState<ResetBatch | null>(null);

  const batchesQ = useQuery({ queryKey: ['reset-batches'], queryFn: getResetBatches });
  const batches = batchesQ.data?.batches ?? [];

  const resetMut = useMutation({
    mutationFn: resetData,
    onSuccess: () => {
      setConfirming(false);
      // 거래 목록 등 전체 무효화(되돌리기 이력도 함께 갱신된다).
      qc.invalidateQueries();
      toast('데이터가 초기화되었습니다. 마이페이지에서 되돌릴 수 있습니다.', 'success');
      router.push('/dashboard');
    },
    onError: (e) => {
      setConfirming(false);
      toast((e as Error).message || '초기화에 실패했습니다.', 'error');
    },
  });

  const restoreMut = useMutation({
    mutationFn: (id: number) => restoreResetBatch(id),
    onSuccess: (r) => {
      setRestoring(null);
      qc.invalidateQueries();
      toast(`${r.restored}건을 되돌렸습니다.`, 'success');
    },
    onError: (e) => {
      setRestoring(null);
      toast((e as Error).message || '복원에 실패했습니다.', 'error');
    },
  });

  return (
    <>
      <SectionCard
        icon="alert"
        title="데이터 초기화"
        desc={<>지금 장부의 <b>모든 거래 내역</b>을 비웁니다. 영구 삭제가 아니라 보관함으로 옮기는 것이라, 아래에서 다시 되돌릴 수 있습니다.</>}
      >
        <button
          className="btn btn-danger"
          onClick={() => setConfirming(true)}
          disabled={resetMut.isPending}
        >
          {resetMut.isPending ? '초기화 중…' : '데이터 초기화'}
        </button>

        {/* 복원 가능한(미복원) 초기화 이력 */}
        {batches.length > 0 && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--card-border)', paddingTop: 14 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>
              되돌릴 수 있는 초기화
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {batches.map((b) => (
                <div key={b.id} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>{b.tx_count}건 보관됨</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 1 }}>{b.created_at} 초기화</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}
                    onClick={() => setRestoring(b)} disabled={restoreMut.isPending}>
                    되돌리기
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      <ConfirmModal
        open={confirming}
        variant="warning"
        icon="↺"
        title="데이터를 초기화 하시겠어요?"
        message={<>지금 장부의 모든 거래 내역이 보관함으로 이동합니다.<br />화면에서는 비워지지만, 이 마이페이지에서 다시 되돌릴 수 있습니다.</>}
        confirmText="초기화"
        onConfirm={() => resetMut.mutate()}
        onCancel={() => setConfirming(false)}
      />

      <ConfirmModal
        open={restoring !== null}
        variant="warning"
        icon="↩"
        title="이 초기화를 되돌릴까요?"
        message={<>보관된 <strong>{restoring?.tx_count}건</strong>이 지금 장부로 복원됩니다.<br />초기화 이후 새로 추가한 거래는 그대로 유지됩니다.</>}
        confirmText="되돌리기"
        onConfirm={() => restoring && restoreMut.mutate(restoring.id)}
        onCancel={() => setRestoring(null)}
      />
    </>
  );
}
