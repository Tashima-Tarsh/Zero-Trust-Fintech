"""Initial schema

Revision ID: 001
Revises: 
Create Date: 2026-11-15

"""
from alembic import op
import sqlalchemy as sa

revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Merchants table
    op.create_table(
        'merchants',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('vpa', sa.String(255), nullable=False, unique=True),
        sa.Column('vpa_last_rotated', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now())
    )
    op.create_index('idx_merchants_vpa', 'merchants', ['vpa'])
    
    # Merchant users table
    op.create_table(
        'merchant_users',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('merchant_id', sa.String(255), sa.ForeignKey('merchants.id'), nullable=False),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    op.create_index('idx_merchant_users_email', 'merchant_users', ['email'])
    op.create_index('idx_merchant_users_merchant', 'merchant_users', ['merchant_id'])
    
    # Immutable ledger table
    op.create_table(
        'merkle_ledger',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('merchant_id', sa.String(255), nullable=True, index=True),
        sa.Column('tx_data', sa.Text, nullable=False),
        sa.Column('prev_hash', sa.String(64), nullable=False),
        sa.Column('block_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    op.create_index('idx_ledger_chain', 'merkle_ledger', ['prev_hash', 'block_hash'])
    op.create_index('idx_ledger_created', 'merkle_ledger', ['created_at'])
    
    # Device keys table
    op.create_table(
        'device_keys',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('device_id', sa.String(255), nullable=False, unique=True),
        sa.Column('merchant_id', sa.String(255), nullable=True),
        sa.Column('public_key', sa.Text, nullable=False),
        sa.Column('algorithm', sa.String(50), nullable=False, default='ed25519'),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('registered_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index('idx_device_keys_device_id', 'device_keys', ['device_id'])
    
    # Audit logs table
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('merchant_id', sa.String(255), nullable=True),
        sa.Column('device_id', sa.String(255), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('user_agent', sa.Text, nullable=True),
        sa.Column('request_data', sa.Text, nullable=True),
        sa.Column('response_status', sa.Integer, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    op.create_index('idx_audit_logs_event_type', 'audit_logs', ['event_type'])
    op.create_index('idx_audit_logs_created_at', 'audit_logs', ['created_at'])

def downgrade() -> None:
    op.drop_table('audit_logs')
    op.drop_table('device_keys')
    op.drop_table('merkle_ledger')
    op.drop_table('merchant_users')
    op.drop_table('merchants')
