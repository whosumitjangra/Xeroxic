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

// Run auth check on initialization
checkAdminAuth();
