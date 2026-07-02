'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCardCredentials, saveCardCredentials, deleteCardCredentials,
} from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();

  const credQ = useQuery({ queryKey: ['card-credentials'], queryFn: getCardCredentials });
  const cred = credQ.data;

  const [imapUser, setImapUser] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [wooriBirth, setWooriBirth] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveMut = useMutation({
    mutationFn: saveCardCredentials,
    onSuccess: () => {
      setImapUser(''); setImapPassword(''); setWooriBirth(''); setEditing(false);
      qc.invalidateQueries({ queryKey: ['card-credentials'] });
      toast('카드 연동을 저장했습니다.', 'success');
    },
    onError: (e) => toast((e as Error).message || '저장에 실패했습니다.', 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: deleteCardCredentials,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['card-credentials'] });
      toast('카드 연동을 해제했습니다.', 'success');
    },
    onError: (e) => toast((e as Error).message || '해제에 실패했습니다.', 'error'),
  });

  const canSave = imapUser.trim().includes('@') && imapPassword.replace(/\s/g, '').length >= 8;
  const showForm = editing || !cred?.configured;

  return (
    <>
      <h1 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>내 정보</h1>

      <div className="card" style={{ padding: 18 }}>
        <div style={sectionTitle}>카드 명세서 자동 수집</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.6 }}>
          Gmail로 받는 카드사(현대·KB·우리) 명세서를 자동으로 가져와 거래로 추가합니다.
          <br />본인 Gmail의 <b>앱 비밀번호</b>가 필요합니다(일반 비밀번호 아님).
          {' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}>앱 비밀번호 만들기 ↗</a>
          <br />저장된 비밀번호는 서버에서 암호화되어 보관되며, 화면에는 다시 표시되지 않습니다.
        </div>

        {credQ.isLoading ? (
          <Empty>불러오는 중…</Empty>
        ) : cred?.configured && !editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={rowStyle}>
              <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text)' }}>
                연동됨 · {cred.imap_user_masked}
                {cred.has_woori && (
                  <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--text-3)' }}>· 우리카드 포함</span>
                )}
              </span>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)' }}>ON</span>
            </div>
            <div style={noticeStyle}>
              ⓘ 저장해두면 매일 한 번 새 명세서를 자동으로 가져옵니다. 지금 바로 가져오려면
              거래 내역 화면의 ‘카드명세서 가져오기’를 누르세요.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>다시 설정</button>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--expense)' }}
                onClick={() => setConfirmDelete(true)}>연동 해제</button>
            </div>
          </div>
        ) : null}

        {showForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: cred?.configured ? 12 : 0 }}>
            <label style={labelStyle}>Gmail 주소</label>
            <input className="field" type="email" placeholder="me@gmail.com" value={imapUser}
              onChange={(e) => setImapUser(e.target.value)} autoComplete="off" />

            <label style={labelStyle}>앱 비밀번호</label>
            <input className="field" type="password" placeholder="16자리 앱 비밀번호" value={imapPassword}
              onChange={(e) => setImapPassword(e.target.value)} autoComplete="new-password" />

            <label style={labelStyle}>우리카드 생년월일 6자리 <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(선택 · 우리카드 복호화용)</span></label>
            <input className="field" inputMode="numeric" maxLength={6} placeholder="예: 900101" value={wooriBirth}
              onChange={(e) => setWooriBirth(e.target.value.replace(/\D/g, ''))} autoComplete="off" />

            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button className="btn btn-primary" disabled={!canSave || saveMut.isPending}
                onClick={() => saveMut.mutate({
                  imap_user: imapUser.trim(),
                  imap_password: imapPassword,
                  woori_birth: wooriBirth || undefined,
                })}>저장</button>
              {cred?.configured && (
                <button className="btn btn-ghost" onClick={() => {
                  setEditing(false); setImapUser(''); setImapPassword(''); setWooriBirth('');
                }}>취소</button>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDelete}
        variant="danger"
        icon="🔌"
        title="카드 연동을 해제할까요?"
        message={<>저장된 Gmail 자격증명을 삭제합니다.<br />이미 가져온 거래는 남습니다.</>}
        confirmText="연동 해제"
        onConfirm={() => { deleteMut.mutate(); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 };
const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-2)', marginTop: 4 };
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10,
  border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '8px 12px',
};
const noticeStyle: React.CSSProperties = {
  fontSize: '0.74rem', color: 'var(--text-3)', lineHeight: 1.6, borderRadius: 10,
  background: 'var(--accent-soft)', padding: '8px 12px',
};

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', padding: '8px 0' }}>{children}</div>;
}
