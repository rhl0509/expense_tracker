'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { addCategory, deleteCategory, reorderCategories } from '@/lib/api';
import { useCategories } from '@/hooks/useCategories';
import { useUserLabels, usePaymentMethods } from '@/hooks/useSettings';
import { useToast } from '@/components/providers/ToastProvider';
import ConfirmModal from '@/components/ConfirmModal';
import type { Category } from '@/lib/types';

export default function CategoriesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { grouped } = useCategories();
  const labelsApi = useUserLabels();
  const methodsApi = usePaymentMethods();

  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<'income' | 'expense'>('expense');
  const [subFor, setSubFor] = useState<Category | null>(null);
  const [subName, setSubName] = useState('');
  const [delTarget, setDelTarget] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });

  const addMut = useMutation({ mutationFn: addCategory, onSuccess: invalidate });
  const delMut = useMutation({ mutationFn: deleteCategory, onSuccess: invalidate });
  const reorderMut = useMutation({ mutationFn: ({ type, ids }: { type: string; ids: number[] }) => reorderCategories(type, ids), onSuccess: invalidate });

  function addParent() {
    if (!newCatName.trim()) return toast('이름을 입력하세요.', 'error');
    addMut.mutate({ name: newCatName.trim(), type: newCatType, parent_id: null }, { onSuccess: () => { invalidate(); setNewCatName(''); toast('대분류가 추가되었습니다.', 'success'); } });
  }
  function addSub() {
    if (!subFor || !subName.trim()) return;
    addMut.mutate({ name: subName.trim(), type: subFor.type, parent_id: subFor.id }, { onSuccess: () => { invalidate(); setSubFor(null); setSubName(''); toast('소분류가 추가되었습니다.', 'success'); } });
  }
  function moveParent(type: 'income' | 'expense', parents: Category[], idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= parents.length) return;
    const ids = parents.map((p) => p.id);
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    reorderMut.mutate({ type, ids });
  }

  return (
    <>
      <h1 style={{ margin: '0 0 16px', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)' }}>카테고리 · 설정</h1>

      {/* 사용자 라벨 / 결제수단 */}
      <div style={{ display: 'grid', gap: 14, marginBottom: 14 }} className="grid-cols-1 md:grid-cols-2">
        <ListEditor
          title="사용자 라벨"
          items={labelsApi.labels}
          onSave={(next) => labelsApi.save.mutate(next, { onSuccess: () => toast('저장되었습니다.', 'success') })}
          placeholder="새 사용자 이름"
          dupMsg="이미 존재하는 이름입니다."
          toast={toast}
        />
        <ListEditor
          title="결제수단"
          items={methodsApi.methods}
          onSave={(next) => methodsApi.save.mutate(next, { onSuccess: () => toast('저장되었습니다.', 'success') })}
          placeholder="새 결제수단"
          dupMsg="이미 존재하는 결제수단입니다."
          toast={toast}
        />
      </div>

      {/* 카테고리 관리 */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>카테고리 관리</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          <select className="field" style={{ width: 'auto' }} value={newCatType} onChange={(e) => setNewCatType(e.target.value as 'income' | 'expense')}>
            <option value="expense">지출</option><option value="income">수입</option>
          </select>
          <input className="field" style={{ flex: 1, minWidth: 160 }} placeholder="새 대분류 이름" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addParent()} />
          <button className="btn btn-primary" onClick={addParent}>+ 대분류 추가</button>
        </div>

        <div style={{ display: 'grid', gap: 24 }} className="grid-cols-1 md:grid-cols-2">
          <CategoryColumn title="수입 카테고리" color="var(--income)" type="income" groups={grouped('income')} onAddSub={setSubFor} onDelete={setDelTarget} onMove={moveParent} />
          <CategoryColumn title="지출 카테고리" color="var(--expense)" type="expense" groups={grouped('expense')} onAddSub={setSubFor} onDelete={setDelTarget} onMove={moveParent} />
        </div>
      </div>

      {/* 소분류 추가 모달 */}
      {subFor && (
        <div className="overlay" onClick={() => setSubFor(null)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 14px', fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>“{subFor.name}” 소분류 추가</h3>
            <input className="field" placeholder="소분류 이름" autoFocus value={subName} onChange={(e) => setSubName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} />
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setSubFor(null)}>취소</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={!subName.trim()} onClick={addSub}>추가</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={delTarget !== null}
        variant="danger"
        icon="🗑"
        title="카테고리를 삭제할까요?"
        message="하위 소분류가 있거나 사용 중이면 삭제되지 않을 수 있습니다."
        confirmText="삭제"
        onConfirm={() => {
          if (delTarget !== null) delMut.mutate(delTarget, {
            onSuccess: () => { invalidate(); toast('삭제되었습니다.', 'success'); },
            onError: (e) => toast((e as Error).message || '삭제할 수 없습니다.', 'error'),
          });
          setDelTarget(null);
        }}
        onCancel={() => setDelTarget(null)}
      />
    </>
  );
}

function ListEditor({ title, items, onSave, placeholder, dupMsg, toast }: {
  title: string; items: string[]; onSave: (next: string[]) => void; placeholder: string; dupMsg: string;
  toast: (m: string, t?: 'success' | 'error' | 'warning' | '') => void;
}) {
  const [val, setVal] = useState('');
  const add = () => {
    const n = val.trim();
    if (!n) return;
    if (items.includes(n)) return toast(dupMsg, 'error');
    onSave([...items, n]); setVal('');
  };
  const remove = (i: number) => { if (items.length > 1) onSave(items.filter((_, idx) => idx !== i)); };
  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir; if (t < 0 || t >= items.length) return;
    const next = [...items]; [next[i], next[t]] = [next[t], next[i]]; onSave(next);
  };
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item, i) => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10, border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '8px 12px' }}>
            <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text)' }}>{item}</span>
            <IconBtn disabled={i === 0} onClick={() => move(i, -1)}>▲</IconBtn>
            <IconBtn disabled={i === items.length - 1} onClick={() => move(i, 1)}>▼</IconBtn>
            <IconBtn disabled={items.length <= 1} onClick={() => remove(i)} danger>✕</IconBtn>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input className="field" style={{ flex: 1 }} placeholder={placeholder} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn-ghost btn-sm" onClick={add}>+</button>
      </div>
    </div>
  );
}

function CategoryColumn({ title, color, type, groups, onAddSub, onDelete, onMove }: {
  title: string; color: string; type: 'income' | 'expense';
  groups: { parent: Category; subs: Category[] }[];
  onAddSub: (p: Category) => void; onDelete: (id: number) => void;
  onMove: (type: 'income' | 'expense', parents: Category[], idx: number, dir: -1 | 1) => void;
}) {
  const parents = groups.map((g) => g.parent);
  return (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color, marginBottom: 10 }}>{title}</div>
      {groups.length === 0 ? (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', padding: '8px 0' }}>등록된 카테고리가 없습니다.</div>
      ) : groups.map((g, idx) => (
        <div key={g.parent.id} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10, border: '1px solid var(--card-border)', background: 'var(--hover-bg)', padding: '8px 12px' }}>
            <span style={{ flex: 1, fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)' }}>{g.parent.name}</span>
            <IconBtn disabled={idx === 0} onClick={() => onMove(type, parents, idx, -1)}>▲</IconBtn>
            <IconBtn disabled={idx === parents.length - 1} onClick={() => onMove(type, parents, idx, 1)}>▼</IconBtn>
            <IconBtn onClick={() => onAddSub(g.parent)} accent>＋</IconBtn>
            <IconBtn onClick={() => onDelete(g.parent.id)} danger>🗑</IconBtn>
          </div>
          {g.subs.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 18, marginTop: 4, borderRadius: 9, border: '1px solid var(--card-border)', padding: '6px 12px' }}>
              <span style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>↳</span>
              <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--text-2)' }}>{s.name}</span>
              <IconBtn onClick={() => onDelete(s.id)} danger>✕</IconBtn>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function IconBtn({ children, onClick, disabled, danger, accent }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; accent?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', fontSize: '0.78rem', padding: '2px 4px',
        color: disabled ? 'var(--text-3)' : danger ? 'var(--expense)' : accent ? 'var(--accent)' : 'var(--text-2)', opacity: disabled ? 0.3 : 1, fontFamily: 'inherit' }}>
      {children}
    </button>
  );
}
