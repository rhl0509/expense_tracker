# database/db_connection.py
import os
import pymysql
from dbutils.pooled_db import PooledDB
from config import Config

_pool: PooledDB | None = None


def _get_pool() -> PooledDB:
    global _pool
    if _pool is None:
        # RDS 등 원격 DB는 전송 암호화가 필요하다. DB_SSL_CA(인증서 경로)가 있으면 그 CA 로
        # 검증하는 TLS 연결을 쓴다. 로컬(미설정)에선 평문 — 개발 편의.
        kwargs = dict(
            creator=pymysql,
            mincached=2,
            maxcached=10,
            maxconnections=20,
            blocking=True,
            host=Config.MYSQL_HOST,
            user=Config.MYSQL_USER,
            password=Config.MYSQL_PASSWORD,
            db=Config.MYSQL_DB,
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=5,
            read_timeout=30,
            write_timeout=30,
        )
        ssl_ca = os.getenv('DB_SSL_CA')
        if ssl_ca:
            kwargs['ssl'] = {'ca': ssl_ca}
        _pool = PooledDB(**kwargs)
    return _pool


def get_db_connection():
    """풀에서 커넥션을 꺼내 반환. conn.close() 시 풀에 반환됨."""
    return _get_pool().connection()
