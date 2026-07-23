-- 013_merchant_catalog.sql
-- 전역 가맹점 카탈로그 — 장부 무관 공유 분류 캐시 (다인 서비스).
--
-- 왜 개인 캐시(012)와 별개인가:
--   merchant_category_map(012)은 account_book_id 단위라 남의 장부엔 안 붙는다.
--   그런데 가맹점→카테고리는 대부분 일반 지식이고(올리브영=드럭스토어), 모든 신규
--   가입자는 동일한 기본 10 카테고리로 시작한다(routes/auth.py _DEFAULT_CATEGORIES).
--   그래서 "가맹점 → 기본 카테고리" 매핑은 사용자 간에 공유할 수 있다. 이 표가 그 공유분이다.
--
-- 채우는 방법 — **선큐레이션만**. rho가 로컬 LLM(tools/curate_merchant_catalog.py)으로
--   분류하고 검수한 결과를 seeds/merchant_catalog.sql 로 적재한다. 런타임 승격(사용자
--   AI 분류 결과의 자동 축적)은 하지 않는다 — 한 사용자의 오분류가 전역으로 전파되는
--   것과, 특이 가맹점명이 통제 없이 쌓이는 것을 막기 위해서다. source 는 그래서 단일값.
--
-- ■ 프라이버시 경계 (다인이라 중요):
--   이 표는 (가맹점명 → 카테고리)만 담는다. **"누가 그 가맹점에 갔는지"는 담지 않는다.**
--   가맹점명은 공개된 상호이고, 조회는 각 사용자가 이미 자기 명세서에서 가진 가맹점명으로만
--   일어난다. member_id·account_book_id 컬럼이 없는 것은 설계이지 누락이 아니다.
--
-- category_name 은 기본 10 카테고리 중 하나로만 채운다(선큐레이션 배치가 그 목록으로
--   분류한다). 사용자가 카테고리를 커스텀한 장부에서는 조회 측(merchant_classifier)이
--   그 장부의 카테고리 화이트리스트로 걸러 불일치 값을 버린다.
--
-- merchant_key 정규화는 merchant_classifier.normalize_merchant() 와 반드시 같이 움직인다.
--   개인 캐시(012)와 동일한 키 규칙이라, 같은 가맹점이면 두 표에서 같은 키가 나온다.

CREATE TABLE IF NOT EXISTS merchant_catalog (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    merchant_key  VARCHAR(120) NOT NULL COMMENT '정규화된 가맹점명(소문자·공백접기)',
    category_name VARCHAR(50)  NOT NULL COMMENT '기본 10 카테고리 중 하나',
    source        ENUM('curated') NOT NULL DEFAULT 'curated'
                  COMMENT 'rho 선큐레이션 전용 — 런타임 승격 없음',
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_merchant (merchant_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='전역 가맹점 분류 카탈로그(장부 무관·선큐레이션)';
