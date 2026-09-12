// ===================================================================
// Xerox Centre — Super Admin Portal Logic
// Sections: Assignments | Staff Accounts | Pricing
// ===================================================================

let currentUser = null;
let allStaff = [];
let attachedFileObject = null;

document.addEventListener('DOMContentLoaded', () => {
  initSuperAdmin();
});

async function initSuperAdmin() {
  await checkSuperAdminAuth();
  loadAllData();
  wireEventListeners();
}

// ---------------- AUTH CHECK ----------------
async function checkSuperAdminAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/admin'; return; }
    const user = await res.json();
    const roleUpper = (user.role || '').toUpperCase();
    if (roleUpper !== 'SUPER_ADMIN' && roleUpper !== 'SUPERADMIN') {
      alert('Access Restricted: Super Admin credentials required.');
      window.location.href = (roleUpper === 'ADMIN') ? '/admin/dashboard' : '/admin';
      return;
    }
    currentUser = user;
    const nameEl = document.getElementById('superadmin-welcome-name');
    if (nameEl) nameEl.textContent = user.name || 'Superadmin';
  } catch (err) {
    window.location.href = '/admin';
  }
}

// ---------------- LOGOUT ----------------
document.getElementById('superadmin-logout-btn')?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/admin';
});

// ---------------- DATA LOAD ----------------
function loadAllData() {
  loadAssignments();
  // Staff & pricing load on section open
}

// ===================================================================
// SECTION: ASSIGNMENTS
// ===================================================================
async function loadAssignments() {
  const loadingEl = document.getElementById('sa-asgn-loading');
  const gridEl    = document.getElementById('sa-asgn-grid');
  const emptyEl   = document.getElementById('sa-asgn-empty');
  if (loadingEl) loadingEl.style.display = 'block';
  if (gridEl)    gridEl.style.display = 'none';
  if (emptyEl)   emptyEl.style.display = 'none';

  try {
    const res = await fetch(`/api/assignments?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
    });
    if (!res.ok) throw new Error('Failed to load assignments');
    const data = await res.json();
    const assignments = data.assignments || [];

    if (loadingEl) loadingEl.style.display = 'none';

    if (assignments.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (gridEl)  gridEl.style.display = 'grid';
    gridEl.innerHTML = '';

    assignments.forEach(a => {
      const card = document.createElement('div');
      card.className = 'asgn-card';
      card.id = `sa-asgn-${a.id}`;
      const hasAtt = a.hasAttachment;
      const previewBtn = hasAtt
        ? `<button type="button" class="action-btn preview-btn"
             onclick="openPreview('${a.id}','${encodeURIComponent(a.attachmentName||'file')}')">
             👁 Preview
           </button>
           <a href="/api/assignments/${a.id}/attachment" class="action-btn download-btn"
              download="${a.attachmentName||'file'}">⬇ Download</a>`
        : `<span style="font-size:12px;color:#7d9183;">No file</span>`;
      card.innerHTML = `
        <div class="asgn-card-top">
          <span class="asgn-subject-tag">${a.subject}</span>
          ${a.deadline ? `<span class="asgn-deadline-pill">Due: ${a.deadline}</span>` : ''}
        </div>
        <h3 class="asgn-title">${a.title || a.subject}</h3>
        <div class="asgn-card-footer">
          <div class="asgn-actions">
            ${previewBtn}
            <button type="button" class="action-btn delete-asgn-btn" style="margin-left:auto;"
              onclick="deleteAssignment('${a.id}')">🗑 Delete</button>
          </div>
        </div>
      `;
      gridEl.appendChild(card);
    });
  } catch (err) {
    showToast('Failed to load assignments: ' + err.message, 'error');
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

window.deleteAssignment = async function(id) {
  if (!confirm('Permanently delete this assignment?')) return;
  // Optimistic UI remove
  const card = document.getElementById(`sa-asgn-${id}`);
  if (card) card.remove();
  try {
    const res = await fetch(`/api/admin/assignments/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Assignment deleted.', 'info');
    // Check if grid is now empty
    const gridEl = document.getElementById('sa-asgn-grid');
    if (gridEl && !gridEl.children.length) {
      gridEl.style.display = 'none';
      const emptyEl = document.getElementById('sa-asgn-empty');
      if (emptyEl) emptyEl.style.display = 'block';
    }
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
    loadAssignments(); // recover on error
  }
};

window.openPreview = function(id, fnameEncoded) {
  const fname = decodeURIComponent(fnameEncoded);
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px;';
  const isImg = /\.(png|jpg|jpeg|gif|svg)$/i.test(fname);
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:100%;max-width:700px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.25);">
      <div style="background:linear-gradient(135deg,#2d8f4e,#1e6b38);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">
        <h3 style="color:#fff;margin:0;font-size:15px;">${fname}</h3>
        <button onclick="this.closest('[style*=fixed]').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:16px;">✕</button>
      </div>
      <div style="padding:0;max-height:70vh;overflow:auto;">
        ${isImg
          ? `<img src="/api/assignments/${id}/attachment?inline=1" style="width:100%;display:block;">`
          : `<iframe src="/api/assignments/${id}/attachment?inline=1" style="width:100%;height:65vh;border:none;"></iframe>`}
      </div>
      <div style="padding:14px 20px;border-top:1px solid #f0f5f1;">
        <a href="/api/assignments/${id}/attachment" download="${fname}"
           style="background:linear-gradient(135deg,#2d8f4e,#1e6b38);color:#fff;padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;">
          ⬇ Download
        </a>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
};

// ===================================================================
// SECTION: STAFF
// ===================================================================
async function loadStaff() {
  const loadingEl = document.getElementById('staff-loading');
  const tableEl   = document.getElementById('staff-table');
  const tbodyEl   = document.getElementById('staff-tbody');
  if (loadingEl) loadingEl.style.display = 'block';
  if (tableEl)   tableEl.style.display = 'none';

  try {
    const res = await fetch('/api/superadmin/staff');
    if (!res.ok) throw new Error('Could not fetch staff accounts');
    const data = await res.json();
    allStaff = data.staff || [];

    const countEl = document.getElementById('tab-staff-count');
    if (countEl) countEl.textContent = allStaff.length;

    tbodyEl.innerHTML = '';
    allStaff.forEach(s => {
      const tr = document.createElement('tr');
      const isSelf = currentUser && currentUser.email === s.email;
      const isDisabled = !!s.disabled;
      const statusBadge = isDisabled
        ? '<span class="sbadge-disabled">Disabled</span>'
        : '<span class="sbadge-active">Active</span>';
      const sRole = (s.role || '').toUpperCase();
      const roleBadge = (sRole === 'SUPER_ADMIN' || sRole === 'SUPERADMIN')
        ? '<span class="sbadge-role">👑 Super Admin</span>'
        : '<span class="sbadge-role">🛡️ Staff</span>';
      const dateStr = s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-IN') : 'N/A';
      tr.innerHTML = `
        <td><strong>${s.name}</strong> ${isSelf ? '<span style="font-size:11px;color:#2d8f4e;">(You)</span>' : ''}</td>
        <td><code>${s.email}</code></td>
        <td>${roleBadge}</td>
        <td>${dateStr}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="staff-actions">
            ${!isSelf ? `<button type="button" class="btn-sm ${isDisabled?'btn-enable-sm':'btn-disable-sm'}"
                onclick="toggleStaffStatus('${s.id}',${!isDisabled})">
                ${isDisabled ? '✅ Enable' : '🚫 Disable'}</button>` : ''}
            <button type="button" class="btn-sm btn-reset-sm"
              onclick="openResetPwdModal('${s.id}','${s.name}','${s.email}')">🔑 Reset Pwd</button>
          </div>
        </td>`;
      tbodyEl.appendChild(tr);
    });
    if (loadingEl) loadingEl.style.display = 'none';
    if (tableEl)   tableEl.style.display = 'table';
  } catch (err) {
    showToast('Failed to load staff: ' + err.message, 'error');
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

window.toggleStaffStatus = async function(staffId, newDisabledState) {
  if (!confirm(`${newDisabledState ? 'Disable' : 'Enable'} this staff account?`)) return;
  try {
    const res = await fetch(`/api/superadmin/staff/${staffId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: newDisabledState })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Status update failed');
    showToast(`Staff account ${newDisabledState ? 'disabled' : 'enabled'}.`, 'success');
    loadStaff();
  } catch (err) { showToast(err.message, 'error'); }
};

window.openResetPwdModal = function(id, name, email) {
  document.getElementById('reset-staff-target-id').value = id;
  document.getElementById('reset-staff-target-name').textContent = name;
  document.getElementById('reset-staff-target-email').textContent = email;
  document.getElementById('reset-pwd-input').value = '';
  document.getElementById('reset-pwd-modal').style.display = 'flex';
};

// ===================================================================
// SECTION: PRICING
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
  } catch (err) { console.error('Error loading pricing:', err); }
}

// ===================================================================
// WIRE EVENT LISTENERS
// ===================================================================
function wireEventListeners() {
  // Section action cards (defined inline in HTML for robustness)
  // Staff form toggle
  document.getElementById('btn-toggle-new-staff')?.addEventListener('click', () => {
    const container = document.getElementById('create-staff-container');
    if (container) container.classList.toggle('show');
  });
  document.getElementById('btn-cancel-new-staff')?.addEventListener('click', () => {
    const container = document.getElementById('create-staff-container');
    if (container) container.classList.remove('show');
  });

  // Create staff form
  document.getElementById('create-staff-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-staff-name').value.trim();
    const email = document.getElementById('new-staff-email').value.trim();
    const password = document.getElementById('new-staff-pwd').value;
    const role = document.getElementById('new-staff-role').value;
    const submitBtn = document.getElementById('btn-submit-staff');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }
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
      document.getElementById('create-staff-container').classList.remove('show');
      loadStaff();
    } catch (err) { showToast(err.message, 'error'); }
    finally { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Account'; } }
  });

  // Pricing form
  document.getElementById('pricing-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('btn-save-pricing');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
    const newPricing = {
      'bw-single':    parseFloat(document.getElementById('price-bw-single').value) || 2,
      'bw-double':    parseFloat(document.getElementById('price-bw-double').value) || 3,
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
      showToast('Pricing updated! Active for all future orders.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
    finally { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Save Pricing'; } }
  });

  // Assignment modal
  const asgnFileInput = document.getElementById('asgn-file-input');
  const asgnFileStatus = document.getElementById('asgn-file-status');
  const asgnDropzone = document.getElementById('asgn-dropzone');
  asgnDropzone?.addEventListener('click', () => asgnFileInput?.click());
  asgnFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4.5 * 1024 * 1024) { alert('File must be under 4.5 MB.'); return; }
    if (asgnFileStatus) asgnFileStatus.textContent = `Reading ${file.name}…`;
    const reader = new FileReader();
    reader.onload = () => {
      attachedFileObject = { originalName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, dataBase64: reader.result.split(',')[1] };
      if (asgnFileStatus) asgnFileStatus.textContent = `✅ Ready: ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('add-asgn-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('submit-asgn-btn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Publishing…'; }
    const subject  = document.getElementById('asgn-subject-input')?.value.trim();
    const deadline = document.getElementById('asgn-deadline-input')?.value || '';
    if (!subject) { alert('Subject is required.'); if (submitBtn) { submitBtn.disabled=false; submitBtn.textContent='Publish Assignment'; } return; }
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, deadline, attachment: attachedFileObject })
      });
      const data = await res.json();
      if (res.status === 401) {
        alert('Session expired. Please log in again.');
        window.location.href = '/admin';
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed');
      showToast('Assignment published!', 'success');
      document.getElementById('add-asgn-form').reset();
      attachedFileObject = null;
      if (asgnFileStatus) asgnFileStatus.textContent = 'Supports PDF, JPG, PNG, DOC (max 4 MB)';
      document.getElementById('admin-asgn-modal').style.display = 'none';
      loadAssignments();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
    finally { if (submitBtn) { submitBtn.disabled=false; submitBtn.textContent='Publish Assignment'; } }
  });

  // Reset password modal
  document.getElementById('reset-pwd-close')?.addEventListener('click', () => {
    document.getElementById('reset-pwd-modal').style.display = 'none';
  });
  document.getElementById('reset-pwd-cancel')?.addEventListener('click', () => {
    document.getElementById('reset-pwd-modal').style.display = 'none';
  });
  document.getElementById('reset-pwd-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const staffId     = document.getElementById('reset-staff-target-id').value;
    const newPassword = document.getElementById('reset-pwd-input').value;
    try {
      const res = await fetch(`/api/superadmin/staff/${staffId}/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password reset failed');
      showToast('Password updated!', 'success');
      document.getElementById('reset-pwd-modal').style.display = 'none';
    } catch (err) { showToast(err.message, 'error'); }
  });

  // Section switching — load data when section opens
  window.showSection = function(name) {
    ['assignments','staff','pricing'].forEach(s => {
      const el = document.getElementById('section-' + s);
      const card = document.getElementById('acard-' + s);
      if (el) el.style.display = s === name ? 'block' : 'none';
      if (card) card.classList.toggle('active-action', s === name);
    });
    if (name === 'staff')   loadStaff();
    if (name === 'pricing') loadPricing();
    if (name === 'assignments') loadAssignments();
  };
}

// ===================================================================
// TOAST
// ===================================================================
function showToast(msg, type = 'info') {
  const toast = document.getElementById('super-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `admin-toast show ${type}`;
  setTimeout(() => { toast.className = 'admin-toast'; }, 3500);
}
