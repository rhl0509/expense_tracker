import { redirect } from 'next/navigation';

// 내 정보는 마이페이지로 합쳤다. 이 경로는 북마크·기존 링크가 깨지지 않게 남겨둔다.
export default function SettingsPage() {
  redirect('/my');
}
