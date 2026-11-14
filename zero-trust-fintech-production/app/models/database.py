from sqlalchemy import create_engine, Column, Integer, String, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone
from ..core.config import get_settings

settings = get_settings()

# Use standard JSON if sqlite, JSONB if postgres
is_postgres = settings.DATABASE_URL.startswith("postgresql")

engine = create_engine(
    settings.DATABASE_URL,
    pool_size=settings.DATABASE_POOL_SIZE if is_postgres else 5,
    max_overflow=10 if is_postgres else 0
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class MerkleLedger(Base):
    __tablename__ = "merkle_ledger"

    id = Column(Integer, primary_key=True, index=True)
    tx_data = Column(JSONB if is_postgres else JSON, nullable=False)
    prev_hash = Column(String(64), nullable=False, index=True)
    block_hash = Column(String(64), nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class DeviceKey(Base):
    __tablename__ = "device_keys"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(255), unique=True, nullable=False, index=True)
    public_key = Column(Text, nullable=False)
    algorithm = Column(String(50), default="ed25519", nullable=False)
    registered_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)
    device_id = Column(String(255), nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    request_data = Column(JSONB if is_postgres else JSON, nullable=True)
    response_status = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
