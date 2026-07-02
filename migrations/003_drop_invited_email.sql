-- 003_drop_invited_email.sql
-- account_book_invites.invited_email 컬럼 제거.
-- 초대는 토큰 링크 방식이라 이메일을 저장/사용하는 코드가 없어 죽은 컬럼이었다.

ALTER TABLE account_book_invites
    DROP COLUMN invited_email;
