// VestMail(우리카드 보안메일) 복호화.
// 그들 인라인 JS 를 jsdom 에서 그대로 실행 → doAction() 이 복호화한 HTML 을
// document.write 로 뿌리는 걸 가로채 stdout 으로 내보낸다.
// 사용법: 암호화 HTML 을 stdin 으로 파이프, 인자로 생년월일 6자리.
//   node decrypt.js <birth6>   < encrypted.html
const { JSDOM, VirtualConsole } = require('jsdom');

const birth = process.argv[2];
if (!birth) {
  console.error('usage: node decrypt.js <birth6>  (encrypted HTML via stdin)');
  process.exit(64);
}

let html = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { html += c; });
process.stdin.on('end', () => decrypt(html));

function decrypt(html) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.error('[jsdomError]', e.message));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
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
