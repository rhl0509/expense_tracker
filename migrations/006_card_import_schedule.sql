-- 006_card_import_schedule.sql
-- 카드 명세서 자동수집 스케줄러의 "마지막 실행 시각"을 영속화한다.
-- 재실행 안전(IF NOT EXISTS / INSERT IGNORE).
--
-- 왜 필요한가:
--   기존 _scheduler_loop()는 `while not _scheduler_stop.wait(24h)` 라서
--   ① 기동 후 첫 실행까지 무조건 24시간을 기다리고,
--   ② 마지막 실행 시각을 어디에도 남기지 않아 재시작하면 그 24시간이 리셋된다.
--   → 백엔드를 하루에 한 번이라도 재시작하면 자동수집이 영원히 한 번도 돌지 않는다.
--     개발 중엔 재시작이 잦으므로 사실상 죽은 기능이었다.
--   주석("기동 직후 즉시 돌지 않고 한 주기 뒤부터 실행")이 말하는 의도 자체는 맞지만,
--   "마지막 실행 시각"이 없으면 그 의도를 재시작 너머로 유지할 수 없다.
--
-- 왜 settings 테이블을 쓰지 않는가:
--   settings 는 account_book 별 사용자 라벨·결제수단 저장소다(가구 스코프).
--   스케줄러 시각은 전역 값이라 account_book_id 를 NULL 로 넣어야 하는데,
--   002 가 건 UNIQUE(account_book_id, setting_key) 는 MySQL 에서 NULL 중복을
--   허용하므로 같은 키가 여러 행 생길 수 있다. 스코프도 의미도 맞지 않는다.
--
-- 단일 행 테이블이다. id 는 항상 1 이며 CHECK 로 고정한다.

CREATE TABLE IF NOT EXISTS card_import_schedule (
    id          TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    last_run_at TIMESTAMP NULL DEFAULT NULL COMMENT '_import_all_members() 를 마지막으로 시도한 시각(성공·실패 무관)',
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_cis_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='카드 자동수집 스케줄러 상태(단일 행)';

-- last_run_at 이 NULL = 한 번도 안 돌았다 → 기동 시 즉시 1회 실행한다.
INSERT IGNORE INTO card_import_schedule (id, last_run_at) VALUES (1, NULL);

-- 롤백:
--   DROP TABLE IF EXISTS card_import_schedule;
--   (코드가 이 테이블을 참조하므로 코드도 함께 롤백해야 한다.)
