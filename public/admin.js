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
      window.location.href = '/admin';
      return;
    }
    const user = await res.json();
    const userRole = (user.role || '').toUpperCase();
    if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN' && userRole !== 'SUPERADMIN') {
      alert('Access Denied: This portal is reserved for Xerox Staff & Admins.');
      window.location.href = '/';
      return;
    }

    const nameEl = document.getElementById('admin-welcome-name');
    if (userRole === 'SUPER_ADMIN' || userRole === 'SUPERADMIN') {
      if (nameEl) nameEl.textContent = `Hi, ${user.name} (Super Admin)`;
    } else {
      if (nameEl) nameEl.textContent = `Hi, ${user.name} (Staff)`;
    }
    
    // Load dashboard data, notifications & assignments
    loadDashboardData();
    loadAdminNotifications();
    loadAdminAssignments();

    // Request desktop notification permissions if supported
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    // Start 4-second responsive polling for real-time incoming requests & persistent notifications
    setInterval(() => {
      loadDashboardData(true);
      loadAdminNotifications(true);
    }, 4000);
  } catch (err) {
    window.location.href = '/admin';
  }
}

// Sign out
const logoutBtn = document.getElementById('admin-logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/admin';
  });
}

// State for database-driven persistent incoming notifications
let activeUnreadNotifications = [];
let currentNotifIndex = 0;
let playedNotifIds = new Set();
let titleFlashInterval = null;
const originalDocTitle = document.title || 'Admin Portal — Xerox Centre';

// Web Audio API synthesized two-tone notification chime (100% reliable, zero network dependency)
function playNotificationChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    // Tone 1: 880Hz (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.3, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.25);

    // Tone 2: 1320Hz (E6)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
    gain2.gain.setValueAtTime(0.35, ctx.currentTime + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.55);
  } catch (e) {
    console.warn('Audio chime warning:', e);
  }
}

function startTitleFlash(orderId) {
  if (titleFlashInterval) clearInterval(titleFlashInterval);
  let isAlertTitle = false;
  titleFlashInterval = setInterval(() => {
    document.title = isAlertTitle ? originalDocTitle : `🔔 (NEW REQUEST!) ${orderId}`;
    isAlertTitle = !isAlertTitle;
  }, 1000);
}

function stopTitleFlash() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
    document.title = originalDocTitle;
  }
}

// Clear title flash on window focus
window.addEventListener('focus', () => {
  stopTitleFlash();
});

function triggerDesktopNotification(notif) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('⚡ New Print Request Received!', {
        body: `Order #${notif.orderId} from ${notif.studentName} (${notif.fileCount} file(s) • ₹${notif.amount})`,
        icon: '/logo.gif'
      });
    } catch (e) {}
  }
}

// Fetch database-driven persistent notifications
async function loadAdminNotifications(isPolling = false) {
  try {
    const res = await fetch(`/api/admin/notifications?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    if (!res.ok) return;
    const data = await res.json();
    const unread = data.unread || [];

    console.log('[Admin Notification Sync] Received unread count:', unread.length);

    // Check for brand new incoming requests not yet chimed
    const brandNew = unread.filter(n => !playedNotifIds.has(n.id));
    if (brandNew.length > 0) {
      brandNew.forEach(n => playedNotifIds.add(n.id));
      console.log('[Admin Notification Sync] Brand new incoming requests:', brandNew.map(n => n.orderId));
      playNotificationChime();
      startTitleFlash(brandNew[0].orderId);
      triggerDesktopNotification(brandNew[0]);
      showToast(`⚡ New print request arrived: ${brandNew[0].orderId}`, 'success');
    }

    activeUnreadNotifications = unread;
    renderNotificationBanner();
  } catch (err) {
    // Silent fail during background polling
  }
}

// Render persistent notification banner with direct navigation
function renderNotificationBanner() {
  const banner = document.getElementById('admin-incoming-alert');
  const alertText = document.getElementById('incoming-alert-text');
  const viewBtn = document.getElementById('btn-view-incoming');
  const dismissBtn = document.getElementById('btn-dismiss-incoming');

  if (!banner || !alertText) return;

  if (activeUnreadNotifications.length === 0) {
    banner.style.display = 'none';
    stopTitleFlash();
    return;
  }

  if (currentNotifIndex >= activeUnreadNotifications.length) {
    currentNotifIndex = 0;
  }

  const notif = activeUnreadNotifications[currentNotifIndex];
  const countBadge = activeUnreadNotifications.length > 1
    ? ` <span style="background:rgba(255,255,255,0.25); padding:2px 8px; border-radius:999px; font-size:12px; margin-left:6px;">${currentNotifIndex + 1} of ${activeUnreadNotifications.length}</span>`
    : '';

  alertText.innerHTML = `<strong>⚡ NEW PRINT REQUEST!</strong>${countBadge} Order <code>#${notif.orderId}</code> from <strong>${notif.studentName}</strong> (${notif.fileCount} file(s) • ₹${notif.amount})`;
  banner.style.display = 'flex';

  if (viewBtn) {
    viewBtn.onclick = async () => {
      // 1. Acknowledge on backend
      try {
        await fetch(`/api/admin/notifications/${encodeURIComponent(notif.id)}/acknowledge`, {
          method: 'POST',
          headers: { 'Cache-Control': 'no-cache' }
        });
      } catch (e) {}

      // 2. Remove from active list
      activeUnreadNotifications = activeUnreadNotifications.filter(n => n.id !== notif.id);
      renderNotificationBanner();

      // 3. Open the exact related print request card
      await openRelatedPrintRequest(notif.orderId, notif);
    };
  }

  if (dismissBtn) {
    dismissBtn.onclick = async () => {
      try {
        await fetch(`/api/admin/notifications/${encodeURIComponent(notif.id)}/acknowledge`, {
          method: 'POST',
          headers: { 'Cache-Control': 'no-cache' }
        });
      } catch (e) {}

      activeUnreadNotifications = activeUnreadNotifications.filter(n => n.id !== notif.id);
      renderNotificationBanner();
    };
  }
}

// Open exact related print request and smoothly focus it (fetches on-demand if missing)
async function openRelatedPrintRequest(orderId, notifPayload = null) {
  if (!orderId) return;

  console.log('[Admin Notification Click] Click payload:', { orderId, notif: notifPayload });

  // 1. Switch to Print Document Requests tab if on Subject Assignments
  const tabBtnRequests = document.getElementById('tab-btn-requests');
  const tabRequestsView = document.getElementById('tab-requests-view');
  const tabBtnAssignments = document.getElementById('tab-btn-assignments');
  const tabAssignmentsView = document.getElementById('tab-assignments-view');

  if (tabBtnRequests && !tabBtnRequests.classList.contains('active')) {
    tabBtnRequests.classList.add('active');
    tabBtnAssignments?.classList.remove('active');
    if (tabRequestsView) tabRequestsView.style.display = 'block';
    if (tabAssignmentsView) tabAssignmentsView.style.display = 'none';
  }

  // 2. Check if the order is already in allOrders; if not, fetch it from backend by canonical ID
  let order = allOrders.find(o => o.orderId && o.orderId.toLowerCase() === String(orderId).toLowerCase());
  if (!order) {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
      if (res.ok) {
        const remoteOrder = await res.json();
        if (remoteOrder && remoteOrder.orderId) {
          allOrders.unshift(remoteOrder);
          order = remoteOrder;
          console.log('[Admin Notification Click] Fetched missing order from backend:', { orderId });
        }
      } else {
        console.warn('[Admin Notification Click] Target record not found in backend:', { orderId, status: res.status });
        showToast(`Order #${orderId} not found or has been removed.`, 'error');
        return;
      }
    } catch (e) {
      console.error('[Admin Notification Click] Failed to fetch order from backend:', e);
      showToast(`Order #${orderId} not found or has been removed.`, 'error');
      return;
    }
  }

  console.log('[Admin Notification Click] Target record resolved:', {
    orderId,
    foundInLocalState: !!order,
    status: order ? order.status : null
  });

  // 3. Reset filters & clear search to guarantee the card is not hidden
  const statusFilters = document.getElementById('status-filters');
  if (statusFilters) {
    statusFilters.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    const allPill = statusFilters.querySelector('[data-filter="all"]');
    if (allPill) allPill.classList.add('active');
  }
  activeFilter = 'all';

  const searchInput = document.getElementById('admin-search-input');
  if (searchInput) {
    searchInput.value = '';
    searchQuery = '';
  }

  // 4. Force re-render to ensure card is populated
  renderOrders(true);

  // 5. Smoothly scroll into view and pulse
  setTimeout(() => {
    const card = document.getElementById(`order-card-${orderId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('new-order-pulse');
      setTimeout(() => card.classList.remove('new-order-pulse'), 8000);
    } else {
      showToast(`Order #${orderId} loaded in queue.`, 'info');
    }
  }, 120);
}

// Load stats and orders from server (supports silent 4s background polling)
async function loadDashboardData(isPolling = false) {
  const loadingEl = document.getElementById('orders-loading');
  const containerEl = document.getElementById('orders-container');
  const emptyEl = document.getElementById('orders-empty');

  if (!isPolling) {
    if (loadingEl) loadingEl.style.display = 'block';
    if (containerEl) containerEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'none';
  }

  try {
    const [ordersRes, statsRes] = await Promise.all([
      fetch(`/api/admin/orders?_t=${Date.now()}`, { cache: 'no-store' }),
      fetch(`/api/admin/stats?_t=${Date.now()}`, { cache: 'no-store' })
    ]);

    if (!ordersRes.ok) throw new Error('Failed to load orders');

    const ordersData = await ordersRes.json();
    allOrders = ordersData.orders || [];

    console.log('[Admin Poll/Sync] Received orders count:', allOrders.length, 'Filter:', activeFilter);

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
    if (!isPolling) {
      console.error('Error loading admin data:', err);
      showToast('Failed to load orders: ' + err.message, 'error');
    }
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

  // Update new requests pill counter badge
  const newPillCount = document.getElementById('pill-new-count');
  if (newPillCount) {
    const cnt = stats.newCount || stats.newRequestsCount || 0;
    newPillCount.textContent = cnt;
    newPillCount.style.display = cnt > 0 ? 'inline-block' : 'none';
  }

  // Update pending pill counter badge
  const pendingPillCount = document.getElementById('pill-pending-count');
  if (pendingPillCount) {
    const pCnt = stats.inProgressCount || 0;
    pendingPillCount.textContent = pCnt;
    pendingPillCount.style.display = pCnt > 0 ? 'inline-block' : 'none';
  }
}

function computeStatsFromOrders(orders) {
  let pending = 0;
  let ready = 0;
  let revenue = 0;
  let newCount = 0;
  for (const o of orders) {
    if (o.paymentStatus !== 'CANCELLED' && o.paymentStatus !== 'FAILED') {
      revenue += (o.total || 0);
    }
    const st = (o.status || '').toUpperCase();
    if (st === 'REQUEST_RECEIVED' || o.status === 'New' || o.status === 'Order Received') {
      newCount++;
      pending++;
    } else if (st === 'READY' || o.status === 'Ready for Collection' || o.status === 'Ready for Pickup') {
      ready++;
    } else if (st !== 'COMPLETED' && o.status !== 'Collected' && o.status !== 'Completed' && st !== 'CANCELLED') {
      pending++;
    }
  }
  updateStatsUI({
    totalOrders: orders.length,
    newCount,
    newRequestsCount: newCount,
    inProgressCount: pending,
    readyCount: ready,
    totalRevenue: revenue
  });
}

// Render filtered orders list with quick actions & live stage progression
function renderOrders(force = false) {
  const containerEl = document.getElementById('orders-container');
  const emptyEl = document.getElementById('orders-empty');
  if (!containerEl) return;

  const filtered = allOrders.filter(order => {
    // Status filter
    if (activeFilter !== 'all') {
      const orderSt = (order.status || '').toUpperCase();
      const filterSt = activeFilter.toUpperCase();

      if (filterSt === 'PENDING') {
        return orderSt !== 'COMPLETED' && order.status !== 'Collected' && order.status !== 'Completed' && orderSt !== 'CANCELLED' && order.status !== 'Cancelled';
      }
      if (filterSt === 'NEW' || filterSt === 'REQUEST_RECEIVED') {
        return orderSt === 'REQUEST_RECEIVED' || order.status === 'New' || order.status === 'Order Received';
      }
      if (filterSt === 'ACCEPTED') {
        return orderSt === 'ACCEPTED' || order.status === 'Accepted';
      }
      if (filterSt === 'PRINTING') {
        return orderSt === 'PRINTING' || order.status === 'Printing' || order.status === 'Printing in Progress';
      }
      if (filterSt === 'READY' || filterSt === 'READY FOR COLLECTION') {
        return orderSt === 'READY' || order.status === 'Ready for Collection' || order.status === 'Ready for Pickup';
      }
      if (filterSt === 'COLLECTED' || filterSt === 'COMPLETED') {
        return orderSt === 'COMPLETED' || order.status === 'Collected' || order.status === 'Completed';
      }
      if (order.status !== activeFilter) return false;
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
    containerEl._renderedSig = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  // Prevent UI flickering if orders and statuses have not changed
  const sig = `${activeFilter}|${searchQuery}|` + filtered.map(o => `${o.orderId}:${o.status}:${o.total}:${o.paymentStatus}:${(o.items||[]).length}`).join(';');
  if (!force && containerEl._renderedSig === sig) {
    return;
  }
  containerEl._renderedSig = sig;

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
    const isNew = order.status === 'New' || order.status === 'Order Received' || order.status === 'REQUEST_RECEIVED';
    const isAccepted = order.status === 'Accepted' || order.status === 'ACCEPTED';
    const isPrinting = order.status === 'Printing' || order.status === 'Printing in Progress' || order.status === 'PRINTING';
    const isReady = order.status === 'Ready for Collection' || order.status === 'Ready for Pickup' || order.status === 'READY';
    const isCollected = order.status === 'Collected' || order.status === 'Completed' || order.status === 'COMPLETED';
    const isCancelled = order.status === 'Cancelled' || order.status === 'CANCELLED';

    let itemsHtml = '';
    (order.items || []).forEach(item => {
      const sizeStr = item.size ? ` (${formatBytes(item.size)})` : '';
      const copiesStr = (item.copies && item.copies > 1) ? ` • <strong>${item.copies} copies</strong>` : '';
      const printSpecs = `${item.color === 'color' ? '🎨 Color' : '⬛ Black & White'} • ${item.sides === 'double' ? 'Double-sided' : 'Single-sided'} • ${item.pages} page${item.pages > 1 ? 's' : ''}${copiesStr}`;

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

    // Quick action buttons based on stage progression
    let quickActionsHtml = '';
    if (isNew) {
      quickActionsHtml = `
        <button type="button" class="btn-action-sm" onclick="updateOrderStatusOnServer('${order.orderId}', 'ACCEPTED')" style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; border-radius:8px; padding:6px 14px; font-weight:600; font-size:12.5px; cursor:pointer;">
          🔵 Accept Order
        </button>
        <button type="button" class="btn-action-sm" onclick="updateOrderStatusOnServer('${order.orderId}', 'CANCELLED')" style="background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; border-radius:8px; padding:6px 14px; font-weight:600; font-size:12.5px; cursor:pointer;">
          🚫 Reject
        </button>
      `;
    } else if (isAccepted) {
      quickActionsHtml = `
        <button type="button" class="btn-action-sm" onclick="updateOrderStatusOnServer('${order.orderId}', 'PRINTING')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:8px; padding:6px 14px; font-weight:600; font-size:12.5px; cursor:pointer;">
          🖨️ Start Printing
        </button>
        <button type="button" class="btn-action-sm" onclick="updateOrderStatusOnServer('${order.orderId}', 'CANCELLED')" style="background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; border-radius:8px; padding:6px 14px; font-weight:600; font-size:12.5px; cursor:pointer;">
          🚫 Reject
        </button>
      `;
    } else if (isPrinting) {
      quickActionsHtml = `
        <button type="button" class="btn-action-sm" onclick="updateOrderStatusOnServer('${order.orderId}', 'READY')" style="background:#e8f8f0; color:#059669; border:1px solid #a7f3d0; border-radius:8px; padding:6px 14px; font-weight:600; font-size:12.5px; cursor:pointer;">
          🟢 Mark Ready for Collection
        </button>
      `;
    } else if (isReady) {
      quickActionsHtml = `
        <button type="button" class="btn-action-sm" onclick="updateOrderStatusOnServer('${order.orderId}', 'COMPLETED')" style="background:#f3f4f6; color:#1f2937; border:1px solid #d1d5db; border-radius:8px; padding:6px 14px; font-weight:600; font-size:12.5px; cursor:pointer;">
          ✅ Mark Collected / Done
        </button>
      `;
    }

    const newBadgeHtml = isNew
      ? `<span class="badge-new-pulse" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; margin-left:10px;">⚡ NEW REQUEST</span>`
      : '';

    card.innerHTML = `
      <div class="admin-order-header">
        <div class="admin-order-meta">
          <span class="admin-order-id">${order.orderId}</span>
          ${newBadgeHtml}
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

      <div class="admin-order-footer" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
        <div class="admin-order-total">
          <span>Order Total:</span>
          <strong>₹${order.total}</strong>
          <span style="font-size:12px; color:#2b7a2b; font-weight:600; margin-left:8px;">(${order.paymentStatus || 'PAID'})</span>
        </div>

        <!-- Quick Action Buttons -->
        <div class="admin-quick-actions-bar" style="display:flex; gap:8px; align-items:center;">
          ${quickActionsHtml}
        </div>

        <div class="admin-status-controller">
          <label class="admin-control-label">Change Status:</label>
          <select class="admin-status-select" data-order-id="${order.orderId}">
            <option value="REQUEST_RECEIVED" ${isNew ? 'selected' : ''}>🟡 Request Received</option>
            <option value="ACCEPTED" ${isAccepted ? 'selected' : ''}>🔵 Accepted</option>
            <option value="PRINTING" ${isPrinting ? 'selected' : ''}>🖨️ Printing</option>
            <option value="READY" ${isReady ? 'selected' : ''}>🟢 Ready for Collection</option>
            <option value="COMPLETED" ${isCollected ? 'selected' : ''}>✅ Collected / Done</option>
            <option value="CANCELLED" ${isCancelled ? 'selected' : ''}>🚫 Cancelled</option>
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
  const order = allOrders.find(o => o.orderId === orderId);
  const previousStatus = order ? order.status : 'UNKNOWN';

  console.log('[Admin Review Action] Updating order:', {
    orderId,
    previousStatus,
    nextStatus: newStatus
  });

  try {
    const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Status update failed');

    // Update local order
    if (order) order.status = newStatus;

    // Update badge in DOM if present
    const badgeEl = document.getElementById(`badge-${orderId}`);
    if (badgeEl) {
      badgeEl.textContent = newStatus;
      badgeEl.className = `admin-status-badge ${getStatusClass(newStatus)}`;
    }

    computeStatsFromOrders(allOrders);

    // Immediately re-render orders list so that reviewed/completed items cleanly leave the filtered view
    renderOrders(true);

    showToast(`Order ${orderId} updated to "${newStatus}"!`, 'success');
  } catch (err) {
    console.error('Failed to update status:', err);
    showToast('Failed to update status: ' + err.message, 'error');
  }
}

function getStatusClass(status) {
  const s = (status || '').toUpperCase();
  if (s === 'REQUEST_RECEIVED' || status === 'New' || status === 'Order Received') return 'badge-received';
  if (s === 'ACCEPTED' || status === 'Accepted') return 'badge-received';
  if (s === 'PRINTING' || status === 'Printing' || status === 'Printing in Progress') return 'badge-printing';
  if (s === 'READY' || status === 'Ready for Collection' || status === 'Ready for Pickup') return 'badge-ready';
  if (s === 'COMPLETED' || status === 'Collected' || status === 'Completed') return 'badge-completed';
  if (s === 'CANCELLED' || status === 'Cancelled') return 'badge-cancelled';
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
    const res = await fetch(`/api/assignments?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
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
  if (!confirm('Are you sure you want to permanently delete this subject assignment?')) return;
  try {
    // 1. Optimistic removal from frontend state to immediately update UI
    allAdminAssignments = allAdminAssignments.filter(a => a.id !== id);
    const countEl = document.getElementById('tab-asgn-count');
    if (countEl) countEl.textContent = allAdminAssignments.length;
    renderAdminAssignments();

    // 2. Permanently delete from backend & database tombstone
    const res = await fetch(`/api/admin/assignments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Assignment permanently deleted.', 'info');

    // 3. Re-sync from backend with cache-busting
    await loadAdminAssignments();
  } catch (err) {
    showToast('Could not delete assignment: ' + err.message, 'error');
    await loadAdminAssignments();
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
