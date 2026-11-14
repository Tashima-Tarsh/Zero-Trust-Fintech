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
  const valid = ['overview', 'payments', 'create-payment', 'upi-ids', 'reports', 'soundbox', 'ip-whitelist', 'notifications', 'settings'];
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
    'ip-whitelist': 'Server IP Whitelist',
    'notifications': 'Notifications',
    'settings': 'Settings'
  };
  document.getElementById('headerWorkspaceTitle').textContent = titles[target] || 'Overview';

  // Close mobile sidebar if open
  toggleMobileSidebar(false);

  // Trigger workspace specific refresh
  if (target === 'payments') loadPaymentsList();
  if (target === 'upi-ids') loadVpas();
  if (target === 'ip-whitelist') loadIpWhitelist();
  if (target === 'reports') loadReportsData();
  if (target === 'notifications') loadFullNotifications();
  if (target === 'settings') populateSettingsForm();
  if (target === 'create-payment') {
    populateCreatePaymentVpaSelect();
    generateNewOrderId();
  }
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
    if (metrics.totalTransactions === 0) {
      document.getElementById('metricSuccessRate').textContent = 'No transactions yet';
    } else {
      document.getElementById('metricSuccessRate').textContent = `${metrics.successRate}% completion rate (${metrics.totalTransactions} total)`;
    }
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
      : (t.status === 'PENDING' ? '<span class="badge-pending">● PENDING</span>' : '<span class="badge-expired">● EXPIRED</span>');

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
          <span class="ov-vpa-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4"></path></svg>
          </span>
          <div>
            <strong class="font-mono">${v.vpa_address}</strong>
            <span class="ov-bank-name">${v.bank_name} ${v.is_default ? '· <span class="tag-default"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:2px; vertical-align:-1px;"><polyline points="20 6 9 17 4 12"></polyline></svg>DEFAULT</span>' : ''}</span>
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
      : (o.status === 'PENDING' ? '<span class="badge-pending">● PENDING</span>' : '<span class="badge-expired">● EXPIRED</span>');

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
window.generateNewOrderId = function() {
  const d = new Date();
  const dateStr = d.getFullYear().toString().slice(-2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  const newId = `ORD_${dateStr}_${rand}`;
  const input = document.getElementById('orderCustomId');
  if (input) input.value = newId;
  return newId;
};

async function populateCreatePaymentVpaSelect() {
  const select = document.getElementById('orderVpaSelect');
  if (currentVpas.length === 0) await loadVpas();

  select.innerHTML = currentVpas
    .filter(v => v.status === 'ACTIVE')
    .map(v => `<option value="${v.vpa_address}" ${v.is_default ? 'selected' : ''}>${v.vpa_address} (${v.bank_name}) ${v.is_default ? '— Default' : ''}</option>`)
    .join('');

  const orderIdInput = document.getElementById('orderCustomId');
  if (orderIdInput && !orderIdInput.value) {
    generateNewOrderId();
  }
}

document.getElementById('createPaymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const amount = document.getElementById('orderAmount').value;
  const description = document.getElementById('orderDesc').value.trim();
  const vpaAddress = document.getElementById('orderVpaSelect').value;
  const orderId = (document.getElementById('orderCustomId')?.value || '').trim() || generateNewOrderId();

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
      body: JSON.stringify({ amount, description, vpaAddress, orderId })
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

    // Prepare next unique order ID for subsequent link
    setTimeout(generateNewOrderId, 500);
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

  // Direct Pay with App Button & clickable QR
  const appBtn = document.getElementById('btnOpenUpiApp');
  if (appBtn) appBtn.href = order.upi_uri;

  const qrBadge = document.getElementById('qrStatusBadge');
  qrBadge.className = 'status-pill-pending';
  qrBadge.textContent = 'Awaiting Scan';

  // Hide confirmation card on fresh order
  const confirmCard = document.getElementById('paymentConfirmationCard');
  if (confirmCard) confirmCard.style.display = 'none';

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

  // Wire click to open UPI app
  const qrCardBox = document.getElementById('qrCardBox');
  if (qrCardBox) {
    qrCardBox.onclick = () => window.openUpiAppDirectly();
  }

  // Reset simulate button
  const simBtn = document.getElementById('btnSimulatePayment');
  simBtn.disabled = false;
  simBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 6px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span>Simulate Customer Payment (Tests Soundbox)</span>';
}

function isMobileDevice() {
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua);
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 1);
  return isMobileUA || (isTouchDevice && window.innerWidth <= 820);
}

function getAppSpecificUri(app, baseUpi) {
  if (!baseUpi) return '';
  const query = baseUpi.includes('?') ? baseUpi.split('?')[1] : baseUpi.replace(/^upi:\/\/pay\??/, '');
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (app === 'gpay') {
    if (isAndroid) {
      return `intent://pay?${query}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`;
    } else if (isIOS) {
      return `tez://upi/pay?${query}`;
    }
    return `upi://pay?${query}`;
  }

  if (app === 'phonepe') {
    if (isAndroid) {
      return `intent://pay?${query}#Intent;scheme=upi;package=com.phonepe.app;end`;
    } else if (isIOS) {
      return `phonepe://pay?${query}`;
    }
    return `phonepe://pay?${query}`;
  }

  if (app === 'paytm') {
    if (isAndroid) {
      return `intent://pay?${query}#Intent;scheme=upi;package=net.one97.paytm;end`;
    } else if (isIOS) {
      return `paytmmp://pay?${query}`;
    }
    return `paytmmp://pay?${query}`;
  }

  if (app === 'bhim') {
    if (isAndroid) {
      return `intent://pay?${query}#Intent;scheme=upi;package=in.org.npci.upiapp;end`;
    }
    return `upi://pay?${query}`;
  }

  return baseUpi;
}

function dispatchDashUpi(uri) {
  if (!uri) return;
  window.__lastDispatchedUri = uri;
  try {
    const a = document.createElement('a');
    a.href = uri;
    a.target = '_top';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 120);
  } catch (_) {
    window.location.href = uri;
  }
}

window.openUpiAppDirectly = function() {
  if (!activeCreatedOrder || !activeCreatedOrder.upi_uri) {
    alert('Please generate a payment QR first.');
    return;
  }

  if (isMobileDevice()) {
    // Launch directly into mobile UPI chooser
    dispatchDashUpi(activeCreatedOrder.upi_uri);
  } else {
    // Desktop: show guidance modal
    const modal = document.getElementById('dashUpiModal');
    if (modal) modal.style.display = 'flex';
  }
};

window.openSpecificUpiApp = function(app) {
  if (!activeCreatedOrder || !activeCreatedOrder.upi_uri) {
    alert('Please generate a payment QR first.');
    return;
  }

  if (isMobileDevice()) {
    const targetUri = getAppSpecificUri(app, activeCreatedOrder.upi_uri);
    dispatchDashUpi(targetUri);
  } else {
    const modal = document.getElementById('dashUpiModal');
    if (modal) modal.style.display = 'flex';
  }
};

window.closeDashUpiModal = function() {
  const modal = document.getElementById('dashUpiModal');
  if (modal) modal.style.display = 'none';
};

window.copyPaymentLinkFromModal = function() {
  window.copyPaymentLink();
  window.closeDashUpiModal();
};

window.simulateFromModal = function() {
  window.closeDashUpiModal();
  window.simulatePaymentForActiveOrder();
};

window.copyPaymentLink = function() {
  const input = document.getElementById('generatedLinkInput');
  input.select();
  navigator.clipboard.writeText(input.value);
  alert('Payment link copied to clipboard!');
};

window.replaySoundboxAudio = function() {
  if (activeCreatedOrder && activeCreatedOrder.amount) {
    playMerchantAnnouncement(activeCreatedOrder.amount);
  }
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
      simBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 6px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span>Simulate Customer Payment</span>';
      return;
    }

    const completed = data.order;
    activeCreatedOrder = completed;

    // Update UI status
    const qrBadge = document.getElementById('qrStatusBadge');
    qrBadge.className = 'status-pill-active';
    qrBadge.textContent = '● COMPLETED';

    simBtn.textContent = `Verified! Bank UTR: ${completed.utr}`;

    // Reveal Full User Confirmation & Security Card
    const confirmCard = document.getElementById('paymentConfirmationCard');
    if (confirmCard) {
      confirmCard.style.display = 'block';
      const now = new Date();
      const istTime = new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: 'Asia/Kolkata'
      }).format(now);

      const confirmTimeEl = document.getElementById('confirmTimestamp');
      if (confirmTimeEl) confirmTimeEl.textContent = istTime + ' IST';

      const confirmSenderEl = document.getElementById('confirmSenderVpa');
      if (confirmSenderEl) confirmSenderEl.textContent = 'customer@okhdfcbank';

      const confirmMerchantEl = document.getElementById('confirmMerchantVpa');
      if (confirmMerchantEl) confirmMerchantEl.textContent = completed.vpa_address || (currentMerchant ? currentMerchant.primary_vpa : 'merchant@upi');

      const confirmUtrEl = document.getElementById('confirmUtr');
      if (confirmUtrEl) confirmUtrEl.textContent = completed.utr;

      const confirmOrderEl = document.getElementById('confirmOrderId');
      if (confirmOrderEl) confirmOrderEl.textContent = completed.id;
    }

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
        <td>${v.is_default ? '<span class="tag-default"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:3px; vertical-align:-1px;"><polyline points="20 6 9 17 4 12"></polyline></svg>DEFAULT</span>' : '<button type="button" class="btn-table-action" onclick="setDefaultVpa(\'' + v.id + '\')">Set Default</button>'}</td>
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
        <div class="fn-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        </div>
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

// ═══════════════════════════════════════════════════════════════════
// GAMING ENTERPRISE IP WHITELIST WORKSPACE
// ═══════════════════════════════════════════════════════════════════
let currentWhitelistedIps = [];

async function loadIpWhitelist() {
  try {
    const res = await fetch('/api/merchant/ip-whitelist', {
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    const apiKeyEl = document.getElementById('dispApiKey');
    if (apiKeyEl) apiKeyEl.value = data.apiKey || 'disha_live_default_key';

    const countEl = document.getElementById('ipNodeCount');
    if (countEl) countEl.textContent = `${data.ips ? data.ips.length : 0} Server IPs`;

    currentWhitelistedIps = data.ips || [];
    renderWhitelistTable(currentWhitelistedIps);
    renderBlockedAttemptsTable(data.blocked || []);
  } catch (err) {
    console.error('Failed to load IP whitelist:', err);
  }
}

function renderWhitelistTable(ips) {
  const tbody = document.getElementById('whitelistTableBody');
  if (!tbody) return;

  if (!ips || ips.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-table-msg">No server IPs whitelisted yet. Click "+ Whitelist New IP / CIDR" above.</td></tr>`;
    return;
  }

  tbody.innerHTML = ips.map(i => {
    const addr = i.ip_address || i.ip_range;
    const isCidr = Boolean(i.ip_range);
    const lastUsed = i.last_used_at ? new Date(i.last_used_at).toLocaleTimeString() : 'Never';

    return `
      <tr>
        <td>
          <strong class="font-mono" style="color: #38bdf8;">${addr}</strong>
          ${isCidr ? '<span style="font-size: 10px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 5px; border-radius: 4px; margin-left: 6px;">SUBNET CIDR</span>' : ''}
        </td>
        <td>${i.description || 'Game Server Node'}</td>
        <td><span class="status-pill-active">Whitelisted</span></td>
        <td>
          <button type="button" class="btn-table-danger" onclick="deleteServerIp('${i.id}')">Revoke</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderBlockedAttemptsTable(blocked) {
  const tbody = document.getElementById('blockedTableBody');
  if (!tbody) return;

  if (!blocked || blocked.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table-msg" style="color: #10b981;">✓ Zero unauthorized intrusions detected in the last 24 hours.</td></tr>`;
    return;
  }

  tbody.innerHTML = blocked.map(b => {
    const dateStr = b.last_attempt ? new Date(b.last_attempt).toLocaleTimeString() : 'Just now';
    return `
      <tr>
        <td><strong class="font-mono" style="color: #ef4444;">${b.ip_address}</strong></td>
        <td><span class="panel-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">${b.attempt_count} blocked</span></td>
        <td><code style="font-size: 12px;">${b.endpoint}</code></td>
        <td><span style="color: #f59e0b;">${b.reason}</span></td>
        <td class="text-muted" style="font-size: 12px;">${dateStr}</td>
      </tr>
    `;
  }).join('');
}

window.copyApiKey = function() {
  const apiKeyEl = document.getElementById('dispApiKey');
  if (!apiKeyEl) return;
  navigator.clipboard.writeText(apiKeyEl.value);
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = originalText; }, 1800);
};

window.openAddServerIpModal = function() {
  const modal = document.getElementById('addServerIpModal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('newServerIp').value = '';
    document.getElementById('newServerDesc').value = '';
    document.getElementById('newServerIp').focus();
    const box = document.getElementById('serverIpValidation');
    if (box) box.className = 'vpa-feedback-box empty';
  }
};

window.closeAddServerIpModal = function() {
  const modal = document.getElementById('addServerIpModal');
  if (modal) modal.style.display = 'none';
};

const serverIpInput = document.getElementById('newServerIp');
serverIpInput?.addEventListener('input', () => {
  const val = serverIpInput.value.trim();
  const box = document.getElementById('serverIpValidation');
  const icon = document.getElementById('serverIpIcon');
  const text = document.getElementById('serverIpText');
  const btn = document.getElementById('btnSaveServerIp');

  if (!val) {
    box.className = 'vpa-feedback-box empty';
    icon.textContent = 'ℹ️';
    text.textContent = 'Enter IPv4 address (e.g. 52.84.123.45) or CIDR (e.g. 52.84.0.0/16)';
    btn.disabled = true;
    return;
  }

  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(val);
  const isCidr = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(val);

  if (isIpv4 || isCidr) {
    box.className = 'vpa-feedback-box valid';
    icon.textContent = '✓';
    text.textContent = isCidr ? 'Valid CIDR subnet range syntax.' : 'Valid IPv4 server address syntax.';
    btn.disabled = false;
  } else {
    box.className = 'vpa-feedback-box invalid';
    icon.textContent = '⚠️';
    text.textContent = 'Invalid format. Provide a valid IPv4 address or CIDR notation.';
    btn.disabled = true;
  }
});

document.getElementById('addServerIpForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rawIp = document.getElementById('newServerIp').value.trim();
  const description = document.getElementById('newServerDesc').value.trim();
  const isCidr = rawIp.includes('/');

  try {
    const res = await fetch('/api/merchant/ip-whitelist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
      },
      body: JSON.stringify({
        ip_address: isCidr ? null : rawIp,
        ip_range: isCidr ? rawIp : null,
        description
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to whitelist IP');
      return;
    }
    closeAddServerIpModal();
    loadIpWhitelist();
  } catch (err) {
    alert('Server error while whitelisting IP');
  }
});

window.deleteServerIp = async function(ipId) {
  if (!confirm('Revoke access for this server IP? Requests from this IP will be blocked immediately.')) return;
  try {
    const res = await fetch(`/api/merchant/ip-whitelist/${ipId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + authToken }
    });
    if (res.ok) {
      loadIpWhitelist();
    }
  } catch (err) {
    console.error(err);
  }
};
