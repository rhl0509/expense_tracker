-- 010_transactions_archive.sql
-- 데이터 초기화를 "영구 삭제"에서 "아카이브 후 이동"으로 바꾼다.
-- 가구장이 /transaction/reset 을 누르면 거래를 지우는 대신 transactions_archive 로
-- 통째로 옮기고, reset_batches 에 그 초기화 이벤트를 한 건 남긴다. 마이페이지에서
-- 미복원 배치를 골라 되돌릴 수 있다(복원 시 아카이브 → transactions 재삽입).
--
-- 아카이브는 "원본이 사라져도 보존"이 목적이라, 원본 categories/members 로의 FK 를 걸지
-- 않고 값만 보관한다(그 원본이 나중에 지워져도 아카이브는 남아야 한다). 배치→아카이브만
-- FK(CASCADE)로 묶어, 가구가 삭제되면 배치와 아카이브가 함께 정리되게 한다.

CREATE TABLE IF NOT EXISTS reset_batches (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    account_book_id INT UNSIGNED NOT NULL COMMENT '초기화된 가구',
    member_id       INT UNSIGNED NOT NULL COMMENT '초기화 실행자(참고용, FK 없음 — 실행자 탈퇴와 독립)',
    tx_count        INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '아카이브된 거래 수',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '초기화 시각',
    restored_at     DATETIME DEFAULT NULL COMMENT '복원 시각(NULL=미복원, 되돌리기 대상)',
    KEY idx_reset_batches_book (account_book_id, restored_at),
    CONSTRAINT fk_reset_batches_book FOREIGN KEY (account_book_id) REFERENCES account_books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='데이터 초기화 이벤트(아카이브 배치)';

CREATE TABLE IF NOT EXISTS transactions_archive (
    id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id         INT UNSIGNED NOT NULL COMMENT '초기화 배치(reset_batches.id)',
    original_id      INT UNSIGNED NOT NULL COMMENT '원본 transactions.id (참고용)',
    account_book_id  INT UNSIGNED NOT NULL,
    category_id      INT UNSIGNED DEFAULT NULL COMMENT '원본 카테고리(FK 없음 — 복원 시 존재 검증)',
    member_id        INT UNSIGNED NOT NULL COMMENT '원본 작성자(FK 없음 — 복원 시 존재 검증)',
    type             ENUM('income','expense') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
    amount           DECIMAL(15,2) NOT NULL,
    title            VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
    memo             VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
    transaction_date DATE NOT NULL,
    payment_method   VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
    created_at       DATETIME NOT NULL COMMENT '원본 생성일 보존',
    updated_at       DATETIME NOT NULL COMMENT '원본 수정일 보존',
    user             VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '공용',
    KEY idx_tx_archive_batch (batch_id),
    CONSTRAINT fk_tx_archive_batch FOREIGN KEY (batch_id) REFERENCES reset_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='초기화로 아카이브된 거래내역';
