-- 008_stock_ingest.sql
-- 주식 앱(d:\stock_git)이 배당·매매를 이 가계부에 자동 기록하기 위한
-- ① 연동 토큰 ② 기록 원장. gagebu DB 대상. 재실행 안전(IF NOT EXISTS).
--
-- ── 왜 "가계부가 발급하는 토큰"인가 ──────────────────────────────────
-- 주식 앱이 JWT 를 서명해 보내는 안을 먼저 검토했으나, 그러면 주식 앱이
-- 이 가계부 데이터에 대한 신원 공급자(IdP)가 된다. 주식 앱은 공개 회원가입이라
-- (stock_git/routes/auth.py:68) 그 가입 정책이 곧 이 가계부의 가입 정책이 된다.
-- 가계부는 rho 1인의 사적 장부이므로 신뢰 방향이 뒤집힌다.
-- 토큰을 가계부가 발급하면 주식 앱은 "누구로 기록할지" 를 주장할 수단 자체가 없다
-- — 토큰 행이 member_id·account_book_id 를 결정한다.
--
-- ── 왜 원장인가 (005 와 같은 이유) ───────────────────────────────────
-- 발신측(주식 앱) dedup 만으로는 부족하다:
--   ① POST 성공 후 응답이 유실되면 발신측은 실패로 알고 재시도 → 중복 삽입.
--      공격자 없이 타임아웃 한 번이면 발생한다.
--   ② 사용자가 자동기록 거래를 지우면 다음 실행이 되살린다.
--   ③ SELECT → INSERT 는 비원자라 동시 요청이 둘 다 삽입한다.
-- 원장 + UNIQUE 가 ①②③ 을 구조적으로 막는다. 005 가 이미 겪은 실패다.
--
-- idempotency_key 는 발신측이 만든다(주식 앱이 의미를 아는 쪽이므로):
--   배당: SHA2('dividend|{stock_code}|{ex_div_date}', 256)
--   매매: SHA2('trade|{stock_transactions.id}', 256)
-- 스코프는 해시에 넣지 않고 UNIQUE 키의 account_book_id 컬럼으로 건다(005 와 동일).

-- ── ① 연동 토큰 ──────────────────────────────────────────────────────
-- 평문은 저장하지 않는다. 발급 시 1회만 표시하고 SHA2-256 해시만 남긴다.
-- 이 행 하나가 "누구의 어느 장부에 쓸 수 있는가" 를 전부 결정한다.
-- 취소 = UPDATE enabled = 0 (키 회전·양쪽 재배포 불필요).
CREATE TABLE IF NOT EXISTS stock_ingest_token (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    member_id        INT UNSIGNED NOT NULL,      -- 기록 주체
    account_book_id  INT UNSIGNED NOT NULL,      -- 기록 대상 장부
    label            VARCHAR(50) NOT NULL DEFAULT '',
    enabled          TINYINT(1) NOT NULL DEFAULT 1,
    expires_at       DATETIME NULL,              -- NULL = 무기한
    last_used_at     DATETIME NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sit_hash (token_hash),
    KEY idx_sit_member (member_id),
    CONSTRAINT fk_sit_book   FOREIGN KEY (account_book_id) REFERENCES account_books(id) ON DELETE CASCADE,
    CONSTRAINT fk_sit_member FOREIGN KEY (member_id)       REFERENCES members(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='주식 앱 연동 토큰(해시만 저장, 행이 member·book 을 결정)';

-- ── ② 기록 원장 ──────────────────────────────────────────────────────
-- transaction_id 에 의도적으로 FK 를 걸지 않는다: 사용자가 그 거래를 지워도
-- 원장은 남아야 다음 실행이 되살리지 않는다(005:38-39 와 같은 근거).
CREATE TABLE IF NOT EXISTS stock_ingest_ledger (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    account_book_id  INT UNSIGNED NOT NULL,
    idempotency_key  CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- 아래는 감사·추적용 스냅샷. 이후 거래행이 수정·삭제돼도 바뀌지 않는다.
    source           VARCHAR(20) NOT NULL,       -- 'dividend' | 'trade'
    transaction_id   INT UNSIGNED NULL,          -- 삽입 당시 거래 id. FK 없음(위 사유).
    token_id         INT UNSIGNED NULL,          -- 어느 토큰이 썼는가(부인방지)
    amount           DECIMAL(15,2) NOT NULL,
    title            VARCHAR(200) NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sil_book_idem (account_book_id, idempotency_key),
    KEY idx_sil_token (token_id),
    CONSTRAINT fk_sil_book  FOREIGN KEY (account_book_id) REFERENCES account_books(id) ON DELETE CASCADE,
    CONSTRAINT fk_sil_token FOREIGN KEY (token_id)        REFERENCES stock_ingest_token(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='주식 앱 자동기록 원장(멱등키 영구 기록 — 거래를 지워도 부활 금지)';

-- 백필 없음: 주식 앱의 기존 기록은 별도 DB(stock_stack)의 고아 테이블에 있고
-- 이 가계부(gagebu)에는 주식발 거래가 한 건도 없다(2026-07-17 실측: 0건).
-- 과거분을 옮길지는 별건 — 옮긴다면 원장에도 함께 등록해야 재삽입되지 않는다.

-- 롤백:
--   DROP TABLE IF EXISTS stock_ingest_ledger;
--   DROP TABLE IF EXISTS stock_ingest_token;
--   (transactions 는 건드리지 않으므로 드롭만으로 원복된다. 단 드롭하면
--    routes/stock_ingest.py 가 이 테이블을 참조하므로 코드도 함께 롤백해야 한다.)
