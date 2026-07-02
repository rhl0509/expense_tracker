# 가계부 Pro — 백엔드 (FastAPI)

가계부(개인·가구 공유) 앱의 백엔드. **순수 JSON API**만 제공하며, 화면은
별도 저장소의 Next.js SPA([expense_frontend](https://github.com/rhl0509/expense_frontend))가
담당한다. 페이지 렌더링(Jinja2)은 없다.

## 아키텍처

```
브라우저 ── Next.js SPA (프론트, :3000) ── 프록시 ──▶ FastAPI (:5000) ──▶ MySQL
             동일 출처로 /auth /transaction ...          JSON only
             호출(next.config rewrites)                  Starlette 세션 쿠키
```

- 프론트는 상대경로로 호출하고 Next rewrites가 백엔드로 프록시 → 동일 출처라
  세션 쿠키가 그대로 전달되고 CORS가 필요 없다.
- 인증: Starlette `SessionMiddleware`(서명 쿠키). `session["user_no"]`가 신원,
  `session["account_book_id"]`가 활성 가구.
- 멀티테넌시: 모든 데이터는 가구(`account_book`) 단위로 스코프된다.

## 기술 스택

- Python 3 · FastAPI · Uvicorn
- MySQL 8 (`pymysql` + `dbutils.PooledDB`, ORM 없이 raw SQL, `DictCursor`)
- Anthropic Claude API (AI 어드바이저, 선택)

## 디렉터리

```
app.py                      FastAPI 앱(lifespan·세션·라우터 등록)
config.py                   .env 로드(SECRET_KEY 필수)
database/db_connection.py   pymysql + PooledDB(min2/max20)
routes/
  utils.py        인증 의존성·세션 헬퍼(가구 멤버십/owner 검증)
  auth.py         /auth/register /login /logout /me
  household.py    /auth/books* /auth/invites* (가구 멤버십·초대)
  transaction.py  /transaction/* (거래·카테고리·정기결제·설정·CSV)
  card_import.py  /transaction/import/card (카드 명세서 파싱)
  expense_ai.py   /ai/analyze /ai/chat /ai/agent (Claude 스트리밍)
  health.py       /health
migrations/       스키마 마이그레이션(SQL)
tests/test_api.py pytest 통합 테스트(TestClient + 실 MySQL)
```

## 시작하기

### 1. 사전 준비
- Python 3, MySQL 8
- 가상환경 및 의존성:
  ```bat
  .venv64\Scripts\pip.exe install -r requirements.txt
  ```

### 2. 환경변수(.env)
`.env.example`을 복사해 값을 채운다. 이 백엔드에 필요한 키:

| Key | 필수 | 설명 |
|-----|------|------|
| `SECRET_KEY` | ✅ | 세션 서명 키. 미설정 시 서버가 시작되지 않음 |
| `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | ✅ | MySQL 접속 정보 |
| `ANTHROPIC_API_KEY` | 선택 | AI 어드바이저(`/ai/*`)용. `expense_ai.py`가 import 시점에 클라이언트를 생성하므로 AI 기능을 쓰려면 필요 |

> `.env`는 절대 커밋하지 않는다(`.gitignore`로 제외됨).

### 3. DB 마이그레이션
`migrations/`의 SQL을 순서대로 적용한다.

```bat
mysql -u root -p <DB_NAME> < migrations\001_multitenancy.sql
mysql -u root -p <DB_NAME> < migrations\002_settings_unique_per_book.sql
```

### 4. 실행
```bat
.venv64\Scripts\python.exe app.py     # http://localhost:5000
```

## 테스트

```bat
.venv64\Scripts\python.exe -m pytest tests/ -v
```

통합 테스트는 임시 유저·가구를 만들어 엔드포인트를 검증하고, 생성한 데이터를
teardown에서 모두 정리한다(공유 `settings`는 스냅샷 후 복원).

## 데이터베이스

- 커넥션은 `database/db_connection.py:get_db_connection()`으로만 얻고, 사용 후
  `finally`에서 반드시 `conn.close()`(풀 반환)한다.
- 주요 테이블: `members`, `account_books`, `account_book_members`(멤버십·role),
  `account_book_invites`(토큰 초대), `transactions`, `categories`(계층),
  `recurring_transactions`, `settings`(가구별 사용자 라벨·결제수단).

## 가구·초대 정책

- 한 유저는 여러 가구에 속할 수 있고, 활성 가구를 전환할 수 있다.
- 초대는 **owner만 생성**하며 토큰 기반(기본 7일 만료)이다.
- 초대 목록은 대기중/만료/수락됨 상태를 반환하고, 수락된 초대는 수락자 이름을
  함께 보여준다. 만료 초대 수락은 거부(410)된다.
</content>
</invoke>
