-- 002_settings_unique_per_book.sql
-- settings 테이블의 UNIQUE 제약을 setting_key 단독 → (account_book_id, setting_key) 복합키로 교체.
-- 기존(단일 DB 시절)엔 setting_key 하나만 UNIQUE라, 새 가구의 설정 저장 시
-- ON DUPLICATE KEY UPDATE 가 다른 가구의 같은 setting_key 행을 덮어써버리는 버그가 있었다.
-- gagebu DB 대상.

ALTER TABLE settings
    DROP INDEX uq_setting_key,
    ADD UNIQUE KEY uq_book_setting (account_book_id, setting_key);
