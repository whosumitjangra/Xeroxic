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
    const freshOrders = ordersData.orders || [];

    if (isPolling && freshOrders.length < allOrders.length) {
      // KV may have returned a stale/incomplete snapshot.
      // Merge: keep all previously known orders, but update their status fields
      // if the fresh poll has updated info for them. Also add any genuinely new orders.
      const knownIds = new Map(allOrders.map(o => [o.orderId, o]));
      for (const fresh of freshOrders) {
        if (knownIds.has(fresh.orderId)) {
          // Update status and payment fields in-place, preserve everything else
          const existing = knownIds.get(fresh.orderId);
          existing.status = fresh.status;
          existing.paymentStatus = fresh.paymentStatus;
          existing.updatedAt = fresh.updatedAt;
        } else {
          // Genuinely new order not yet in local state
          allOrders.unshift(fresh);
        }
      }
      console.log('[Admin Poll] Merged (stale KV guard). Known:', allOrders.length, 'Fresh:', freshOrders.length);
    } else {
      // Normal case: use fresh data (initial load or fresh KV with more/equal data)
      allOrders = freshOrders;
      console.log('[Admin Poll/Sync] Received orders count:', allOrders.length, 'Filter:', activeFilter);
    }

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

  // Update status card counts (new card-grid UI)
  const scardCounts = {
    new:     stats.newCount || stats.newRequestsCount || 0,
    queue:   stats.acceptedCount || 0,
    print:   stats.printingCount || 0,
    collect: stats.readyCount || 0,
    done:    stats.completedCount !== undefined ? stats.completedCount : (stats.collectedCount || 0),
    all:     stats.totalOrders || (allOrders ? allOrders.length : 0)
  };
  Object.entries(scardCounts).forEach(([key, val]) => {
    const el = document.getElementById(`scard-count-${key}`);
    if (el) el.textContent = val;
  });

  // Notification bell badge
  const bellBadge = document.getElementById('notif-badge-count');
  if (bellBadge) {
    const unread = (stats.newCount || 0) + (stats.newRequestsCount || 0);
    bellBadge.textContent = unread;
    bellBadge.classList.toggle('hidden', unread === 0);
  }
}

function computeStatsFromOrders(orders) {
  let pending = 0, ready = 0, revenue = 0, newCount = 0;
  let acceptedCount = 0, printingCount = 0, completedCount = 0;
  for (const o of orders) {
    if (o.paymentStatus !== 'CANCELLED' && o.paymentStatus !== 'FAILED') {
      revenue += (o.total || 0);
    }
    const st = String(o.status || '').toUpperCase().trim();
    if (st === 'REQUEST_RECEIVED' || st === 'NEW' || st === 'ORDER RECEIVED') {
      newCount++; pending++;
    } else if (st === 'ACCEPTED') {
      acceptedCount++; pending++;
    } else if (st === 'PRINTING' || st === 'PRINTING IN PROGRESS') {
      printingCount++; pending++;
    } else if (st === 'READY' || st === 'READY FOR COLLECTION' || st === 'READY FOR PICKUP') {
      ready++;
    } else if (st === 'COMPLETED' || st === 'COLLECTED') {
      completedCount++;
    }
  }
  updateStatsUI({
    totalOrders: orders.length,
    newCount,
    newRequestsCount: newCount,
    inProgressCount: pending,
    acceptedCount,
    printingCount,
    readyCount: ready,
    collectedCount: completedCount,
    completedCount,
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
    const btn = e.target.closest('.filter-pill, .fpill');
    if (!btn) return;
    document.querySelectorAll('.filter-pill, .fpill').forEach(b => b.classList.remove('active'));
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

// Status card click handlers (new card-grid UI)
const statusCardsRow = document.getElementById('status-cards-row');
if (statusCardsRow) {
  statusCardsRow.addEventListener('click', (e) => {
    const card = e.target.closest('.status-card[data-filter]');
    if (!card) return;
    // Toggle active on cards
    document.querySelectorAll('.status-card').forEach(c => c.classList.remove('active-filter'));
    card.classList.add('active-filter');
    const filter = card.getAttribute('data-filter');
    // Also update pill active state
    document.querySelectorAll('.filter-pill, .fpill').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-filter') === filter);
    });
    activeFilter = filter;
    // Update panel title
    const titleEl = document.getElementById('orders-panel-title');
    if (titleEl) titleEl.textContent = card.querySelector('.status-card-label')?.textContent + ' Requests';
    renderOrders();
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
let stagedAttachments = [];
let activeStagedIndex = 0;
let currentPreviewAsgn = null;
let currentPreviewIndex = 0;

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

  if (currentAdminSubjectFilter !== 'all' && !subjects.includes(currentAdminSubjectFilter)) {
    currentAdminSubjectFilter = 'all';
  }

  const isAllActive = currentAdminSubjectFilter === 'all';
  container.innerHTML = `<button type="button" class="fpill ${isAllActive ? 'active' : ''}" data-subject="all">All Subjects (${assignments.length})</button>`;

  subjects.forEach(subj => {
    const count = assignments.filter(a => a.subject === subj).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fpill ${currentAdminSubjectFilter === subj ? 'active' : ''}`;
    btn.dataset.subject = subj;
    btn.textContent = `${subj} (${count})`;
    btn.onclick = () => {
      container.querySelectorAll('.fpill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentAdminSubjectFilter = subj;
      renderAdminAssignments();
    };
    container.appendChild(btn);
  });

  const allBtn = container.querySelector('[data-subject="all"]');
  if (allBtn) {
    allBtn.onclick = () => {
      container.querySelectorAll('.fpill').forEach(b => b.classList.remove('active'));
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
      (a.subject && a.subject.toLowerCase().includes(q)) ||
      (a.title && a.title.toLowerCase().includes(q)) ||
      (a.attachmentName && a.attachmentName.toLowerCase().includes(q));
    return matchesSubject && matchesSearch;
  });

  if (filtered.length === 0) {
    gridEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const emptyTitle = emptyEl.querySelector('h3');
      const emptyDesc = emptyEl.querySelector('p');
      if (emptyTitle) emptyTitle.textContent = allAdminAssignments.length === 0 ? 'No Assignments Yet' : 'No Matching Assignments';
      if (emptyDesc) emptyDesc.textContent = allAdminAssignments.length === 0 ? 'Click "Add Assignment" to post a lab assignment for students.' : 'Try changing your subject filter or search keyword.';
    }
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
    const attCount = a.attachmentCount || (a.attachments && a.attachments.length) || (hasAtt ? 1 : 0);
    const isMulti = attCount > 1;
    const previewBtn = hasAtt ? `
      <button type="button" class="action-btn preview-btn" onclick="openAdminAttachmentPreview('${a.id}', '${encodeURIComponent(a.subject)}', '${encodeURIComponent(a.attachmentName || 'file')}')">
        👁 Preview ${isMulti ? `(${attCount})` : ''}
      </button>
      <a href="/api/assignments/${a.id}/attachment" class="action-btn download-btn" download="${a.attachmentName || 'assignment_file'}">
        ⬇ Download
      </a>
    ` : '';

    const attChipHTML = hasAtt ? `
      <div class="asgn-att-chip">
        <span class="att-icon">${isMulti ? '📷' : '📎'}</span>
        <div class="att-info">
          <span class="att-name" title="${escapeHtml(a.attachmentName || 'Attachment')}">${isMulti ? `📷 ${attCount} Images / Files Attached` : escapeHtml(a.attachmentName || 'Attachment')}</span>
          <span class="att-size">${formatBytes(a.attachmentSize)}</span>
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
        <div class="asgn-card-top" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:8px;">
          <span class="asgn-subject-tag">📘 ${a.subject}</span>
          <span class="asgn-batch-tag" style="background:#f3e8ff; color:#6b21a8; padding:2px 8px; border-radius:12px; font-size:11.5px; font-weight:600; border:1px solid #e9d5ff;">📂 ${a.category || 'Lab Experiments'}</span>
          <span class="asgn-batch-tag" style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:12px; font-size:11.5px; font-weight:600; border:1px solid #bae6fd;">🏫 ${a.targetClass || 'All Classes'}</span>
          <span class="asgn-batch-tag" style="background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:12px; font-size:11.5px; font-weight:600; border:1px solid #fde68a;">🏷️ ${a.batch || 'All Batches'}</span>
          ${a.deadline ? `<span class="asgn-deadline-pill">📅 Due: ${a.deadline}</span>` : '<span class="asgn-deadline-pill" style="background:#f3f4f6;color:#6b7280;border-color:#e5e7eb;">No Deadline</span>'}
        </div>
        <h3 class="asgn-title">${a.title || a.subject}</h3>
        ${attChipHTML}
      </div>
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

// Search and filter listeners for assignments in Admin
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

// Multi-Image Staging & Live Preview Window Controller
function updateStagedPreviewUI() {
  const container = document.getElementById('asgn-staged-container');
  const countEl = document.getElementById('asgn-staged-count');
  const viewerMedia = document.getElementById('asgn-viewer-media');
  const viewerCaption = document.getElementById('asgn-viewer-caption');
  const tray = document.getElementById('asgn-thumbnails-tray');
  const prevBtn = document.getElementById('asgn-prev-img-btn');
  const nextBtn = document.getElementById('asgn-next-img-btn');
  const fileStatus = document.getElementById('asgn-file-status');

  if (!container) return;

  if (stagedAttachments.length === 0) {
    container.style.display = 'none';
    if (fileStatus) fileStatus.textContent = 'Supports PDF, DOC, DOCX, PPT, JPG, PNG (Up to 50 MB each, direct cloud upload)';
    return;
  }

  container.style.display = 'block';
  const totalSize = stagedAttachments.reduce((sum, a) => sum + (a.size || 0), 0);
  const imgCount = stagedAttachments.filter(a => a.isImg).length;
  if (countEl) {
    countEl.textContent = `📷 ${stagedAttachments.length} ${stagedAttachments.length === 1 ? 'Attachment' : 'Attachments'} (${imgCount} ${imgCount === 1 ? 'Image' : 'Images'}) • ${formatBytes(totalSize)} staged`;
  }
  if (fileStatus) {
    fileStatus.textContent = `✅ Ready: ${stagedAttachments.length} file(s) staged (${formatBytes(totalSize)} total)`;
  }

  if (activeStagedIndex >= stagedAttachments.length) {
    activeStagedIndex = Math.max(0, stagedAttachments.length - 1);
  }

  const activeItem = stagedAttachments[activeStagedIndex];
  if (activeItem && viewerMedia) {
    if (activeItem.isImg) {
      const imgSrc = activeItem.previewUrl || (activeItem.dataBase64 ? `data:${activeItem.mimeType};base64,${activeItem.dataBase64}` : '');
      viewerMedia.innerHTML = `<img src="${imgSrc}" alt="${escapeHtml(activeItem.originalName)}" style="max-height:220px; max-width:100%; object-fit:contain; border-radius:6px;">`;
    } else {
      viewerMedia.innerHTML = `
        <div class="doc-preview-icon" style="text-align:center;">
          <span style="font-size:42px; display:block; margin-bottom:4px;">📄</span>
          <span style="font-weight:600; font-size:13px; color:#fff; display:block;">${escapeHtml(activeItem.originalName)}</span>
          <span style="font-size:11px; opacity:0.8; color:#d1e7dd; display:block;">${formatBytes(activeItem.size)} • Document</span>
        </div>
      `;
    }
  }

  if (viewerCaption && activeItem) {
    viewerCaption.textContent = `${activeItem.isImg ? '🖼️ Image' : '📄 File'} ${activeStagedIndex + 1} of ${stagedAttachments.length}: ${activeItem.originalName} (${formatBytes(activeItem.size)})`;
  }

  if (prevBtn) prevBtn.style.display = stagedAttachments.length > 1 ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = stagedAttachments.length > 1 ? 'flex' : 'none';

  if (tray) {
    tray.innerHTML = '';
    stagedAttachments.forEach((att, idx) => {
      const thumb = document.createElement('div');
      thumb.className = `staged-thumb-item ${idx === activeStagedIndex ? 'active' : ''}`;
      thumb.title = `${att.originalName} (${formatBytes(att.size)})`;

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'staged-thumb-remove';
      delBtn.innerHTML = '✕';
      delBtn.title = 'Remove this file';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        removeStagedAttachment(idx);
      };

      const idxBadge = document.createElement('span');
      idxBadge.className = 'staged-thumb-index';
      idxBadge.textContent = idx + 1;

      if (att.isImg) {
        const img = document.createElement('img');
        img.src = att.previewUrl || (att.dataBase64 ? `data:${att.mimeType};base64,${att.dataBase64}` : '');
        img.alt = att.originalName;
        thumb.appendChild(img);
      } else {
        const fallback = document.createElement('div');
        fallback.className = 'staged-thumb-fallback';
        fallback.innerHTML = `📄<span style="overflow:hidden; text-overflow:ellipsis; max-width:60px; white-space:nowrap;">${escapeHtml(att.originalName)}</span>`;
        thumb.appendChild(fallback);
      }

      thumb.appendChild(delBtn);
      thumb.appendChild(idxBadge);
      thumb.onclick = () => {
        activeStagedIndex = idx;
        updateStagedPreviewUI();
      };
      tray.appendChild(thumb);
    });
  }
}

function removeStagedAttachment(index) {
  stagedAttachments.splice(index, 1);
  if (activeStagedIndex >= stagedAttachments.length) {
    activeStagedIndex = Math.max(0, stagedAttachments.length - 1);
  }
  updateStagedPreviewUI();
}

function compressImageFile(file, maxWidth = 1200, maxHeight = 1200, quality = 0.72) {
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
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        let base64 = dataUrl.split(',')[1];

        // Multi-pass: If base64 is still larger than 320KB, recompress with lower quality
        if (base64.length > 320000) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.58);
          base64 = dataUrl.split(',')[1];
        }

        // Second pass: If still larger than 320KB, downscale canvas dimensions
        if (base64.length > 320000) {
          const canvas2 = document.createElement('canvas');
          const scale = 900 / Math.max(width, height);
          canvas2.width = Math.max(100, Math.round(width * scale));
          canvas2.height = Math.max(100, Math.round(height * scale));
          const ctx2 = canvas2.getContext('2d');
          ctx2.drawImage(canvas, 0, 0, canvas2.width, canvas2.height);
          dataUrl = canvas2.toDataURL('image/jpeg', 0.60);
          base64 = dataUrl.split(',')[1];
        }

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

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFilesSelected(files) {
  if (!files || files.length === 0) return;
  const asgnFileStatus = document.getElementById('asgn-file-status');
  if (asgnFileStatus) asgnFileStatus.textContent = `Processing ${files.length} file(s)...`;

  const filesArray = Array.from(files);
  const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB cloud storage limit

  for (const file of filesArray) {
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      alert(`File "${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Maximum allowed size is 50 MB.`);
      continue;
    }

    const isImg = /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(file.name) || (file.type && file.type.startsWith('image/'));
    try {
      let previewUrl = null;
      let base64Data = null;
      let mimeType = file.type || (isImg ? 'image/jpeg' : 'application/octet-stream');
      let size = file.size;

      if (isImg) {
        previewUrl = URL.createObjectURL(file);
        // Small image thumbnail / preview
        try {
          const compressed = await compressImageFile(file);
          if (compressed) {
            base64Data = compressed.base64;
            mimeType = compressed.mimeType;
          }
        } catch (_) {}
      }

      stagedAttachments.push({
        id: 'stg-' + Math.random().toString(36).substr(2, 9),
        originalName: file.name,
        mimeType,
        size,
        file,
        previewUrl,
        dataBase64: base64Data,
        isImg
      });
    } catch (err) {
      console.error('Error staging file:', err);
    }
  }
  activeStagedIndex = stagedAttachments.length - 1;
  updateStagedPreviewUI();
}

asgnDropzone?.addEventListener('click', (e) => {
  if (e.target.closest('#asgn-staged-container')) return;
  asgnFileInput?.click();
});

asgnDropzone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  asgnDropzone.style.borderColor = '#2d8f4e';
  asgnDropzone.style.background = '#f0f9f3';
});

asgnDropzone?.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  asgnDropzone.style.borderColor = '#c8dbd0';
  asgnDropzone.style.background = '#f8fbf9';
});

asgnDropzone?.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  asgnDropzone.style.borderColor = '#c8dbd0';
  asgnDropzone.style.background = '#f8fbf9';
  if (e.dataTransfer && e.dataTransfer.files) {
    handleFilesSelected(e.dataTransfer.files);
  }
});

asgnFileInput?.addEventListener('change', (e) => {
  if (e.target.files) {
    handleFilesSelected(e.target.files);
    e.target.value = '';
  }
});

document.getElementById('asgn-add-more-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  asgnFileInput?.click();
});

document.getElementById('asgn-clear-all-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  stagedAttachments = [];
  activeStagedIndex = 0;
  updateStagedPreviewUI();
});

document.getElementById('asgn-prev-img-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (stagedAttachments.length <= 1) return;
  activeStagedIndex = (activeStagedIndex - 1 + stagedAttachments.length) % stagedAttachments.length;
  updateStagedPreviewUI();
});

document.getElementById('asgn-next-img-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (stagedAttachments.length <= 1) return;
  activeStagedIndex = (activeStagedIndex + 1) % stagedAttachments.length;
  updateStagedPreviewUI();
});

// Direct upload of assignment file to Supabase Storage
async function uploadAssignmentAttachment(att) {
  if (att.filePath && att.storageProvider === 'supabase') return att;
  if (!att.file) return att;

  const prepRes = await fetch('/api/admin/assignments/prepare-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      filename: att.originalName,
      size: att.size,
      mimeType: att.mimeType || 'application/octet-stream'
    })
  });

  if (!prepRes.ok) {
    let errMsg = 'Failed to initialize cloud upload.';
    try {
      const errData = await prepRes.json();
      if (errData.error) errMsg = errData.error;
    } catch (_) {}
    throw new Error(errMsg);
  }

  const prepData = await prepRes.json();
  let uploaded = false;

  if (window.supabase && prepData.supabaseUrl && prepData.supabaseKey) {
    try {
      const supaClient = window.supabase.createClient(prepData.supabaseUrl, prepData.supabaseKey, {
        auth: { persistSession: false }
      });
      const { error: uploadErr } = await supaClient.storage
        .from(prepData.bucket)
        .upload(prepData.filePath, att.file, {
          upsert: true,
          contentType: att.mimeType || 'application/octet-stream'
        });
      if (!uploadErr) uploaded = true;
      else console.warn('Supabase JS upload warning:', uploadErr);
    } catch (sdkErr) {
      console.warn('Supabase SDK error:', sdkErr);
    }
  }

  if (!uploaded && prepData.signedUrl) {
    const putRes = await fetch(prepData.signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': att.mimeType || 'application/octet-stream',
        'apikey': prepData.supabaseKey,
        'Authorization': `Bearer ${prepData.supabaseKey}`
      },
      body: att.file
    });
    if (!putRes.ok) {
      throw new Error(`Failed to upload "${att.originalName}" to cloud storage (HTTP ${putRes.status}).`);
    }
    uploaded = true;
  }

  if (!uploaded) {
    throw new Error(`Cloud upload could not be completed for "${att.originalName}".`);
  }

  att.filePath = prepData.filePath;
  att.storageProvider = 'supabase';
  delete att.dataBase64;
  return att;
}

addAsgnForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submit-asgn-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Publishing...';
  }

  const subject = document.getElementById('asgn-subject-input')?.value.trim();
  const category = document.getElementById('asgn-category-input')?.value.trim() || 'Lab Experiments';
  const year = document.getElementById('asgn-year-input')?.value || 'All Years';
  const branch = document.getElementById('asgn-branch-input')?.value || 'All Branches';
  const batch = document.getElementById('asgn-batch-input')?.value?.trim() || 'All Batches';
  const targetClass = (year !== 'All Years' || branch !== 'All Branches') ? `${year} ${branch}`.trim() : 'All Classes';
  const deadline = document.getElementById('asgn-deadline-input')?.value || '';

  if (!subject) {
    alert('Subject is required.');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Publish Assignment'; }
    return;
  }

  try {
    // 1. Upload files directly to Supabase Storage (Bypassing Vercel completely)
    for (let i = 0; i < stagedAttachments.length; i++) {
      const att = stagedAttachments[i];
      if (att.file && !att.filePath) {
        if (submitBtn) submitBtn.textContent = `Uploading ${i + 1}/${stagedAttachments.length} to cloud...`;
        await uploadAssignmentAttachment(att);
      }
    }

    // 2. Build lightweight payload (only file paths and metadata)
    const payloadAttachments = stagedAttachments.map(a => ({
      originalName: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
      filePath: a.filePath || null,
      storageProvider: a.storageProvider || (a.filePath ? 'supabase' : null),
      dataBase64: a.filePath ? null : (a.dataBase64 || null)
    }));

    const payloadData = {
      subject,
      category,
      year,
      branch,
      targetClass,
      batch,
      deadline,
      attachments: payloadAttachments,
      attachment: payloadAttachments[0] || null
    };

    if (submitBtn) submitBtn.textContent = 'Saving assignment...';

    const res = await fetch('/api/admin/assignments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadData)
    });

    let data;
    try {
      const rawText = await res.text();
      data = JSON.parse(rawText);
    } catch (parseErr) {
      if (res.status === 413) {
        data = { error: 'Files exceed the cloud upload limit (HTTP 413). Please reduce the number of images or file sizes.' };
      } else if (res.status >= 500) {
        data = { error: `Server error (${res.status}). Please try again shortly.` };
      } else {
        data = { error: `Server response error (status ${res.status})` };
      }
    }

    if (res.status === 401) {
      alert('Session expired. Please log in again.');
      window.location.href = '/admin';
      return;
    }

    if (!res.ok) {
      alert(data.error || 'Failed to publish assignment.');
      showToast(data.error || 'Failed to publish assignment.', 'error');
      return;
    }

    showToast('Assignment published successfully with preview!', 'success');
    alert('Assignment published successfully!');
    addAsgnForm.reset();
    stagedAttachments = [];
    activeStagedIndex = 0;
    updateStagedPreviewUI();
    if (addModal) addModal.style.display = 'none';
    loadAdminAssignments();
  } catch (err) {
    alert('Error publishing assignment: ' + err.message);
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
  } catch (err) {
    showToast('Could not delete assignment: ' + err.message, 'error');
    await loadAdminAssignments();
  }
};

// Preview Modal for Admin (Supports Multi-Attachment Gallery)
window.openAdminAttachmentPreview = function(asgnId, titleEncoded, fnameEncoded) {
  const asgn = allAdminAssignments.find(a => a.id === asgnId) || {
    id: asgnId,
    subject: titleEncoded ? decodeURIComponent(titleEncoded) : 'Assignment',
    attachmentName: fnameEncoded ? decodeURIComponent(fnameEncoded) : 'file',
    attachments: [{ originalName: fnameEncoded ? decodeURIComponent(fnameEncoded) : 'file', index: 0 }]
  };

  currentPreviewAsgn = asgn;
  currentPreviewIndex = 0;

  const modal = document.getElementById('admin-preview-modal');
  if (modal) modal.style.display = 'flex';

  renderAdminPreviewModalSlide();
};

function renderAdminPreviewModalSlide() {
  if (!currentPreviewAsgn) return;
  const asgn = currentPreviewAsgn;
  const rawAtts = (Array.isArray(asgn.attachments) && asgn.attachments.length > 0)
    ? asgn.attachments
    : (asgn.hasAttachment ? [{ index: 0, originalName: asgn.attachmentName || 'attachment', size: asgn.attachmentSize }] : []);

  const total = rawAtts.length || 1;
  if (currentPreviewIndex >= total) currentPreviewIndex = 0;
  if (currentPreviewIndex < 0) currentPreviewIndex = total - 1;
  const currentAtt = rawAtts[currentPreviewIndex] || { originalName: 'file', size: 0, index: 0 };

  const titleEl = document.getElementById('admin-preview-title');
  const subtitleEl = document.getElementById('admin-preview-subtitle');
  const navEl = document.getElementById('admin-preview-nav');
  const counterEl = document.getElementById('admin-preview-counter');
  const thumbsEl = document.getElementById('admin-preview-thumbs');
  const bodyEl = document.getElementById('admin-preview-body');
  const dlLink = document.getElementById('admin-preview-dl-link');
  const metaEl = document.getElementById('admin-preview-meta');

  if (titleEl) titleEl.textContent = `${asgn.subject || 'Assignment'}`;
  if (subtitleEl) {
    subtitleEl.style.display = 'block';
    subtitleEl.textContent = `${asgn.category || 'Lab Experiments'} • ${asgn.targetClass || ''} • ${asgn.batch || ''}`;
  }

  if (navEl) navEl.style.display = total > 1 ? 'flex' : 'none';
  if (counterEl) counterEl.textContent = `${currentPreviewIndex + 1} / ${total}`;

  if (metaEl) {
    metaEl.textContent = `📄 ${currentAtt.originalName} ${currentAtt.size ? `(${formatBytes(currentAtt.size)})` : ''}`;
  }

  if (dlLink) {
    dlLink.href = `/api/assignments/${asgn.id}/attachment?index=${currentPreviewIndex}`;
    dlLink.setAttribute('download', currentAtt.originalName || 'file');
  }

  const isImg = /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(currentAtt.originalName || '');
  if (bodyEl) {
    if (isImg) {
      bodyEl.innerHTML = `<img src="/api/assignments/${asgn.id}/attachment?index=${currentPreviewIndex}&inline=1" alt="Attachment preview" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:8px;">`;
    } else {
      bodyEl.innerHTML = `<iframe src="/api/assignments/${asgn.id}/attachment?index=${currentPreviewIndex}&inline=1" style="width:100%; height:65vh; border:none; border-radius:8px; background:#fff;"></iframe>`;
    }
  }

  if (thumbsEl) {
    if (total > 1) {
      thumbsEl.style.display = 'flex';
      thumbsEl.innerHTML = '';
      rawAtts.forEach((att, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'staged-mini-btn';
        if (idx === currentPreviewIndex) {
          btn.style.background = '#2d8f4e';
          btn.style.color = '#fff';
          btn.style.borderColor = '#2d8f4e';
        }
        btn.innerHTML = `${/\.(png|jpg|jpeg|webp)$/i.test(att.originalName) ? '🖼️' : '📄'} Page ${idx + 1}`;
        btn.onclick = () => {
          currentPreviewIndex = idx;
          renderAdminPreviewModalSlide();
        };
        thumbsEl.appendChild(btn);
      });
    } else {
      thumbsEl.style.display = 'none';
    }
  }
}

document.getElementById('admin-preview-prev')?.addEventListener('click', () => {
  if (!currentPreviewAsgn) return;
  const count = (currentPreviewAsgn.attachments && currentPreviewAsgn.attachments.length) || 1;
  currentPreviewIndex = (currentPreviewIndex - 1 + count) % count;
  renderAdminPreviewModalSlide();
});

document.getElementById('admin-preview-next')?.addEventListener('click', () => {
  if (!currentPreviewAsgn) return;
  const count = (currentPreviewAsgn.attachments && currentPreviewAsgn.attachments.length) || 1;
  currentPreviewIndex = (currentPreviewIndex + 1) % count;
  renderAdminPreviewModalSlide();
});

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
