-- 007_recurring_payment_method.sql
-- 정기결제에 결제수단을 추가한다. 재실행 안전.
--
-- 왜 필요한가:
--   recurring_transactions 에 payment_method 가 없어서, /process-recurring 이 만드는
--   거래는 payment_method 가 NULL 로 들어갔다. 즉 매달 자동 생성되는 구독료가
--   "어느 카드로 나갔는지" 기록되지 않았고, 결제수단별 지출 통계·필터에서 전부
--   '기타'로 빠졌다. 거래 추가(대시보드 모달)에는 결제수단 칸이 있는데 정기결제에만
--   없어서 생긴 비대칭이다.
--
-- 타입은 transactions.payment_method 와 맞춘다(varchar(50) NULL).
-- 값은 자유 문자열이다 — 결제수단 목록은 settings 에 account_book 별로
-- setting_key='payment_methods' 로 저장되고 사용자가 자유롭게 추가한다. 그래서
-- ENUM 이나 FK 로 묶지 않는다(묶으면 결제수단을 추가할 때마다 스키마가 바뀐다).
--
-- 기존 행은 NULL 로 남는다. 이 장부의 정기결제는 1건뿐이라 사용자가 편집할 때 채우면
-- 된다. 임의의 기본값(예: 첫 결제수단)을 넣으면 틀린 데이터를 만든다.
--
-- MySQL 8 에는 ADD COLUMN IF NOT EXISTS 가 없다(MariaDB 문법). information_schema 로
-- 확인한 뒤 동적 실행해서 재실행 안전을 만든다.

SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'recurring_transactions'
      AND COLUMN_NAME = 'payment_method'
);

SET @ddl := IF(@col_exists = 0,
    'ALTER TABLE recurring_transactions ADD COLUMN payment_method VARCHAR(50) NULL AFTER `user`',
    'DO 0'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 롤백:
--   ALTER TABLE recurring_transactions DROP COLUMN payment_method;
--   (코드가 이 컬럼을 참조하므로 코드도 함께 롤백해야 한다.)
