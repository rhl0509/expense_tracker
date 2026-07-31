'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getBooks, switchBook, getBookMembers, removeBookMember,
  createInvite, getInvites, acceptInvite, revokeInvite,
} from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';
import type { Book, BookMember, Invite } from '@/lib/types';

export default function HouseholdPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const booksQ = useQuery({ queryKey: ['books'], queryFn: getBooks });
  const membersQ = useQuery({ queryKey: ['book-members'], queryFn: getBookMembers });
  const invitesQ = useQuery({ queryKey: ['invites'], queryFn: getInvites });

  const activeId = booksQ.data?.active_book_id ?? null;
  const books = booksQ.data?.books ?? [];
  const members = membersQ.data?.members ?? [];
  const invites = invitesQ.data?.invites ?? [];
  const myRole = books.find((b) => b.id === activeId)?.role;
  const isOwner = myRole === 'owner';

  const [acceptToken, setAcceptToken] = useState('');
  const [newInvite, setNewInvite] = useState<{ token: string; expires_at: string } | null>(null);
  const [delMember, setDelMember] = useState<BookMember | null>(null);

  const switchMut = useMutation({
    mutationFn: switchBook,
    onSuccess: () => { qc.invalidateQueries(); toast('가구를 전환했습니다.', 'success'); },
    onError: (e) => toast((e as Error).message || '전환에 실패했습니다.', 'error'),
  });

  const inviteMut = useMutation({
    mutationFn: createInvite,
    onSuccess: (data) => { setNewInvite(data); qc.invalidateQueries({ queryKey: ['invites'] }); },
    onError: (e) => toast((e as Error).message || '초대 생성에 실패했습니다.', 'error'),
  });

  const acceptMut = useMutation({
    mutationFn: acceptInvite,
    onSuccess: () => { setAcceptToken(''); qc.invalidateQueries(); toast('가구에 참여했습니다.', 'success'); },
    onError: (e) => toast((e as Error).message || '초대 수락에 실패했습니다.', 'error'),
  });

  const revokeMut = useMutation({
    mutationFn: revokeInvite,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invites'] }); toast('초대를 취소했습니다.', 'success'); },
    onError: (e) => toast((e as Error).message || '취소에 실패했습니다.', 'error'),
  });

  const removeMut = useMutation({
    mutationFn: removeBookMember,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['book-members'] }); toast('멤버를 내보냈습니다.', 'success'); },
    onError: (e) => toast((e as Error).message || '내보내기에 실패했습니다.', 'error'),
  });

  return (
    <>
      <h1 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>가구 관리</h1>

      <div style={{ display: 'grid', gap: 14 }} className="grid-cols-1 md:grid-cols-2">
        {/* 내 가구 목록 + 전환 */}
        <div className="card" style={{ padding: 18 }}>
          <div style={sectionTitle}>내 가구</div>
          {books.length === 0 ? (
            <Empty>속한 가구가 없습니다.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {books.map((b: Book) => {
                const active = b.id === activeId;
                return (
                  <div key={b.id} style={rowStyle}>
                    <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text)', fontWeight: active ? 700 : 500 }}>
                      {b.title}
                      <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--text-3)' }}>
                        {b.role === 'owner' ? '· 가구장' : '· 멤버'}
                      </span>
                    </span>
                    {active ? (
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)' }}>사용 중</span>
                    ) : (
                      <button className="btn btn-ghost btn-sm" disabled={switchMut.isPending}
                        onClick={() => switchMut.mutate(b.id)}>전환</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 초대 코드로 참여 */}
        <div className="card" style={{ padding: 18 }}>
          <div style={sectionTitle}>초대 코드로 참여</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: 10 }}>
            받은 초대 코드를 입력하면 해당 가구에 합류합니다.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="field" style={{ flex: 1 }} placeholder="초대 코드" value={acceptToken}
              onChange={(e) => setAcceptToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && acceptToken.trim() && acceptMut.mutate(acceptToken.trim())} />
            <button className="btn btn-primary" disabled={!acceptToken.trim() || acceptMut.isPending}
              onClick={() => acceptMut.mutate(acceptToken.trim())}>참여</button>
          </div>
        </div>
      </div>

      {/* 현재 가구 멤버 */}
      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <div style={sectionTitle}>현재 가구 멤버</div>
        {members.length === 0 ? (
          <Empty>멤버 정보를 불러올 수 없습니다.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {members.map((m: BookMember) => (
              <div key={m.member_id} style={rowStyle}>
                <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text)' }}>
                  {m.name}
                  {/* 소셜 전용 회원은 user_id 가 없다 — '@null' 을 그리지 않는다. */}
                  {m.user_id && <span style={{ marginLeft: 6, fontSize: '0.72rem', color: 'var(--text-3)' }}>@{m.user_id}</span>}
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: m.role === 'owner' ? 'var(--accent)' : 'var(--text-3)' }}>
                  {m.role === 'owner' ? '가구장' : '멤버'}
                </span>
                {isOwner && m.role !== 'owner' && (
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--expense)' }}
                    onClick={() => setDelMember(m)}>내보내기</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 초대 관리 (가구장 전용) */}
      {isOwner && (
        <div className="card" style={{ padding: 18, marginTop: 14 }}>
          <div style={sectionTitle}>멤버 초대</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button className="btn btn-primary" disabled={inviteMut.isPending}
              onClick={() => inviteMut.mutate()}>+ 초대 코드 생성</button>
          </div>

          {newInvite && (
            <div style={{ ...rowStyle, background: 'var(--accent-soft)', marginBottom: 12 }}>
              <code style={{ flex: 1, fontSize: '0.82rem', color: 'var(--text)', wordBreak: 'break-all' }}>{newInvite.token}</code>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { navigator.clipboard?.writeText(newInvite.token); toast('복사되었습니다.', 'success'); }}>복사</button>
            </div>
          )}

          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, margin: '4px 0 8px' }}>초대 현황</div>
          {invites.length === 0 ? (
            <Empty>생성된 초대가 없습니다.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {invites.map((inv: Invite) => {
                const expired = inv.status === 'expired';
                return (
                  <div key={inv.id} style={rowStyle}>
                    <code style={{ flex: 1, fontSize: '0.78rem', wordBreak: 'break-all',
                      color: expired ? 'var(--text-3)' : 'var(--text-2)',
                      textDecoration: expired ? 'line-through' : 'none' }}>{inv.token}</code>
                    <StatusBadge status={inv.status} />
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
                      {inv.status === 'accepted'
                        ? (inv.accepted_by_name ? `${inv.accepted_by_name} 참여` : '참여됨')
                        : inv.expires_at ? `~${inv.expires_at.slice(0, 10)}` : ''}
                    </span>
                    {inv.status === 'pending' && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--expense)' }}
                        onClick={() => revokeMut.mutate(inv.id)}>취소</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={delMember !== null}
        variant="danger"
        icon="🚪"
        title="멤버를 내보낼까요?"
        message={<>{delMember?.name}님을 이 가구에서 내보냅니다.<br />기록된 거래는 남습니다.</>}
        confirmText="내보내기"
        onConfirm={() => { if (delMember) removeMut.mutate(delMember.member_id); setDelMember(null); }}
        onCancel={() => setDelMember(null)}
      />
    </>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 };
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10,
  border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '8px 12px',
};

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', padding: '8px 0' }}>{children}</div>;
}

const BADGE: Record<Invite['status'], { label: string; color: string; bg: string }> = {
  pending: { label: '대기중', color: 'var(--accent)', bg: 'var(--accent-soft)' },
  expired: { label: '만료됨', color: 'var(--text-3)', bg: 'var(--hover-bg)' },
  accepted: { label: '수락됨', color: 'var(--income)', bg: 'var(--hover-bg)' },
  revoked: { label: '취소됨', color: 'var(--text-3)', bg: 'var(--hover-bg)' },
};

function StatusBadge({ status }: { status: Invite['status'] }) {
  const s = BADGE[status] ?? BADGE.pending;
  return (
    <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99, color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}
