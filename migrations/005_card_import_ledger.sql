-- 005_card_import_ledger.sql
-- 카드 명세서 자동수집 "수집 원장": 한 번이라도 수집한 명세서 라인의 지문을
-- 거래행과 독립적으로 영구 기록한다. gagebu DB 대상. 재실행 안전(IF NOT EXISTS / INSERT IGNORE).
--
-- 왜 원장인가 (감사 H3/M4):
--   기존 중복방지는 "명세서 건수 − transactions 기존 건수" 라서
--   ① 사용자가 자동수집 거래를 지우면 다음 수집이 되살리고(H3-a),
--   ② 가맹점명·금액을 수정하면 그룹키가 달라져 원본이 또 들어가고(H3-b),
--   ③ SELECT COUNT → INSERT 가 비원자라 동시 요청이 둘 다 삽입했다(M4).
--   원장은 거래를 지우거나 고쳐도 남으므로 ①②를 막고, UNIQUE 제약이
--   동시 삽입 중 하나만 통과시켜 ③을 구조적으로 막는다.
--
-- fingerprint = SHA2-256( CONCAT_WS('|',
--     DATE_FORMAT(거래일,'%Y-%m-%d'),
--     NORM(가맹점명), NORM_AMT(금액), NORM(결제수단)) )
--   NORM(x)    : NBSP(U+00A0)·전각공백(U+3000)→공백 치환 후 [[:space:]]+ 를 한 칸으로
--                접고 TRIM, LOWER. (routes/card_import.py 의 _norm_text 와 반드시 동일)
--   NORM_AMT(x): DECIMAL(15,2) 문자열에서 소수점 이하 후행 0 과 점 제거
--                ('11000.00'→'11000'). 파서의 int 금액 str() 과 동일해진다.
--   스코프는 해시에 넣지 않고 UNIQUE 키의 account_book_id 컬럼으로 건다.
--
-- line_seq: 같은 명세서에 완전 동일 라인이 n번 나올 수 있어(예: 오락실 1,000원 x10)
--   지문만으로는 다건을 구분 못 한다. 명세서(첨부) 단위로 1..n 을 부여해
--   (account_book_id, fingerprint, line_seq) 를 유니크로 잡는다.

CREATE TABLE IF NOT EXISTS card_import_ledger (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    account_book_id   INT UNSIGNED NOT NULL,
    fingerprint       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    line_seq          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    -- 아래는 디버깅·감사용 원본 스냅샷(지문 계산 결과 검증/추적용). 지문의 근거이므로
    -- 이후 거래행이 수정·삭제돼도 여기 값은 바뀌지 않는다.
    transaction_date  DATE NOT NULL,
    merchant          VARCHAR(100) NOT NULL,
    amount            DECIMAL(15,2) NOT NULL,
    payment_method    VARCHAR(50) NOT NULL,
    member_id         INT UNSIGNED NULL,      -- 수집을 수행한 멤버
    transaction_id    INT UNSIGNED NULL,      -- 삽입 당시 거래 id. 의도적으로 FK 없음:
                                              -- 거래가 삭제돼도 원장은 남아야 한다(H3-a).
    first_imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cil_book_fp_seq (account_book_id, fingerprint, line_seq),
    KEY idx_cil_member (member_id),
    CONSTRAINT fk_cil_book   FOREIGN KEY (account_book_id) REFERENCES account_books(id) ON DELETE CASCADE,
    CONSTRAINT fk_cil_member FOREIGN KEY (member_id)       REFERENCES members(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='카드 명세서 자동수집 원장(수집한 라인 지문 영구 기록)';

-- ── 백필: 기존 자동수집 거래를 원장에 등록 ────────────────────────────
-- memo 형식 '{card}[/{relation}] · {결제수단} 명세서 자동수집' 으로 식별.
-- 이게 없으면 마이그레이션 직후 첫 수집이 기존분(최근 40일 창)을 전부 재삽입한다.
-- line_seq 는 (장부, 지문) 그룹 내 id 순 ROW_NUMBER — 동일 라인 n건이면 1..n.
-- ⚠️ 이미 가맹점명·금액이 "수정된" 자동수집 행은 원본 지문을 복원할 수 없어
--    수정 후 값으로 백필된다(다음 수집 때 원본 라인이 1회 재삽입될 수 있음 — 한계).
-- 검증(2026-07-10, 읽기 전용): 자동수집 721행 전수에 대해 아래 SQL 지문 ==
--    routes/card_import.py statement_fingerprint() 결과 (불일치 0),
--    (장부,지문,seq) 충돌 0. MySQL 8.0.46.
INSERT IGNORE INTO card_import_ledger
    (account_book_id, fingerprint, line_seq, transaction_date, merchant,
     amount, payment_method, member_id, transaction_id, first_imported_at)
SELECT
    t.account_book_id,
    SHA2(CONCAT_WS('|',
        DATE_FORMAT(t.transaction_date, '%Y-%m-%d'),
        LOWER(TRIM(REGEXP_REPLACE(REPLACE(REPLACE(t.title,
            CHAR(0xC2A0 USING utf8mb4), ' '), CHAR(0xE38080 USING utf8mb4), ' '),
            '[[:space:]]+', ' '))),
        TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(t.amount AS CHAR))),
        LOWER(TRIM(REGEXP_REPLACE(REPLACE(REPLACE(t.payment_method,
            CHAR(0xC2A0 USING utf8mb4), ' '), CHAR(0xE38080 USING utf8mb4), ' '),
            '[[:space:]]+', ' ')))
    ), 256),
    ROW_NUMBER() OVER (
        PARTITION BY t.account_book_id,
            SHA2(CONCAT_WS('|',
                DATE_FORMAT(t.transaction_date, '%Y-%m-%d'),
                LOWER(TRIM(REGEXP_REPLACE(REPLACE(REPLACE(t.title,
                    CHAR(0xC2A0 USING utf8mb4), ' '), CHAR(0xE38080 USING utf8mb4), ' '),
                    '[[:space:]]+', ' '))),
                TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(t.amount AS CHAR))),
                LOWER(TRIM(REGEXP_REPLACE(REPLACE(REPLACE(t.payment_method,
                    CHAR(0xC2A0 USING utf8mb4), ' '), CHAR(0xE38080 USING utf8mb4), ' '),
                    '[[:space:]]+', ' ')))
            ), 256)
        ORDER BY t.id
    ),
    t.transaction_date,
    t.title,
    t.amount,
    t.payment_method,
    t.member_id,
    t.id,
    t.created_at
FROM transactions t
WHERE t.memo LIKE '%명세서 자동수집%'
  AND t.payment_method IS NOT NULL;

-- 롤백:
--   DROP TABLE IF EXISTS card_import_ledger;
--   (transactions 는 건드리지 않으므로 테이블 드롭만으로 원복된다.
--    단 드롭하면 코드가 원장을 참조하므로 코드도 함께 롤백해야 한다.)
