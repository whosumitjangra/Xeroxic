// ===================================================================
// Xerox Centre — Admin Dashboard Logic
// Manages document requests, downloads, and live status updates
// ===================================================================

let allOrders = [];
let activeFilter = 'all';
let searchQuery = '';

// Check admin authentication on page load
async function checkAdminAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      window.location.href = 'login.html';
      return;
    }
    const user = await res.json();
    if (user.role !== 'admin') {
      alert('Access Denied: This portal is reserved for Xerox Staff & Admins.');
      window.location.href = 'index.html';
      return;
    }

    const nameEl = document.getElementById('admin-welcome-name');
    if (nameEl) nameEl.textContent = `Hi, ${user.name} (Staff)`;
    
    // Load dashboard data
    loadDashboardData();
    loadAdminAssignments();
  } catch (err) {
    window.location.href = 'login.html';
  }
}

// Sign out
const logoutBtn = document.getElementById('admin-logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });
}

// Load stats and orders from server
async function loadDashboardData() {
  const loadingEl = document.getElementById('orders-loading');
  const containerEl = document.getElementById('orders-container');
  const emptyEl = document.getElementById('orders-empty');

  if (loadingEl) loadingEl.style.display = 'block';
  if (containerEl) containerEl.style.display = 'none';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const [ordersRes, statsRes] = await Promise.all([
      fetch('/api/admin/orders'),
      fetch('/api/admin/stats')
    ]);

    if (!ordersRes.ok) throw new Error('Failed to load orders');

    const ordersData = await ordersRes.json();
    allOrders = ordersData.orders || [];
    const tabReqCount = document.getElementById('tab-req-count');
    if (tabReqCount) tabReqCount.textContent = allOrders.length;

    if (statsRes.ok) {
      const stats = await statsRes.json();
      updateStatsUI(stats);
    } else {
      computeStatsFromOrders(allOrders);
    }

    renderOrders();
  } catch (err) {
    console.error('Error loading admin data:', err);
    showToast('Failed to load orders: ' + err.message, 'error');
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function updateStatsUI(stats) {
  const totalEl = document.getElementById('stat-total-orders');
  const pendingEl = document.getElementById('stat-pending-orders');
  const readyEl = document.getElementById('stat-ready-orders');
  const revenueEl = document.getElementById('stat-total-revenue');

  if (totalEl) totalEl.textContent = stats.totalOrders || 0;
  if (pendingEl) pendingEl.textContent = stats.inProgressCount || 0;
  if (readyEl) readyEl.textContent = stats.readyCount || 0;
  if (revenueEl) revenueEl.textContent = `₹${stats.totalRevenue || 0}`;
}

function computeStatsFromOrders(orders) {
  let inProgress = 0;
  let ready = 0;
  let revenue = 0;
  for (const o of orders) {
    revenue += (o.total || 0);
    if (o.status === 'Ready for Pickup') ready++;
    else if (o.status !== 'Completed') inProgress++;
  }
  updateStatsUI({
    totalOrders: orders.length,
    inProgressCount: inProgress,
    readyCount: ready,
    totalRevenue: revenue
  });
}

// Render filtered orders list
function renderOrders() {
  const containerEl = document.getElementById('orders-container');
  const emptyEl = document.getElementById('orders-empty');
  if (!containerEl) return;

  const filtered = allOrders.filter(order => {
    // Status filter
    if (activeFilter !== 'all' && order.status !== activeFilter) {
      return false;
    }
    // Search query filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
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
    card.id = `order-card-${order.orderId}`;

    const formattedDate = order.createdAt
      ? new Date(order.createdAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      : 'N/A';

    const statusClass = getStatusClass(order.status);

    let itemsHtml = '';
    (order.items || []).forEach(item => {
      const sizeStr = item.size ? ` (${formatBytes(item.size)})` : '';
      const printSpecs = `${item.color === 'color' ? '🎨 Color' : '⬛ Black & White'} • ${item.sides === 'double' ? 'Double-sided' : 'Single-sided'} • ${item.pages} page${item.pages > 1 ? 's' : ''}`;

      itemsHtml += `
        <div class="admin-doc-item">
          <div class="admin-doc-info">
            <div class="admin-doc-icon">📄</div>
            <div>
              <div class="admin-doc-name" title="${item.originalName}">${item.originalName}${sizeStr}</div>
              <div class="admin-doc-specs">${printSpecs} — <strong>₹${item.price}</strong></div>
            </div>
          </div>
          <div class="admin-doc-actions">
            ${item.fileId ? `
              <a href="/api/download/${item.fileId}?inline=1" target="_blank" class="admin-btn-action admin-btn-preview" title="View document in new tab">
                👁 Preview
              </a>
              <a href="/api/download/${item.fileId}" download="${item.originalName}" class="admin-btn-action admin-btn-download" title="Download exact file to print">
                ⬇ Download to Print
              </a>
            ` : '<span class="admin-no-file">File ID Missing</span>'}
          </div>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="admin-order-header">
        <div class="admin-order-meta">
          <span class="admin-order-id">${order.orderId}</span>
          <span class="admin-order-date">📅 ${formattedDate}</span>
          <span class="admin-customer-info">👤 <strong>${order.ownerName}</strong> (${order.ownerEmail})</span>
        </div>
        <div class="admin-order-badge-wrap">
          <span class="admin-status-badge ${statusClass}" id="badge-${order.orderId}">
            ${order.status}
          </span>
        </div>
      </div>

      <div class="admin-order-body">
        <div class="admin-docs-list">
          ${itemsHtml || '<p class="admin-no-docs">No items found in this order.</p>'}
        </div>
      </div>

      <div class="admin-order-footer">
        <div class="admin-order-total">
          <span>Order Total:</span>
          <strong>₹${order.total}</strong>
        </div>

        <div class="admin-status-controller">
          <label class="admin-control-label">Update Status:</label>
          <select class="admin-status-select" data-order-id="${order.orderId}">
            <option value="Order Received" ${order.status === 'Order Received' ? 'selected' : ''}>🟡 Order Received</option>
            <option value="Printing in Progress" ${order.status === 'Printing in Progress' ? 'selected' : ''}>🔵 Printing in Progress</option>
            <option value="Ready for Pickup" ${order.status === 'Ready for Pickup' ? 'selected' : ''}>🟢 Ready for Pickup</option>
            <option value="Completed" ${order.status === 'Completed' ? 'selected' : ''}>🟣 Completed</option>
          </select>
        </div>
      </div>
    `;

    containerEl.appendChild(card);
  });

  // Attach status change event listeners
  document.querySelectorAll('.admin-status-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const orderId = e.target.getAttribute('data-order-id');
      const newStatus = e.target.value;
      await updateOrderStatusOnServer(orderId, newStatus);
    });
  });
}

// Update order status on backend
async function updateOrderStatusOnServer(orderId, newStatus) {
  try {
    const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Status update failed');

    // Update local order
    const order = allOrders.find(o => o.orderId === orderId);
    if (order) order.status = newStatus;

    // Update badge in DOM
    const badgeEl = document.getElementById(`badge-${orderId}`);
    if (badgeEl) {
      badgeEl.textContent = newStatus;
      badgeEl.className = `admin-status-badge ${getStatusClass(newStatus)}`;
    }

    computeStatsFromOrders(allOrders);
    showToast(`Order ${orderId} updated to "${newStatus}"!`, 'success');
  } catch (err) {
    console.error('Failed to update status:', err);
    showToast('Failed to update status: ' + err.message, 'error');
  }
}

function getStatusClass(status) {
  if (status === 'Order Received') return 'badge-received';
  if (status === 'Printing in Progress') return 'badge-printing';
  if (status === 'Ready for Pickup') return 'badge-ready';
  if (status === 'Completed') return 'badge-completed';
  return 'badge-received';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Toast notification helper
function showToast(msg, type = 'info') {
  const toast = document.getElementById('admin-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `admin-toast show ${type}`;
  setTimeout(() => {
    toast.className = 'admin-toast';
  }, 3500);
}

// Search and filter listeners
const searchInput = document.getElementById('admin-search-input');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderOrders();
  });
}

const statusFilters = document.getElementById('status-filters');
if (statusFilters) {
  statusFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-pill');
    if (!btn) return;
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.getAttribute('data-filter');
    renderOrders();
  });
}

const refreshBtn = document.getElementById('refresh-orders-btn');
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    loadDashboardData();
    showToast('Orders refreshed!', 'info');
  });
}

// ===================================================================
// Admin Tab Switching
// ===================================================================
const tabBtnRequests = document.getElementById('tab-btn-requests');
const tabBtnAssignments = document.getElementById('tab-btn-assignments');
const tabRequestsView = document.getElementById('tab-requests-view');
const tabAssignmentsView = document.getElementById('tab-assignments-view');

tabBtnRequests?.addEventListener('click', () => {
  tabBtnRequests.classList.add('active');
  tabBtnAssignments?.classList.remove('active');
  if (tabRequestsView) tabRequestsView.style.display = 'block';
  if (tabAssignmentsView) tabAssignmentsView.style.display = 'none';
});

tabBtnAssignments?.addEventListener('click', () => {
  tabBtnAssignments.classList.add('active');
  tabBtnRequests?.classList.remove('active');
  if (tabRequestsView) tabRequestsView.style.display = 'none';
  if (tabAssignmentsView) tabAssignmentsView.style.display = 'block';
  loadAdminAssignments();
});

// ===================================================================
// Admin Subject Assignments Manager
// ===================================================================
let allAdminAssignments = [];
let currentAdminSubjectFilter = 'all';
let currentAdminSearch = '';
let attachedFileObject = null;

async function loadAdminAssignments() {
  const loadingEl = document.getElementById('admin-asgn-loading');
  const gridEl = document.getElementById('admin-asgn-grid');
  const emptyEl = document.getElementById('admin-asgn-empty');
  const countEl = document.getElementById('tab-asgn-count');

  if (loadingEl) loadingEl.style.display = 'block';
  if (gridEl) gridEl.style.display = 'none';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const res = await fetch('/api/assignments');
    if (!res.ok) throw new Error('Failed to load assignments');
    const data = await res.json();
    allAdminAssignments = data.assignments || [];
    if (countEl) countEl.textContent = allAdminAssignments.length;

    setupAdminSubjectFilters(allAdminAssignments);
    renderAdminAssignments();
  } catch (err) {
    showToast('Failed to load assignments: ' + err.message, 'error');
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function setupAdminSubjectFilters(assignments) {
  const container = document.getElementById('admin-asgn-subject-filters');
  if (!container) return;
  const subjects = Array.from(new Set(assignments.map(a => a.subject).filter(Boolean)));
  container.innerHTML = '<button type="button" class="filter-pill active" data-subject="all">All Subjects</button>';

  subjects.forEach(subj => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-pill';
    btn.dataset.subject = subj;
    btn.textContent = subj;
    btn.onclick = () => {
      container.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentAdminSubjectFilter = subj;
      renderAdminAssignments();
    };
    container.appendChild(btn);
  });

  const allBtn = container.querySelector('[data-subject="all"]');
  if (allBtn) {
    allBtn.onclick = () => {
      container.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      allBtn.classList.add('active');
      currentAdminSubjectFilter = 'all';
      renderAdminAssignments();
    };
  }
}

function renderAdminAssignments() {
  const gridEl = document.getElementById('admin-asgn-grid');
  const emptyEl = document.getElementById('admin-asgn-empty');
  if (!gridEl) return;

  const filtered = allAdminAssignments.filter(a => {
    const matchesSubject = currentAdminSubjectFilter === 'all' || a.subject === currentAdminSubjectFilter;
    const q = currentAdminSearch.toLowerCase();
    const matchesSearch = !q ||
      (a.title && a.title.toLowerCase().includes(q)) ||
      (a.subject && a.subject.toLowerCase().includes(q)) ||
      (a.experimentNo && a.experimentNo.toLowerCase().includes(q)) ||
      (a.info && a.info.toLowerCase().includes(q));
    return matchesSubject && matchesSearch;
  });

  if (filtered.length === 0) {
    gridEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  gridEl.style.display = 'grid';
  gridEl.innerHTML = '';

  filtered.forEach(a => {
    const card = document.createElement('div');
    card.className = 'asgn-card';
    card.id = `admin-asgn-${a.id}`;

    const hasAtt = a.hasAttachment;
    const previewBtn = hasAtt ? `
      <button type="button" class="action-btn preview-btn" onclick="openAdminAttachmentPreview('${a.id}', '${encodeURIComponent(a.title)}', '${encodeURIComponent(a.attachmentName || 'demo_file')}')">
        👁 Preview Demo
      </button>
      <a href="/api/assignments/${a.id}/attachment" class="action-btn download-btn" download="${a.attachmentName || 'demo_file'}">
        ⬇ Download
      </a>
    ` : '<span style="font-size:12px; color:#7d9183; align-self:center;">No demo file</span>';

    card.innerHTML = `
      <div class="asgn-card-top">
        <span class="asgn-subject-tag">${a.subject}</span>
        ${a.experimentNo ? `<span class="asgn-exp-badge">${a.experimentNo}</span>` : ''}
        ${a.deadline ? `<span class="asgn-deadline-pill">Due: ${a.deadline}</span>` : ''}
      </div>
      <h3 class="asgn-title">${a.title}</h3>
      <div class="asgn-section-block">
        <div class="asgn-section-label">🔬 Experiment Info:</div>
        <p class="asgn-text">${a.info || 'No experiment description.'}</p>
      </div>
      ${a.submissionGuidelines ? `
        <div class="asgn-guide-box">
          <span class="guide-title">📌 Submission Instructions:</span>
          <p class="asgn-guide-text">${a.submissionGuidelines}</p>
        </div>
      ` : ''}
      <div class="asgn-card-footer">
        <div class="asgn-actions">
          ${previewBtn}
          <button type="button" class="action-btn delete-asgn-btn" style="margin-left:auto;" onclick="deleteAdminAssignment('${a.id}')">
            🗑 Delete
          </button>
        </div>
      </div>
    `;
    gridEl.appendChild(card);
  });
}

// Search listener
document.getElementById('admin-asgn-search-input')?.addEventListener('input', (e) => {
  currentAdminSearch = e.target.value.trim();
  renderAdminAssignments();
});

// Modal Dialog Controls
const addModal = document.getElementById('admin-asgn-modal');
const btnOpenAddAsgn = document.getElementById('btn-open-add-asgn');
const modalClose = document.getElementById('modal-asgn-close');
const modalCancel = document.getElementById('modal-asgn-cancel');
const asgnDropzone = document.getElementById('asgn-dropzone');
const asgnFileInput = document.getElementById('asgn-file-input');
const asgnFileStatus = document.getElementById('asgn-file-status');
const addAsgnForm = document.getElementById('add-asgn-form');

btnOpenAddAsgn?.addEventListener('click', () => {
  if (addModal) addModal.style.display = 'flex';
});

modalClose?.addEventListener('click', () => {
  if (addModal) addModal.style.display = 'none';
});

modalCancel?.addEventListener('click', () => {
  if (addModal) addModal.style.display = 'none';
});

asgnDropzone?.addEventListener('click', () => {
  asgnFileInput?.click();
});

asgnFileInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 4.5 * 1024 * 1024) {
    alert('Attachment file must be under 4.5 MB.');
    return;
  }
  asgnFileStatus.textContent = `Reading ${file.name} (${(file.size / 1024).toFixed(1)} KB)...`;

  const reader = new FileReader();
  reader.onload = () => {
    const base64Data = reader.result.split(',')[1];
    attachedFileObject = {
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      dataBase64: base64Data
    };
    asgnFileStatus.textContent = `✅ Ready: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  };
  reader.readAsDataURL(file);
});

addAsgnForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submit-asgn-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Publishing...';
  }

  const subject = document.getElementById('asgn-subject-input')?.value.trim();
  const expNo = document.getElementById('asgn-expno-input')?.value.trim();
  const title = document.getElementById('asgn-title-input')?.value.trim();
  const info = document.getElementById('asgn-info-input')?.value.trim();
  const guidelines = document.getElementById('asgn-guidelines-input')?.value.trim();
  const deadline = document.getElementById('asgn-deadline-input')?.value;

  try {
    const res = await fetch('/api/admin/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        experimentNo: expNo,
        title,
        info,
        submissionGuidelines: guidelines,
        deadline,
        attachment: attachedFileObject
      })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Failed to publish assignment.');
      return;
    }

    showToast('Assignment published successfully!', 'success');
    addAsgnForm.reset();
    attachedFileObject = null;
    asgnFileStatus.textContent = 'Supports PDF, JPG, PNG, DOC (max 4 MB)';
    if (addModal) addModal.style.display = 'none';
    loadAdminAssignments();
  } catch (err) {
    showToast('Error publishing assignment: ' + err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish Assignment';
    }
  }
});

// Delete Assignment
window.deleteAdminAssignment = async function(id) {
  if (!confirm('Are you sure you want to delete this subject assignment?')) return;
  try {
    const res = await fetch(`/api/admin/assignments/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Assignment deleted.', 'info');
    loadAdminAssignments();
  } catch (err) {
    showToast('Could not delete assignment: ' + err.message, 'error');
  }
};

// Preview Modal for Admin
window.openAdminAttachmentPreview = function(asgnId, titleEncoded, fnameEncoded) {
  const modal = document.getElementById('admin-preview-modal');
  const titleEl = document.getElementById('admin-preview-title');
  const bodyEl = document.getElementById('admin-preview-body');
  const dlLink = document.getElementById('admin-preview-dl-link');

  const title = decodeURIComponent(titleEncoded);
  const fname = decodeURIComponent(fnameEncoded);

  if (titleEl) titleEl.textContent = `${title} — ${fname}`;
  if (dlLink) {
    dlLink.href = `/api/assignments/${asgnId}/attachment`;
    dlLink.setAttribute('download', fname);
  }

  const isImg = /\.(png|jpg|jpeg|gif|svg)$/i.test(fname);
  if (bodyEl) {
    if (isImg) {
      bodyEl.innerHTML = `<img src="/api/assignments/${asgnId}/attachment?inline=1" alt="Demo preview" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:8px;">`;
    } else {
      bodyEl.innerHTML = `<iframe src="/api/assignments/${asgnId}/attachment?inline=1" style="width:100%; height:65vh; border:none; border-radius:8px;"></iframe>`;
    }
  }

  if (modal) modal.style.display = 'flex';
};

document.getElementById('admin-preview-close')?.addEventListener('click', () => {
  const modal = document.getElementById('admin-preview-modal');
  if (modal) modal.style.display = 'none';
});

// Close modal when clicking overlay background
document.getElementById('admin-preview-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'admin-preview-modal') {
    e.target.style.display = 'none';
  }
});

document.getElementById('admin-asgn-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'admin-asgn-modal') {
    e.target.style.display = 'none';
  }
});

// Run auth check on initialization
checkAdminAuth();
