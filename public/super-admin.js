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
    const roleUpper = (user.role || '').toUpperCase();
    if (roleUpper !== 'SUPER_ADMIN' && roleUpper !== 'SUPERADMIN') {
      alert('Access Restricted: Super Admin credentials required.');
      window.location.href = (roleUpper === 'ADMIN') ? '/admin/dashboard' : '/admin';
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

// ---------------- TABS SWITCHER (Admin Accounts & Pricing Only) ----------------
function setupTabs() {
  const tabs = [
    { btn: 'tab-btn-staff', view: 'view-staff' },
    { btn: 'tab-btn-pricing', view: 'view-pricing' }
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
    });
  });
}

function loadAllData() {
  loadStaff();
  loadPricing();
}

function setupEventListeners() {
  // Empty as all-orders was removed to keep superadmin strictly limited to staff & pricing
}

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
      const sRole = (s.role || '').toUpperCase();
      const roleBadge = (sRole === 'SUPER_ADMIN' || sRole === 'SUPERADMIN')
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

function showToast(msg, type = 'info') {
  const toast = document.getElementById('super-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `admin-toast show ${type}`;
  setTimeout(() => {
    toast.className = 'admin-toast';
  }, 3500);
}
