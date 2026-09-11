// ===================================================================
// Dashboard page logic — talks to the real backend (server.js)
// ===================================================================

// ---------- Check login status on page load ----------
async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      // not logged in -> send to login page
      window.location.href = 'login.html';
      return null;
    }
    const data = await res.json();
    const nameEl = document.getElementById('welcome-name');
    const authBtn = document.getElementById('auth-btn');
    if (nameEl) nameEl.textContent = 'Hi, ' + data.name;
    if (authBtn) {
      authBtn.textContent = 'Sign Out';
      authBtn.onclick = async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = 'login.html';
      };
    }
    if (data.role === 'admin' || data.role === 'superadmin') {
      let adminLink = document.getElementById('admin-portal-link');
      if (!adminLink) {
        adminLink = document.createElement('button');
        adminLink.id = 'admin-portal-link';
        adminLink.className = 'signin secondary-btn';
        adminLink.style.marginRight = '8px';
        if (data.role === 'superadmin') {
          adminLink.style.background = '#7c3aed';
          adminLink.style.color = '#fff';
          adminLink.textContent = '👑 Super Admin';
          adminLink.onclick = () => window.location.href = '/super-admin';
        } else {
          adminLink.textContent = '🛡️ Admin Portal';
          adminLink.onclick = () => window.location.href = '/admin/dashboard';
        }
        const header = document.querySelector('header');
        if (header && authBtn) {
          header.insertBefore(adminLink, authBtn);
        }
      }
    }
    fetchLivePricing();
    loadMyOrders();
    return data;
  } catch (err) {
    window.location.href = 'login.html';
    return null;
  }
}
checkAuth();

// ===================================================================
// Page Navigation & Router
// ===================================================================
function showPage(pageId) {
  const pages = document.querySelectorAll('.page');
  const target = document.getElementById(pageId);
  if (!target) return;

  pages.forEach(p => p.classList.remove('active'));
  target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (pageId === 'printcentre') {
    loadFiles();
  } else if (pageId === 'printoptions') {
    loadOrderItems();
  } else if (pageId === 'assignments') {
    loadAssignments();
  } else if (pageId === 'payment') {
    initPaymentPage();
  } else if (pageId === 'trackorder') {
    loadMyOrders();
  }
}

// Global click event listener for [data-target] and [data-alert]
document.addEventListener('click', (e) => {
  const targetEl = e.target.closest('[data-target]');
  if (targetEl) {
    const page = targetEl.dataset.target;
    if (page) {
      e.preventDefault();
      showPage(page);
    }
  }
  const alertEl = e.target.closest('[data-alert]');
  if (alertEl) {
    e.preventDefault();
    alert(alertEl.dataset.alert);
  }
});

// ---------- Image compression helper for fast & reliable cloud uploads ----------
async function compressImageIfLarge(file) {
  if (!file.type.startsWith('image/') || file.size <= 1.5 * 1024 * 1024) {
    return file;
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDimension = 2048;
        let width = img.width;
        let height = img.height;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

// ---------- Drag & drop + real upload to backend ----------
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const uploadTrigger = document.getElementById('upload-trigger');
const fileList = document.getElementById('file-list');
const dzText = document.getElementById('dz-text');
const uploadStatus = document.getElementById('upload-status');

if (uploadTrigger) {
  uploadTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  });
}

async function uploadFiles(fileListToUpload) {
  if (!fileListToUpload || fileListToUpload.length === 0) return;

  uploadStatus.textContent = 'Processing files...';
  uploadTrigger.disabled = true;

  const formData = new FormData();
  for (const f of fileListToUpload) {
    if (f.size > 4.5 * 1024 * 1024 && !f.type.startsWith('image/')) {
      uploadStatus.textContent = `File "${f.name}" exceeds 4.5MB serverless cap. Please choose a smaller document.`;
      uploadTrigger.disabled = false;
      return;
    }
    uploadStatus.textContent = `Optimizing ${f.name}...`;
    const processed = await compressImageIfLarge(f);
    formData.append('files', processed);
  }

  uploadStatus.textContent = 'Uploading to server...';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) {
      uploadStatus.textContent = data.error || 'Upload failed.';
    } else {
      uploadStatus.textContent = `${data.files.length} file(s) uploaded successfully.`;
      loadFiles();
      const proceedWrap = document.getElementById('proceed-wrap');
      if (proceedWrap) proceedWrap.style.display = 'block';
    }
  } catch (err) {
    uploadStatus.textContent = 'Could not reach server or file exceeds cloud limit.';
  } finally {
    uploadTrigger.disabled = false;
  }
}

async function loadFiles() {
  try {
    const res = await fetch('/api/files');
    if (!res.ok) return;
    const data = await res.json();
    renderFiles(data.files);
  } catch (err) {
    // silent fail
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderFiles(files) {
  fileList.innerHTML = '';
  const proceedWrap = document.getElementById('proceed-wrap');
  if (!files || files.length === 0) {
    dzText.textContent = 'Drag and drop your files here';
    if (proceedWrap) proceedWrap.style.display = 'none';
    return;
  }
  dzText.textContent = files.length + ' file(s) uploaded';
  if (proceedWrap) proceedWrap.style.display = 'block';

  files.forEach(f => {
    const item = document.createElement('div');
    item.className = 'file-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = `${f.originalName} (${formatSize(f.size)})`;

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '⬇';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = () => {
      window.location.href = '/api/download/' + f.id;
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Delete';
    deleteBtn.onclick = async () => {
      await fetch('/api/files/' + f.id, { method: 'DELETE' });
      loadFiles();
    };

    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(nameSpan);
    item.appendChild(actions);
    fileList.appendChild(item);
  });
}

// ===================================================================
// PRINT OPTIONS / ORDER FLOW
// ===================================================================

let PRICE_TABLE = {
  'bw-single': 2,
  'bw-double': 3,
  'color-single': 5,
  'color-double': 8
};

async function fetchLivePricing() {
  try {
    const res = await fetch('/api/pricing');
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        Object.assign(PRICE_TABLE, data);
      }
    }
  } catch (err) {}
}

let orderDraft = []; // built when Print Options page loads

document.getElementById('proceed-btn')?.addEventListener('click', () => {
  showPage('printoptions');
});

async function loadOrderItems() {
  const container = document.getElementById('order-items');
  container.innerHTML = 'Loading your files...';

  const res = await fetch('/api/files');
  if (!res.ok) {
    container.innerHTML = '<p>Could not load your files.</p>';
    return;
  }
  const data = await res.json();

  if (!data.files || data.files.length === 0) {
    container.innerHTML = '<p>No files uploaded yet. Go back and upload something first.</p>';
    updateOrderTotal();
    return;
  }

  container.innerHTML = '';
  orderDraft = [];

  data.files.forEach(f => {
    const row = document.createElement('div');
    row.className = 'order-item';
    row.dataset.fileId = f.id;

    const isImage = /\.(png|jpg|jpeg|gif)$/i.test(f.originalName);
    const previewHTML = isImage
      ? `<img src="/api/download/${f.id}?inline=1" alt="preview">`
      : `<div class="file-icon">📄</div>`;

    row.innerHTML = `
      <div class="file-preview">
        ${previewHTML}
        <div class="file-meta">
          <div class="fname">${f.originalName}</div>
          <div class="fsize">${formatSize(f.size)}</div>
        </div>
      </div>

      <div class="opt-group">
        <label class="opt-label">Sides</label>
        <div class="radio-row">
          <label><input type="radio" name="sides-${f.id}" value="single" checked> Single-sided</label>
          <label><input type="radio" name="sides-${f.id}" value="double"> Double-sided</label>
        </div>
      </div>

      <div class="opt-group">
        <label class="opt-label">Color</label>
        <div class="radio-row">
          <label><input type="radio" name="color-${f.id}" value="bw" checked> Black &amp; White</label>
          <label><input type="radio" name="color-${f.id}" value="color"> Color</label>
        </div>
      </div>

      <div class="pages-input-wrap">
        <label class="opt-label">Pages</label>
        <input type="number" class="pages-input" min="1" value="1" data-pages="${f.id}">
        <div class="line-price" data-price="${f.id}">₹2</div>
      </div>
    `;
    container.appendChild(row);
  });

  // recalc price whenever any option changes
  container.addEventListener('input', updateOrderTotal);
  container.addEventListener('change', updateOrderTotal);
  updateOrderTotal();
}

function updateOrderTotal() {
  const container = document.getElementById('order-items');
  const rows = container.querySelectorAll('.order-item');
  let total = 0;
  orderDraft = [];

  rows.forEach(row => {
    const fileId = row.dataset.fileId;
    const fname = row.querySelector('.fname').textContent;
    const pagesInput = row.querySelector(`[data-pages="${fileId}"]`);
    const pages = Math.max(1, parseInt(pagesInput.value, 10) || 1);
    const sides = row.querySelector(`input[name="sides-${fileId}"]:checked`).value;
    const color = row.querySelector(`input[name="color-${fileId}"]:checked`).value;

    const rate = PRICE_TABLE[`${color}-${sides}`];
    const linePrice = rate * pages;
    total += linePrice;

    row.querySelector(`[data-price="${fileId}"]`).textContent = '₹' + linePrice;

    orderDraft.push({ fileId, originalName: fname, pages, sides, color, price: linePrice });
  });

  document.getElementById('order-total').textContent = '₹' + total;
}

// ===================================================================
// PAYMENT & UPI GATEWAY FLOW
// ===================================================================

let currentPaymentMethod = 'UPI';

function initPaymentPage() {
  const total = orderDraft.reduce((sum, i) => sum + i.price, 0);
  const totalEl = document.getElementById('payment-total');
  if (totalEl) totalEl.textContent = '₹' + total;
  document.querySelectorAll('.pay-btn-amount').forEach(el => el.textContent = '₹' + total);

  // Generate UPI URI
  const upiUri = `upi://pay?pa=aitxerox@upi&pn=AIT%20Xerox%20Centre&am=${total}&cu=INR&tn=Xerox%20Order`;

  // Set Direct UPI App Link for mobile
  const intentLink = document.getElementById('upi-intent-link');
  if (intentLink) {
    intentLink.href = upiUri;
  }

  // Render Google Pay QR Code
  const qrContainer = document.getElementById('upi-qr-container');
  if (qrContainer) {
    qrContainer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center;">
        <img src="gpay-qr.jpg"
             alt="Google Pay UPI QR Code"
             class="upi-qr-img"
             style="max-width:200px; width:100%; border-radius:12px; border:1.5px solid #dce5dc; box-shadow:0 4px 14px rgba(0,0,0,0.06);">
        <div style="margin-top:8px; font-size:12px; color:#2b7a2b; font-weight:600; text-align:center;">
          ⚡ Scan to Pay ₹${total} via Google Pay or Any UPI App
        </div>
      </div>
    `;
  }

  // Setup tab listeners
  const tabUpi = document.getElementById('tab-upi');
  const tabCard = document.getElementById('tab-card');
  const upiSec = document.getElementById('upi-section');
  const cardSec = document.getElementById('card-section');

  tabUpi?.addEventListener('click', () => {
    currentPaymentMethod = 'UPI';
    tabUpi.classList.add('active');
    tabCard?.classList.remove('active');
    if (upiSec) upiSec.style.display = 'block';
    if (cardSec) cardSec.style.display = 'none';
  });

  tabCard?.addEventListener('click', () => {
    currentPaymentMethod = 'Card';
    tabCard.classList.add('active');
    tabUpi?.classList.remove('active');
    if (upiSec) upiSec.style.display = 'none';
    if (cardSec) cardSec.style.display = 'block';
  });

  // Copy UPI ID button
  const copyBtn = document.getElementById('copy-upi-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const upiId = document.getElementById('upi-id-text')?.textContent || 'aitxerox@upi';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(upiId).then(() => {
          copyBtn.textContent = '✅ Copied!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
        }).catch(() => {
          copyBtn.textContent = '✅ Copied!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
        });
      } else {
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
      }
    };
  }
}

document.getElementById('submit-order-btn')?.addEventListener('click', () => {
  const errorEl = document.getElementById('order-error');
  errorEl.textContent = '';
  if (orderDraft.length === 0) {
    errorEl.textContent = 'Please upload at least one file before proceeding.';
    return;
  }
  showPage('payment');
});

async function executePayment(method) {
  const activeBtn = method === 'UPI' ? document.getElementById('upi-pay-btn') : document.getElementById('card-pay-btn');
  const originalText = activeBtn ? activeBtn.innerHTML : '';
  if (activeBtn) {
    activeBtn.disabled = true;
    activeBtn.textContent = 'Verifying & Placing Order...';
  }

  const utr = document.getElementById('pay-utr')?.value.trim() || '';

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: orderDraft,
        paymentMethod: method,
        utr: utr || null
      })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Payment failed. Please try again.');
      return;
    }

    renderConfirmation(data.orderId, data.total, orderDraft, method);
    showPage('confirmation');
  } catch (err) {
    alert('Could not reach the server.');
  } finally {
    if (activeBtn) {
      activeBtn.disabled = false;
      activeBtn.innerHTML = originalText;
    }
  }
}

document.getElementById('upi-pay-btn')?.addEventListener('click', () => executePayment('UPI'));
document.getElementById('card-pay-btn')?.addEventListener('click', () => executePayment('Card'));

function renderConfirmation(orderId, total, items, method = 'UPI') {
  document.getElementById('confirm-token').textContent = orderId;
  document.getElementById('confirm-total').textContent = '₹' + total;

  const itemsEl = document.getElementById('confirm-items');
  itemsEl.innerHTML = `
    <div class="confirm-method-row">
      <span class="pay-method-badge ${method === 'UPI' ? 'upi-badge' : 'card-badge'}">
        ${method === 'UPI' ? '⚡ Paid via UPI Instant' : '💳 Paid via Card'}
      </span>
    </div>
  `;
  items.forEach(i => {
    const line = document.createElement('div');
    line.className = 'confirm-line';
    line.innerHTML = `<span>${i.originalName} (${i.pages}p, ${i.sides}, ${i.color})</span><span>₹${i.price}</span>`;
    itemsEl.appendChild(line);
  });

  document.getElementById('track-this-btn').onclick = () => {
    document.getElementById('track-input').value = orderId;
    showPage('trackorder');
    trackOrder(orderId);
  };
}

// ===================================================================
// TRACK ORDER
// ===================================================================

document.getElementById('track-btn')?.addEventListener('click', () => {
  const id = document.getElementById('track-input').value.trim();
  if (!id) return;
  trackOrder(id);
});

function formatStudentStatus(status) {
  if (status === 'Ready for Collection' || status === 'Ready for Pickup') {
    return {
      label: '🎉 Printed — You can come and collect!',
      sub: 'Your document has been printed and is ready at the Xerox counter! Please collect it at your convenience.',
      style: 'background:#e8f8f0; color:#059669; border:1.5px solid #a7f3d0;'
    };
  }
  if (status === 'Collected' || status === 'Completed') {
    return {
      label: '✅ Collected',
      sub: 'This order has been picked up from the counter. Thank you!',
      style: 'background:#f3f4f6; color:#4b5563; border:1.5px solid #e5e7eb;'
    };
  }
  // Default for New, Accepted, Printing, Order Received, Printing in Progress
  return {
    label: '⏳ Waiting',
    sub: 'Your order is currently in queue / being printed. Please wait.',
    style: 'background:#fff8e7; color:#d97706; border:1.5px solid #fde68a;'
  };
}

async function trackOrder(orderId) {
  const errorEl = document.getElementById('track-error');
  const resultEl = document.getElementById('track-result');
  errorEl.textContent = '';
  resultEl.innerHTML = '<div style="color:#6c8072; font-size:14px;">Looking up order details...</div>';

  try {
    const res = await fetch('/api/orders/' + encodeURIComponent(orderId));
    const data = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = '';
      errorEl.textContent = data.error || 'Order not found. Please verify Order ID.';
      return;
    }

    let itemsHTML = '';
    (data.items || []).forEach(i => {
      const specs = `${i.color === 'color' ? 'Color' : 'B&W'}, ${i.sides === 'double' ? 'Double-sided' : 'Single-sided'}, ${i.pages}p`;
      itemsHTML += `<div class="confirm-line"><span>${i.originalName} (${specs})</span><span>₹${i.price}</span></div>`;
    });

    const studentStatus = formatStudentStatus(data.status);

    resultEl.innerHTML = `
      <div class="status-badge" style="${studentStatus.style}; font-size:14px; padding:8px 14px; display:inline-block; border-radius:12px; margin-bottom:10px;">
        ${studentStatus.label}
      </div>
      <p style="font-size:13.5px; color:#4a5e50; margin:0 0 14px 0;">${studentStatus.sub}</p>
      <p class="track-order-id" style="font-size:18px; font-weight:700; margin:0 0 4px 0;">${data.orderId}</p>
      <p class="fsize" style="color:#7b9183; font-size:12px; margin:0 0 14px 0;">Placed on ${new Date(data.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      <div style="margin-top:14px;">${itemsHTML}</div>
      <div class="price-summary" style="margin-top:14px;">
        <span>Total Paid</span><span>₹${data.total}</span>
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = '';
    errorEl.textContent = 'Could not reach the server.';
  }
}

// ---------- Load Student's Previous Orders ----------
async function loadMyOrders() {
  const loadingEl = document.getElementById('my-orders-loading');
  const listEl = document.getElementById('my-orders-list');
  const emptyEl = document.getElementById('my-orders-empty');
  if (!listEl) return;

  if (loadingEl) loadingEl.style.display = 'block';
  listEl.innerHTML = '';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const res = await fetch('/api/orders');
    if (!res.ok) throw new Error('Failed to fetch orders');
    const data = await res.json();
    const orders = data.orders || [];

    if (loadingEl) loadingEl.style.display = 'none';

    if (orders.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    orders.forEach(o => {
      const card = document.createElement('div');
      card.style.padding = '12px 14px';
      card.style.background = '#f9fbf9';
      card.style.borderRadius = '12px';
      card.style.border = '1px solid #e0eae1';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';
      card.style.flexWrap = 'wrap';
      card.style.gap = '10px';
      card.style.cursor = 'pointer';
      card.style.transition = 'all 0.15s ease';

      card.onmouseenter = () => card.style.borderColor = '#5cb85c';
      card.onmouseleave = () => card.style.borderColor = '#e0eae1';

      const studentStatus = formatStudentStatus(o.status);

      card.innerHTML = `
        <div style="flex:1; min-width:180px;">
          <div style="font-weight:700; font-size:14px; color:var(--ink);">${o.orderId} — ₹${o.total}</div>
          <div style="font-size:12px; color:#6c8072; margin-top:2px;">📅 ${new Date(o.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:12px; font-weight:600; padding:4px 10px; border-radius:12px; ${studentStatus.style}">${studentStatus.label}</span>
          <button type="button" style="background:#e8f8f0; color:#059669; border:none; border-radius:6px; padding:5px 10px; font-size:12px; font-weight:600; cursor:pointer;">Track →</button>
        </div>
      `;

      card.addEventListener('click', () => {
        const trackInput = document.getElementById('track-input');
        if (trackInput) trackInput.value = o.orderId;
        trackOrder(o.orderId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      listEl.appendChild(card);
    });
  } catch (err) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.textContent = 'Could not load previous orders.';
      emptyEl.style.display = 'block';
    }
  }
}

document.getElementById('btn-refresh-my-orders')?.addEventListener('click', () => {
  loadMyOrders();
});

// ---------- Blur-on-hover for dashboard cards ----------
const dockCards = document.querySelectorAll('.dock .card');
dockCards.forEach(card => {
  card.addEventListener('mouseenter', () => {
    dockCards.forEach(c => {
      if (c === card) {
        c.classList.add('is-active');
        c.classList.remove('is-dimmed');
      } else {
        c.classList.add('is-dimmed');
        c.classList.remove('is-active');
      }
    });
  });
  card.addEventListener('mouseleave', () => {
    dockCards.forEach(c => c.classList.remove('is-active', 'is-dimmed'));
  });
});

// ===================================================================
// SUBJECT ASSIGNMENTS & DEMO PREVIEW LOGIC
// ===================================================================

let allAssignments = [];
let currentSubjectFilter = 'all';

async function loadAssignments() {
  const loadingEl = document.getElementById('asgn-loading');
  const gridEl = document.getElementById('asgn-grid');
  const emptyEl = document.getElementById('asgn-empty');
  if (loadingEl) loadingEl.style.display = 'block';
  if (gridEl) gridEl.style.display = 'none';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const res = await fetch('/api/assignments');
    if (!res.ok) throw new Error('Failed to load assignments');
    const data = await res.json();
    allAssignments = data.assignments || [];

    setupSubjectFilters(allAssignments);
    renderAssignmentsList();
  } catch (err) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.querySelector('h3').textContent = 'Could not load assignments';
      emptyEl.querySelector('p').textContent = 'Please check your connection and try again.';
    }
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function setupSubjectFilters(assignments) {
  const container = document.getElementById('asgn-subject-filters');
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
      currentSubjectFilter = subj;
      renderAssignmentsList();
    };
    container.appendChild(btn);
  });

  const allBtn = container.querySelector('[data-subject="all"]');
  if (allBtn) {
    allBtn.onclick = () => {
      container.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      allBtn.classList.add('active');
      currentSubjectFilter = 'all';
      renderAssignmentsList();
    };
  }
}

function renderAssignmentsList() {
  const gridEl = document.getElementById('asgn-grid');
  const emptyEl = document.getElementById('asgn-empty');
  const search = (document.getElementById('asgn-search-input')?.value || '').toLowerCase().trim();

  const filtered = allAssignments.filter(a => {
    const matchesSubject = currentSubjectFilter === 'all' || a.subject === currentSubjectFilter;
    const matchesSearch = !search ||
      (a.title && a.title.toLowerCase().includes(search)) ||
      (a.subject && a.subject.toLowerCase().includes(search)) ||
      (a.experimentNo && a.experimentNo.toLowerCase().includes(search)) ||
      (a.info && a.info.toLowerCase().includes(search));
    return matchesSubject && matchesSearch;
  });

  if (filtered.length === 0) {
    if (gridEl) gridEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (gridEl) {
    gridEl.style.display = 'grid';
    gridEl.innerHTML = '';
  }

  filtered.forEach(a => {
    const card = document.createElement('div');
    card.className = 'asgn-card';

    const hasAtt = a.hasAttachment;
    const previewBtnHTML = hasAtt ? `
      <button type="button" class="action-btn preview-btn" onclick="openAttachmentPreview('${a.id}', '${encodeURIComponent(a.title)}', '${encodeURIComponent(a.attachmentName || 'Demo Assignment')}')">
        👁 Preview Demo
      </button>
      <a href="/api/assignments/${a.id}/attachment" class="action-btn download-btn" download="${a.attachmentName || 'demo_assignment'}">
        ⬇ Download
      </a>
      <button type="button" class="action-btn print-direct-btn" onclick="orderAssignmentPrint('${a.id}', '${encodeURIComponent(a.attachmentName || a.title + '.pdf')}')">
        🖨 Print This Report
      </button>
    ` : '<span class="no-att-note">No demo attachment</span>';

    card.innerHTML = `
      <div class="asgn-card-top">
        <span class="asgn-subject-tag">${a.subject}</span>
        ${a.experimentNo ? `<span class="asgn-exp-badge">${a.experimentNo}</span>` : ''}
        ${a.deadline ? `<span class="asgn-deadline-pill">Due: ${a.deadline}</span>` : ''}
      </div>
      <h3 class="asgn-title">${a.title}</h3>
      <div class="asgn-section-block">
        <div class="asgn-section-label">🔬 Experiment Info &amp; Objectives:</div>
        <p class="asgn-text">${a.info || 'No experiment description provided.'}</p>
      </div>
      ${a.submissionGuidelines ? `
        <div class="asgn-guide-box">
          <span class="guide-title">📌 Submission Guidelines:</span>
          <p class="asgn-guide-text">${a.submissionGuidelines}</p>
        </div>
      ` : ''}
      <div class="asgn-card-footer">
        <div class="asgn-actions">
          ${previewBtnHTML}
        </div>
      </div>
    `;
    gridEl.appendChild(card);
  });
}

// Search input listener for assignments
document.getElementById('asgn-search-input')?.addEventListener('input', () => {
  renderAssignmentsList();
});

// Attachment Preview Modal
window.openAttachmentPreview = function(asgnId, titleEncoded, fnameEncoded) {
  const modal = document.getElementById('preview-modal');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const dlLink = document.getElementById('modal-download-link');
  const printBtn = document.getElementById('modal-print-btn');

  const title = decodeURIComponent(titleEncoded);
  const fname = decodeURIComponent(fnameEncoded);

  if (titleEl) titleEl.textContent = `${title} — ${fname}`;
  if (dlLink) {
    dlLink.href = `/api/assignments/${asgnId}/attachment`;
    dlLink.setAttribute('download', fname);
  }

  if (printBtn) {
    printBtn.onclick = () => {
      if (modal) modal.style.display = 'none';
      orderAssignmentPrint(asgnId, fnameEncoded);
    };
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

// 1-Click Send Demo Assignment to Print Centre
window.orderAssignmentPrint = async function(asgnId, fnameEncoded) {
  const fname = decodeURIComponent(fnameEncoded);
  try {
    const res = await fetch(`/api/assignments/${asgnId}/attachment`);
    if (!res.ok) throw new Error('Could not fetch assignment demo file');
    const blob = await res.blob();
    const file = new File([blob], fname, { type: blob.type || 'application/pdf' });

    const formData = new FormData();
    formData.append('files', file);

    const upRes = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    if (!upRes.ok) throw new Error('Upload failed');

    showPage('printoptions');
    alert(`"${fname}" added to your Print Options! Choose copies and proceed.`);
  } catch (err) {
    alert('Could not transfer to Print Centre: ' + err.message);
  }
};

// Modal Close Listener
document.getElementById('modal-close-btn')?.addEventListener('click', () => {
  const modal = document.getElementById('preview-modal');
  if (modal) modal.style.display = 'none';
});

// Close modal when clicking on overlay background
document.getElementById('preview-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'preview-modal') {
    e.target.style.display = 'none';
  }
});
