// ===================================================================
// Dashboard page logic — talks to the real backend (server.js)
// ===================================================================

// ---------- Check login status on page load ----------
async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      // Unauthenticated visitor -> Display Landing Page with Three Role Cards
      showPage('landing');
      return null;
    }
    const data = await res.json();
    const roleUpper = (data.role || '').toUpperCase();

    // Enforce role separation: Admin & Super Admin are routed to their dedicated portals
    if (roleUpper === 'SUPER_ADMIN' || roleUpper === 'SUPERADMIN') {
      window.location.href = '/super-admin';
      return data;
    }
    if (roleUpper === 'ADMIN') {
      window.location.href = '/admin/dashboard';
      return data;
    }

    // Student -> Show Student Dashboard
    showPage('dashboard');

    const nameEl = document.getElementById('welcome-name');
    const authBtn = document.getElementById('auth-btn');
    if (nameEl) nameEl.textContent = 'Hi, ' + data.name;
    if (authBtn) {
      authBtn.textContent = 'Sign Out';
      authBtn.onclick = async () => {
        await fetch('/api/logout', { method: 'POST' });
        showPage('landing');
        if (nameEl) nameEl.textContent = '';
        authBtn.textContent = 'Sign In';
        authBtn.onclick = () => window.location.href = 'login.html';
      };
    }

    fetchLivePricing();
    loadMyOrders();
    return data;
  } catch (err) {
    showPage('landing');
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

  // Stop any active tracking poller when navigating away from trackorder
  if (pageId !== 'trackorder' && typeof stopTrackingPoller === 'function') {
    stopTrackingPoller();
  }

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

document.getElementById('asgn-back-btn')?.addEventListener('click', () => {
  const nameEl = document.getElementById('welcome-name');
  if (nameEl && nameEl.textContent) {
    showPage('dashboard');
  } else {
    showPage('landing');
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

  uploadTrigger.disabled = true;
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
  const totalCount = fileListToUpload.length;
  let successfulUploads = 0;

  for (let i = 0; i < totalCount; i++) {
    const f = fileListToUpload[i];

    if (f.size > MAX_FILE_SIZE) {
      alert(`File "${f.name}" (${(f.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 50 MB upload limit. Please select a smaller document.`);
      uploadStatus.textContent = `File "${f.name}" exceeds 50 MB limit.`;
      continue;
    }

    uploadStatus.textContent = `Preparing "${f.name}" (${i + 1}/${totalCount})...`;

    try {
      // 1. Image optimization for photos (skip for PDFs and docs)
      const processed = await compressImageIfLarge(f);

      // 2. Request upload authorization from Xerox backend
      const prepRes = await fetch('/api/files/prepare-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          filename: processed.name || f.name,
          size: processed.size,
          mimeType: processed.type || 'application/octet-stream'
        })
      });

      const prepData = await prepRes.json();
      if (!prepRes.ok) {
        throw new Error(prepData.error || 'Server rejected upload request.');
      }

      uploadStatus.textContent = `Uploading "${f.name}" directly to cloud storage (${i + 1}/${totalCount})...`;

      // 3. Direct upload to Supabase Storage (Bypassing Vercel completely)
      let uploadSucceeded = false;

      // Check if Supabase JS SDK is available in window
      if (window.supabase && prepData.supabaseUrl && prepData.supabaseKey) {
        try {
          const supaClient = window.supabase.createClient(prepData.supabaseUrl, prepData.supabaseKey, {
            auth: { persistSession: false }
          });

          if (prepData.token) {
            // Upload to pre-signed upload URL token
            const { error: supaErr } = await supaClient.storage
              .from(prepData.bucket)
              .uploadToSignedUrl(prepData.filePath, prepData.token, processed);
            if (!supaErr) uploadSucceeded = true;
          } else {
            // Standard direct upload to private bucket under RLS
            const { error: supaErr } = await supaClient.storage
              .from(prepData.bucket)
              .upload(prepData.filePath, processed, {
                contentType: processed.type || 'application/octet-stream',
                upsert: true
              });
            if (!supaErr) uploadSucceeded = true;
          }
        } catch (supaSdkErr) {
          console.warn('Supabase SDK upload fallback to HTTP PUT:', supaSdkErr);
        }
      }

      // HTTP fetch fallback if SDK didn't succeed
      if (!uploadSucceeded) {
        const uploadHeaders = {
          'apikey': prepData.supabaseKey,
          'Authorization': `Bearer ${prepData.supabaseKey}`
        };
        if (processed.type) uploadHeaders['Content-Type'] = processed.type;

        const targetUrl = prepData.signedUrl;
        const uploadRes = await fetch(targetUrl, {
          method: prepData.useDirectUpload ? 'POST' : 'PUT',
          headers: uploadHeaders,
          body: processed
        });

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          throw new Error(`Direct cloud upload failed (${uploadRes.status}): ${errText}`);
        }
      }

      uploadStatus.textContent = `Saving record for "${f.name}"...`;

      // 4. Record confirmed file path in MongoDB
      const confirmRes = await fetch('/api/files/confirm-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          fileId: prepData.fileId,
          filePath: prepData.filePath,
          originalName: prepData.originalName,
          size: processed.size,
          mimeType: processed.type
        })
      });

      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) {
        throw new Error(confirmData.error || 'Failed to record file in database.');
      }

      successfulUploads++;
    } catch (err) {
      console.error(`Error uploading "${f.name}":`, err);
      // If direct Supabase upload failed, try fallback through /api/upload
      try {
        uploadStatus.textContent = `Retrying "${f.name}" via backup channel...`;
        const fbFormData = new FormData();
        fbFormData.append('files', f);
        const fbRes = await fetch('/api/upload', {
          method: 'POST',
          credentials: 'same-origin',
          body: fbFormData
        });
        if (fbRes.ok) {
          successfulUploads++;
        } else {
          const fbData = await fbRes.json();
          alert(`Could not upload "${f.name}": ${fbData.error || err.message}`);
        }
      } catch (fbErr) {
        alert(`Could not upload "${f.name}": ${err.message}`);
      }
    }
  }

  if (successfulUploads > 0) {
    uploadStatus.textContent = `✅ ${successfulUploads} file(s) uploaded successfully to cloud storage.`;
    await loadFiles();
    const proceedWrap = document.getElementById('proceed-wrap');
    if (proceedWrap) proceedWrap.style.display = 'block';
  } else {
    uploadStatus.textContent = 'Upload could not be completed. Please verify file format and size.';
  }

  uploadTrigger.disabled = false;
}

async function loadFiles() {
  try {
    const res = await fetch('/api/files', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    renderFiles(data.files || []);
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

  // Header row with count & Clear All Documents button
  const headerRow = document.createElement('div');
  headerRow.className = 'file-list-header';
  headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding:4px 6px;';
  headerRow.innerHTML = `
    <span style="font-size:12.5px; font-weight:600; color:#1e3d2a;">Uploaded Documents (${files.length})</span>
    <button type="button" id="btn-clear-all-docs" style="background:#fff1f2; border:1.5px solid #fecdd3; color:#e11d48; font-size:11.5px; font-weight:600; border-radius:8px; padding:4px 10px; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.15s;">
      🗑️ Clear All
    </button>
  `;
  fileList.appendChild(headerRow);

  headerRow.querySelector('#btn-clear-all-docs').onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('Remove all uploaded documents and start fresh?')) return;
    fileList.innerHTML = '<div style="color:#6c8072; font-size:13px; text-align:center; padding:12px;">Clearing files...</div>';
    await fetch('/api/files/clear', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    loadFiles();
  };

  files.forEach(f => {
    const item = document.createElement('div');
    item.className = 'file-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = `${f.originalName} (${formatSize(f.size)})`;

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'file-action-btn download';
    downloadBtn.textContent = '⬇';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = (e) => {
      e.stopPropagation();
      window.location.href = '/api/download/' + f.id;
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'file-action-btn delete';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Remove this file';
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      // Optimistic removal: visually remove immediately
      item.style.opacity = '0.3';
      item.style.pointerEvents = 'none';
      try {
        await fetch('/api/files/' + f.id, { method: 'DELETE', credentials: 'same-origin' });
      } catch (err) {}
      item.remove();
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

      <div class="opt-group">
        <label class="opt-label">Copies</label>
        <input type="number" class="pages-input" min="1" value="1" data-copies="${f.id}" style="width:70px;">
      </div>

      <div class="opt-group">
        <label class="opt-label">Page Range</label>
        <input type="text" class="auth-input" value="all" placeholder="e.g. all or 1-5" data-pagerange="${f.id}" style="width:110px; padding:6px 10px; font-size:13px;">
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
    const copiesInput = row.querySelector(`[data-copies="${fileId}"]`);
    const copies = Math.max(1, parseInt(copiesInput?.value, 10) || 1);
    const pageRangeInput = row.querySelector(`[data-pagerange="${fileId}"]`);
    const pageRange = pageRangeInput?.value.trim() || 'all';

    const sides = row.querySelector(`input[name="sides-${fileId}"]:checked`).value;
    const color = row.querySelector(`input[name="color-${fileId}"]:checked`).value;

    const rate = PRICE_TABLE[`${color}-${sides}`] || 2;
    const linePrice = rate * pages * copies;
    total += linePrice;

    row.querySelector(`[data-price="${fileId}"]`).textContent = '₹' + linePrice;

    orderDraft.push({ fileId, originalName: fname, pages, sides, color, copies, pageRange, price: linePrice });
  });

  document.getElementById('order-total').textContent = '₹' + total;
}

// ===================================================================
// PAYMENT & UPI GATEWAY FLOW
// ===================================================================

let currentPaymentMethod = 'Razorpay';
let currentPendingOrder = null;

function initPaymentPage() {
  const total = currentPendingOrder ? (currentPendingOrder.amount || currentPendingOrder.total) : orderDraft.reduce((sum, i) => sum + i.price, 0);
  const totalEl = document.getElementById('payment-total');
  if (totalEl) totalEl.textContent = '₹' + total;
  document.querySelectorAll('.pay-btn-amount').forEach(el => el.textContent = '₹' + total);

  if (currentPendingOrder) {
    const orderIdEl = document.getElementById('pay-active-order-id');
    if (orderIdEl) orderIdEl.textContent = currentPendingOrder.orderId;
  }

  currentPaymentMethod = 'Razorpay';
  const rzpTokenEl = document.getElementById('rzp-order-token');
  if (rzpTokenEl && currentPendingOrder) {
    rzpTokenEl.textContent = currentPendingOrder.orderId;
  }

  const razorpaySec = document.getElementById('razorpay-section');
  if (razorpaySec) razorpaySec.style.display = 'block';

  // Reset error box on view
  const errBox = document.getElementById('razorpay-error-box');
  if (errBox) {
    errBox.style.display = 'none';
    errBox.textContent = '';
  }
}

// Step 1: Click "Proceed to Payment" -> Initiates Order on Backend (PENDING_PAYMENT)
document.getElementById('submit-order-btn')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('order-error');
  errorEl.textContent = '';
  if (orderDraft.length === 0) {
    errorEl.textContent = 'Please upload at least one file before proceeding.';
    return;
  }

  const submitBtn = document.getElementById('submit-order-btn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Initiating Secure Order...';

  try {
    const res = await fetch('/api/orders/initiate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: orderDraft,
        copies: parseInt(document.getElementById('order-copies')?.value || '1', 10),
        pageRange: document.getElementById('page-range')?.value || 'all',
        paymentMethod: 'UPI'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Failed to initiate order. Please try again.';
      return;
    }

    currentPendingOrder = data; // { orderId, amount, total, paymentStatus: 'PENDING_PAYMENT', testMode: true }

    const orderIdEl = document.getElementById('pay-active-order-id');
    if (orderIdEl) orderIdEl.textContent = data.orderId;
    const statusEl = document.getElementById('pay-active-status');
    if (statusEl) {
      statusEl.textContent = '⏳ PENDING PAYMENT';
      statusEl.style.background = '#fff3cd';
      statusEl.style.color = '#856404';
    }

    showPage('payment');
  } catch (err) {
    errorEl.textContent = 'Could not reach server to initiate order.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

// Step 2: Verification / Simulation Flow
async function verifyPayment(statusToSimulate = 'SUCCESS', utr = '') {
  if (!currentPendingOrder || !currentPendingOrder.orderId) {
    alert('No active pending order found. Please return to Print Options.');
    showPage('printoptions');
    return;
  }

  const msgBox = document.getElementById('payment-status-message');
  if (msgBox) {
    msgBox.style.display = 'block';
    msgBox.className = 'payment-alert-box';
    msgBox.style.background = '#f0f7f2';
    msgBox.style.color = '#2b7a2b';
    msgBox.innerHTML = `<span>⏳ Verifying payment simulation (${statusToSimulate})...</span>`;
  }

  const btnSuccess = document.getElementById('btn-sim-success');
  const btnFail = document.getElementById('btn-sim-fail');
  const btnCancel = document.getElementById('btn-sim-cancel');
  const upiPayBtn = document.getElementById('upi-pay-btn');
  const cardPayBtn = document.getElementById('card-pay-btn');
  [btnSuccess, btnFail, btnCancel, upiPayBtn, cardPayBtn].forEach(b => { if (b) b.disabled = true; });

  try {
    const res = await fetch('/api/payments/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: currentPendingOrder.orderId,
        simulationStatus: statusToSimulate,
        paymentStatus: statusToSimulate,
        utr: utr || document.getElementById('pay-utr')?.value.trim() || ''
      })
    });

    const data = await res.json();

    if (res.ok && (statusToSimulate === 'SUCCESS' || statusToSimulate === 'PAID')) {
      if (msgBox) {
        msgBox.className = 'payment-alert-box alert-success';
        msgBox.innerHTML = `<span>✅ Payment Verified Successfully! Redirecting to confirmation...</span>`;
      }
      setTimeout(() => {
        renderConfirmation(data.orderId, data.amount || currentPendingOrder.amount, orderDraft, currentPaymentMethod);
        showPage('confirmation');
      }, 600);
      return;
    }

    if (statusToSimulate === 'CANCELLED') {
      const statusEl = document.getElementById('pay-active-status');
      if (statusEl) {
        statusEl.textContent = '🚫 CANCELLED';
        statusEl.style.background = '#f3f4f6';
        statusEl.style.color = '#4b5563';
      }
      if (msgBox) {
        msgBox.className = 'payment-alert-box alert-cancel';
        msgBox.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:8px;">
            <strong>🚫 Payment Cancelled</strong>
            <span>Payment simulation was cancelled. This order has NOT been submitted to the Xerox counter.</span>
            <div style="margin-top:6px;">
              <button type="button" class="upload-btn" onclick="retryPayment()" style="padding:6px 14px; font-size:12.5px; display:inline-block; width:auto;">🔄 Retry Payment</button>
              <button type="button" class="back-btn" onclick="showPage('printoptions')" style="font-size:12.5px; margin-left:10px;">← Back to Print Options</button>
            </div>
          </div>
        `;
      }
      return;
    }

    // FAILED:
    const statusEl = document.getElementById('pay-active-status');
    if (statusEl) {
      statusEl.textContent = '❌ PAYMENT FAILED';
      statusEl.style.background = '#fee2e2';
      statusEl.style.color = '#991b1b';
    }
    if (msgBox) {
      msgBox.className = 'payment-alert-box alert-error';
      msgBox.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px;">
          <strong>❌ Payment Transaction Failed</strong>
          <span>${data.error || 'Your payment was declined in test mode. The order was NOT sent to the printing queue.'}</span>
          <div style="margin-top:6px;">
            <button type="button" class="upload-btn" onclick="retryPayment()" style="background:#dc2626; padding:6px 14px; font-size:12.5px; display:inline-block; width:auto;">🔄 Retry Payment</button>
            <button type="button" class="back-btn" onclick="showPage('printoptions')" style="font-size:12.5px; margin-left:10px;">← Back to Print Options</button>
          </div>
        </div>
      `;
    }
  } catch (err) {
    if (msgBox) {
      msgBox.className = 'payment-alert-box alert-error';
      msgBox.innerHTML = `<span>Could not reach payment verification service: ${err.message}</span>`;
    }
  } finally {
    [btnSuccess, btnFail, btnCancel, upiPayBtn, cardPayBtn].forEach(b => { if (b) b.disabled = false; });
  }
}

function retryPayment() {
  const msgBox = document.getElementById('payment-status-message');
  if (msgBox) msgBox.style.display = 'none';
  const statusEl = document.getElementById('pay-active-status');
  if (statusEl) {
    statusEl.textContent = '⏳ PENDING PAYMENT';
    statusEl.style.background = '#fff3cd';
    statusEl.style.color = '#856404';
  }
}

// ===================================================================
// RAZORPAY STANDARD WEB CHECKOUT FLOW
// ===================================================================

async function launchRazorpayCheckout() {
  const errBox = document.getElementById('razorpay-error-box');
  if (errBox) {
    errBox.style.display = 'none';
    errBox.textContent = '';
  }

  if (!currentPendingOrder || !currentPendingOrder.orderId) {
    alert('No active pending order found. Please return to Print Options.');
    showPage('printoptions');
    return;
  }

  const rzpBtn = document.getElementById('razorpay-checkout-btn');
  const originalText = rzpBtn ? rzpBtn.innerHTML : '';
  if (rzpBtn) {
    rzpBtn.disabled = true;
    rzpBtn.innerHTML = '<span>⏳ Opening Razorpay Gateway...</span>';
  }

  try {
    // 1. Calculate amount in paise (minimum 100 paise)
    const amountInRupees = Number(currentPendingOrder.amount || currentPendingOrder.total || 1);
    const amountInPaise = Math.max(100, Math.round(amountInRupees * 100));

    // 2. Call backend to create Razorpay Order
    const createRes = await fetch('/api/create-order', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: currentPendingOrder.orderId,
        orderId: currentPendingOrder.orderId
      })
    });

    const createData = await createRes.json();
    if (!createRes.ok || !createData.order_id) {
      throw new Error(createData.error || 'Failed to initialize Razorpay order on server.');
    }

    // 3. Verify Razorpay checkout script is loaded
    if (typeof window.Razorpay !== 'function') {
      throw new Error('Razorpay SDK failed to load. Please check your internet connection.');
    }

    const keyId = createData.keyId || 'rzp_test_TeOn3Cq5Vfubfu';

    // 4. Configure Razorpay Standard Checkout Options
    const options = {
      key: keyId,
      amount: createData.amount,
      currency: createData.currency || 'INR',
      name: 'Xerox Centre — AIT Pune',
      description: `Printing Order #${currentPendingOrder.orderId}`,
      image: 'icons/icon-192.png',
      order_id: createData.order_id,
      handler: async function(response) {
        // Step 2 & 3: Received payment response, verify signature with backend
        try {
          if (rzpBtn) {
            rzpBtn.disabled = true;
            rzpBtn.innerHTML = '<span>🔒 Verifying Payment Signature...</span>';
          }

          const verifyRes = await fetch('/api/verify-payment', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              orderId: currentPendingOrder.orderId
            })
          });

          const verifyData = await verifyRes.json();
          if (!verifyRes.ok || !verifyData.success) {
            throw new Error(verifyData.error || 'Payment signature verification failed.');
          }

          // Payment verified successfully!
          currentPaymentMethod = 'Razorpay';
          renderConfirmation(currentPendingOrder.orderId, currentPendingOrder.amount, orderDraft, 'Razorpay');
          showPage('confirmation');
        } catch (verifyErr) {
          console.error('Razorpay verification error:', verifyErr);
          if (errBox) {
            errBox.style.display = 'block';
            errBox.textContent = `Payment verification failed: ${verifyErr.message}`;
          }
          alert(`Payment verification failed: ${verifyErr.message}`);
        } finally {
          if (rzpBtn) {
            rzpBtn.disabled = false;
            rzpBtn.innerHTML = originalText;
          }
        }
      },
      prefill: {
        name: (document.getElementById('welcome-name')?.textContent || 'Student').trim(),
        email: 'student@aitpune.edu.in',
        contact: ''
      },
      notes: {
        xeroxOrderId: currentPendingOrder.orderId
      },
      theme: {
        color: '#2563eb'
      },
      modal: {
        ondismiss: function() {
          console.log('[Razorpay] Payment modal dismissed by user.');
          if (errBox) {
            errBox.style.display = 'block';
            errBox.textContent = 'Payment cancelled. You can retry anytime by clicking the button below.';
          }
          if (rzpBtn) {
            rzpBtn.disabled = false;
            rzpBtn.innerHTML = originalText;
          }
        }
      }
    };

    const rzpInstance = new window.Razorpay(options);

    rzpInstance.on('payment.failed', function(failureResponse) {
      console.error('[Razorpay] Payment failed event:', failureResponse.error);
      const desc = failureResponse.error ? failureResponse.error.description : 'Payment transaction failed';
      if (errBox) {
        errBox.style.display = 'block';
        errBox.textContent = `❌ Payment Failed: ${desc} (Code: ${failureResponse.error?.code || 'ERR'})`;
      }
      if (rzpBtn) {
        rzpBtn.disabled = false;
        rzpBtn.innerHTML = originalText;
      }
    });

    rzpInstance.open();
  } catch (err) {
    console.error('Razorpay checkout initiation error:', err);
    if (errBox) {
      errBox.style.display = 'block';
      errBox.textContent = err.message || 'Could not open Razorpay checkout modal.';
    }
  } finally {
    if (rzpBtn) {
      rzpBtn.disabled = false;
      rzpBtn.innerHTML = originalText;
    }
  }
}

// Payment Event Listeners
document.getElementById('razorpay-checkout-btn')?.addEventListener('click', () => {
  launchRazorpayCheckout();
});
document.getElementById('upi-pay-btn')?.addEventListener('click', () => {
  const utr = document.getElementById('pay-utr')?.value.trim() || '';
  verifyPayment('SUCCESS', utr);
});
document.getElementById('card-pay-btn')?.addEventListener('click', () => verifyPayment('SUCCESS'));
document.getElementById('btn-sim-success')?.addEventListener('click', () => verifyPayment('SUCCESS'));
document.getElementById('btn-sim-fail')?.addEventListener('click', () => verifyPayment('FAILED'));
document.getElementById('btn-sim-cancel')?.addEventListener('click', () => verifyPayment('CANCELLED'));

function renderConfirmation(orderId, total, items, method = 'Razorpay') {
  document.getElementById('confirm-token').textContent = orderId;
  document.getElementById('confirm-total').textContent = '₹' + total;

  // Clear uploaded files tray so previous documents never linger for the next order
  fetch('/api/files/clear', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});

  const itemsEl = document.getElementById('confirm-items');
  const badgeText = method === 'Razorpay' ? '💳 Paid via Razorpay (Verified)' : (method === 'UPI' ? '⚡ Paid via UPI Instant' : '💳 Paid via Card');
  itemsEl.innerHTML = `
    <div class="confirm-method-row">
      <span class="pay-method-badge ${method === 'Razorpay' ? 'card-badge' : (method === 'UPI' ? 'upi-badge' : 'card-badge')}" style="${method === 'Razorpay' ? 'background:#2563eb; color:#fff;' : ''}">
        ${badgeText}
      </span>
    </div>
  `;
  items.forEach(i => {
    const line = document.createElement('div');
    line.className = 'confirm-line';
    const copiesStr = (i.copies && i.copies > 1) ? ` × ${i.copies} copies` : '';
    line.innerHTML = `<span>${i.originalName} (${i.pages}p, ${i.sides}, ${i.color}${copiesStr})</span><span>₹${i.price}</span>`;
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
  if (status === 'READY' || status === 'Ready for Collection' || status === 'Ready for Pickup') {
    return {
      label: '🎉 Printed — Ready for Collection!',
      sub: 'Your document has been printed and is ready at the Xerox counter! Please collect it at your convenience.',
      style: 'background:#e8f8f0; color:#059669; border:1.5px solid #a7f3d0;'
    };
  }
  if (status === 'COMPLETED' || status === 'Collected' || status === 'Completed') {
    return {
      label: '✅ Collected',
      sub: 'This order has been picked up from the Xerox counter. Thank you!',
      style: 'background:#f3f4f6; color:#4b5563; border:1.5px solid #e5e7eb;'
    };
  }
  if (status === 'CANCELLED' || status === 'Cancelled') {
    return {
      label: '🚫 Cancelled',
      sub: 'This order was cancelled or payment was not completed.',
      style: 'background:#fef2f2; color:#991b1b; border:1.5px solid #fecaca;'
    };
  }
  if (status === 'PRINTING' || status === 'Printing' || status === 'Printing in Progress') {
    return {
      label: '🖨️ Printing in Progress',
      sub: 'Your document is currently being printed by the Xerox operator. Please stand by.',
      style: 'background:#eff6ff; color:#2563eb; border:1.5px solid #bfdbfe;'
    };
  }
  if (status === 'ACCEPTED' || status === 'Accepted') {
    return {
      label: '🔵 Order Accepted',
      sub: 'Your order was accepted by the Xerox operator and queued for printing.',
      style: 'background:#e0f2fe; color:#0284c7; border:1.5px solid #bae6fd;'
    };
  }
  // REQUEST_RECEIVED / New / Order Received
  return {
    label: '⏳ Request Received',
    sub: 'Payment confirmed. Your print request is in the store queue waiting for operator pickup.',
    style: 'background:#fff8e7; color:#d97706; border:1.5px solid #fde68a;'
  };
}

// Pulsing beacon config: status → beacon colour CSS class
function getStatusBeacon(status) {
  const st = (status || '').toUpperCase();
  if (st === 'CANCELLED') return { cls: 'beacon-grey',   label: '⚫', terminal: true };
  if (st === 'COMPLETED') return { cls: 'beacon-green',  label: '🟢', terminal: true };
  if (st === 'READY')     return { cls: 'beacon-green',  label: '🟢', terminal: false };
  if (st === 'PRINTING')  return { cls: 'beacon-blue',   label: '🔵', terminal: false };
  if (st === 'ACCEPTED')  return { cls: 'beacon-amber',  label: '🟡', terminal: false };
  // REQUEST_RECEIVED or unknown → red (in queue)
                          return { cls: 'beacon-red',    label: '🔴', terminal: false };
}

let _trackingPoller = null;

function stopTrackingPoller() {
  if (_trackingPoller) {
    clearInterval(_trackingPoller);
    _trackingPoller = null;
  }
}

async function trackOrder(orderId) {
  stopTrackingPoller();

  const errorEl = document.getElementById('track-error');
  const resultEl = document.getElementById('track-result');
  if (errorEl) errorEl.textContent = '';
  if (resultEl) resultEl.innerHTML = '<div style="color:#6c8072; font-size:14px;">Looking up order details...</div>';

  async function fetchAndRender(silent = false) {
    try {
      const res = await fetch('/api/orders/' + encodeURIComponent(orderId));
      const data = await res.json();

      if (!res.ok) {
        if (!silent) {
          if (resultEl) resultEl.innerHTML = '';
          if (errorEl) errorEl.textContent = data.error || 'Order not found. Please verify Order ID.';
        }
        stopTrackingPoller();
        return;
      }

      const beacon = getStatusBeacon(data.status);
      const studentStatus = formatStudentStatus(data.status);

      let itemsHTML = '';
      (data.items || []).forEach(i => {
        const specs = `${i.color === 'color' ? 'Color' : 'B&W'}, ${i.sides === 'double' ? 'Double-sided' : 'Single-sided'}, ${i.pages}p`;
        itemsHTML += `<div class="confirm-line"><span>${i.originalName} (${specs})</span><span>₹${i.price}</span></div>`;
      });

      // 5-step progress pipeline
      const steps = ['REQUEST_RECEIVED','ACCEPTED','PRINTING','READY','COMPLETED'];
      const stUp = (data.status || '').toUpperCase();
      const stepIdx = stUp === 'CANCELLED' ? -1 : steps.indexOf(stUp);
      const progressHTML = stUp === 'CANCELLED' ? '' : `
        <div class="track-progress-bar" style="margin:14px 0 18px;">
          ${steps.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            const names = ['Received','Accepted','Printing','Ready','Collected'];
            return `<div class="track-step ${done ? 'step-done' : ''} ${active ? 'step-active' : ''}">
              <div class="track-step-dot"></div>
              <div class="track-step-label">${names[i]}</div>
            </div>`;
          }).join('')}
        </div>`;

      const liveTag = beacon.terminal ? '' :
        `<span style="font-size:11px; color:#059669; background:#dcfce7; border-radius:20px; padding:2px 8px; font-weight:600; margin-left:8px; vertical-align:middle;">LIVE ↻</span>`;

      if (resultEl) resultEl.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
          <span class="status-beacon ${beacon.cls}"></span>
          <span style="${studentStatus.style}; font-size:14px; padding:6px 14px; border-radius:12px; font-weight:600;">${studentStatus.label}</span>
          ${liveTag}
        </div>
        <p style="font-size:13px; color:#4a5e50; margin:0 0 10px 0;">${studentStatus.sub}</p>
        ${progressHTML}
        <p class="track-order-id" style="font-size:17px; font-weight:700; margin:0 0 3px 0;">${data.orderId}</p>
        <p style="color:#7b9183; font-size:12px; margin:0 0 14px 0;">Placed on ${new Date(data.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        <div style="margin-top:10px;">${itemsHTML}</div>
        <div class="price-summary" style="margin-top:14px;"><span>Total Paid</span><span>₹${data.total}</span></div>
        ${!beacon.terminal ? `<p style="font-size:11px; color:#9aab9f; margin-top:10px; text-align:center;">Auto-refreshing every 8 seconds…</p>` : ''}
      `;

      // Stop polling when terminal state is reached
      if (beacon.terminal) stopTrackingPoller();

    } catch (err) {
      if (!silent) {
        if (resultEl) resultEl.innerHTML = '';
        if (errorEl) errorEl.textContent = 'Could not reach the server.';
      }
      stopTrackingPoller();
    }
  }

  // Initial fetch (shows loading message)
  await fetchAndRender(false);

  // Start live auto-polling every 8 seconds (only for non-terminal statuses)
  _trackingPoller = setInterval(() => fetchAndRender(true), 8000);
}

// ---------- Dual-Tab Order History & In-Process Cards Tracker ----------
function setupOrderTrackingTabs() {
  const tabInProcess = document.getElementById('tab-in-process');
  const tabCompleted = document.getElementById('tab-completed');
  const viewInProcess = document.getElementById('view-in-process-orders');
  const viewCompleted = document.getElementById('view-completed-orders');

  if (tabInProcess && tabCompleted) {
    tabInProcess.onclick = () => {
      tabInProcess.classList.add('active');
      tabCompleted.classList.remove('active');
      if (viewInProcess) viewInProcess.style.display = 'block';
      if (viewCompleted) viewCompleted.style.display = 'none';
    };

    tabCompleted.onclick = () => {
      tabCompleted.classList.add('active');
      tabInProcess.classList.remove('active');
      if (viewCompleted) viewCompleted.style.display = 'block';
      if (viewInProcess) viewInProcess.style.display = 'none';
    };
  }
}

function renderPrintRequestCard(order, isActive = false) {
  const card = document.createElement('div');
  card.className = `print-req-card ${isActive ? 'card-active' : ''}`;
  card.id = `order-card-${order.orderId}`;

  const studentStatus = formatStudentStatus(order.status);
  const beacon = getStatusBeacon(order.status);
  const placedDate = new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  // 5-step progress pipeline
  const steps = ['REQUEST_RECEIVED','ACCEPTED','PRINTING','READY','COMPLETED'];
  const stUp = (order.status || '').toUpperCase();
  const stepIdx = stUp === 'CANCELLED' ? -1 : steps.indexOf(stUp);
  const progressHTML = stUp === 'CANCELLED' ? '' : `
    <div class="track-progress-bar" style="margin:12px 0 14px;">
      ${steps.map((s, i) => {
        const done = i < stepIdx;
        const active = i === stepIdx;
        const names = ['Received','Accepted','Printing','Ready','Collected'];
        return `<div class="track-step ${done ? 'step-done' : ''} ${active ? 'step-active' : ''}">
          <div class="track-step-dot"></div>
          <div class="track-step-label">${names[i]}</div>
        </div>`;
      }).join('')}
    </div>`;

  // Item specs breakdown
  let itemsHTML = '';
  (order.items || []).forEach(item => {
    const isPurged = item.filePurged || !isActive;
    const purgeBadge = isPurged ? `<span class="tag-purged-shield" title="Binary data safely purged from database to reclaim storage">🔒 Purged</span>` : '';
    const specs = `${item.color === 'color' ? '🎨 Color' : '📄 B&W'} • ${item.sides === 'double' ? 'Double-sided' : 'Single-sided'} • ${item.pages || 1} pgs`;
    itemsHTML += `
      <div class="print-req-item-line">
        <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
          <span class="print-req-item-name" title="${item.originalName || 'Document'}">📄 ${item.originalName || 'Document'}</span>
          ${purgeBadge}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="print-req-item-specs">${specs}</span>
          <span style="font-weight:700; color:#1b6a38; font-size:12px;">₹${item.price || 0}</span>
        </div>
      </div>
    `;
  });

  const liveBadge = isActive ? `<span class="status-beacon ${beacon.cls}"></span>` : '';

  card.innerHTML = `
    <div>
      <div class="print-req-top">
        <div>
          <div class="print-req-id">
            ${liveBadge}
            <span>${order.orderId}</span>
          </div>
          <div class="print-req-date">📅 ${placedDate}</div>
        </div>
        <div style="text-align:right;">
          <div class="print-req-price">₹${order.total}</div>
          <span class="print-req-status-badge" style="${studentStatus.style}">${studentStatus.label}</span>
        </div>
      </div>

      <div style="font-size:12.5px; color:#4a5e50; margin:4px 0 8px;">${studentStatus.sub}</div>

      ${progressHTML}

      <div class="print-req-items">
        <div style="font-size:11px; font-weight:700; color:#6c8072; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Print Documents:</div>
        ${itemsHTML}
      </div>
    </div>

    <div class="print-req-footer">
      <div style="font-size:12px; color:#6c8072;">
        ${isActive && stUp === 'READY' ? '<strong style="color:#059669;">📍 Ready for pickup at Xerox counter</strong>' : (isActive ? '⏱ Live processing in Xerox queue' : '✅ Finished &amp; collected')}
      </div>
      <button type="button" class="btn-card-track" onclick="selectOrderToTrack('${order.orderId}')">
        ${isActive ? '🔍 Track Live Progress →' : '📋 View Details →'}
      </button>
    </div>
  `;

  return card;
}

window.selectOrderToTrack = function(orderId) {
  const trackInput = document.getElementById('track-input');
  if (trackInput) trackInput.value = orderId;
  trackOrder(orderId);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

async function loadMyOrders() {
  setupOrderTrackingTabs();

  const inProcessLoading = document.getElementById('in-process-loading');
  const inProcessList = document.getElementById('in-process-orders-list');
  const inProcessEmpty = document.getElementById('in-process-empty');
  const inProcessBadge = document.getElementById('badge-in-process-count');

  const completedLoading = document.getElementById('completed-loading');
  const completedList = document.getElementById('completed-orders-list');
  const completedEmpty = document.getElementById('completed-empty');
  const completedBadge = document.getElementById('badge-completed-count');

  if (inProcessLoading) inProcessLoading.style.display = 'block';
  if (completedLoading) completedLoading.style.display = 'block';
  if (inProcessList) inProcessList.innerHTML = '';
  if (completedList) completedList.innerHTML = '';
  if (inProcessEmpty) inProcessEmpty.style.display = 'none';
  if (completedEmpty) completedEmpty.style.display = 'none';

  try {
    const res = await fetch('/api/orders');
    if (!res.ok) throw new Error('Failed to fetch orders');
    const data = await res.json();
    const orders = data.orders || [];

    if (inProcessLoading) inProcessLoading.style.display = 'none';
    if (completedLoading) completedLoading.style.display = 'none';

    // Partition orders into In-Process vs Completed
    const activeStatuses = ['REQUEST_RECEIVED', 'ACCEPTED', 'PRINTING', 'READY', 'NEW'];
    const inProcessOrders = orders.filter(o => {
      const st = (o.status || '').toUpperCase();
      return activeStatuses.includes(st);
    });

    const completedOrders = orders.filter(o => {
      const st = (o.status || '').toUpperCase();
      return !activeStatuses.includes(st);
    });

    // Update badge counts
    if (inProcessBadge) inProcessBadge.textContent = inProcessOrders.length;
    if (completedBadge) completedBadge.textContent = completedOrders.length;

    // Render In-Process Cards
    if (inProcessOrders.length === 0) {
      if (inProcessEmpty) inProcessEmpty.style.display = 'block';
    } else {
      inProcessOrders.forEach(o => {
        if (inProcessList) inProcessList.appendChild(renderPrintRequestCard(o, true));
      });
    }

    // Render Completed Cards
    if (completedOrders.length === 0) {
      if (completedEmpty) completedEmpty.style.display = 'block';
    } else {
      completedOrders.forEach(o => {
        if (completedList) completedList.appendChild(renderPrintRequestCard(o, false));
      });
    }

  } catch (err) {
    if (inProcessLoading) inProcessLoading.style.display = 'none';
    if (completedLoading) completedLoading.style.display = 'none';
    if (inProcessEmpty) {
      inProcessEmpty.querySelector('h4').textContent = 'Could not load orders';
      inProcessEmpty.querySelector('p').textContent = 'Please check your connection and try again.';
      inProcessEmpty.style.display = 'block';
    }
  }
}

document.getElementById('btn-refresh-my-orders')?.addEventListener('click', () => {
  loadMyOrders();
});
setupOrderTrackingTabs();

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

// Academic Year & Branch Wizard State (Divided by Admin Categories)
let selectedYear = null;
let selectedBranch = null;
let activeClassFilter = null; // { year: 'TE', branch: 'IT' }
let currentCategoryFilter = 'all';

function setYearSelection(year) {
  selectedYear = year;
  const yearCards = document.querySelectorAll('#wizard-year-cards .wizard-select-card');
  yearCards.forEach(c => {
    c.classList.toggle('selected', c.dataset.year === year);
  });

  const yearBadge = document.getElementById('wizard-year-chosen-badge');
  if (yearBadge) {
    yearBadge.textContent = `Selected: ${year}`;
    yearBadge.style.display = 'inline-block';
  }

  const ind1 = document.getElementById('step-ind-1');
  const ind2 = document.getElementById('step-ind-2');
  if (ind1) ind1.classList.add('completed');
  if (ind2) ind2.classList.add('active');

  updateWizardSummary();

  // Scroll smoothly down to branch panel
  const branchPanel = document.getElementById('wizard-panel-branch');
  if (branchPanel) {
    branchPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function setBranchSelection(branch) {
  selectedBranch = branch;
  const branchCards = document.querySelectorAll('#wizard-branch-cards .wizard-select-card');
  branchCards.forEach(c => {
    c.classList.toggle('selected', c.dataset.branch === branch);
  });

  const branchBadge = document.getElementById('wizard-branch-chosen-badge');
  if (branchBadge) {
    branchBadge.textContent = `Selected: ${branch}`;
    branchBadge.style.display = 'inline-block';
  }

  const ind2 = document.getElementById('step-ind-2');
  if (ind2) ind2.classList.add('completed');

  updateWizardSummary();

  // Automatically proceed if year is already selected
  if (selectedYear && selectedBranch) {
    setTimeout(() => {
      applyClassSelection(selectedYear, selectedBranch);
    }, 250);
  }
}

function updateWizardSummary() {
  const summaryEl = document.getElementById('wizard-active-summary');
  const submitBtn = document.getElementById('wizard-btn-submit');

  const yText = selectedYear || 'Select Year';
  const bText = selectedBranch || 'Select Branch';

  if (summaryEl) {
    summaryEl.textContent = `${yText} • ${bText}`;
  }

  const isComplete = Boolean(selectedYear && selectedBranch);
  if (submitBtn) {
    submitBtn.disabled = !isComplete;
    submitBtn.style.opacity = isComplete ? '1' : '0.6';
    submitBtn.style.cursor = isComplete ? 'pointer' : 'not-allowed';
  }
}

function initWizardUI() {
  // Year Card Clicks
  const yearCards = document.querySelectorAll('#wizard-year-cards .wizard-select-card');
  yearCards.forEach(c => {
    c.onclick = () => {
      setYearSelection(c.dataset.year);
    };
  });

  // Branch Card Clicks
  const branchCards = document.querySelectorAll('#wizard-branch-cards .wizard-select-card');
  branchCards.forEach(c => {
    c.onclick = () => {
      setBranchSelection(c.dataset.branch);
    };
  });

  // Wizard Confirmation Button
  const submitBtn = document.getElementById('wizard-btn-submit');
  if (submitBtn) {
    submitBtn.onclick = () => {
      if (selectedYear && selectedBranch) {
        applyClassSelection(selectedYear, selectedBranch);
      }
    };
  }

  // Restore pre-selected values if present
  if (activeClassFilter) {
    if (activeClassFilter.year) setYearSelection(activeClassFilter.year);
    if (activeClassFilter.branch) setBranchSelection(activeClassFilter.branch);
  } else {
    updateWizardSummary();
  }
}

function applyClassSelection(year, branch) {
  activeClassFilter = { year, branch };
  try {
    localStorage.setItem('xerox_student_class', JSON.stringify(activeClassFilter));
  } catch(e) {}

  const wizardView = document.getElementById('asgn-wizard-view');
  const contentView = document.getElementById('asgn-content-view');

  if (wizardView) wizardView.style.display = 'none';
  if (contentView) contentView.style.display = 'block';

  const yearPill = document.getElementById('asgn-active-year-pill');
  const branchPill = document.getElementById('asgn-active-branch-pill');

  if (yearPill) yearPill.textContent = year;
  if (branchPill) branchPill.textContent = branch;

  setupCategoryFilters(allAssignments);
  setupSubjectFilters(allAssignments);
  renderAssignmentsList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openClassSelectorWizard() {
  const wizardView = document.getElementById('asgn-wizard-view');
  const contentView = document.getElementById('asgn-content-view');

  if (contentView) contentView.style.display = 'none';
  if (wizardView) {
    wizardView.style.display = 'block';
    initWizardUI();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadAssignments() {
  const loadingEl = document.getElementById('asgn-loading');
  const emptyEl = document.getElementById('asgn-empty');
  if (loadingEl) loadingEl.style.display = 'block';
  if (emptyEl) emptyEl.style.display = 'none';

  // Read saved student class selection from storage
  if (!activeClassFilter) {
    const saved = localStorage.getItem('xerox_student_class');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.year && parsed.branch) {
          activeClassFilter = parsed;
          selectedYear = parsed.year;
          selectedBranch = parsed.branch;
        }
      } catch (e) {}
    }
  }

  const wizardView = document.getElementById('asgn-wizard-view');
  const contentView = document.getElementById('asgn-content-view');

  if (!activeClassFilter) {
    if (wizardView) wizardView.style.display = 'block';
    if (contentView) contentView.style.display = 'none';
    initWizardUI();
  } else {
    if (wizardView) wizardView.style.display = 'none';
    if (contentView) contentView.style.display = 'block';
    const yearPill = document.getElementById('asgn-active-year-pill');
    const branchPill = document.getElementById('asgn-active-branch-pill');
    if (yearPill) yearPill.textContent = activeClassFilter.year;
    if (branchPill) branchPill.textContent = activeClassFilter.branch;
  }

  try {
    const res = await fetch(`/api/assignments?_t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    if (!res.ok) throw new Error('Failed to load assignments');
    const data = await res.json();
    allAssignments = data.assignments || [];

    setupCategoryFilters(allAssignments);
    setupSubjectFilters(allAssignments);
    if (activeClassFilter) {
      renderAssignmentsList();
    }
  } catch (err) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const emptyTitle = emptyEl.querySelector('h3');
      const emptyDesc = emptyEl.querySelector('p');
      if (emptyTitle) emptyTitle.textContent = 'Could not load assignments';
      if (emptyDesc) emptyDesc.textContent = 'Please check your connection and try again.';
    }
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

function formatAsgnBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function matchesYearFilter(asgnYear, targetClass, chosenYear) {
  if (!chosenYear) return true;
  const y = String(asgnYear || '').toUpperCase().trim();
  const tc = String(targetClass || '').toUpperCase().trim();
  const cy = String(chosenYear).toUpperCase().trim();
  if (y === 'ALL' || y === 'ALL YEARS' || tc === 'ALL CLASSES' || tc === 'ALL' || !tc) return true;
  if (y === cy) return true;
  if (tc.startsWith(cy) || tc.includes(cy)) return true;
  return false;
}

function matchesBranchFilter(asgnBranch, targetClass, chosenBranch) {
  if (!chosenBranch) return true;
  const b = String(asgnBranch || '').toUpperCase().trim();
  const tc = String(targetClass || '').toUpperCase().trim();
  const cb = String(chosenBranch).toUpperCase().trim();
  if (b === 'ALL' || b === 'ALL BRANCHES' || tc === 'ALL CLASSES' || tc === 'ALL' || !tc) return true;
  if (b === cb) return true;
  if (cb === 'CSE' && (b === 'COMP' || tc.includes('COMP') || tc.includes('CSE'))) return true;
  if (cb === 'IT' && (b === 'IT' || tc.includes('IT'))) return true;
  if (cb === 'MECH' && (b === 'MECH' || tc.includes('MECH'))) return true;
  if (cb === 'ARE' && (b === 'ARE' || tc.includes('ARE') || tc.includes('ROBOTICS'))) return true;
  if (cb === 'ENTC' && (b === 'ENTC' || tc.includes('ENTC') || tc.includes('ETC'))) return true;
  return false;
}

function setupCategoryFilters(assignments) {
  const container = document.getElementById('asgn-category-filters');
  if (!container) return;

  const relevant = assignments.filter(a => {
    if (!activeClassFilter) return true;
    return matchesYearFilter(a.year, a.targetClass, activeClassFilter.year) &&
           matchesBranchFilter(a.branch, a.targetClass, activeClassFilter.branch);
  });

  const categories = Array.from(new Set(relevant.map(a => (a.category && a.category.trim()) || 'Lab Experiments').filter(Boolean)));

  if (currentCategoryFilter !== 'all' && !categories.includes(currentCategoryFilter)) {
    currentCategoryFilter = 'all';
  }

  const isAllActive = currentCategoryFilter === 'all';
  container.innerHTML = `<button type="button" class="filter-pill ${isAllActive ? 'active' : ''}" data-cat="all">All Categories (${relevant.length})</button>`;

  categories.forEach(cat => {
    const count = relevant.filter(a => ((a.category && a.category.trim()) || 'Lab Experiments') === cat).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `filter-pill ${currentCategoryFilter === cat ? 'active' : ''}`;
    btn.dataset.cat = cat;
    btn.textContent = `📂 ${cat} (${count})`;
    btn.onclick = () => {
      container.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategoryFilter = cat;
      renderAssignmentsList();
    };
    container.appendChild(btn);
  });

  const allBtn = container.querySelector('[data-cat="all"]');
  if (allBtn) {
    allBtn.onclick = () => {
      container.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      allBtn.classList.add('active');
      currentCategoryFilter = 'all';
      renderAssignmentsList();
    };
  }
}

function setupSubjectFilters(assignments) {
  const container = document.getElementById('asgn-subject-filters');
  if (!container) return;

  // Only subjects matching the active class filter
  const relevantAssignments = assignments.filter(a => {
    if (!activeClassFilter) return true;
    return matchesYearFilter(a.year, a.targetClass, activeClassFilter.year) &&
           matchesBranchFilter(a.branch, a.targetClass, activeClassFilter.branch);
  });

  const subjects = Array.from(new Set(relevantAssignments.map(a => a.subject).filter(Boolean)));

  if (currentSubjectFilter !== 'all' && !subjects.includes(currentSubjectFilter)) {
    currentSubjectFilter = 'all';
  }

  const isAllActive = currentSubjectFilter === 'all';
  container.innerHTML = `<button type="button" class="filter-pill ${isAllActive ? 'active' : ''}" data-subject="all">All Subjects (${relevantAssignments.length})</button>`;

  subjects.forEach(subj => {
    const count = relevantAssignments.filter(a => a.subject === subj).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `filter-pill ${currentSubjectFilter === subj ? 'active' : ''}`;
    btn.dataset.subject = subj;
    btn.textContent = `${subj} (${count})`;
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
  const wrapperEl = document.getElementById('asgn-categories-wrapper');
  const emptyEl = document.getElementById('asgn-empty');
  const search = (document.getElementById('asgn-search-input')?.value || '').toLowerCase().trim();

  const chosenYear = activeClassFilter ? activeClassFilter.year : null;
  const chosenBranch = activeClassFilter ? activeClassFilter.branch : null;

  const filtered = allAssignments.filter(a => {
    const cat = (a.category && a.category.trim()) || 'Lab Experiments';
    const matchesCat = currentCategoryFilter === 'all' || cat === currentCategoryFilter;
    const matchesSubject = currentSubjectFilter === 'all' || a.subject === currentSubjectFilter;
    const matchesSearch = !search ||
      (a.subject && a.subject.toLowerCase().includes(search)) ||
      (a.title && a.title.toLowerCase().includes(search)) ||
      (a.category && a.category.toLowerCase().includes(search)) ||
      (a.attachmentName && a.attachmentName.toLowerCase().includes(search));
    const yearMatch = matchesYearFilter(a.year, a.targetClass, chosenYear);
    const branchMatch = matchesBranchFilter(a.branch, a.targetClass, chosenBranch);
    return matchesCat && matchesSubject && matchesSearch && yearMatch && branchMatch;
  });

  if (filtered.length === 0) {
    if (wrapperEl) {
      wrapperEl.style.display = 'none';
      wrapperEl.innerHTML = '';
    }
    if (emptyEl) {
      emptyEl.style.display = 'block';
      const emptyTitle = document.getElementById('asgn-empty-title') || emptyEl.querySelector('h3');
      const emptyDesc = document.getElementById('asgn-empty-desc') || emptyEl.querySelector('p');
      if (activeClassFilter) {
        if (emptyTitle) emptyTitle.textContent = `No Assignments for ${activeClassFilter.year} • ${activeClassFilter.branch}`;
        if (emptyDesc) emptyDesc.textContent = 'Staff have not uploaded assignments for this category or branch yet. Check back soon or change your selection.';
      } else {
        if (emptyTitle) emptyTitle.textContent = allAssignments.length === 0 ? 'No Assignments Yet' : 'No Matching Assignments';
        if (emptyDesc) emptyDesc.textContent = allAssignments.length === 0 ? 'Staff have not uploaded any subject assignments yet.' : 'Try changing your search keyword or category filter.';
      }
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (wrapperEl) {
    wrapperEl.style.display = 'block';
    wrapperEl.innerHTML = '';
  }

  // Group filtered assignments by Category as entered by Admin
  const groupedCategories = {};
  filtered.forEach(a => {
    const cat = (a.category && a.category.trim()) || 'Lab Experiments';
    if (!groupedCategories[cat]) groupedCategories[cat] = [];
    groupedCategories[cat].push(a);
  });

  Object.entries(groupedCategories).forEach(([categoryName, items]) => {
    const section = document.createElement('div');
    section.className = 'asgn-category-group';
    section.style.marginBottom = '32px';

    const header = document.createElement('div');
    header.className = 'asgn-category-section-header';
    header.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:22px;">📂</span>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:var(--ink);">${categoryName}</h2>
      </div>
      <span class="asgn-pill-badge" style="background:#f3e8ff; color:#6b21a8; border-color:#e9d5ff;">
        ${items.length} ${items.length === 1 ? 'assignment' : 'assignments'}
      </span>
    `;

    const grid = document.createElement('div');
    grid.className = 'asgn-grid';
    grid.style.marginTop = '14px';

    items.forEach(a => {
      const card = document.createElement('div');
      card.className = 'asgn-card';

      const hasAtt = a.hasAttachment;
      const rawAtts = (Array.isArray(a.attachments) && a.attachments.length > 0)
        ? a.attachments
        : (hasAtt ? [{ index: 0, originalName: a.attachmentName || 'demo_assignment', size: a.attachmentSize }] : []);
      const attCount = a.attachmentCount || rawAtts.length || (hasAtt ? 1 : 0);
      const isMulti = attCount > 1;

      // Clickable pills for each page / photo
      const filePillsHTML = (hasAtt && isMulti) ? `
        <div class="asgn-files-list">
          ${rawAtts.map((att, idx) => `
            <a href="/api/assignments/${a.id}/attachment?index=${idx}" class="asgn-file-pill" download="${escapeHtml(att.originalName || `page_${idx+1}`)}" title="Download ${escapeHtml(att.originalName || `Page ${idx+1}`)}">
              ⬇ ${/\.(png|jpg|jpeg|webp)$/i.test(att.originalName || '') ? '📷' : '📄'} Page ${idx + 1}
              <span style="opacity:0.75; font-size:10.5px;">(${formatAsgnBytes(att.size)})</span>
            </a>
          `).join('')}
        </div>
      ` : '';

      const downloadActionHTML = isMulti ? `
        <button type="button" class="action-btn download-btn" onclick="downloadAllAssignmentFiles('${a.id}')" style="background:#1e6b38; color:#ffffff; font-weight:600;">
          ⬇ Download All (${attCount} Photos)
        </button>
      ` : (hasAtt ? `
        <a href="/api/assignments/${a.id}/attachment" class="action-btn download-btn" download="${escapeHtml(a.attachmentName || 'demo_assignment')}">
          ⬇ Download
        </a>
      ` : '');

      const previewBtnHTML = hasAtt ? `
        <button type="button" class="action-btn preview-btn" onclick="openAttachmentPreview('${a.id}', '${encodeURIComponent(a.subject)}', '${encodeURIComponent(a.attachmentName || 'Demo Assignment')}')">
          👁 Preview Demo ${isMulti ? `(${attCount})` : ''}
        </button>
        ${downloadActionHTML}
        <button type="button" class="action-btn print-direct-btn" onclick="orderAssignmentPrint('${a.id}', '${encodeURIComponent(a.attachmentName || a.subject + '.pdf')}')">
          🖨 Print This Report
        </button>
      ` : '';

      const attChipHTML = hasAtt ? `
        <div class="asgn-att-chip">
          <span class="att-icon">${isMulti ? '📷' : '📎'}</span>
          <div class="att-info">
            <span class="att-name" title="${escapeHtml(a.attachmentName || 'Attachment')}">${isMulti ? `📷 ${attCount} Images / Files Attached` : escapeHtml(a.attachmentName || 'Attachment')}</span>
            <span class="att-size">${formatAsgnBytes(a.attachmentSize)}</span>
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
            ${a.batch && a.batch !== 'All Batches' ? `<span class="asgn-batch-tag" style="background:#fef3c7; color:#b45309; padding:2px 8px; border-radius:12px; font-size:11.5px; font-weight:600; border:1px solid #fde68a;">🏷️ ${a.batch}</span>` : ''}
            ${a.deadline ? `<span class="asgn-deadline-pill">📅 Due: ${a.deadline}</span>` : '<span class="asgn-deadline-pill" style="background:#f3f4f6;color:#6b7280;border-color:#e5e7eb;">No Deadline</span>'}
          </div>
          <h3 class="asgn-title">${a.title || a.subject}</h3>
          ${attChipHTML}
          ${filePillsHTML}
        </div>
        <div class="asgn-card-footer">
          <div class="asgn-actions">
            ${previewBtnHTML}
          </div>
        </div>
      `;
      grid.appendChild(card);
    });

    section.appendChild(header);
    section.appendChild(grid);
    wrapperEl.appendChild(section);
  });
}

// Search and filter listeners for assignments
document.getElementById('asgn-search-input')?.addEventListener('input', () => {
  renderAssignmentsList();
});
document.getElementById('btn-change-class')?.addEventListener('click', openClassSelectorWizard);
document.getElementById('btn-empty-change')?.addEventListener('click', openClassSelectorWizard);

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Multi-Attachment Student Preview State & Logic
let currentStudentPreviewAsgn = null;
let currentStudentPreviewIndex = 0;

window.openAttachmentPreview = function(asgnId, titleEncoded, fnameEncoded) {
  const asgn = allAssignments.find(a => a.id === asgnId) || {
    id: asgnId,
    subject: titleEncoded ? decodeURIComponent(titleEncoded) : 'Assignment',
    attachmentName: fnameEncoded ? decodeURIComponent(fnameEncoded) : 'file',
    attachments: [{ originalName: fnameEncoded ? decodeURIComponent(fnameEncoded) : 'file', index: 0 }]
  };

  currentStudentPreviewAsgn = asgn;
  currentStudentPreviewIndex = 0;

  const modal = document.getElementById('preview-modal');
  if (modal) modal.style.display = 'flex';

  renderStudentPreviewSlide();
};

function renderStudentPreviewSlide() {
  if (!currentStudentPreviewAsgn) return;
  const asgn = currentStudentPreviewAsgn;
  const rawAtts = (Array.isArray(asgn.attachments) && asgn.attachments.length > 0)
    ? asgn.attachments
    : (asgn.hasAttachment ? [{ index: 0, originalName: asgn.attachmentName || 'file', size: asgn.attachmentSize }] : []);

  const total = rawAtts.length || 1;
  if (currentStudentPreviewIndex >= total) currentStudentPreviewIndex = 0;
  if (currentStudentPreviewIndex < 0) currentStudentPreviewIndex = total - 1;
  const currentAtt = rawAtts[currentStudentPreviewIndex] || { originalName: 'file', size: 0, index: 0 };

  const titleEl = document.getElementById('modal-title');
  const subtitleEl = document.getElementById('modal-subtitle');
  const navEl = document.getElementById('student-preview-nav');
  const counterEl = document.getElementById('student-preview-counter');
  const thumbsEl = document.getElementById('student-preview-thumbs');
  const bodyEl = document.getElementById('modal-body');
  const dlLink = document.getElementById('modal-download-link');
  const dlAllBtn = document.getElementById('modal-download-all-btn');
  const printBtn = document.getElementById('modal-print-btn');
  const metaEl = document.getElementById('student-preview-meta');

  if (titleEl) titleEl.textContent = `${asgn.subject || 'Assignment'}`;
  if (subtitleEl) {
    subtitleEl.style.display = 'block';
    subtitleEl.textContent = `${asgn.category || 'Lab Experiments'} • ${asgn.targetClass || ''} • ${asgn.batch || ''}`;
  }

  if (navEl) navEl.style.display = total > 1 ? 'flex' : 'none';
  if (counterEl) counterEl.textContent = `${currentStudentPreviewIndex + 1} / ${total}`;

  if (metaEl) {
    metaEl.textContent = `📄 ${currentAtt.originalName} ${currentAtt.size ? `(${formatAsgnBytes(currentAtt.size)})` : ''}`;
  }

  if (dlLink) {
    dlLink.href = `/api/assignments/${asgn.id}/attachment?index=${currentStudentPreviewIndex}`;
    dlLink.setAttribute('download', currentAtt.originalName || 'file');
    dlLink.textContent = total > 1 ? `⬇ Download Current (Page ${currentStudentPreviewIndex + 1})` : '⬇ Download File';
  }

  if (dlAllBtn) {
    if (total > 1) {
      dlAllBtn.style.display = 'inline-flex';
      dlAllBtn.textContent = `⬇ Download All (${total} Photos)`;
      dlAllBtn.onclick = () => downloadAllAssignmentFiles(asgn.id);
    } else {
      dlAllBtn.style.display = 'none';
    }
  }

  if (printBtn) {
    printBtn.onclick = () => {
      const modal = document.getElementById('preview-modal');
      if (modal) modal.style.display = 'none';
      orderAssignmentPrint(asgn.id, encodeURIComponent(currentAtt.originalName || 'file'), currentStudentPreviewIndex);
    };
  }

  const isImg = /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(currentAtt.originalName || '');
  if (bodyEl) {
    if (isImg) {
      bodyEl.innerHTML = `<img src="/api/assignments/${asgn.id}/attachment?index=${currentStudentPreviewIndex}&inline=1" alt="Demo preview" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:8px;">`;
    } else {
      bodyEl.innerHTML = `<iframe src="/api/assignments/${asgn.id}/attachment?index=${currentStudentPreviewIndex}&inline=1" style="width:100%; height:65vh; border:none; border-radius:8px; background:#fff;"></iframe>`;
    }
  }

  if (thumbsEl) {
    if (total > 1) {
      thumbsEl.style.display = 'flex';
      thumbsEl.innerHTML = '';
      rawAtts.forEach((att, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'upload-btn secondary-btn';
        btn.style.padding = '4px 10px';
        btn.style.fontSize = '11.5px';
        if (idx === currentStudentPreviewIndex) {
          btn.style.background = '#2d8f4e';
          btn.style.color = '#fff';
          btn.style.borderColor = '#2d8f4e';
        }
        btn.innerHTML = `${/\.(png|jpg|jpeg|webp)$/i.test(att.originalName) ? '🖼️' : '📄'} Page ${idx + 1}`;
        btn.onclick = () => {
          currentStudentPreviewIndex = idx;
          renderStudentPreviewSlide();
        };
        thumbsEl.appendChild(btn);
      });
    } else {
      thumbsEl.style.display = 'none';
    }
  }
}

document.getElementById('student-preview-prev')?.addEventListener('click', () => {
  if (!currentStudentPreviewAsgn) return;
  const count = (currentStudentPreviewAsgn.attachments && currentStudentPreviewAsgn.attachments.length) || 1;
  currentStudentPreviewIndex = (currentStudentPreviewIndex - 1 + count) % count;
  renderStudentPreviewSlide();
});

document.getElementById('student-preview-next')?.addEventListener('click', () => {
  if (!currentStudentPreviewAsgn) return;
  const count = (currentStudentPreviewAsgn.attachments && currentStudentPreviewAsgn.attachments.length) || 1;
  currentStudentPreviewIndex = (currentStudentPreviewIndex + 1) % count;
  renderStudentPreviewSlide();
});

// Multi-File Bulk Download Handler for Students
window.downloadAllAssignmentFiles = async function(asgnId) {
  const asgn = allAssignments.find(a => a.id === asgnId) || (currentStudentPreviewAsgn && currentStudentPreviewAsgn.id === asgnId ? currentStudentPreviewAsgn : null);
  if (!asgn) return;

  const rawAtts = (Array.isArray(asgn.attachments) && asgn.attachments.length > 0)
    ? asgn.attachments
    : (asgn.hasAttachment ? [{ index: 0, originalName: asgn.attachmentName || 'assignment_file' }] : []);

  if (rawAtts.length === 0) {
    alert('No files found to download.');
    return;
  }

  for (let i = 0; i < rawAtts.length; i++) {
    const att = rawAtts[i];
    const link = document.createElement('a');
    link.href = `/api/assignments/${asgn.id}/attachment?index=${i}`;
    link.setAttribute('download', att.originalName || `page_${i + 1}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (i < rawAtts.length - 1) {
      await new Promise(r => setTimeout(r, 380));
    }
  }
};

// 1-Click Send Demo Assignment to Print Centre
window.orderAssignmentPrint = async function(asgnId, fnameEncoded, index = 0) {
  const fname = decodeURIComponent(fnameEncoded);
  try {
    const res = await fetch(`/api/assignments/${asgnId}/attachment?index=${index}`);
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
