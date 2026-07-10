'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUserLabels, saveUserLabels,
  getPaymentMethods, savePaymentMethods,
} from '@/lib/api';

export function useUserLabels() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['user-labels'], queryFn: getUserLabels });
  const save = useMutation({
    mutationFn: saveUserLabels,
    onSuccess: (res) => qc.setQueryData(['user-labels'], res.labels),
  });
  return { labels: query.data ?? [], isLoading: query.isLoading, save };
}

export function usePaymentMethods() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['payment-methods'], queryFn: getPaymentMethods });
  const save = useMutation({
    mutationFn: savePaymentMethods,
    onSuccess: (res) => qc.setQueryData(['payment-methods'], res.methods),
  });
  return { methods: query.data ?? [], isLoading: query.isLoading, save };
}
