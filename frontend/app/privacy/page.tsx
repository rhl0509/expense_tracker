import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import PrivacyContent from '@/components/legal/PrivacyContent';

export const metadata: Metadata = { title: '개인정보처리방침 — AI 가계부' };

export default function PrivacyPage() {
  return (
    <LegalPage title="개인정보처리방침">
      <PrivacyContent />
    </LegalPage>
  );
}
