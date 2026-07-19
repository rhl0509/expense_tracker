'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAiCredential, saveAiCredential, deleteAiCredential } from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';
import { SectionCard, StatusBadge, rowStyle, labelStyle } from '@/components/my/Section';

// provider 를 추가하면 select 가 자동으로 열린다. value 는 백엔드 _SUPPORTED_PROVIDERS 와 맞춘다.
const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'console.anthropic.com 에서 발급 (sk-ant-…)' },
  { value: 'openai', label: 'OpenAI (GPT)', hint: 'platform.openai.com/api-keys 에서 발급 (sk-…)' },
  { value: 'gemini', label: 'Google Gemini', hint: 'aistudio.google.com/apikey 에서 발급 (AIza…)' },
];

export default function AiCredentials() {
  const qc = useQueryClient();
  const toast = useToast();
  const credQ = useQuery({ queryKey: ['ai-credential'], queryFn: getAiCredential });
  const cred = credQ.data;

  const [provider, setProvider] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveMut = useMutation({
    mutationFn: () => saveAiCredential(provider, apiKey.trim()),
    onSuccess: () => {
      setApiKey('');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['ai-credential'] });
      toast('API 키가 저장되었습니다.', 'success');
    },
    onError: (e) => toast((e as Error).message || '저장에 실패했습니다.', 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteAiCredential(),
    onSuccess: () => {
      setConfirmDelete(false);
      qc.invalidateQueries({ queryKey: ['ai-credential'] });
      toast('API 키를 삭제했습니다.', 'success');
    },
    onError: (e) => toast((e as Error).message || '삭제에 실패했습니다.', 'error'),
  });

  const configured = cred?.configured;
  const activeProvider = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];
  const showForm = !credQ.isLoading && (!configured || editing);

  return (
    <>
      <SectionCard
        icon="sparkles"
        title="AI 어드바이저 연동"
        badge={!credQ.isLoading && <StatusBadge on={!!configured} />}
        desc={<>
          AI 재정 어드바이저는 <b>본인의 API 키</b>로 작동합니다. 발급받은 키를 등록하면 그 키로
          분석·대화가 이뤄지고, 비용은 해당 키 계정에 청구됩니다. 키는 암호화되어 저장되며 다시
          표시되지 않습니다.
        </>}
      >
        {credQ.isLoading ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>불러오는 중…</div>
        ) : configured && !editing ? (
          <div style={rowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text)' }}>
                {PROVIDERS.find((p) => p.value === cred?.provider)?.label ?? cred?.provider}
              </div>
              <div className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 1 }}>
                {cred?.key_hint}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}
              onClick={() => { setProvider(cred?.provider ?? 'anthropic'); setApiKey(''); setEditing(true); }}>
              변경
            </button>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--expense)', flexShrink: 0 }}
              onClick={() => setConfirmDelete(true)}>
              삭제
            </button>
          </div>
        ) : null}

        {showForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: configured ? 12 : 0 }}>
            {PROVIDERS.length > 1 && (
              <div>
                <label htmlFor="ai-provider" style={labelStyle}>프로바이더</label>
                <select id="ai-provider" className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="ai-key" style={labelStyle}>API 키</label>
              <input id="ai-key" className="field" type="password" autoComplete="off" placeholder="API 키를 붙여넣으세요"
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-3)' }}>{activeProvider.hint}</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}
                onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !apiKey.trim()}>
                {saveMut.isPending ? '검증 중…' : '키 저장'}
              </button>
              {editing && (
                <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}
                  onClick={() => { setEditing(false); setApiKey(''); }}>
                  취소
                </button>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      <ConfirmModal
        open={confirmDelete}
        variant="danger"
        icon="🔑"
        title="API 키를 삭제할까요?"
        message={<>등록된 AI API 키가 삭제됩니다.<br />삭제 후에는 AI 어드바이저를 쓸 수 없고, 다시 쓰려면 키를 재등록해야 합니다.</>}
        confirmText="키 삭제"
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
