/**
 * DISHA Merchant Dashboard — Client Application Controller
 */

let authToken = sessionStorage.getItem('disha_token');
let currentMerchant = null;
let currentOrders = [];
let currentVpas = [];
let activeCreatedOrder = null;
let activeDateFilter = '30d';
let activePaymentsStatus = 'ALL';
let activePaymentsSearch = '';

// Check Authentication and Initialize
document.addEventListener('DOMContentLoaded', async () => {
  if (!authToken) {
    window.location.href = '/login';
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });

    if (!res.ok) {
      sessionStorage.clear();
      window.location.href = '/login';
      return;
    }

    const data = await res.json();
    currentMerchant = data.merchant;

    if (!currentMerchant.setup_completed) {
      window.location.href = '/setup';
      return;
    }

    // Populate profile UI
    document.getElementById('sideMerchantName').textContent = currentMerchant.business_name || 'My Business';
    document.getElementById('sideMerchantVpa').textContent = currentMerchant.primary_vpa || '';
    document.getElementById('sideUserEmail').textContent = currentMerchant.email;

    // Initialize soundbox state
    document.getElementById('sbMasterSwitch').checked = Boolean(currentMerchant.soundbox_enabled);
    document.getElementById('sbLangSelect').value = currentMerchant.soundbox_lang || 'en';
    document.getElementById('sbVolumeSlider').value = currentMerchant.soundbox_volume || 80;
    document.getElementById('sbVolPercent').textContent = (currentMerchant.soundbox_volume || 80) + '%';
    updateSoundboxHeaderStatus();

    // Setup initial workspace
    const hash = window.location.hash.replace('#', '') || 'overview';
    switchWorkspace(hash);

    // Load initial data
    await loadDashboardOverview();
    await loadNotifications();
    await loadVpas();
  } catch (err) {
    console.error('Initialization error:', err);
    window.location.href = '/login';
  }
});

// Mobile Sidebar Toggle
window.toggleMobileSidebar = function(open) {
  const sidebar = document.getElementById('dashSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (open) {
    sidebar.classList.add('open');
    backdrop.classList.add('open');
  } else {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
  }
};

// Workspace Switcher
window.switchWorkspace = function(wsId) {
  const valid = ['overview', 'payments', 'create-payment', 'upi-ids', 'reports', 'soundbox', 'notifications', 'settings'];
  const target = valid.includes(wsId) ? wsId : 'overview';

  // Update nav links
  document.querySelectorAll('.side-nav-item').forEach(link => {
    if (link.dataset.workspace === target) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update workspace sections
  document.querySelectorAll('.workspace-section').forEach(sec => {
    sec.classList.remove('active');
  });

  const activeSec = document.getElementById(`ws-${target}`);
  if (activeSec) activeSec.classList.add('active');

  // Breadcrumb
  const titles = {
    'overview': 'Overview',
    'payments': 'Payments',
    'create-payment': 'Create Payment',
    'upi-ids': 'UPI IDs',
    'reports': 'Reports & Taxes',
    'soundbox': 'Voice Soundbox',
    'notifications': 'Notifications',
    'settings': 'Settings'
  };
  document.getElementById('headerWorkspaceTitle').textContent = titles[target] || 'Overview';

  // Close mobile sidebar if open
  toggleMobileSidebar(false);

  // Trigger workspace specific refresh
  if (target === 'payments') loadPaymentsList();
  if (target === 'upi-ids') loadVpas();
  if (target === 'reports') loadReportsData();
  if (target === 'notifications') loadFullNotifications();
  if (target === 'settings') populateSettingsForm();
  if (target === 'create-payment') populateCreatePaymentVpaSelect();
};

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '') || 'overview';
  switchWorkspace(hash);
});

// Date Filter Change
window.onDateFilterChange = async function() {
  activeDateFilter = document.getElementById('dateFilterSelect').value;
  await loadDashboardOverview();
  if (document.getElementById('ws-reports').classList.contains('active')) {
    await loadReportsData();
  }
};

// Overview Loader
async function loadDashboardOverview() {
  try {
    const res = await fetch(`/api/merchant/dashboard?dateFilter=${activeDateFilter}`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    const { metrics, recentTransactions, chartData, vpas, unreadNotifications } = data;

    // Metrics
    document.getElementById('metricTotalVolume').textContent = '₹' + parseFloat(metrics.totalVolume).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    document.getElementById('metricCompletedOrders').textContent = metrics.completedTransactions;
    document.getElementById('metricSuccessRate').textContent = `${metrics.successRate}% completion rate (${metrics.totalTransactions} total)`;
    document.getElementById('metricFeesSaved').textContent = '₹' + parseFloat(metrics.feesSaved).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    document.getElementById('metricAvgTicket').textContent = '₹' + parseFloat(metrics.averageTicket).toLocaleString('en-IN', { minimumFractionDigits: 2 });

    // Recent table
    renderRecentTable(recentTransactions);

    // Chart
    renderChart(chartData);

    // VPAs Overview
    renderOverviewVpas(vpas);

    // Unread badge
    updateNotifBadge(unreadNotifications);
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

function renderRecentTable(transactions) {
  const tbody = document.getElementById('overviewRecentTable');
  if (!transactions || transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-table-msg">No transactions found for this period. Click "+ Create Payment" to accept your first payment.</td></tr>`;
    return;
  }

  tbody.innerHTML = transactions.map(t => {
    const dateStr = new Date(t.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
    const isSuccess = t.status === 'COMPLETED';
    const statusBadge = isSuccess 
      ? '<span class="badge-success">● COMPLETED</span>'
      : (t.status === 'PENDING' ? '<span class="badge-pending">⏳ PENDING</span>' : '<span class="badge-expired">✕ EXPIRED</span>');

    return `
      <tr>
        <td><code>${t.id}</code></td>
        <td>${dateStr}</td>
        <td><strong>₹${t.amount.toFixed(2)}</strong></td>
        <td><span class="font-mono text-muted">${t.vpa_address}</span></td>
        <td><code>${t.utr || '—'}</code></td>
        <td>${statusBadge}</td>
        <td><button type="button" class="btn-table-action" onclick="openTxDrawer('${t.id}')">View</button></td>
      </tr>
    `;
  }).join('');
}

function renderChart(chartData) {
  const barsContainer = document.getElementById('chartBars');
  const emptyState = document.getElementById('emptyChart');

  if (!chartData || chartData.length === 0 || chartData.every(d => d.amount === 0)) {
    barsContainer.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';
  const maxVal = Math.max(...chartData.map(d => d.amount), 100);

  barsContainer.innerHTML = chartData.map(d => {
    const heightPercent = Math.max((d.amount / maxVal) * 100, 4);
    return `
      <div class="chart-bar-col">
        <div class="bar-amount-tip">₹${d.amount > 0 ? d.amount.toFixed(0) : '0'}</div>
        <div class="bar-fill" style="height: ${heightPercent}%;"></div>
        <span class="bar-label">${d.label}</span>
      </div>
    `;
  }).join('');
}

function renderOverviewVpas(vpas) {
  const container = document.getElementById('overviewVpaList');
  if (!vpas || vpas.length === 0) {
    container.innerHTML = '<p class="text-muted">No UPI IDs configured yet.</p>';
    return;
  }

  container.innerHTML = vpas.map(v => {
    const isActive = v.status === 'ACTIVE';
    return `
      <div class="overview-vpa-card">
        <div class="ov-vpa-left">
          <span class="ov-vpa-icon">🏦</span>
          <div>
            <strong class="font-mono">${v.vpa_address}</strong>
            <span class="ov-bank-name">${v.bank_name} ${v.is_default ? '· <span class="tag-default">DEFAULT</span>' : ''}</span>
          </div>
        </div>
        <span class="${isActive ? 'status-pill-active' : 'status-pill-paused'}">
          ${isActive ? 'Active' : 'Paused'}
        </span>
      </div>
    `;
  }).join('');
}

// Payments Workspace
async function loadPaymentsList() {
  try {
    const params = new URLSearchParams({
      status: activePaymentsStatus,
      search: activePaymentsSearch,
      limit: '100'
    });

    const res = await fetch(`/api/merchant/payments?${params.toString()}`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    currentOrders = data.orders || [];
    renderPaymentsTable(currentOrders);
  } catch (err) {
    console.error('Failed to load payments:', err);
  }
}

function renderPaymentsTable(orders) {
  const tbody = document.getElementById('paymentsTableBody');
  if (!orders || orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-table-msg">No transactions found matching the filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const dateStr = new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const isCompleted = o.status === 'COMPLETED';
    const statusBadge = isCompleted 
      ? '<span class="badge-success">● COMPLETED</span>'
      : (o.status === 'PENDING' ? '<span class="badge-pending">⏳ PENDING</span>' : '<span class="badge-expired">✕ EXPIRED</span>');

    return `
      <tr>
        <td><code>${o.id}</code></td>
        <td>${dateStr}</td>
        <td><strong>₹${o.amount.toFixed(2)}</strong></td>
        <td><span class="font-mono text-muted">${o.vpa_address}</span></td>
        <td><code>${o.utr || '—'}</code></td>
        <td>${statusBadge}</td>
        <td><button type="button" class="btn-table-action" onclick="openTxDrawer('${o.id}')">View Details</button></td>
      </tr>
    `;
  }).join('');
}

window.filterPaymentsByStatus = function(status) {
  activePaymentsStatus = status;
  document.querySelectorAll('.payments-toolbar .filter-pills .pill').forEach(p => {
    if (p.dataset.status === status) p.classList.add('active');
    else p.classList.remove('active');
  });
  loadPaymentsList();
};

let searchDebounceTimeout = null;
window.onPaymentsSearch = function() {
  clearTimeout(searchDebounceTimeout);
  searchDebounceTimeout = setTimeout(() => {
    activePaymentsSearch = document.getElementById('paymentsSearchInput').value.trim();
    loadPaymentsList();
  }, 250);
};

window.exportPaymentsCsv = function() {
  window.location.href = `/api/merchant/reports?dateFilter=${activeDateFilter}&format=csv`;
};

// Transaction Details Drawer
window.openTxDrawer = function(orderId) {
  const order = currentOrders.find(o => o.id === orderId) || (currentMerchant && currentMerchant.recentTransactions ? currentMerchant.recentTransactions.find(o => o.id === orderId) : null);
  
  const drawer = document.getElementById('txDrawer');
  const backdrop = document.getElementById('txDrawerBackdrop');
  const body = document.getElementById('txDrawerBody');

  if (!order) {
    // Fetch directly
    fetch(`/api/merchant/payments?search=${orderId}`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    }).then(r => r.json()).then(d => {
      const fetched = d.orders && d.orders[0];
      if (fetched) renderDrawerContent(fetched);
    });
  } else {
    renderDrawerContent(order);
  }

  drawer.classList.add('open');
  backdrop.classList.add('open');
};

function renderDrawerContent(o) {
  const body = document.getElementById('txDrawerBody');
  const createdDate = new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium' });
  const settledDate = o.settled_at ? new Date(o.settled_at).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium' }) : 'Pending Customer Payment';
  const isCompleted = o.status === 'COMPLETED';

  body.innerHTML = `
    <div class="drawer-amount-card">
      <span class="drawer-amount-label">Payment Amount</span>
      <h2 class="drawer-amount-val">₹${o.amount.toFixed(2)}</h2>
      <span class="drawer-fee-tag">Fee: ₹0.00 (Zero MDR)</span>
    </div>

    <div class="drawer-info-grid">
      <div class="drawer-info-item">
        <span>Order Reference</span>
        <code>${o.id}</code>
      </div>
      <div class="drawer-info-item">
        <span>Status</span>
        <strong>${isCompleted ? '● COMPLETED (Bank Settled)' : '⏳ PENDING'}</strong>
      </div>
      <div class="drawer-info-item">
        <span>Bank UTR Reference</span>
        <code>${o.utr || 'Pending Settlement'}</code>
      </div>
      <div class="drawer-info-item">
        <span>Settlement UPI Handle</span>
        <code class="font-mono">${o.vpa_address}</code>
      </div>
      <div class="drawer-info-item">
        <span>Description</span>
        <span>${o.description || 'No note attached'}</span>
      </div>
    </div>

    <h4 style="margin: 24px 0 12px 0;">Activity Timeline</h4>
    <div class="activity-timeline">
      <div class="timeline-step done">
        <span class="step-dot">✓</span>
        <div class="step-content">
          <strong>Order Generated</strong>
          <span>${createdDate}</span>
        </div>
      </div>
      <div class="timeline-step done">
        <span class="step-dot">✓</span>
        <div class="step-content">
          <strong>Dynamic QR & Intent Created</strong>
          <span>UPI URI formatted for ${o.vpa_address}</span>
        </div>
      </div>
      <div class="timeline-step ${isCompleted ? 'done' : 'pending'}">
        <span class="step-dot">${isCompleted ? '✓' : '•'}</span>
        <div class="step-content">
          <strong>${isCompleted ? 'Payment Received & Verified' : 'Awaiting Customer Scan'}</strong>
          <span>${isCompleted ? 'UTR: ' + o.utr : 'Customer presented QR'}</span>
        </div>
      </div>
      <div class="timeline-step ${isCompleted ? 'done' : 'pending'}">
        <span class="step-dot">${isCompleted ? '✓' : '•'}</span>
        <div class="step-content">
          <strong>${isCompleted ? 'Direct Bank Settlement (T+0)' : 'Pending Bank Credit'}</strong>
          <span>${isCompleted ? settledDate : 'Funds credited directly upon scan'}</span>
        </div>
      </div>
    </div>
  `;
}

window.closeTxDrawer = function() {
  document.getElementById('txDrawer').classList.remove('open');
  document.getElementById('txDrawerBackdrop').classList.remove('open');
};

// Create Payment Form
async function populateCreatePaymentVpaSelect() {
  const select = document.getElementById('orderVpaSelect');
  if (currentVpas.length === 0) await loadVpas();

  select.innerHTML = currentVpas
    .filter(v => v.status === 'ACTIVE')
    .map(v => `<option value="${v.vpa_address}" ${v.is_default ? 'selected' : ''}>${v.vpa_address} (${v.bank_name}) ${v.is_default ? '— Default' : ''}</option>`)
    .join('');
}

document.getElementById('createPaymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const amount = document.getElementById('orderAmount').value;
  const description = document.getElementById('orderDesc').value.trim();
  const vpaAddress = document.getElementById('orderVpaSelect').value;

  const btn = document.getElementById('btnGeneratePayment');
  btn.disabled = true;
  btn.textContent = 'Generating Secure UPI Link...';

  try {
    const res = await fetch('/api/merchant/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ amount, description, vpaAddress })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to create payment link');
      btn.disabled = false;
      btn.textContent = 'Generate Dynamic QR & Payment Link';
      return;
    }

    activeCreatedOrder = data.order;
    renderGeneratedQr(data.order);
    btn.disabled = false;
    btn.textContent = 'Generate Dynamic QR & Payment Link';
  } catch (err) {
    alert('Failed to connect to server');
    btn.disabled = false;
    btn.textContent = 'Generate Dynamic QR & Payment Link';
  }
});

function renderGeneratedQr(order) {
  document.getElementById('qrIdleState').style.display = 'none';
  const activeState = document.getElementById('qrActiveState');
  activeState.style.display = 'block';

  document.getElementById('qrShopTitle').textContent = currentMerchant.business_name || 'Merchant Pay';
  document.getElementById('qrAmountTag').textContent = '₹' + order.amount.toFixed(2);
  document.getElementById('generatedLinkInput').value = order.upi_uri;

  const qrBadge = document.getElementById('qrStatusBadge');
  qrBadge.className = 'status-pill-pending';
  qrBadge.textContent = 'Awaiting Scan';

  // Render QR
  const qrContainer = document.getElementById('qrcode');
  qrContainer.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrContainer, {
      text: order.upi_uri,
      width: 170,
      height: 170,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  // Reset simulate button
  const simBtn = document.getElementById('btnSimulatePayment');
  simBtn.disabled = false;
  simBtn.textContent = '⚡ Simulate Customer Payment (Tests Soundbox)';
}

window.copyPaymentLink = function() {
  const input = document.getElementById('generatedLinkInput');
  input.select();
  navigator.clipboard.writeText(input.value);
  alert('Payment link copied to clipboard!');
};

// Simulate Customer Payment in Test Mode
window.simulatePaymentForActiveOrder = async function() {
  if (!activeCreatedOrder) return;
  const simBtn = document.getElementById('btnSimulatePayment');
  simBtn.disabled = true;
  simBtn.textContent = 'Simulating scan and verification...';

  try {
    const res = await fetch(`/api/merchant/payments/${activeCreatedOrder.id}/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Simulation failed');
      simBtn.disabled = false;
      simBtn.textContent = '⚡ Simulate Customer Payment';
      return;
    }

    const completed = data.order;
    activeCreatedOrder = completed;

    // Update UI status
    const qrBadge = document.getElementById('qrStatusBadge');
    qrBadge.className = 'status-pill-active';
    qrBadge.textContent = '✓ COMPLETED';

    simBtn.textContent = `✓ Payment Verified! UTR: ${completed.utr}`;

    // Play Voice Soundbox Announcement
    playMerchantAnnouncement(completed.amount);

    // Refresh overview and notifications
    loadDashboardOverview();
    loadNotifications();
  } catch (err) {
    alert('Simulation error');
    simBtn.disabled = false;
  }
};

// Voice Soundbox Announcement Controller
function playMerchantAnnouncement(amount) {
  if (!currentMerchant || !currentMerchant.soundbox_enabled) return;
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const lang = currentMerchant.soundbox_lang || 'en';
  let text = `DISHA Pay: Payment received of ${Math.round(amount)} rupees.`;
  let code = 'en-IN';

  if (lang === 'hi') {
    text = `दिशा पे: ${Math.round(amount)} रुपये प्राप्त हुए।`;
    code = 'hi-IN';
  } else if (lang === 'mr') {
    text = `दिशा पे: ${Math.round(amount)} रुपये मिळाले आहेत.`;
    code = 'mr-IN';
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  u.volume = (currentMerchant.soundbox_volume || 80) / 100;
  window.speechSynthesis.speak(u);
}

// VPA Management
async function loadVpas() {
  try {
    const [vpaRes, anaRes] = await Promise.all([
      fetch('/api/merchant/vpas', { headers: { 'Authorization': 'Bearer ' + authToken } }),
      fetch('/api/merchant/vpas/analytics', { headers: { 'Authorization': 'Bearer ' + authToken } }).catch(() => null)
    ]);

    if (!vpaRes.ok) return;

    const data = await vpaRes.json();
    currentVpas = data.vpas || [];
    renderVpaTable(currentVpas);

    if (anaRes && anaRes.ok) {
      const anaData = await anaRes.json();
      renderVpaAnalytics(anaData.analytics);
    }
  } catch (err) {
    console.error('Failed to load VPAs:', err);
  }
}

function renderVpaAnalytics(analytics) {
  if (!analytics) return;
  const healthEl = document.getElementById('vpaFleetHealth');
  const activeCountEl = document.getElementById('vpaActiveCount');
  const dailyTxEl = document.getElementById('vpaDailyTxCapacity');
  const dailyVolEl = document.getElementById('vpaDailyVolCapacity');
  const monthlyVolEl = document.getElementById('vpaMonthlyVolCapacity');
  const bankCountEl = document.getElementById('vpaBankDiversityCount');
  const pillsEl = document.getElementById('vpaDiversityPills');

  if (healthEl) healthEl.textContent = `${analytics.avgHealth}% Low Risk`;
  if (activeCountEl) activeCountEl.textContent = analytics.active;
  if (dailyTxEl) dailyTxEl.textContent = `${analytics.capacity?.dailySafeTxCapacity || 0} / day`;
  if (dailyVolEl) dailyVolEl.textContent = `₹${(analytics.capacity?.dailySafeVolumeCapacity || 0).toLocaleString('en-IN')} / day`;
  if (monthlyVolEl) monthlyVolEl.textContent = `₹${((analytics.capacity?.monthlySafeVolumeCapacity || 0) / 10000000).toFixed(2)} Cr / mo safe limit`;
  if (bankCountEl) bankCountEl.textContent = `${analytics.bankDiversity?.length || 0} Banks`;

  if (pillsEl && analytics.bankDiversity) {
    pillsEl.innerHTML = analytics.bankDiversity.map(b => `
      <span style="font-size: 11px; padding: 2px 6px; background: rgba(255,255,255,0.06); border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
        ${b.bank}: <strong>${b.pct}%</strong>
      </span>
    `).join('');
  }
}

function renderVpaTable(vpas) {
  const tbody = document.getElementById('vpaTableBody');
  if (!vpas || vpas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table-msg">No UPI IDs found. Click "+ Add New UPI ID" or "Bulk Import" above.</td></tr>`;
    return;
  }

  tbody.innerHTML = vpas.map(v => {
    const isActive = v.status === 'ACTIVE';
    const isCooldown = v.status === 'COOLDOWN';
    let statusBadge = '<span class="status-pill-active">Active</span>';
    if (isCooldown) {
      statusBadge = '<span class="status-pill-paused" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24;">Quarantined (Cooldown)</span>';
    } else if (!isActive) {
      statusBadge = '<span class="status-pill-paused">Paused</span>';
    }

    return `
      <tr>
        <td><strong class="font-mono">${v.vpa_address}</strong></td>
        <td>${v.bank_name}</td>
        <td>${statusBadge}</td>
        <td>${v.is_default ? '<span class="tag-default">DEFAULT</span>' : '<button type="button" class="btn-table-action" onclick="setDefaultVpa(\'' + v.id + '\')">Set Default</button>'}</td>
        <td>
          ${isActive ? '<button type="button" class="btn-table-action" onclick="toggleVpaStatus(\'' + v.id + '\', \'pause\')">Pause</button>' : ''}
          ${v.status === 'PAUSED' || isCooldown ? '<button type="button" class="btn-table-action" onclick="toggleVpaStatus(\'' + v.id + '\', \'resume\')">Resume</button>' : ''}
          ${isActive && !v.is_default ? '<button type="button" class="btn-table-action" style="color: #f59e0b;" onclick="quarantineVpa(\'' + v.id + '\')">Quarantine</button>' : ''}
          ${!v.is_default ? '<button type="button" class="btn-table-danger" onclick="deleteVpa(\'' + v.id + '\')">Delete</button>' : ''}
        </td>
      </tr>
    `;
  }).join('');
}

window.openAddVpaModal = function() {
  document.getElementById('addVpaModal').style.display = 'flex';
  document.getElementById('newVpaAddress').value = '';
  document.getElementById('newVpaBank').value = '';
  document.getElementById('newVpaAddress').focus();
};

window.closeAddVpaModal = function() {
  document.getElementById('addVpaModal').style.display = 'none';
};

window.openBulkVpaModal = function() {
  const modal = document.getElementById('bulkVpaModal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('bulkCsvInput').value = '';
    const fb = document.getElementById('bulkVpaFeedback');
    if (fb) fb.style.display = 'none';
  }
};

window.closeBulkVpaModal = function() {
  const modal = document.getElementById('bulkVpaModal');
  if (modal) modal.style.display = 'none';
};

document.getElementById('bulkVpaForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const csv = document.getElementById('bulkCsvInput').value.trim();
  const fb = document.getElementById('bulkVpaFeedback');
  const btn = document.getElementById('btnUploadBulkVpa');

  if (!csv) return;
  btn.disabled = true;
  btn.textContent = 'Ingesting...';

  try {
    const res = await fetch('/api/merchant/vpas/bulk-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ csv })
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = 'Ingest Fleet';

    if (!res.ok) {
      alert(data.error || 'Failed to ingest VPAs');
      return;
    }

    if (fb) {
      fb.style.display = 'block';
      let msg = `✓ Added ${data.added} VPAs into rotation (${data.skipped} skipped).`;
      if (data.bankDiversityWarning) {
        msg += `<br>⚠️ ${data.bankDiversityWarning}`;
        fb.className = 'vpa-feedback-box invalid';
      } else {
        fb.className = 'vpa-feedback-box valid';
      }
      fb.innerHTML = msg;
    }

    setTimeout(() => {
      closeBulkVpaModal();
      loadVpas();
      loadDashboardOverview();
    }, 1500);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Ingest Fleet';
    alert('Server error while importing VPAs');
  }
});

window.quarantineVpa = async function(vpaId) {
  if (!confirm('Put this VPA into emergency 7-day quarantine cooldown? It will be removed from active checkout rotation.')) return;
  try {
    const res = await fetch(`/api/merchant/vpas/${vpaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ action: 'quarantine' })
    });
    if (res.ok) {
      loadVpas();
      loadDashboardOverview();
    }
  } catch (err) {
    console.error(err);
  }
};

const newVpaInput = document.getElementById('newVpaAddress');
const newVpaRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
newVpaInput?.addEventListener('input', () => {
  const val = newVpaInput.value.trim().toLowerCase();
  const box = document.getElementById('newVpaValidation');
  const icon = document.getElementById('newVpaIcon');
  const text = document.getElementById('newVpaText');
  const btn = document.getElementById('btnSaveNewVpa');

  if (!val) {
    box.className = 'vpa-feedback-box empty';
    icon.textContent = 'ℹ️';
    text.textContent = 'Format: handle@bank';
    btn.disabled = true;
    return;
  }

  if (newVpaRegex.test(val)) {
    box.className = 'vpa-feedback-box valid';
    icon.textContent = '✓';
    text.textContent = 'Valid UPI syntax format.';
    btn.disabled = false;
  } else {
    box.className = 'vpa-feedback-box invalid';
    icon.textContent = '⚠️';
    text.textContent = 'Invalid format. Must include username and bank handle.';
    btn.disabled = true;
  }
});

document.getElementById('addVpaForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const vpaAddress = document.getElementById('newVpaAddress').value.trim();
  const bankName = document.getElementById('newVpaBank').value.trim();

  try {
    const res = await fetch('/api/merchant/vpas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ vpaAddress, bankName })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to add UPI ID');
      return;
    }
    closeAddVpaModal();
    loadVpas();
    loadDashboardOverview();
  } catch (err) {
    alert('Failed to connect to server');
  }
});

window.setDefaultVpa = async function(vpaId) {
  try {
    const res = await fetch(`/api/merchant/vpas/${vpaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ action: 'set_default' })
    });
    if (res.ok) {
      loadVpas();
      loadDashboardOverview();
    }
  } catch (err) {
    console.error(err);
  }
};

window.toggleVpaStatus = async function(vpaId, action) {
  try {
    const res = await fetch(`/api/merchant/vpas/${vpaId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ action })
    });
    if (res.ok) {
      loadVpas();
      loadDashboardOverview();
    }
  } catch (err) {
    console.error(err);
  }
};

window.deleteVpa = async function(vpaId) {
  if (!confirm('Are you sure you want to remove this UPI ID?')) return;
  try {
    const res = await fetch(`/api/merchant/vpas/${vpaId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Cannot delete UPI ID');
      return;
    }
    loadVpas();
    loadDashboardOverview();
  } catch (err) {
    console.error(err);
  }
};

// Reports Workspace
async function loadReportsData() {
  try {
    const res = await fetch(`/api/merchant/reports?dateFilter=${activeDateFilter}`, {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    const turnover = parseFloat(data.metrics.totalVolume);
    const cgst = turnover * 0.09;
    const sgst = turnover * 0.09;
    const saved = parseFloat(data.metrics.feesSaved);

    document.getElementById('repTaxableTurnover').textContent = '₹' + turnover.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    document.getElementById('repCgst').textContent = '₹' + cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    document.getElementById('repSgst').textContent = '₹' + sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    document.getElementById('repCommissionAvoided').textContent = '₹' + saved.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  } catch (err) {
    console.error('Failed to load reports:', err);
  }
}

// Soundbox Settings
window.onSoundboxSettingChange = async function() {
  const enabled = document.getElementById('sbMasterSwitch').checked;
  const lang = document.getElementById('sbLangSelect').value;
  const vol = parseInt(document.getElementById('sbVolumeSlider').value, 10);

  currentMerchant.soundbox_enabled = enabled ? 1 : 0;
  currentMerchant.soundbox_lang = lang;
  currentMerchant.soundbox_volume = vol;
  updateSoundboxHeaderStatus();

  try {
    await fetch('/api/merchant/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({
        soundboxEnabled: enabled,
        soundboxLang: lang,
        soundboxVolume: vol
      })
    });
  } catch (_) {}
};

window.onVolumeSliderChange = function() {
  const val = document.getElementById('sbVolumeSlider').value;
  document.getElementById('sbVolPercent').textContent = val + '%';
  onSoundboxSettingChange();
};

window.testSoundboxAnnouncement = function() {
  playMerchantAnnouncement(500);
};

function updateSoundboxHeaderStatus() {
  const text = document.getElementById('headerSoundboxText');
  const sbText = document.getElementById('sbReadinessText');
  if (currentMerchant.soundbox_enabled) {
    if (text) text.textContent = 'Soundbox Active';
    if (sbText) sbText.textContent = 'Audio Ready';
  } else {
    if (text) text.textContent = 'Soundbox Muted';
    if (sbText) sbText.textContent = 'Audio Disabled';
  }
}

// Notifications
async function loadNotifications() {
  try {
    const res = await fetch('/api/merchant/notifications', {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    const notifs = data.notifications || [];
    const unread = notifs.filter(n => !n.is_read).length;
    updateNotifBadge(unread);

    // Dropdown list
    const dropList = document.getElementById('notifDropList');
    if (notifs.length === 0) {
      dropList.innerHTML = '<div class="empty-notif-drop">No notifications</div>';
    } else {
      dropList.innerHTML = notifs.slice(0, 5).map(n => `
        <div class="notif-drop-item ${n.is_read ? 'read' : 'unread'}">
          <strong>${n.title}</strong>
          <p>${n.message}</p>
          <span class="notif-time">${new Date(n.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Failed to load notifs:', err);
  }
}

function updateNotifBadge(count) {
  const sideBadge = document.getElementById('sideNotifBadge');
  const headerBadge = document.getElementById('headerNotifBadge');
  if (count > 0) {
    if (sideBadge) { sideBadge.style.display = 'inline-block'; sideBadge.textContent = count; }
    if (headerBadge) { headerBadge.style.display = 'inline-block'; headerBadge.textContent = count; }
  } else {
    if (sideBadge) sideBadge.style.display = 'none';
    if (headerBadge) headerBadge.style.display = 'none';
  }
}

window.toggleNotifPopup = function() {
  const popup = document.getElementById('notifPopup');
  popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
};

window.markAllNotificationsRead = async function() {
  try {
    await fetch('/api/merchant/notifications/read', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    loadNotifications();
    if (document.getElementById('ws-notifications').classList.contains('active')) {
      loadFullNotifications();
    }
  } catch (_) {}
};

async function loadFullNotifications() {
  const container = document.getElementById('fullNotifList');
  try {
    const res = await fetch('/api/merchant/notifications', {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) return;
    const data = await res.json();
    const notifs = data.notifications || [];

    if (notifs.length === 0) {
      container.innerHTML = '<p class="text-muted">No activity alerts recorded.</p>';
      return;
    }

    container.innerHTML = notifs.map(n => `
      <div class="full-notif-card ${n.is_read ? 'read' : 'unread'}">
        <div class="fn-icon">🔔</div>
        <div class="fn-content">
          <h4>${n.title}</h4>
          <p>${n.message}</p>
          <span class="fn-time">${new Date(n.created_at).toLocaleString('en-IN')}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// Settings
function populateSettingsForm() {
  if (!currentMerchant) return;
  document.getElementById('setBizName').value = currentMerchant.business_name || '';
  document.getElementById('setContactPhone').value = currentMerchant.contact_phone || '';
  document.getElementById('setCity').value = currentMerchant.city || '';
}

document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const businessName = document.getElementById('setBizName').value.trim();
  const contactPhone = document.getElementById('setContactPhone').value.trim();
  const city = document.getElementById('setCity').value.trim();

  try {
    const res = await fetch('/api/merchant/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ businessName, contactPhone, city })
    });
    const data = await res.json();
    if (res.ok) {
      currentMerchant = data.merchant;
      document.getElementById('sideMerchantName').textContent = currentMerchant.business_name;
      alert('Business profile updated successfully!');
    }
  } catch (err) {
    alert('Failed to update profile');
  }
});

document.getElementById('passwordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('currPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmNewPassword = document.getElementById('confirmNewPassword').value;

  if (newPassword !== confirmNewPassword) {
    alert('New passwords do not match');
    return;
  }

  try {
    const res = await fetch('/api/merchant/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Password updated successfully!');
      document.getElementById('passwordForm').reset();
    } else {
      alert(data.error || 'Password update failed');
    }
  } catch (err) {
    alert('Failed to update password');
  }
});

// Logout
window.handleLogout = async function() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
  } catch (_) {}
  sessionStorage.clear();
  window.location.href = '/login';
};
