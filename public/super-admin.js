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
let allSuperAssignments = [];
let currentSuperSubjectFilter = 'all';
let currentSuperSearch = '';

function formatSuperBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

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
    allSuperAssignments = data.assignments || [];

    setupSuperSubjectFilters(allSuperAssignments);
    renderSuperAssignments();
  } catch (err) {
    showToast('Failed to load assignments: ' + err.message, 'error');
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function setupSuperSubjectFilters(assignments) {
  const container = document.getElementById('sa-asgn-subject-filters');
  if (!container) return;
  const subjects = Array.from(new Set(assignments.map(a => a.subject).filter(Boolean)));

  if (currentSuperSubjectFilter !== 'all' && !subjects.includes(currentSuperSubjectFilter)) {
    currentSuperSubjectFilter = 'all';
  }

  const isAllActive = currentSuperSubjectFilter === 'all';
  container.innerHTML = `<button type="button" class="fpill ${isAllActive ? 'active' : ''}" data-subject="all">All Subjects (${assignments.length})</button>`;

  subjects.forEach(subj => {
    const count = assignments.filter(a => a.subject === subj).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fpill ${currentSuperSubjectFilter === subj ? 'active' : ''}`;
    btn.dataset.subject = subj;
    btn.textContent = `${subj} (${count})`;
    btn.onclick = () => {
      container.querySelectorAll('.fpill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSuperSubjectFilter = subj;
      renderSuperAssignments();
    };
    container.appendChild(btn);
  });

  const allBtn = container.querySelector('[data-subject="all"]');
  if (allBtn) {
    allBtn.onclick = () => {
      container.querySelectorAll('.fpill').forEach(b => b.classList.remove('active'));
      allBtn.classList.add('active');
      currentSuperSubjectFilter = 'all';
      renderSuperAssignments();
    };
  }
}

function renderSuperAssignments() {
  const gridEl = document.getElementById('sa-asgn-grid');
  const emptyEl = document.getElementById('sa-asgn-empty');
  if (!gridEl) return;

  const filtered = allSuperAssignments.filter(a => {
    const matchesSubject = currentSuperSubjectFilter === 'all' || a.subject === currentSuperSubjectFilter;
    const q = currentSuperSearch.toLowerCase();
    const matchesSearch = !q ||
      (a.subject && a.subject.toLowerCase().includes(q)) ||
      (a.title && a.title.toLowerCase().includes(q)) ||
      (a.attachmentName && a.attachmentName.toLowerCase().includes(q));
    return matchesSubject && matchesSearch;
  });

  if (filtered.length === 0) {
    gridEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const p = emptyEl.querySelector('p');
      if (p) p.textContent = allSuperAssignments.length === 0 ? 'No assignments published yet.' : 'No assignments match your search or filter.';
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  gridEl.style.display = 'grid';
  gridEl.innerHTML = '';

  filtered.forEach(a => {
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
      : '';

    const attChipHTML = hasAtt ? `
      <div class="asgn-att-chip">
        <span class="att-icon">📎</span>
        <div class="att-info">
          <span class="att-name" title="${a.attachmentName || 'Attachment'}">${a.attachmentName || 'Attachment'}</span>
          <span class="att-size">${formatSuperBytes(a.attachmentSize)}</span>
        </div>
      </div>
    ` : `
      <div class="asgn-att-chip no-file">
        <span class="att-icon">📄</span>
        <div class="att-info">
          <span class="att-name">No file attached</span>
        </div>
      </div>
    `;

    card.innerHTML = `
      <div>
        <div class="asgn-card-top">
          <span class="asgn-subject-tag">📘 ${a.subject}</span>
          ${a.deadline ? `<span class="asgn-deadline-pill">📅 Due: ${a.deadline}</span>` : '<span class="asgn-deadline-pill" style="background:#f3f4f6;color:#6b7280;border-color:#e5e7eb;">No Deadline</span>'}
        </div>
        <h3 class="asgn-title">${a.title || a.subject}</h3>
        ${attChipHTML}
      </div>
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
}

window.deleteAssignment = async function(id) {
  if (!confirm('Permanently delete this assignment?')) return;
  // Optimistic UI remove
  allSuperAssignments = allSuperAssignments.filter(a => a.id !== id);
  renderSuperAssignments();
  setupSuperSubjectFilters(allSuperAssignments);

  try {
    const res = await fetch(`/api/admin/assignments/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Assignment deleted.', 'info');
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

  // Search listener for assignments
  document.getElementById('sa-asgn-search-input')?.addEventListener('input', (e) => {
    currentSuperSearch = e.target.value.trim();
    renderSuperAssignments();
  });

  // Assignment modal controls
  document.getElementById('btn-open-add-asgn')?.addEventListener('click', () => {
    const m = document.getElementById('admin-asgn-modal');
    if (m) m.style.display = 'flex';
  });
  document.getElementById('modal-asgn-close')?.addEventListener('click', () => {
    const m = document.getElementById('admin-asgn-modal');
    if (m) m.style.display = 'none';
  });
  document.getElementById('modal-asgn-cancel')?.addEventListener('click', () => {
    const m = document.getElementById('admin-asgn-modal');
    if (m) m.style.display = 'none';
  });

  const asgnFileInput = document.getElementById('asgn-file-input');
  const asgnFileStatus = document.getElementById('asgn-file-status');
  const asgnDropzone = document.getElementById('asgn-dropzone');
  asgnDropzone?.addEventListener('click', () => asgnFileInput?.click());
  function compressImageFile(file, maxWidth = 1600, maxHeight = 1600, quality = 0.82) {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve(null);
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => {
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxWidth || height > maxHeight) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const base64 = dataUrl.split(',')[1];
          resolve({
            base64,
            mimeType: 'image/jpeg',
            size: Math.round((base64.length * 3) / 4)
          });
        };
        img.onerror = () => resolve(null);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  asgnFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (asgnFileStatus) asgnFileStatus.textContent = `Processing ${file.name}…`;

    const isImg = /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(file.name) || (file.type && file.type.startsWith('image/'));
    if (isImg) {
      const compressed = await compressImageFile(file);
      if (compressed) {
        attachedFileObject = {
          originalName: file.name,
          mimeType: compressed.mimeType,
          size: compressed.size,
          dataBase64: compressed.base64
        };
        if (asgnFileStatus) asgnFileStatus.textContent = `✅ Ready: ${file.name} (${(compressed.size / 1024).toFixed(1)} KB)`;
        return;
      }
    }

    if (file.size > 8 * 1024 * 1024) { alert('File must be under 8 MB.'); return; }
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
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, deadline, attachment: attachedFileObject })
      });
      const data = await res.json();
      if (res.status === 401) {
        alert('Session expired. Please log in again.');
        window.location.href = '/admin';
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to publish assignment');
      showToast('Assignment published!', 'success');
      alert('Assignment published successfully!');
      document.getElementById('add-asgn-form').reset();
      attachedFileObject = null;
      if (asgnFileStatus) asgnFileStatus.textContent = 'Supports PDF, JPG, PNG, DOC (max 4 MB)';
      document.getElementById('admin-asgn-modal').style.display = 'none';
      loadAssignments();
    } catch (err) {
      alert('Error: ' + err.message);
      showToast('Error: ' + err.message, 'error');
    }
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
