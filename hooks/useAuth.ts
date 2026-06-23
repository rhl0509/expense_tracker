'use client';

import { useQuery } from '@tanstack/react-query';
import { getMe } from '@/lib/api';
import type { User } from '@/lib/types';

export function useAuth() {
  const { data, isLoading, error } = useQuery<User>({
    queryKey: ['me'],
    queryFn: getMe,
    retry: false,
  });

  return {
    user: data,
    isLoading,
    isLoggedIn: !!data && !error,
  };
}
