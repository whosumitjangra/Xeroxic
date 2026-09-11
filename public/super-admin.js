// ===================================================================
// Xerox Centre — Super Admin Portal Logic
// Full system administration: staff, pricing, orders, analytics
// ===================================================================

let currentUser = null;
let allStaff = [];
let allOrders = [];
let activeOrderFilter = 'all';
let orderSearchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
  initSuperAdmin();
});

async function initSuperAdmin() {
  await checkSuperAdminAuth();
  setupTabs();
  setupEventListeners();
  loadAllData();
}

// ---------------- AUTH CHECK ----------------
async function checkSuperAdminAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      window.location.href = '/admin';
      return;
    }
    const user = await res.json();
    if (user.role !== 'superadmin') {
      alert('Access Restricted: Super Admin credentials required.');
      window.location.href = user.role === 'admin' ? '/admin/dashboard' : '/';
      return;
    }
    currentUser = user;
    const nameEl = document.getElementById('superadmin-welcome-name');
    if (nameEl) nameEl.textContent = `Hi, ${user.name}`;
  } catch (err) {
    window.location.href = '/admin';
  }
}

// ---------------- LOGOUT ----------------
document.getElementById('superadmin-logout-btn')?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/admin';
});

// ---------------- TABS SWITCHER ----------------
function setupTabs() {
  const tabs = [
    { btn: 'tab-btn-overview', view: 'view-overview' },
    { btn: 'tab-btn-staff', view: 'view-staff' },
    { btn: 'tab-btn-pricing', view: 'view-pricing' },
    { btn: 'tab-btn-allorders', view: 'view-allorders' }
  ];

  tabs.forEach(t => {
    const btn = document.getElementById(t.btn);
    if (!btn) return;
    btn.addEventListener('click', () => {
      tabs.forEach(o => {
        document.getElementById(o.btn)?.classList.remove('active');
        const v = document.getElementById(o.view);
        if (v) v.style.display = 'none';
      });
      btn.classList.add('active');
      const targetView = document.getElementById(t.view);
      if (targetView) targetView.style.display = 'block';

      if (t.view === 'view-staff') loadStaff();
      if (t.view === 'view-pricing') loadPricing();
      if (t.view === 'view-allorders') loadOrders();
    });
  });
}

function loadAllData() {
  loadOverviewStats();
  loadStaff();
  loadPricing();
  loadOrders();
}

// ===================================================================
// TAB 1: SYSTEM OVERVIEW & STATS
// ===================================================================
async function loadOverviewStats() {
  try {
    const res = await fetch('/api/superadmin/stats');
    if (!res.ok) throw new Error('Could not fetch stats');
    const data = await res.json();

    document.getElementById('stat-total-orders').textContent = data.totalOrders || 0;
    document.getElementById('stat-total-revenue').textContent = `₹${data.totalRevenue || 0}`;
    document.getElementById('stat-total-staff').textContent = data.totalStaff || 0;
    document.getElementById('stat-total-students').textContent = data.totalStudents || 0;

    const counts = data.statusCounts || {};
    document.getElementById('count-new').textContent = counts['New'] || 0;
    document.getElementById('count-accepted').textContent = counts['Accepted'] || 0;
    document.getElementById('count-printing').textContent = counts['Printing'] || 0;
    document.getElementById('count-ready').textContent = counts['Ready for Collection'] || 0;
    document.getElementById('count-collected').textContent = counts['Collected'] || 0;

    const tabOrdersCount = document.getElementById('tab-orders-count');
    if (tabOrdersCount) tabOrdersCount.textContent = data.totalOrders || 0;
    const tabStaffCount = document.getElementById('tab-staff-count');
    if (tabStaffCount) tabStaffCount.textContent = data.totalStaff || 0;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

document.getElementById('refresh-overview-btn')?.addEventListener('click', () => {
  loadOverviewStats();
  showToast('Statistics refreshed', 'info');
});

// ===================================================================
// TAB 2: STAFF ACCOUNTS
// ===================================================================
async function loadStaff() {
  const loadingEl = document.getElementById('staff-loading');
  const tableEl = document.getElementById('staff-table');
  const tbodyEl = document.getElementById('staff-tbody');

  if (loadingEl) loadingEl.style.display = 'block';
  if (tableEl) tableEl.style.display = 'none';

  try {
    const res = await fetch('/api/superadmin/staff');
    if (!res.ok) throw new Error('Could not fetch staff accounts');
    const data = await res.json();
    allStaff = data.staff || [];

    const tabStaffCount = document.getElementById('tab-staff-count');
    if (tabStaffCount) tabStaffCount.textContent = allStaff.length;

    tbodyEl.innerHTML = '';
    allStaff.forEach(s => {
      const tr = document.createElement('tr');
      const isSelf = currentUser && currentUser.email === s.email;
      const isDisabled = !!s.disabled;
      const statusBadge = isDisabled
        ? '<span class="staff-badge-disabled">Disabled</span>'
        : '<span class="staff-badge-active">Active</span>';
      const roleBadge = s.role === 'superadmin'
        ? '<span class="super-badge">👑 Super Admin</span>'
        : '<span class="staff-role-badge">🛡️ Staff</span>';

      const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-IN') : 'N/A';

      tr.innerHTML = `
        <td><strong>${s.name}</strong> ${isSelf ? '<span style="font-size:11px; color:#2b7a2b;">(You)</span>' : ''}</td>
        <td><code>${s.email}</code></td>
        <td>${roleBadge}</td>
        <td>${dateStr}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="staff-actions">
            ${!isSelf ? `
              <button type="button" class="btn-action-sm ${isDisabled ? 'btn-enable' : 'btn-disable'}" onclick="toggleStaffStatus('${s.id}', ${!isDisabled})">
                ${isDisabled ? '✅ Enable' : '🚫 Disable'}
              </button>
            ` : ''}
            <button type="button" class="btn-action-sm btn-reset-pwd" onclick="openResetPwdModal('${s.id}', '${s.name}', '${s.email}')">
              🔑 Reset Password
            </button>
          </div>
        </td>
      `;
      tbodyEl.appendChild(tr);
    });

    if (loadingEl) loadingEl.style.display = 'none';
    if (tableEl) tableEl.style.display = 'table';
  } catch (err) {
    console.error('Error loading staff:', err);
    showToast('Failed to load staff accounts: ' + err.message, 'error');
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

// Toggle staff create form
const toggleCreateStaffBtn = document.getElementById('btn-toggle-new-staff');
const createStaffContainer = document.getElementById('create-staff-container');
const cancelCreateStaffBtn = document.getElementById('btn-cancel-new-staff');

toggleCreateStaffBtn?.addEventListener('click', () => {
  createStaffContainer.style.display = createStaffContainer.style.display === 'none' ? 'block' : 'none';
});
cancelCreateStaffBtn?.addEventListener('click', () => {
  createStaffContainer.style.display = 'none';
});

// Create staff submit
document.getElementById('create-staff-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-staff-name').value.trim();
  const email = document.getElementById('new-staff-email').value.trim();
  const password = document.getElementById('new-staff-pwd').value;
  const role = document.getElementById('new-staff-role').value;
  const submitBtn = document.getElementById('btn-submit-staff');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating Account...';

  try {
    const res = await fetch('/api/superadmin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create staff account');

    showToast(`Staff account created for ${name}!`, 'success');
    document.getElementById('create-staff-form').reset();
    createStaffContainer.style.display = 'none';
    loadStaff();
    loadOverviewStats();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
});

// Toggle Staff Disable / Enable
window.toggleStaffStatus = async function(staffId, newDisabledState) {
  const actionText = newDisabledState ? 'disable' : 'enable';
  if (!confirm(`Are you sure you want to ${actionText} this staff account?`)) return;

  try {
    const res = await fetch(`/api/superadmin/staff/${staffId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: newDisabledState })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Status update failed');

    showToast(`Staff account successfully ${newDisabledState ? 'disabled' : 'enabled'}!`, 'success');
    loadStaff();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// Reset Password Modal
window.openResetPwdModal = function(id, name, email) {
  document.getElementById('reset-staff-target-id').value = id;
  document.getElementById('reset-staff-target-name').textContent = name;
  document.getElementById('reset-staff-target-email').textContent = email;
  document.getElementById('reset-pwd-input').value = '';
  document.getElementById('reset-pwd-modal').style.display = 'flex';
};

document.getElementById('reset-pwd-close')?.addEventListener('click', () => {
  document.getElementById('reset-pwd-modal').style.display = 'none';
});
document.getElementById('reset-pwd-cancel')?.addEventListener('click', () => {
  document.getElementById('reset-pwd-modal').style.display = 'none';
});

document.getElementById('reset-pwd-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const staffId = document.getElementById('reset-staff-target-id').value;
  const newPassword = document.getElementById('reset-pwd-input').value;

  try {
    const res = await fetch(`/api/superadmin/staff/${staffId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Password reset failed');

    showToast('Password successfully updated!', 'success');
    document.getElementById('reset-pwd-modal').style.display = 'none';
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ===================================================================
// TAB 3: PRICING TABLE MANAGEMENT
// ===================================================================
async function loadPricing() {
  try {
    const res = await fetch('/api/superadmin/pricing');
    if (!res.ok) throw new Error('Could not fetch pricing');
    const data = await res.json();
    const pricing = data.pricing || {};

    document.getElementById('price-bw-single').value = pricing['bw-single'] || 2;
    document.getElementById('price-bw-double').value = pricing['bw-double'] || 3;
    document.getElementById('price-color-single').value = pricing['color-single'] || 5;
    document.getElementById('price-color-double').value = pricing['color-double'] || 8;
  } catch (err) {
    console.error('Error loading pricing:', err);
  }
}

document.getElementById('pricing-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('btn-save-pricing');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving Rates...';

  const newPricing = {
    'bw-single': parseFloat(document.getElementById('price-bw-single').value) || 2,
    'bw-double': parseFloat(document.getElementById('price-bw-double').value) || 3,
    'color-single': parseFloat(document.getElementById('price-color-single').value) || 5,
    'color-double': parseFloat(document.getElementById('price-color-double').value) || 8
  };

  try {
    const res = await fetch('/api/superadmin/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPricing)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save pricing');

    showToast('Pricing table successfully updated! Active for all future student orders.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '💾 Save New Pricing Table';
  }
});

// ===================================================================
// TAB 4: ALL PRINT ORDERS MASTER LOG
// ===================================================================
async function loadOrders() {
  const loadingEl = document.getElementById('so-orders-loading');
  const containerEl = document.getElementById('so-orders-container');
  const emptyEl = document.getElementById('so-orders-empty');

  if (loadingEl) loadingEl.style.display = 'block';
  if (containerEl) containerEl.style.display = 'none';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const res = await fetch('/api/admin/orders');
    if (!res.ok) throw new Error('Could not fetch orders');
    const data = await res.json();
    allOrders = data.orders || [];

    const tabOrdersCount = document.getElementById('tab-orders-count');
    if (tabOrdersCount) tabOrdersCount.textContent = allOrders.length;

    renderMasterOrders();
  } catch (err) {
    console.error('Error loading all orders:', err);
    showToast('Failed to load orders: ' + err.message, 'error');
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

document.getElementById('refresh-allorders-btn')?.addEventListener('click', () => {
  loadOrders();
  showToast('Orders refreshed', 'info');
});

function setupEventListeners() {
  // Search orders
  const searchInput = document.getElementById('so-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      orderSearchQuery = e.target.value.trim();
      renderMasterOrders();
    });
  }

  // Filter pills
  const pills = document.querySelectorAll('#so-status-filters .filter-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeOrderFilter = pill.getAttribute('data-filter');
      renderMasterOrders();
    });
  });
}

function renderMasterOrders() {
  const containerEl = document.getElementById('so-orders-container');
  const emptyEl = document.getElementById('so-orders-empty');
  if (!containerEl) return;

  const filtered = allOrders.filter(order => {
    if (activeOrderFilter !== 'all') {
      if (order.status !== activeOrderFilter) {
        if (activeOrderFilter === 'New' && order.status === 'Order Received') return true;
        if (activeOrderFilter === 'Printing' && order.status === 'Printing in Progress') return true;
        if (activeOrderFilter === 'Ready for Collection' && order.status === 'Ready for Pickup') return true;
        if (activeOrderFilter === 'Collected' && order.status === 'Completed') return true;
        return false;
      }
    }
    if (orderSearchQuery) {
      const q = orderSearchQuery.toLowerCase();
      const matchId = (order.orderId || '').toLowerCase().includes(q);
      const matchName = (order.ownerName || '').toLowerCase().includes(q);
      const matchEmail = (order.ownerEmail || '').toLowerCase().includes(q);
      const matchDoc = (order.items || []).some(item => (item.originalName || '').toLowerCase().includes(q));
      if (!matchId && !matchName && !matchEmail && !matchDoc) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    containerEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  containerEl.style.display = 'flex';
  containerEl.innerHTML = '';

  filtered.forEach(order => {
    const card = document.createElement('div');
    card.className = 'admin-order-card';
    card.id = `so-card-${order.orderId}`;

    const formattedDate = order.createdAt
      ? new Date(order.createdAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      : 'N/A';

    const statusClass = getStatusClass(order.status);

    let itemsHtml = '';
    (order.items || []).forEach(item => {
      const printSpecs = `${item.color === 'color' ? '🎨 Color' : '⬛ B&W'} • ${item.sides === 'double' ? 'Double-sided' : 'Single'} • ${item.pages} page${item.pages > 1 ? 's' : ''}`;
      itemsHtml += `
        <div class="admin-doc-item">
          <div class="admin-doc-info">
            <div class="admin-doc-icon">📄</div>
            <div>
              <div class="admin-doc-name">${item.originalName}</div>
              <div class="admin-doc-specs">${printSpecs} — <strong>₹${item.price}</strong></div>
            </div>
          </div>
          <div class="admin-doc-actions">
            ${item.fileId ? `
              <a href="/api/download/${item.fileId}?inline=1" target="_blank" class="admin-btn-action admin-btn-preview">👁 Preview</a>
              <a href="/api/download/${item.fileId}" download="${item.originalName}" class="admin-btn-action admin-btn-download">⬇ Download</a>
            ` : '<span class="admin-no-file">No File</span>'}
          </div>
        </div>
      `;
    });

    const isNew = order.status === 'New' || order.status === 'Order Received';
    const isAccepted = order.status === 'Accepted';
    const isPrinting = order.status === 'Printing' || order.status === 'Printing in Progress';
    const isReady = order.status === 'Ready for Collection' || order.status === 'Ready for Pickup';
    const isCollected = order.status === 'Collected' || order.status === 'Completed';

    card.innerHTML = `
      <div class="admin-order-header">
        <div class="admin-order-meta">
          <span class="admin-order-id">${order.orderId}</span>
          <span class="admin-order-date">📅 ${formattedDate}</span>
          <span class="admin-customer-info">👤 <strong>${order.ownerName}</strong> (${order.ownerEmail})</span>
        </div>
        <div class="admin-order-badge-wrap">
          <span class="admin-status-badge ${statusClass}" id="so-badge-${order.orderId}">
            ${order.status}
          </span>
        </div>
      </div>

      <div class="admin-order-body">
        <div class="admin-docs-list">
          ${itemsHtml || '<p class="admin-no-docs">No items in this order.</p>'}
        </div>
      </div>

      <div class="admin-order-footer">
        <div class="admin-order-total">
          <span>Total:</span>
          <strong>₹${order.total}</strong>
        </div>

        <div class="admin-status-controller">
          <label class="admin-control-label">Update Status:</label>
          <select class="admin-status-select so-status-select" data-order-id="${order.orderId}">
            <option value="New" ${isNew ? 'selected' : ''}>🟡 New</option>
            <option value="Accepted" ${isAccepted ? 'selected' : ''}>🔵 Accepted</option>
            <option value="Printing" ${isPrinting ? 'selected' : ''}>🖨️ Printing</option>
            <option value="Ready for Collection" ${isReady ? 'selected' : ''}>🟢 Ready for Collection</option>
            <option value="Collected" ${isCollected ? 'selected' : ''}>✅ Collected</option>
          </select>
        </div>
      </div>
    `;

    containerEl.appendChild(card);
  });

  document.querySelectorAll('.so-status-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const orderId = e.target.getAttribute('data-order-id');
      const newStatus = e.target.value;
      await updateOrderStatusFromSuper(orderId, newStatus);
    });
  });
}

async function updateOrderStatusFromSuper(orderId, newStatus) {
  try {
    const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Status update failed');

    const order = allOrders.find(o => o.orderId === orderId);
    if (order) order.status = newStatus;

    const badgeEl = document.getElementById(`so-badge-${orderId}`);
    if (badgeEl) {
      badgeEl.textContent = newStatus;
      badgeEl.className = `admin-status-badge ${getStatusClass(newStatus)}`;
    }

    loadOverviewStats();
    showToast(`Order ${orderId} updated to "${newStatus}"!`, 'success');
  } catch (err) {
    showToast('Failed to update status: ' + err.message, 'error');
  }
}

function getStatusClass(status) {
  if (status === 'New' || status === 'Order Received') return 'badge-received';
  if (status === 'Accepted') return 'badge-received';
  if (status === 'Printing' || status === 'Printing in Progress') return 'badge-printing';
  if (status === 'Ready for Collection' || status === 'Ready for Pickup') return 'badge-ready';
  if (status === 'Collected' || status === 'Completed') return 'badge-completed';
  return 'badge-received';
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('super-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `admin-toast show ${type}`;
  setTimeout(() => {
    toast.className = 'admin-toast';
  }, 3500);
}
