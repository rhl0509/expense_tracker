'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getCategories } from '@/lib/api';
import type { Category } from '@/lib/types';

export function useCategories() {
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
  });

  const helpers = useMemo(() => {
    const parents = (type: 'income' | 'expense') =>
      categories.filter((c) => c.type === type && !c.parent_id);
    const subs = (parentId: number | string | null | undefined) =>
      categories.filter((c) => parentId != null && String(c.parent_id) === String(parentId));
    /** 수입/지출별 대분류 + 하위 소분류 그룹 */
    const grouped = (type: 'income' | 'expense') =>
      parents(type).map((p) => ({ parent: p, subs: subs(p.id) }));
    return { parents, subs, grouped };
  }, [categories]);

  return { categories: categories as Category[], isLoading, ...helpers };
}
