"""
merchant_classifier.py — 가맹점 → 카테고리 자동분류 (룰 + AI 하이브리드).

card_statement.categorize_merchant() 의 키워드 룰은 그대로 두고 그 **앞뒤를 감싼다**.
룰을 대체하지 않는 이유: 룰은 무료·즉답이고 AI 키가 없는 사용자에게도 동작해야 한다.
AI는 룰이 못 맞춘 가맹점에만 붙는 폴백이다.

분류 순서:
  ① 개인 캐시 source='user'  — 사용자 교정. 항상 최우선. (교정 UI가 아직 없어 현재 미사용)
  ② 키워드 룰               — card_statement.categorize_merchant()
  ③ 개인 캐시 source='ai'    — 이 장부에서 이미 AI가 분류한 가맹점은 다시 묻지 않는다
  ④ 전역 카탈로그           — merchant_catalog(장부 무관·선큐레이션). 그 장부에 그
                              카테고리 이름이 있을 때만 채택(allowed 필터)
  ⑤ AI 배치 분류            — 미매칭분만, 옵트인일 때만, 1회 수집당 상한 안에서
  ⑥ '기타'

AI 호출은 DB 트랜잭션 **밖**에서 한다. 삽입 루프 안에서 네트워크를 타면 수십 초 동안
행 잠금을 쥔 채 외부 응답을 기다리게 된다.
"""
import logging
import re

from card_statement import categorize_merchant
from database.db_connection import get_db_connection

logger = logging.getLogger(__name__)

FALLBACK_CATEGORY = "기타"
AI_CATEGORIZE_SETTING = "ai_auto_categorize"

# 한 번의 수집에서 AI에 물어보는 신규 가맹점 수 상한. 캐시 덕에 정상 운영에서는 한 자릿수로
# 수렴하지만, 첫 수집이나 캐시 초기화 직후에는 수백 건이 될 수 있다 — 사용자 지갑(BYOK)에서
# 나가는 비용이라 상한을 둔다. 초과분은 룰 결과('기타')로 남고 다음 수집에서 처리된다.
MAX_AI_MERCHANTS = 40

_WS_RE = re.compile(r"[ \t\r\n\v\f 　]+")


def normalize_merchant(merchant) -> str:
    """캐시 키. 공백류(NBSP·전각 포함)를 한 칸으로 접고 양끝 제거 + 소문자 + 120자 절단.

    merchant_category_map.merchant_key 가 VARCHAR(120)이라 길이를 여기서 맞춘다.
    이 규칙이 바뀌면 기존 캐시가 전부 미스가 되므로 마이그레이션을 함께 고려할 것.
    """
    return _WS_RE.sub(" ", str(merchant or "")).strip().lower()[:120]


def _is_ai_enabled(cursor, account_book_id) -> bool:
    """AI 자동분류 옵트인 여부. 기본값은 꺼짐 — 켜지 않은 사용자의 키로 돈을 쓰지 않는다."""
    cursor.execute(
        "SELECT setting_value FROM settings WHERE account_book_id = %s AND setting_key = %s",
        (account_book_id, AI_CATEGORIZE_SETTING),
    )
    row = cursor.fetchone()
    return bool(row and str(row["setting_value"]).strip() == "1")


def _load_cache(cursor, account_book_id, keys):
    """{merchant_key: (category_name, source)}. keys 가 비면 조회하지 않는다."""
    if not keys:
        return {}
    placeholders = ",".join(["%s"] * len(keys))
    cursor.execute(
        f"""SELECT merchant_key, category_name, source
            FROM merchant_category_map
            WHERE account_book_id = %s AND merchant_key IN ({placeholders})""",
        (account_book_id, *keys),
    )
    return {r["merchant_key"]: (r["category_name"], r["source"]) for r in cursor.fetchall()}


# 전역 카탈로그 키가 최소 이 길이 이상일 때만 접두 매칭에 쓴다. 1글자 브랜드가 무관한
# 가맹점 앞에 우연히 걸리는 오탐을 막는다(card_statement 의 "cu"↔"mercure" 오매칭과 같은 종류).
_MIN_BRAND_LEN = 2


def _match_global(cursor, keys):
    """{정규화 가맹점 키: category_name} — 전역 카탈로그를 **브랜드 접두 매칭**한다.

    카탈로그 키는 지점명을 벗긴 브랜드다(예: '이디야'). 그래서 정확 매칭이 아니라
    "가맹점명이 그 브랜드로 시작하는가"로 조회한다 — '이디야강남점' → '이디야' 적중.
    긴 브랜드를 우선해 '이마트24'가 '이마트'보다 먼저 잡히게 한다(오탐 축소).

    카탈로그는 프랜차이즈만 담아 규모가 작다(수백~수천). 카드 수집은 월 1회·옵트인이라
    매 호출 전량 로드해도 부담이 없다. 장부 무관이라 account_book_id 를 받지 않는다.
    """
    if not keys:
        return {}
    cursor.execute("SELECT merchant_key, category_name FROM merchant_catalog")
    brands = [(r["merchant_key"], r["category_name"]) for r in cursor.fetchall()
              if len(r["merchant_key"]) >= _MIN_BRAND_LEN]
    brands.sort(key=lambda kc: -len(kc[0]))     # 긴 브랜드 우선
    out = {}
    for key in keys:
        for brand, category in brands:
            if key.startswith(brand):
                out[key] = category
                break
    return out


def _save_cache(cursor, account_book_id, mapping, source="ai"):
    """분류 결과를 캐시에 기록. 사용자 교정(source='user')은 AI 결과로 덮지 않는다."""
    for key, category in mapping.items():
        cursor.execute(
            """INSERT INTO merchant_category_map
                 (account_book_id, merchant_key, category_name, source)
               VALUES (%s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE
                 category_name = IF(source = 'user', category_name, VALUES(category_name)),
                 source        = IF(source = 'user', 'user', VALUES(source))""",
            (account_book_id, key, category, source),
        )


def resolve_categories(account_book_id, member_id, merchants, allowed_categories):
    """가맹점명 리스트 → {원본 가맹점명: 카테고리명}.

    allowed_categories 는 이 장부에 실제로 존재하는 지출 카테고리명 집합이다. AI가
    무엇을 답하든 이 집합 밖의 값은 버린다 — 환각한 카테고리로 거래가 분류되지 않게
    막는 마지막 방어선이다.

    자체 커넥션을 열고 닫는다. 호출측(_insert_rows)의 삽입 트랜잭션과 분리하기 위해서다.
    """
    result = {}
    if not merchants:
        return result

    allowed = set(allowed_categories or ())
    # 원본 → 정규화 키. 같은 가맹점이 배치에 여러 번 나와도 키는 하나로 접힌다.
    key_of = {m: normalize_merchant(m) for m in set(merchants)}

    keys = sorted(set(key_of.values()))
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cache = _load_cache(cursor, account_book_id, keys)      # 개인(장부별·정확매칭)
            catalog = _match_global(cursor, keys)                   # 전역(장부 무관·브랜드 접두)
            ai_enabled = _is_ai_enabled(cursor, account_book_id)

        unresolved = {}          # {정규화 키: 소독 전 원본 가맹점명}
        for merchant, key in key_of.items():
            cached = cache.get(key)
            # ① 사용자 교정이 있으면 룰보다 우선한다.
            if cached and cached[1] == "user" and cached[0] in allowed:
                result[merchant] = cached[0]
                continue
            # ② 키워드 룰.
            ruled = categorize_merchant(merchant)
            if ruled != FALLBACK_CATEGORY and ruled in allowed:
                result[merchant] = ruled
                continue
            # ③ 이 장부에서 AI가 이미 분류해 둔 가맹점.
            if cached and cached[0] in allowed:
                result[merchant] = cached[0]
                continue
            # ④ 전역 카탈로그(선큐레이션). 기본 10종으로 저장돼 있고, 이 장부에 그 이름이
            #    없으면(카테고리를 커스텀한 경우) allowed 필터에서 버려져 ⑤/⑥으로 넘어간다.
            global_cat = catalog.get(key)
            if global_cat and global_cat in allowed:
                result[merchant] = global_cat
                continue
            result[merchant] = FALLBACK_CATEGORY
            unresolved.setdefault(key, merchant)

        if not (ai_enabled and unresolved and allowed):
            return result

        # ④ AI 배치 분류. 여기서만 네트워크를 탄다(커서를 쥐고 있지 않은 상태).
        targets = sorted(unresolved.items())[:MAX_AI_MERCHANTS]
        if len(unresolved) > MAX_AI_MERCHANTS:
            logger.info(
                "AI 자동분류 상한 적용: 미매칭 %d건 중 %d건만 분류 (장부 %s)",
                len(unresolved), MAX_AI_MERCHANTS, account_book_id,
            )
        # 순환 import 회피 — expense_ai 는 이 모듈을 import 하지 않는다.
        from routes.expense_ai import classify_merchants_for_member

        try:
            decided = classify_merchants_for_member(
                member_id, [m for _, m in targets], sorted(allowed),
            )
        except Exception:
            logger.exception("AI 가맹점 분류 실패 — 룰 결과로 진행 (장부 %s)", account_book_id)
            return result

        learned = {}
        merchant_to_key = {m: k for k, m in targets}
        for merchant, category in (decided or {}).items():
            if category not in allowed:
                continue                       # 환각·오탈자는 버린다
            key = merchant_to_key.get(merchant)
            if key is None:
                continue                       # 우리가 묻지 않은 가맹점은 무시
            result[merchant] = category
            learned[key] = category

        if learned:
            with conn.cursor() as cursor:
                _save_cache(cursor, account_book_id, learned, source="ai")
            conn.commit()
            logger.info("AI 자동분류 %d건 캐시 기록 (장부 %s)", len(learned), account_book_id)
        return result
    finally:
        conn.close()
