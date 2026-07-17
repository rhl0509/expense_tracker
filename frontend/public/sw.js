// 킬 스위치. 이 앱은 더 이상 서비스워커를 쓰지 않는다.
//
// 이전 버전은 정적 자산을 cache-first로 물었는데, /auth·/transaction 등 API는 애초에
// 캐시 대상이 아니었다(데이터가 전부 거기서 온다). 즉 오프라인이 되어도 데이터 없는
// 빈 껍데기만 보여서 실익이 없는 반면, 낡은 번들을 계속 내주며 화면을 "로딩 중..."에
// 묶어두는 사고는 실제로 냈다.
//
// next.config.ts가 /sw.js에 no-store를 주고 등록도 updateViaCache:'none'이라,
// 브라우저는 접속할 때마다 이 파일을 서버에서 새로 받아 비교한다. 그래서 과거에
// 워커가 등록된 기기는 페이지 JS가 망가져 있어도 다음 접속에 이 파일을 집어삼키고
// 스스로 복구된다.
//
// fetch 핸들러가 없으므로 이 워커는 어떤 요청도 가로채지 않는다.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      // 낡은 자산을 물고 멈춰 있던 창을 새로고침해 정상 상태로 되돌린다.
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })()
  );
});
