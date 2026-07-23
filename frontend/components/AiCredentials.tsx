'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAiCredential, saveAiCredential, deleteAiCredential,
  getAiAutoCategorize, setAiAutoCategorize,
} from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';
import { SectionCard, StatusBadge, rowStyle, labelStyle } from '@/components/my/Section';

// provider 를 추가하면 select 가 자동으로 열린다. value 는 백엔드 supported_providers() 와 맞춘다.
const CLOUD_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'console.anthropic.com 에서 발급 (sk-ant-…)' },
  { value: 'openai', label: 'OpenAI (GPT)', hint: 'platform.openai.com/api-keys 에서 발급 (sk-…)' },
  { value: 'gemini', label: 'Google Gemini', hint: 'aistudio.google.com/apikey 에서 발급 (AIza…)' },
];
// 로컬은 서버가 LOCAL_LLM_URL 을 설정한 경우에만 목록에 넣는다. 없는 선택지를 띄우면
// 저장은 되는데 매 호출이 실패하는 상태가 된다.
const LOCAL_PROVIDER = { value: 'local', label: '로컬 모델 (API 키 불필요)', hint: '이 서버에 연결된 로컬 추론 서버를 사용합니다.' };

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

  const autoQ = useQuery({ queryKey: ['ai-auto-categorize'], queryFn: getAiAutoCategorize });
  const autoCat = autoQ.data?.enabled ?? false;
  const autoMut = useMutation({
    mutationFn: (next: boolean) => setAiAutoCategorize(next),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['ai-auto-categorize'] });
      toast(res.enabled ? '가맹점 자동분류를 켰습니다.' : '가맹점 자동분류를 껐습니다.', 'success');
    },
    onError: (e) => toast((e as Error).message || '변경에 실패했습니다.', 'error'),
  });

  const configured = cred?.configured;
  const PROVIDERS = cred?.local_available ? [...CLOUD_PROVIDERS, LOCAL_PROVIDER] : CLOUD_PROVIDERS;
  const activeProvider = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];
  const isLocal = provider === 'local';
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
            {/* 로컬은 키 입력칸을 아예 감춘다 — 받아도 쓰지 않으므로 칸을 두면
                "여기에 뭘 넣어야 하나"라는 질문만 만든다. */}
            {isLocal ? (
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-2)', lineHeight: 1.6 }}>
                이 서버에 연결된 로컬 모델 <b className="font-mono">{cred?.local_model}</b> 을 사용합니다.
                <br />API 키가 필요 없고 호출 비용도 발생하지 않습니다. 대화 내용이 외부로 나가지 않습니다.
              </p>
            ) : (
              <div>
                <label htmlFor="ai-key" style={labelStyle}>API 키</label>
                <input id="ai-key" className="field" type="password" autoComplete="off" placeholder="API 키를 붙여넣으세요"
                  value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-3)' }}>{activeProvider.hint}</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || (!isLocal && !apiKey.trim())}>
                {saveMut.isPending ? '검증 중…' : isLocal ? '로컬 모델 사용' : '키 저장'}
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

        {/* 카드 명세서 자동분류 옵트인. 키가 등록된 경우에만 보여준다 — 키가 없으면
            켜도 아무 일이 일어나지 않아 "켰는데 왜 안 되지"가 된다. */}
        {configured && (
          <div style={{ ...rowStyle, marginTop: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text)' }}>가맹점 자동분류</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 3, lineHeight: 1.5 }}>
                카드 명세서를 수집할 때 키워드 규칙으로 분류되지 않은 가맹점을 AI가 분류합니다.
                한 번 분류한 가맹점은 저장해 두고 다시 묻지 않습니다. 끄면 규칙만 사용합니다(무료).
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ flexShrink: 0, color: autoCat ? 'var(--income)' : 'var(--text-3)' }}
              disabled={autoQ.isLoading || autoMut.isPending}
              onClick={() => autoMut.mutate(!autoCat)}
            >
              {autoQ.isLoading ? '…' : autoCat ? '켜짐' : '꺼짐'}
            </button>
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
