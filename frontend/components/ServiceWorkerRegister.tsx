'use client';

import { useEffect } from 'react';

// 서비스워커를 등록하지 않는다. cache-first가 낡은 번들을 물어 화면을 "로딩 중..."에
// 묶어두는 사고를 냈고, API를 캐시하지 않아 오프라인 실익도 없었다(public/sw.js 참고).
// Chrome은 108(모바일)/112(데스크톱)부터 설치 조건에서 SW를 요구하지 않으므로
// manifest만으로 홈 화면 추가는 그대로 된다.
// 과거 버전이 남긴 워커·캐시가 있으면 정리한다(sw.js 킬 스위치와 이중 안전장치).
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }, []);
  return null;
}
