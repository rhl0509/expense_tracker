-- 012_merchant_category_map.sql
-- 가맹점 → 카테고리 확정 캐시 (자동분류 하이브리드의 학습 저장소).
--
-- 왜 필요한가: 종전 분류는 card_statement._CATEGORY_RULES 의 키워드 하드코딩 하나였다.
-- 그 목록에는 업종 단서가 없는 개별 상호(예: '멘츠루', '느루집')까지 직접 박혀 있어서
-- 새 가게에 갈 때마다 코드를 고쳐 배포해야 했고, 안 고치면 전부 '기타'로 떨어졌다.
--
-- 분류 순서는 코드(merchant_classifier.resolve_categories)에 있다:
--   ① 이 표의 source='user'  (사용자 교정 — 항상 최우선)
--   ② 키워드 룰            (무료·즉답. AI 키가 없어도 여기까지는 동작한다)
--   ③ 이 표의 source='ai'   (이미 AI가 분류해 둔 가맹점 → 다시 묻지 않는다)
--   ④ AI 배치 분류         (미매칭분만, 옵트인일 때만)
--   ⑤ '기타'
--
-- 캐시가 있어야 BYOK 비용이 수렴한다. 한 사용자의 가맹점 종류는 수백 개 수준이라
-- 초반 몇 번의 수집 이후에는 신규 가맹점만 AI를 타고, 나머지는 ②③에서 끝난다.
--
-- merchant_key 는 정규화된 가맹점명이다(소문자 + 공백류 접기). 정규화 규칙은
-- merchant_classifier.normalize_merchant() 와 반드시 같이 움직여야 한다 —
-- 어긋나면 캐시가 조용히 미스를 내고 같은 가맹점을 매번 AI로 다시 묻게 된다.
--
-- source='user' 는 지금은 쓰이지 않는다. 거래의 카테고리를 수정하는 엔드포인트가
-- 아직 없기 때문이다(2026-07-22 확인: transactions 의 UPDATE 는 카테고리 삭제 시
-- NULL 처리 두 곳뿐). 교정 UI가 생기면 그때 이 값을 쓰면 되도록 자리만 만들어 둔다 —
-- 나중에 컬럼을 추가하는 마이그레이션을 또 돌리지 않기 위해서다.

CREATE TABLE IF NOT EXISTS merchant_category_map (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_book_id INT UNSIGNED NOT NULL,
    merchant_key    VARCHAR(120) NOT NULL COMMENT '정규화된 가맹점명(소문자·공백접기)',
    category_name   VARCHAR(50)  NOT NULL COMMENT 'categories.name 과 대조해 쓴다',
    source          ENUM('ai','user') NOT NULL DEFAULT 'ai',
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_book_merchant (account_book_id, merchant_key),
    CONSTRAINT fk_mcm_account_book FOREIGN KEY (account_book_id)
        REFERENCES account_books (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='가맹점 자동분류 캐시';
