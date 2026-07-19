# 가계부 백엔드 (FastAPI). 로컬에선 `python app.py`, 컨테이너에선 BIND_HOST=0.0.0.0 로 뜬다.
FROM python:3.11-slim

# 우리카드 명세서 복호화(vestmail/decrypt.js)에 Node 런타임이 필요하다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성을 먼저 설치해 레이어 캐시를 살린다(코드만 바뀌면 재설치 안 함).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 앱 코드
COPY . .

# vestmail(우리카드 복호화) node 의존성 설치
RUN cd vestmail && npm ci --omit=dev

# 비루트 유저로 실행(침해 시 컨테이너 내 피해 축소)
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    BIND_HOST=0.0.0.0 \
    PORT=5000

EXPOSE 5000
CMD ["python", "app.py"]
