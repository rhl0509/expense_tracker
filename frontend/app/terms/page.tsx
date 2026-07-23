import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import TermsContent from '@/components/legal/TermsContent';

export const metadata: Metadata = { title: '이용약관 — AI 가계부' };

export default function TermsPage() {
  return (
    <LegalPage title="이용약관">
      <TermsContent />
    </LegalPage>
  );
}
