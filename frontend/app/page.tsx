import { redirect } from 'next/navigation';

// 이 앱의 홈은 기록하기다(사이드바 NAV_MAIN 첫 항목과 같다).
// 서버에서 보낸다 — 클라이언트 리디렉트면 AppShell이 먼저 마운트돼
// 사이드바만 뜬 빈 화면이 한 프레임 깜빡인 뒤 이동한다.
export default function Home() {
  redirect('/record');
}
