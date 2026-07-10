// VestMail(우리카드 보안메일) 복호화.
// 그들 인라인 JS 를 jsdom 에서 그대로 실행 → doAction() 이 복호화한 HTML 을
// document.write 로 뿌리는 걸 가로채 stdout 으로 내보낸다.
// 사용법: stdin 첫 줄에 생년월일 6자리, 이어서 암호화 HTML.
// (argv 로 받으면 생년월일이 프로세스 목록에 노출되므로 stdin 으로만 받는다.)
//   { echo <birth6>; cat encrypted.html; } | node decrypt.js
//
// ⚠️ NEEDS-USER (보안): runScripts:'dangerously' 는 메일 첨부의 신뢰되지 않은 JS 를
// 이 Node 프로세스 안에서 실행한다. jsdom 은 보안 샌드박스가 아니므로 jsdom 탈출
// 취약점이 나오면 RCE 가 될 수 있다. 완화(발신자 DKIM/SPF 인증 통과 첨부만 도달,
// 아래에서 네트워크 API 제거, 외부 리소스 미로딩)는 적용했지만, 근본 대책은
// 권한 낮춘 별도 프로세스/컨테이너 격리다 — 사용자 결정 필요.
const { JSDOM, VirtualConsole } = require('jsdom');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const nl = input.indexOf('\n');
  const birth = (nl === -1 ? '' : input.slice(0, nl)).trim();
  if (!birth) {
    console.error('usage: node decrypt.js  (stdin: birth6 on first line, then encrypted HTML)');
    process.exit(64);
  }
  decrypt(input.slice(nl + 1), birth);
});

function decrypt(html, birth) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.error('[jsdomError]', e.message));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    // resources 미지정(기본값): 외부 스크립트·이미지 등 서브리소스를 로드하지 않는다.
    // beforeParse: 인라인 스크립트 실행 전에 네트워크 API 를 제거해 외부 유출·요청 차단.
    // (VestMail 복호화는 순수 로컬 연산이라 네트워크가 필요 없다.)
    beforeParse(window) {
      window.XMLHttpRequest = undefined;
      window.fetch = undefined;
      window.WebSocket = undefined;
      window.navigator.sendBeacon = undefined;
    },
  });
  const { window } = dom;
  window.alert = () => {};

  let captured = '';
  window.document.write = (...a) => { captured += a.join(''); };
  window.document.writeln = (...a) => { captured += a.join('') + '\n'; };

  function finish() {
    if (captured.length > 0) {
      process.stdout.write(captured);
      process.exit(0);
    }
    console.error('decrypt produced no output (wrong birth or VestMail change?)');
    process.exit(4);
  }

  function run() {
    const pwd = window.document.getElementById('password');
    if (!pwd) { console.error('no #password element'); process.exit(2); }
    pwd.value = birth;
    if (typeof window.doAction !== 'function') {
      console.error('doAction not defined');
      process.exit(3);
    }
    try { window.doAction(); } catch (e) { console.error('doAction threw:', e.message); }
    // O(): 12블록을 setTimeout(...,10)로 순차 복호 → P(). 넉넉히 대기.
    setTimeout(finish, 2000);
  }

  if (window.document.readyState === 'complete') setTimeout(run, 50);
  else window.addEventListener('load', () => setTimeout(run, 50));
}
