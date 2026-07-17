"""
card_statement.py — 현대카드 이메일 명세서(HTML 첨부) 파싱 + Gmail IMAP 수집.

명세서 HTML 안의 거래는 자바스크립트 배열로 들어있다:
    arUseDesc[loop++] = new UseDesc(loop, '260501','본인','Amex Gold Ed2',
        '남원추어탕통마늘오리','11,000','0','0','11,000', ...);
인자 순서(생성자 정의 기준):
    (loop, usedate, use_type, card, shop, useamt, div, divcnt, divamt, ...)
- usedate  : YYMMDD (예: 260501 → 2026-05-01)
- use_type : 본인/가족
- card     : 카드명
- shop     : 가맹점명 (gf_Convert2ByteChar2('...') 로 감싸져 있음)
- useamt   : 이용금액(가맹점에서 실제 사용액) ← 가계부에 넣는 금액
- divamt   : 청구금액(당월 청구액, 할인/할부 반영)
소계·총합계 행은 usedate 가 6자리 숫자가 아니므로 자동 제외된다.
"""
import html as _html
import re
from datetime import date, datetime, timedelta

_HYUNDAI_SENDER = "admin@hyundaicard.com"
_KB_SENDER = "cyberman@bill.kbcard.com"
_WOORI_SENDER = "wooricard@wooricard.com"

# new UseDesc( ... );  전체 인자 문자열 캡처
_CALL = re.compile(r"new\s+UseDesc\((.*?)\);", re.S)
# gf_Convert2ByteChar2('...') 래퍼 제거
_UNWRAP = re.compile(r"gf_Convert2ByteChar2\(\s*('(?:[^'\\]|\\.)*')\s*\)")
# 인자 토큰: 따옴표 문자열(쉼표 포함 금액 안전) 또는 비따옴표 토큰. 앞 공백 먼저 소비.
_ARG = re.compile(r"\s*(?:'((?:[^'\\]|\\.)*)'|([^,]+))")

# KB국민카드: 명세서 HTML 의 거래는 자바스크립트 배열 list_pe01Json 안에
# {"청구일련번호":N, "data":'<tr>...</tr>'} 형태로 들어있다. 각 <tr> 컬럼:
#   [0] 이용일자(YY.MM.DD) · [1] 이용카드 · [2] 구분(일시불/할부) ·
#   [3] 이용가맹점(<a><u>..</u></a>) · 첫 <span class="sum">숫자</span> = 이용금액.
_KB_ROW = re.compile(r'"data"\s*:\s*\'(<tr>.*?</tr>)\'', re.S)
_KB_DATE = re.compile(r'<td[^>]*class="first"[^>]*>\s*(\d\d)\.(\d\d)\.(\d\d)\s*</td>')
_KB_MERCHANT = re.compile(r"<u>(.*?)</u>", re.S)
_KB_SUM = re.compile(r'<span class="sum">([^<]*)</span>')
_KB_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_TAG = re.compile(r"<[^>]+>")

# 우리카드: VestMail 보안메일을 복호화한 평문 HTML 을 파싱한다(복호화는 별도 헤드리스
# 단계, 여기선 평문 HTML 만 받는다). 거래는 표준 <tr> 행:
#   [0] 이용일자(MM/DD, class="tdcent") · [1] 이용가맹점(class="tdleft") ·
#   [2] 이용금액(해외현지금액) ← 가계부에 넣는 금액.
# 카드명은 앞선 <td class="txtImport"> 행에 들어있고, 소계/청구합계 행은
# [0] 이 MM/DD 가 아니라 자동 제외된다. 연도는 표 밖 '이용기간'에서 얻되,
# [우리카드_재발송] 과거 명세서는 레이아웃이 달라 '이용기간'이 없다 →
# 호출부가 메일 제목의 결제일(또는 Date 헤더)로 만든 anchor_date 로 유도한다.
_WOORI_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_WOORI_CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S)
_WOORI_MMDD = re.compile(r"^(\d{2})/(\d{2})$")
_WOORI_CARD = re.compile(r'class="txtImport"[^>]*>(.*?)</td>', re.S)
# '이용기간 ... YYYY년 [MM월]' — 기간 시작 연도(+가능하면 시작월)를 캡처.
_WOORI_YEAR = re.compile(r"이용기간.*?(\d{4})년(?:\s*(\d{1,2})월)?", re.S)
# 메일 제목의 결제일: '... 2026년 01월 14일(결제일) 이용대금명세서'
_WOORI_SUBJECT_DATE = re.compile(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일")


def _clean_html_text(s: str) -> str:
    """태그 제거 + HTML 엔티티 디코드(&#40;→( 등) + nbsp 정리."""
    return _html.unescape(_TAG.sub("", s)).replace("\xa0", " ").strip()


def parse_kb_statement(html: str) -> list[dict]:
    """KB국민카드 명세서 HTML 에서 거래 리스트를 뽑는다(이용금액 기준).

    반환: [{date:'YYYY-MM-DD', merchant, amount(int), card, relation}, ...]
    """
    rows = []
    for tr in _KB_ROW.findall(html):
        md = _KB_DATE.search(tr)
        if not md:
            continue
        amount = None
        for s in _KB_SUM.findall(tr):
            v = _to_int(_clean_html_text(s))
            if v is not None:
                amount = v
                break
        if amount is None or amount == 0:
            continue
        mm = _KB_MERCHANT.search(tr)
        if mm:
            merchant = _clean_html_text(mm.group(1))
        else:
            cells = _KB_TD.findall(tr)
            merchant = _clean_html_text(cells[3]) if len(cells) > 3 else ""
        cells = _KB_TD.findall(tr)
        rows.append({
            "date": f"20{md.group(1)}-{md.group(2)}-{md.group(3)}",
            "merchant": merchant,
            "amount": amount,
            "card": _clean_html_text(cells[1]) if len(cells) > 1 else "",
            "relation": "",
        })
    return rows


def parse_woori_statement(html: str, anchor_date: date | None = None) -> list[dict]:
    """우리카드 복호화된 명세서 HTML 에서 거래 리스트를 뽑는다(이용금액 기준).

    반환: [{date:'YYYY-MM-DD', merchant, amount(int), card, relation}, ...]
    이용금액이 0/빈값인 행(면제·안내 등)은 제외.

    연도 결정(우선순위):
      ① 본문 '이용기간 YYYY년 [MM월]' — 기간 시작 연·월. 시작월보다 작은 월의
         거래는 해를 넘긴 것으로 보고 +1년 (12월→1월 경계 보정).
      ② anchor_date — 호출부가 메일 제목의 결제일(없으면 Date 헤더)에서 뽑은
         기준일. 명세서 거래일은 기준일보다 앞서므로, MM/DD 가 anchor 보다
         미래면 전년으로 본다. [우리카드_재발송] 과거 명세서는 본문에
         '이용기간'이 없어 이 경로를 탄다.
      ③ 둘 다 없으면 빈 리스트 — 과거 명세서를 현재 연도로 오파싱해 미래
         날짜·중복 삽입을 만들던 datetime.now().year 폴백은 제거했다.
    """
    ym = _WOORI_YEAR.search(html)
    year = int(ym.group(1)) if ym else None
    period_month = int(ym.group(2)) if ym and ym.group(2) else None
    if year is None and anchor_date is None:
        return []

    rows = []
    card = ""
    first_month = period_month  # 기간 시작월(못 얻으면 첫 거래 행의 월로 대체)
    for tr in _WOORI_TR.findall(html):
        cm = _WOORI_CARD.search(tr)
        if cm:
            card = _clean_html_text(cm.group(1))
            continue
        cells = [_clean_html_text(c) for c in _WOORI_CELL.findall(tr)]
        if len(cells) < 3:
            continue
        md = _WOORI_MMDD.match(cells[0])
        if not md:
            continue  # 소계/청구합계/헤더 행
        amount = _to_int(cells[2])
        if amount is None or amount == 0:
            continue
        month, day = int(md.group(1)), int(md.group(2))
        if year is not None:
            # '이용기간' 연도는 기간 시작 연도 → 시작월보다 작은 월은 다음 해
            # (명세서 기간은 최대 1~2개월이라 안전한 경계 보정).
            if first_month is None:
                first_month = month
            row_year = year + 1 if month < first_month else year
        else:
            # 거래일은 anchor(결제일/수신일)보다 앞선 1년 이내에 있다.
            row_year = anchor_date.year
            if (month, day) > (anchor_date.month, anchor_date.day):
                row_year -= 1
        rows.append({
            "date": f"{row_year}-{md.group(1)}-{md.group(2)}",
            "merchant": cells[1],
            "amount": amount,
            "card": card,
            "relation": "",
        })
    return rows


def _tokenize(arg_str: str) -> list[str]:
    arg_str = _UNWRAP.sub(r"\1", arg_str)
    out = []
    for m in _ARG.finditer(arg_str):
        out.append(m.group(1) if m.group(1) is not None else m.group(2).strip())
    return out


def _to_int(s: str):
    s = s.replace(",", "").strip()
    return int(s) if s.lstrip("-").isdigit() else None


# 가맹점명 키워드 → 카테고리(대분류). 위에서부터 첫 매칭 우선, 미매칭은 '기타'.
# 편의점·카페·주유·택시·대형 유통점처럼 상호에 업종 단서가 있는 건은 잘 잡히고,
# 개별 식당 고유상호(예: '귀한족발')는 업종 단서가 없어 상호를 직접 등록해 잡는다.
# PG·간편결제(네이버페이 등)·관공서처럼 실제 업종이 안 드러나는 건은 '기타'로 둔다.
_CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("의료", ("약국", "의원", "병원", "한의원", "치과", "정형외과", "이비인후과")),
    ("통신", ("유플러스", "lgu+", "통신요금", "skt", "kt통신", "텔레콤")),
    ("구독", ("claude", "anthropic", "openai", "apple", "netflix", "spotify",
            "스포티파이", "유튜브프리미엄", "디즈니플러스", "왓챠", "chatgpt", "와우멤버십")),
    ("세금/공과금", ("시청", "구청", "군청", "도청", "시설관리공단", "상수도",
                 "수도요금", "전기요금", "한국전력", "도시가스", "국세", "지방세", "관세청",
                 "관리비")),
    ("교통비", ("주유", "오일뱅크", "에너지", "칼텍스", "택시", "uber",
              "티머니", "t머니", "주차", "아이파킹", "쉴더스", "하이패스", "고속도로",
              "철도", "코레일", "ktx", "jrhokkaido")),
    ("취미/문화", ("오락실", "예술컴퍼니", "레일파크",
                "cgv", "시네마", "영화", "문고", "서점", "도서", "pc방",
                "넥슨", "포터리", "공방")),
    ("쇼핑", ("다이소", "올리브영", "롯데쇼핑", "나이키", "무신사", "ably",
            "akplaza", "ak플라자", "갤러리아", "디에프", "면세", "스타필드",
            "백화점", "안경", "젝시믹스", "스킨밴드", "문구", "완구", "이케아",
            "에프알엘", "유니클로", "화원", "다이클로", "쿠페이")),
    ("식비", ("커피", "카페", "cafe", "스타벅스", "베이커리", "베스킨", "라빈스", "목장",
            "쿠팡이츠", "배달의민족", "배민", "요기요",
            # "cu"(편의점) 는 'mercure' 등 영단어에 오매칭 → 실제 CU 는 '씨유CU..'라 '씨유'로 잡음
            "gs25", "씨유", "세븐일레븐", "세븐", "이마트24", "노브랜드", "홈플러스",
            "통닭", "족발", "닭갈비", "추어", "냉면", "포차", "맥주", "고기",
            "오리", "도축", "정육", "하나로", "유통센터", "시장", "빙토피아",
            "통마늘", "국밥", "분식", "떡볶이", "치킨", "피자", "버거", "초원", "핵밥",
            # 업종 단서 없는 개별 식당·카페 상호
            "술속의밤", "선주가", "더아메리칸41", "삼미락", "정담은", "느루집",
            "멘츠루", "나작가", "홍라드", "소박한풍경", "퀸스애비뉴", "텐퍼센트")),
]


def categorize_merchant(merchant: str) -> str:
    """가맹점명으로 카테고리(대분류)명을 추정한다. 미매칭은 '기타'."""
    t = merchant.lower()
    for category, keywords in _CATEGORY_RULES:
        if any(k in t for k in keywords):
            return category
    return "기타"


def parse_hyundai_statement(html: str) -> list[dict]:
    """명세서 HTML 문자열에서 거래 리스트를 뽑는다.

    반환: [{date:'YYYY-MM-DD', merchant, amount(int), card, relation}, ...]
    이용금액이 0인 행은 제외(취소/할인 등 음수 행은 그대로 유지 → 월합계에서 상계).
    """
    rows = []
    for call in _CALL.findall(html):
        a = _tokenize(call)
        if len(a) < 9:
            continue
        usedate = a[1]
        if not re.fullmatch(r"\d{6}", usedate):
            continue  # 소계/총합계 행
        amount = _to_int(a[5])
        if amount is None or amount == 0:
            continue
        rows.append({
            "date": f"20{usedate[:2]}-{usedate[2:4]}-{usedate[4:6]}",
            "merchant": a[4].strip(),
            "amount": amount,
            "card": a[3].strip(),
            "relation": a[2].strip(),
        })
    return rows


def decode_statement_bytes(raw: bytes) -> str:
    """명세서 HTML 바이트를 문자열로 디코드한다(현대카드 첨부는 euc-kr)."""
    for enc in ("euc-kr", "cp949", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("euc-kr", errors="replace")


# Gmail(mx.google.com)이 수신 시 부여한 인증 결과. FROM 헤더는 위조 가능하므로
# spf/dkim/dmarc pass + 발신 도메인 정합을 요구해, spoof 된 명세서 HTML 이
# 파서·우리카드 복호화(node+jsdom)에 도달하지 못하게 한다.
_AUTH_PASS = re.compile(r"\b(?:dkim|spf|dmarc)=pass\b([^;]*)", re.I)
_AUTH_DOMAIN = re.compile(
    r"(?:header\.d|header\.i|header\.from|smtp\.mailfrom)\s*=\s*<?([^\s;>]+)", re.I
)


def _registrable(domain: str) -> str:
    """도메인의 등록가능 도메인(끝 두 레이블)을 반환. 한국 카드사는 모두 .com."""
    domain = domain.strip().strip(".").lower()
    if "@" in domain:
        domain = domain.rsplit("@", 1)[-1]
    labels = domain.split(".")
    return ".".join(labels[-2:]) if len(labels) >= 2 else domain


def _sender_authenticated(msg, sender: str) -> bool:
    """Gmail 이 부여한 Authentication-Results 로 발신 도메인이 인증됐는지 확인."""
    want = _registrable(sender)
    for header in msg.get_all("Authentication-Results") or []:
        if not header.strip().lower().startswith("mx.google.com"):
            continue  # 위조 가능한 상류 헤더는 무시(Gmail 자체 결과만 신뢰)
        for m in _AUTH_PASS.finditer(header):
            dm = _AUTH_DOMAIN.search(m.group(1))
            if dm and _registrable(dm.group(1)) == want:
                return True
    return False


def _decode_filename(name: str) -> str:
    """RFC2047 인코딩된 첨부 파일명을 디코드(KB 등은 EUC-KR B-인코딩됨)."""
    from email.header import decode_header
    out = []
    for part, enc in decode_header(name or ""):
        out.append(part.decode(enc or "utf-8", errors="replace")
                   if isinstance(part, bytes) else part)
    return "".join(out)


def _woori_anchor_date(msg) -> date | None:
    """우리카드 명세서 메일에서 연도 유도 기준일(anchor)을 뽑는다.

    ① 제목의 결제일 'YYYY년 MM월 DD일' → ② Date 헤더의 날짜. 둘 다 없으면 None.
    재발송 명세서는 본문에 '이용기간'이 없어 이 anchor 로만 연도를 정한다.
    """
    from email.utils import parsedate_to_datetime

    # _decode_filename 은 범용 RFC2047 디코더 — 제목에도 그대로 쓴다.
    m = _WOORI_SUBJECT_DATE.search(_decode_filename(msg.get("Subject") or ""))
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    try:
        dt = parsedate_to_datetime(msg.get("Date"))
    except (TypeError, ValueError):
        return None
    return dt.date() if dt else None


def _woori_decrypt(encrypted_html: str, birth: str) -> str | None:
    """우리카드 VestMail 암호화 HTML 을 그들 JS(node+jsdom)로 복호화한 평문 HTML 반환.

    복호화는 vestmail/decrypt.js 가 담당. 생년월일은 프로세스 목록에 노출되는
    argv 대신 stdin 첫 줄로 넘기고, 이어서 암호화 HTML 을 붙인다. 실패 시 None.
    """
    import os
    import subprocess

    script = os.path.join(os.path.dirname(__file__), "vestmail", "decrypt.js")
    try:
        proc = subprocess.run(
            ["node", script],
            input=(birth + "\n" + encrypted_html).encode("utf-8"),
            capture_output=True,
            timeout=60,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    return proc.stdout.decode("utf-8", errors="replace")


# 지원 카드사: (IMAP FROM 발신자, 첨부 파일명 힌트(소문자), 파서, 결제수단명,
#   복호화필요?). 우리카드만 첨부가 VestMail 암호화 → node 로 선복호화한다.
_SOURCES = [
    (_HYUNDAI_SENDER, "hyundaicard", parse_hyundai_statement, "현대카드", False),
    (_KB_SENDER, "kb_", parse_kb_statement, "KB카드", False),
    (_WOORI_SENDER, "wooricard", parse_woori_statement, "우리카드", True),
]


def _fetch_source(imap, since, sender, fn_hint, parser, payment_method,
                  decrypt_birth) -> list[dict]:
    import email

    rows: list[dict] = []
    typ, data = imap.search(None, "FROM", sender, "SINCE", since)
    if typ != "OK":
        return rows
    for num in data[0].split():
        typ, msg_data = imap.fetch(num, "(RFC822)")
        if typ != "OK" or not msg_data or not msg_data[0]:
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        if not _sender_authenticated(msg, sender):
            continue  # 발신 도메인 미인증(위조 가능) → 명세서로 취급하지 않음
        for part in msg.walk():
            filename = _decode_filename(part.get_filename() or "").lower()
            if not filename.endswith(".html") or fn_hint not in filename:
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            html = decode_statement_bytes(payload)
            if decrypt_birth is not None:
                html = _woori_decrypt(html, decrypt_birth)
                if not html:
                    continue
            if parser is parse_woori_statement:
                # 재발송 명세서는 본문에 연도가 없어 제목 결제일/Date 헤더로 유도
                parsed = parser(html, anchor_date=_woori_anchor_date(msg))
            else:
                parsed = parser(html)
            # _stmt: 배치 내 명세서(첨부) 식별 태그. 같은 명세서 안의 완전 동일
            # 라인 다건에 순번(line_seq)을 부여하기 위한 것으로, DB 에는 저장하지
            # 않는다(routes/card_import.py 의 원장 중복방지 참고).
            stmt_tag = f"{payment_method}/{num.decode('ascii', 'replace')}/{filename}"
            for r in parsed:
                r["payment_method"] = payment_method
                r["_stmt"] = stmt_tag
                rows.append(r)
    return rows


def verify_imap_login(imap_user: str, imap_password: str) -> None:
    """Gmail IMAP 로그인만 확인한다. 실패하면 예외를 그대로 올린다.

    자격증명을 저장하는 시점에 부르는 용도다. 형식만 맞고 실제로는 못 쓰는 값
    (예: 앱 비밀번호가 아니라 계정 비밀번호)이 조용히 저장되면, 사용자는 "저장됨"을
    보지만 수집은 24시간 뒤 스케줄러 로그에서만 실패한다.

    ssl_context·timeout 을 명시하는 이유는 fetch_all_statements 와 같다.
    """
    import imaplib
    import ssl

    imap = imaplib.IMAP4_SSL(
        "imap.gmail.com", ssl_context=ssl.create_default_context(), timeout=15,
    )
    try:
        imap.login(imap_user, imap_password)
    finally:
        try:
            imap.logout()
        except Exception:
            pass


def fetch_all_statements(imap_user: str, imap_password: str, days: int = 40,
                         woori_birth: str = None) -> list[dict]:
    """Gmail IMAP 로 최근 카드 명세서(현대·KB·우리) HTML 첨부를 받아 파싱한다.

    우리카드는 VestMail 암호화라 woori_birth(생년월일 6자리)가 있어야 복호화·파싱한다.
    없으면 우리카드는 건너뛴다. 반환: 각 거래 dict 에 payment_method 와
    _stmt(배치 내 명세서 식별 태그, 중복방지 순번용·비저장) 포함.
    """
    import imaplib
    import ssl

    since = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
    all_rows: list[dict] = []
    # ssl_context 명시: 이 환경의 imaplib 기본 컨텍스트는 인증서를 검증하지 않아
    # (CERT_NONE) MITM 이 Gmail 을 사칭하면 앱 비밀번호가 유출될 수 있다.
    # timeout: 무응답 소켓에 수집 스레드(스케줄러 포함)가 영구 블록되는 것 방지.
    imap = imaplib.IMAP4_SSL(
        "imap.gmail.com", ssl_context=ssl.create_default_context(), timeout=30,
    )
    try:
        imap.login(imap_user, imap_password)
        imap.select("INBOX")
        for sender, fn_hint, parser, pm, needs_decrypt in _SOURCES:
            if needs_decrypt and not woori_birth:
                continue
            birth = woori_birth if needs_decrypt else None
            all_rows.extend(
                _fetch_source(imap, since, sender, fn_hint, parser, pm, birth)
            )
    finally:
        try:
            imap.logout()
        except Exception:
            pass
    return all_rows
