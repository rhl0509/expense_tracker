# 배포 가이드 (AWS)

가계부(AI 가계부)를 AWS에 올리는 절차. 아키텍처는 **EC2 1대(앱 컨테이너 3개) + RDS 1대(MySQL)**.

```
브라우저 ─HTTPS─▶ Caddy(EC2:443) ─▶ frontend(Next standalone) ─▶ backend(FastAPI)
                                                                        │
                                                              RDS MySQL(별도, SSL)
```

Caddy만 외부에 열리고 frontend·backend는 컨테이너 내부 네트워크에만 있다.

---

## 이미 준비된 것 (코드/산출물)

- `Dockerfile`(백엔드, Node 포함·비루트 실행), `frontend/Dockerfile`(Next standalone·비루트), `docker-compose.yml`, `Caddyfile`, `Caddy.Dockerfile`(rate_limit 플러그인 빌드)
- Caddy 앞단 방어: 요청 본문 10MB 제한(DoS), `/auth/register`·`/auth/login` IP당 레이트리밋(10회/분)
- `next.config.ts` `output: "standalone"` + `/integration` rewrites
- `app.py` `BIND_HOST` env (컨테이너에서 `0.0.0.0`)
- `database/db_connection.py` `DB_SSL_CA` 설정 시 TLS 연결
- `requirements.txt` 버전 고정
- `schema.sql` — 빈 DB에 한 번에 적용하는 완성 스키마(migrations 001~010 반영)
- BYOK: 서버 공용 AI 키 없음(사용자별 키). `AI_ENC_KEY`로 암호화(미설정 시 `SECRET_KEY` 파생)

## 로컬에서 배포 구성 검증

```bash
# .env 에 DB_HOST=host.docker.internal (호스트 MySQL 사용 시)
docker compose up --build
# https://localhost 접속 (로컬은 Caddy 내부 인증서 → 브라우저 경고 정상)
```

---

## AWS 배포 순서

### 1. RDS (MySQL) 먼저 — 잠그고 시작
- db.t3.micro, MySQL 8. **Public access 차단.**
- 보안그룹: 3306을 **EC2 보안그룹에서만** 허용(전체 공개 금지).
- 스키마 적재: `schema.sql`(완성 스키마 — 001~010 반영, 전체 테이블 포함)을 빈 RDS 에 한 번 적용: `mysql -h <RDS엔드포인트> -u <user> -p <db> < schema.sql`. 이후 **새로 추가되는** 마이그레이션만 번호순으로 적용한다. (증분 마이그레이션만으론 베이스 테이블이 안 생겨 빈 DB 구축이 실패한다.)
- RDS CA 번들을 EC2에 두고 `DB_SSL_CA`로 지정.

### 2. EC2
- t3.micro, Docker + docker compose 설치.
- **`next build`는 t3.micro(1GB)에서 OOM 위험** → EC2에 스왑 2GB 를 먼저 설정한 뒤 `docker compose up -d --build`:
  `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` (영구화는 `/etc/fstab`에 `/swapfile none swap sw 0 0`). 또는 로컬/CI에서 이미지를 빌드해 레지스트리로 올리고 compose 를 `image:` 참조로 바꾼다.
- 보안그룹: 80/443만 공개. 22(SSH)는 본인 IP만.

### 3. 환경변수(.env, EC2)
필수:
```
SECRET_KEY=<32자+ 무작위>
AI_ENC_KEY=<SECRET_KEY 와 다른 무작위>   # 유출면 분리
DB_HOST=<RDS 엔드포인트>
DB_USER= / DB_PASSWORD= / DB_NAME=
DB_SSL_CA=/etc/ssl/rds-ca.pem
SESSION_COOKIE_SECURE=true
CORS_ORIGINS=https://<도메인>
DOMAIN=<도메인>
BIND_HOST=0.0.0.0
```

### 4. 기동 + DNS
```bash
docker compose up -d --build
```
- 도메인 A레코드를 EC2 퍼블릭 IP로. Caddy가 Let's Encrypt 인증서를 자동 발급.

---

## 배포 전 보안 체크리스트

- [ ] `AI_ENC_KEY`를 `SECRET_KEY`와 **다른 값**으로 설정 (①)
- [ ] `SESSION_COOKIE_SECURE=true` + Caddy HTTPS 동작 (②)
- [ ] RDS public 차단 + 보안그룹 EC2 한정 + `DB_SSL_CA` 설정 (③)
- [ ] `.env`는 git·이미지에 포함 금지(`.dockerignore`·`.gitignore` 확인)
- [ ] 이메일 인증은 아직 미구현(레이트리밋은 Caddy 앞단으로 적용됨) — 봇 가입 완전 차단하려면 추가

## 아직 안 한 것 (배포 후/별도)

- 회원가입 이메일 인증 (레이트리밋은 Caddy 앞단으로 적용됨 — 이메일 검증까지 하면 봇 가입 완전 차단)
- AWS 프리티어 개편(신규 계정 6개월 크레딧) — 6개월 후 계정 만료 시 데모 URL 소멸 대비 재배포 계획
