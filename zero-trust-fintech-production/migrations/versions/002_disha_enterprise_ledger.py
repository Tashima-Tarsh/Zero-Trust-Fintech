"""DISHA 8.2 enterprise ledger, vpa pool, and compliance tables

Revision ID: 002
Revises: 001
Create Date: 2026-11-15

"""
from alembic import op
import sqlalchemy as sa

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # VPA Pool
    op.create_table(
        'vpa_pool',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('merchant_id', sa.String(255), sa.ForeignKey('merchants.id'), nullable=False),
        sa.Column('vpa_address', sa.String(100), unique=True, nullable=False),
        sa.Column('bank_name', sa.String(50), nullable=True),
        sa.Column('account_number_hash', sa.String(64), nullable=True),
        sa.Column('ifsc_code', sa.String(15), nullable=True),
        sa.Column('status', sa.String(20), server_default='ACTIVE'),
        sa.Column('health_score', sa.Integer(), server_default='100'),
        sa.Column('priority', sa.Integer(), server_default='50'),
        sa.Column('daily_tx_limit', sa.Integer(), server_default='30'),
        sa.Column('daily_volume_limit', sa.Numeric(15, 2), server_default='50000.00'),
        sa.Column('per_tx_limit', sa.Numeric(15, 2), server_default='100000.00'),
        sa.Column('daily_tx_count', sa.Integer(), server_default='0'),
        sa.Column('daily_volume', sa.Numeric(15, 2), server_default='0.00'),
        sa.Column('last_reset_date', sa.Date(), server_default=sa.func.current_date()),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cooldown_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
        sa.Column('notes', sa.Text(), nullable=True)
    )
    op.create_index('idx_vpa_address', 'vpa_pool', ['vpa_address'])
    op.create_index('idx_vpa_merchant_id', 'vpa_pool', ['merchant_id'])

    # Chart of Accounts
    op.create_table(
        'accounts',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('code', sa.String(20), unique=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('vpa_id', sa.String(255), sa.ForeignKey('vpa_pool.id'), nullable=True),
        sa.Column('merchant_id', sa.String(255), sa.ForeignKey('merchants.id'), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    op.create_index('idx_accounts_code', 'accounts', ['code'])
    op.create_index('idx_accounts_merchant_id', 'accounts', ['merchant_id'])

    # Transactions
    op.create_table(
        'transactions',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('order_id', sa.String(255), nullable=False),
        sa.Column('utr', sa.String(20), unique=True, nullable=False),
        sa.Column('amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('status', sa.String(20), server_default='PENDING'),
        sa.Column('vpa_used', sa.String(255), sa.ForeignKey('vpa_pool.id'), nullable=True),
        sa.Column('merchant_id', sa.String(255), sa.ForeignKey('merchants.id'), nullable=False),
        sa.Column('customer_vpa', sa.String(100), nullable=True),
        sa.Column('raw_receipt', sa.Text(), nullable=True),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('settled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    op.create_index('idx_transactions_utr', 'transactions', ['utr'])
    op.create_index('idx_transactions_merchant_id', 'transactions', ['merchant_id'])

    # Ledger Entries
    op.create_table(
        'ledger_entries',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('transaction_id', sa.String(255), sa.ForeignKey('transactions.id'), nullable=False),
        sa.Column('account_id', sa.String(255), sa.ForeignKey('accounts.id'), nullable=False),
        sa.Column('entry_type', sa.String(10), nullable=False),
        sa.Column('amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('currency', sa.String(3), server_default='INR'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('reference_type', sa.String(50), nullable=True),
        sa.Column('reference_id', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    op.create_index('idx_ledger_transaction_id', 'ledger_entries', ['transaction_id'])
    op.create_index('idx_ledger_account_id', 'ledger_entries', ['account_id'])

    # VPA Usage Log
    op.create_table(
        'vpa_usage_log',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('vpa_id', sa.String(255), sa.ForeignKey('vpa_pool.id'), nullable=False),
        sa.Column('transaction_id', sa.String(255), sa.ForeignKey('transactions.id'), nullable=False),
        sa.Column('amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('customer_vpa', sa.String(100), nullable=True),
        sa.Column('customer_region', sa.String(50), nullable=True),
        sa.Column('used_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    op.create_index('idx_vpa_usage_vpa_id', 'vpa_usage_log', ['vpa_id'])

    # VPA Health Events
    op.create_table(
        'vpa_health_events',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('vpa_id', sa.String(255), sa.ForeignKey('vpa_pool.id'), nullable=False),
        sa.Column('event_type', sa.String(50), nullable=False),
        sa.Column('severity', sa.String(20), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('health_impact', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )

    # GST Invoices
    op.create_table(
        'gst_invoices',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('invoice_number', sa.String(50), unique=True, nullable=False),
        sa.Column('transaction_id', sa.String(255), sa.ForeignKey('transactions.id'), nullable=True),
        sa.Column('merchant_id', sa.String(255), sa.ForeignKey('merchants.id'), nullable=False),
        sa.Column('merchant_gstin', sa.String(15), nullable=True),
        sa.Column('merchant_name', sa.String(200), nullable=True),
        sa.Column('taxable_value', sa.Numeric(15, 2), nullable=False),
        sa.Column('cgst_rate', sa.Numeric(5, 2), server_default='0.00'),
        sa.Column('sgst_rate', sa.Numeric(5, 2), server_default='0.00'),
        sa.Column('igst_rate', sa.Numeric(5, 2), server_default='0.00'),
        sa.Column('cgst_amount', sa.Numeric(15, 2), server_default='0.00'),
        sa.Column('sgst_amount', sa.Numeric(15, 2), server_default='0.00'),
        sa.Column('igst_amount', sa.Numeric(15, 2), server_default='0.00'),
        sa.Column('total_amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('invoice_date', sa.Date(), nullable=False),
        sa.Column('financial_year', sa.String(9), server_default='2026-27'),
        sa.Column('hsn_code', sa.String(10), server_default='997199'),
        sa.Column('status', sa.String(20), server_default='GENERATED'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )
    op.create_index('idx_gst_invoice_number', 'gst_invoices', ['invoice_number'])

    # TDS Records
    op.create_table(
        'tds_records',
        sa.Column('id', sa.String(255), primary_key=True),
        sa.Column('merchant_id', sa.String(255), sa.ForeignKey('merchants.id'), nullable=False),
        sa.Column('financial_year', sa.String(9), nullable=False),
        sa.Column('quarter', sa.String(5), nullable=False),
        sa.Column('total_volume', sa.Numeric(15, 2), nullable=False),
        sa.Column('tds_amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('deducted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deposited', sa.Boolean(), server_default='false'),
        sa.Column('deposited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('challan_number', sa.String(50), nullable=True)
    )

def downgrade() -> None:
    op.drop_table('tds_records')
    op.drop_table('gst_invoices')
    op.drop_table('vpa_health_events')
    op.drop_table('vpa_usage_log')
    op.drop_table('ledger_entries')
    op.drop_table('transactions')
    op.drop_table('accounts')
    op.drop_table('vpa_pool')
