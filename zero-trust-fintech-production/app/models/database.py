from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Boolean, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import declarative_base, sessionmaker
from ..core.config import get_settings

settings = get_settings()

Base = declarative_base()

class TransactionBlock(Base):
    """Immutable ledger block with hash chaining"""
    __tablename__ = "merkle_ledger"
    
    id = Column(Integer, primary_key=True, index=True)
    tx_data = Column(Text, nullable=False)
    prev_hash = Column(String(64), nullable=False, index=True)
    block_hash = Column(String(64), nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    __table_args__ = (
        Index('idx_block_chain', 'prev_hash', 'block_hash'),
    )

class DeviceKey(Base):
    """Registered device public keys"""
    __tablename__ = "device_keys"
    
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(255), unique=True, nullable=False, index=True)
    public_key = Column(Text, nullable=False)
    algorithm = Column(String(50), nullable=False, default="ed25519")
    registered_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True))
    is_active = Column(Boolean, default=True)

class AuditLog(Base):
    """Security audit trail"""
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)
    device_id = Column(String(255), index=True)
    ip_address = Column(String(45))
    user_agent = Column(Text)
    request_data = Column(Text)
    response_status = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

# Database engine and session
engine_kwargs = {"pool_pre_ping": True}
if not settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs["pool_size"] = settings.DATABASE_POOL_SIZE
    engine_kwargs["max_overflow"] = settings.DATABASE_MAX_OVERFLOW
else:
    from sqlalchemy.pool import StaticPool
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    if ":memory:" in settings.DATABASE_URL:
        engine_kwargs["poolclass"] = StaticPool

engine = create_engine(
    settings.DATABASE_URL,
    **engine_kwargs
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency for getting database sessions"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
