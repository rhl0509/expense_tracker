'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCardCredentials, saveCardCredentials, deleteCardCredentials,
} from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';
import { SectionCard, StatusBadge, rowStyle, labelStyle, noticeStyle, errorStyle } from '@/components/my/Section';

export default function CardCredentials() {
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

  // 기존 연동이 있으면 비밀번호를 비워도 저장 가능(기존 값 유지). 새로 등록할 땐 비번 필수.
  const canSave = imapUser.trim().includes('@') &&
    (imapPassword.replace(/\s/g, '').length >= 8 || !!cred?.configured);
  const showForm = !credQ.isLoading && (editing || !cred?.configured);

  return (
    <>
      <SectionCard
        icon="card"
        title="카드 명세서 자동 수집"
        badge={!credQ.isLoading && <StatusBadge on={!!cred?.configured} />}
        desc={<>
          Gmail로 받는 카드사(현대·KB·우리) 명세서를 자동으로 가져와 거래로 추가합니다. 본인 Gmail의{' '}
          <b>앱 비밀번호</b>가 필요합니다(일반 비밀번호 아님).{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--brand)' }}>앱 비밀번호 만들기 ↗</a>
          <br />저장된 비밀번호는 서버에서 암호화되어 보관되며, 화면에는 다시 표시되지 않습니다.
        </>}
      >
        {credQ.isLoading ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>불러오는 중…</div>
        ) : cred?.configured && !editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0, fontSize: '0.875rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cred.imap_user_masked}
                {cred.has_woori && (
                  <span style={{ marginLeft: 6, fontSize: '0.72rem', color: 'var(--text-3)' }}>· 우리카드 포함</span>
                )}
              </span>
            </div>
            <div style={noticeStyle}>
              저장해두면 매일 한 번 새 명세서를 자동으로 가져옵니다. 지금 바로 가져오려면 거래 내역
              화면의 ‘카드명세서 가져오기’를 누르세요.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setImapUser(cred.imap_user ?? ''); setEditing(true); }}>다시 설정</button>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--expense)' }}
                onClick={() => setConfirmDelete(true)}>연동 해제</button>
            </div>
          </div>
        ) : null}

        {showForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: cred?.configured ? 12 : 0 }}>
            <div>
              <label htmlFor="card-gmail" style={labelStyle}>Gmail 주소</label>
              <input id="card-gmail" className="field" type="email" placeholder="me@gmail.com" value={imapUser}
                onChange={(e) => setImapUser(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="card-pw" style={labelStyle}>앱 비밀번호</label>
              <input id="card-pw" className="field" type="password"
                placeholder={cred?.configured ? '변경할 때만 입력 (비우면 기존 유지)' : '16자리 앱 비밀번호'} value={imapPassword}
                onChange={(e) => setImapPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label htmlFor="card-woori" style={labelStyle}>
                우리카드 생년월일 6자리 <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(선택 · 우리카드 복호화용)</span>
              </label>
              <input id="card-woori" className="field" inputMode="numeric" maxLength={6}
                placeholder={cred?.has_woori ? '등록됨 · 변경할 때만 입력' : '예: 900101'} value={wooriBirth}
                onChange={(e) => setWooriBirth(e.target.value.replace(/\D/g, ''))} autoComplete="off" />
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-primary btn-sm" disabled={!canSave || saveMut.isPending}
                onClick={() => saveMut.mutate({
                  imap_user: imapUser.trim(),
                  imap_password: imapPassword,
                  woori_birth: wooriBirth || undefined,
                })}>{saveMut.isPending ? '검증 중…' : '저장'}</button>
              {cred?.configured && (
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  setEditing(false); setImapUser(''); setImapPassword(''); setWooriBirth('');
                }}>취소</button>
              )}
            </div>

            {/* 토스트는 사라지지만 이 문구는 남는다 — 무엇을 고쳐야 하는지 보면서 다시 입력할 수 있어야 한다. */}
            {saveMut.isError && (
              <div style={errorStyle} role="alert">
                {(saveMut.error as Error).message || '저장에 실패했습니다.'}
              </div>
            )}
          </div>
        )}
      </SectionCard>

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
