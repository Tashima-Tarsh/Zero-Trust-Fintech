from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Boolean, Index, ForeignKey, Numeric, Date
from sqlalchemy.sql import func
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from ..core.config import get_settings

settings = get_settings()

Base = declarative_base()

class Merchant(Base):
    """Registered merchants with VPA and rotation history"""
    __tablename__ = "merchants"
    
    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    vpa = Column(String(255), nullable=False, unique=True, index=True)
    vpa_last_rotated = Column(DateTime(timezone=True))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    users = relationship("MerchantUser", back_populates="merchant", cascade="all, delete-orphan")

class MerchantUser(Base):
    """Merchant dashboard login credentials and access control"""
    __tablename__ = "merchant_users"
    
    id = Column(String(255), primary_key=True, index=True)
    merchant_id = Column(String(255), ForeignKey("merchants.id"), nullable=False, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    merchant = relationship("Merchant", back_populates="users")

class TransactionBlock(Base):
    """Immutable ledger block with hash chaining and merchant scope"""
    __tablename__ = "merkle_ledger"
    
    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(String(255), nullable=True, index=True)
    tx_data = Column(Text, nullable=False)
    prev_hash = Column(String(64), nullable=False, index=True)
    block_hash = Column(String(64), nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    __table_args__ = (
        Index('idx_block_chain', 'prev_hash', 'block_hash'),
    )

class DeviceKey(Base):
    """Registered device public keys for hardware-backed attestation"""
    __tablename__ = "device_keys"
    
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(255), unique=True, nullable=False, index=True)
    merchant_id = Column(String(255), nullable=True, index=True)
    public_key = Column(Text, nullable=False)
    algorithm = Column(String(50), nullable=False, default="ed25519")
    registered_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True))
    is_active = Column(Boolean, default=True)

class AuditLog(Base):
    """Security audit trail for regulatory compliance and forensic triage"""
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)
    merchant_id = Column(String(255), index=True)
    device_id = Column(String(255), index=True)
    ip_address = Column(String(45))
    user_agent = Column(Text)
    request_data = Column(Text)
    response_status = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

class VPAPool(Base):
    """VPA rotation pool with health scoring, cooldown, and limits"""
    __tablename__ = "vpa_pool"
    
    id = Column(String(255), primary_key=True, index=True)
    merchant_id = Column(String(255), ForeignKey("merchants.id"), nullable=False, index=True)
    vpa_address = Column(String(100), unique=True, nullable=False, index=True)
    bank_name = Column(String(50))
    account_number_hash = Column(String(64))
    ifsc_code = Column(String(15))
    status = Column(String(20), default="ACTIVE")
    health_score = Column(Integer, default=100)
    priority = Column(Integer, default=50)
    daily_tx_limit = Column(Integer, default=30)
    daily_volume_limit = Column(Numeric(15, 2), default=50000.00)
    per_tx_limit = Column(Numeric(15, 2), default=100000.00)
    daily_tx_count = Column(Integer, default=0)
    daily_volume = Column(Numeric(15, 2), default=0.00)
    last_reset_date = Column(Date, server_default=func.current_date())
    last_used_at = Column(DateTime(timezone=True))
    cooldown_until = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    notes = Column(Text)

class Account(Base):
    """Chart of Accounts for double-entry ledger"""
    __tablename__ = "accounts"
    
    id = Column(String(255), primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    type = Column(String(20), nullable=False)  # ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    vpa_id = Column(String(255), ForeignKey("vpa_pool.id"), nullable=True)
    merchant_id = Column(String(255), ForeignKey("merchants.id"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Transaction(Base):
    """UPI Transactions"""
    __tablename__ = "transactions"
    
    id = Column(String(255), primary_key=True, index=True)
    order_id = Column(String(255), nullable=False, index=True)
    utr = Column(String(20), unique=True, nullable=False, index=True)
    amount = Column(Numeric(15, 2), nullable=False)
    status = Column(String(20), default="PENDING")
    vpa_used = Column(String(255), ForeignKey("vpa_pool.id"), nullable=True)
    merchant_id = Column(String(255), ForeignKey("merchants.id"), nullable=False, index=True)
    customer_vpa = Column(String(100))
    raw_receipt = Column(Text)
    verified_at = Column(DateTime(timezone=True))
    settled_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class LedgerEntry(Base):
    """Double-entry balanced accounting entries"""
    __tablename__ = "ledger_entries"
    
    id = Column(String(255), primary_key=True, index=True)
    transaction_id = Column(String(255), ForeignKey("transactions.id"), nullable=False, index=True)
    account_id = Column(String(255), ForeignKey("accounts.id"), nullable=False, index=True)
    entry_type = Column(String(10), nullable=False)  # DEBIT or CREDIT
    amount = Column(Numeric(15, 2), nullable=False)
    currency = Column(String(3), default="INR")
    description = Column(Text)
    reference_type = Column(String(50))
    reference_id = Column(String(100))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

class VPAUsageLog(Base):
    """VPA usage log for pattern masking and forensic analysis"""
    __tablename__ = "vpa_usage_log"
    
    id = Column(String(255), primary_key=True, index=True)
    vpa_id = Column(String(255), ForeignKey("vpa_pool.id"), nullable=False, index=True)
    transaction_id = Column(String(255), ForeignKey("transactions.id"), nullable=False, index=True)
    amount = Column(Numeric(15, 2), nullable=False)
    customer_vpa = Column(String(100))
    customer_region = Column(String(50))
    used_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

class VPAHealthEvent(Base):
    """Health event log for VPA degradation and warnings"""
    __tablename__ = "vpa_health_events"
    
    id = Column(String(255), primary_key=True, index=True)
    vpa_id = Column(String(255), ForeignKey("vpa_pool.id"), nullable=False, index=True)
    event_type = Column(String(50), nullable=False)
    severity = Column(String(20), nullable=False)
    description = Column(Text)
    health_impact = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class GSTInvoice(Base):
    """GST-compliant tax invoices"""
    __tablename__ = "gst_invoices"
    
    id = Column(String(255), primary_key=True, index=True)
    invoice_number = Column(String(50), unique=True, nullable=False, index=True)
    transaction_id = Column(String(255), ForeignKey("transactions.id"), nullable=True)
    merchant_id = Column(String(255), ForeignKey("merchants.id"), nullable=False, index=True)
    merchant_gstin = Column(String(15))
    merchant_name = Column(String(200))
    taxable_value = Column(Numeric(15, 2), nullable=False)
    cgst_rate = Column(Numeric(5, 2), default=0)
    sgst_rate = Column(Numeric(5, 2), default=0)
    igst_rate = Column(Numeric(5, 2), default=0)
    cgst_amount = Column(Numeric(15, 2), default=0)
    sgst_amount = Column(Numeric(15, 2), default=0)
    igst_amount = Column(Numeric(15, 2), default=0)
    total_amount = Column(Numeric(15, 2), nullable=False)
    invoice_date = Column(Date, nullable=False)
    financial_year = Column(String(9), default="2026-27")
    hsn_code = Column(String(10), default="997199")
    status = Column(String(20), default="GENERATED")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class TDSRecord(Base):
    """TDS tracking under Section 194Q"""
    __tablename__ = "tds_records"
    
    id = Column(String(255), primary_key=True, index=True)
    merchant_id = Column(String(255), ForeignKey("merchants.id"), nullable=False, index=True)
    financial_year = Column(String(9), nullable=False)
    quarter = Column(String(5), nullable=False)
    total_volume = Column(Numeric(15, 2), nullable=False)
    tds_amount = Column(Numeric(15, 2), nullable=False)
    deducted_at = Column(DateTime(timezone=True))
    deposited = Column(Boolean, default=False)
    deposited_at = Column(DateTime(timezone=True))
    challan_number = Column(String(50))

# Database engine and session
engine_kwargs = {"pool_pre_ping": True}
if not settings.DATABASE_URL.startswith("sqlite"):
    engine_kwargs["pool_size"] = settings.DATABASE_POOL_SIZE
    engine_kwargs["max_overflow"] = settings.DATABASE_MAX_OVERFLOW
    engine_kwargs["pool_recycle"] = getattr(settings, "DATABASE_POOL_RECYCLE", 3600)
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
