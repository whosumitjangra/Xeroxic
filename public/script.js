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
    return data;
  } catch (err) {
    window.location.href = 'login.html';
    return null;
  }
}
checkAuth();

// ---------- Page navigation (Print Centre card, Back button) ----------
document.querySelectorAll('[data-target]').forEach(el => {
  el.addEventListener('click', () => {
    const targetId = el.getAttribute('data-target');
    showPage(targetId);
  });
});

document.querySelectorAll('[data-alert]').forEach(el => {
  el.addEventListener('click', () => {
    alert(el.getAttribute('data-alert'));
  });
});

function showPage(id){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
  if (id === 'printcentre') loadFiles();
  if (id === 'printoptions') loadOrderItems();
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

  const formData = new FormData();
  for (const f of fileListToUpload) {
    formData.append('files', f);
  }

  uploadStatus.textContent = 'Uploading...';
  uploadTrigger.disabled = true;

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
    uploadStatus.textContent = 'Could not reach the server.';
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
  if (!files || files.length === 0) {
    dzText.textContent = 'Drag and drop your files here';
    return;
  }
  dzText.textContent = files.length + ' file(s) uploaded';

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

const PRICE_TABLE = {
  'bw-single': 2,
  'bw-double': 3,
  'color-single': 5,
  'color-double': 8
};

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

document.getElementById('submit-order-btn')?.addEventListener('click', () => {
  const errorEl = document.getElementById('order-error');
  errorEl.textContent = '';
  if (orderDraft.length === 0) {
    errorEl.textContent = 'Please upload at least one file before proceeding.';
    return;
  }
  const total = orderDraft.reduce((sum, i) => sum + i.price, 0);
  document.getElementById('payment-total').textContent = '₹' + total;
  document.getElementById('pay-btn-amount').textContent = '₹' + total;
  showPage('payment');
});

// ---------- Payment (demo only — no real transaction) ----------
document.getElementById('pay-btn')?.addEventListener('click', async () => {
  const payBtn = document.getElementById('pay-btn');
  payBtn.disabled = true;
  payBtn.textContent = 'Processing...';

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: orderDraft })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Payment failed. Please try again.');
      payBtn.disabled = false;
      payBtn.textContent = 'Pay ' + document.getElementById('pay-btn-amount').textContent;
      return;
    }

    renderConfirmation(data.orderId, data.total, orderDraft);
    showPage('confirmation');
  } catch (err) {
    alert('Could not reach the server.');
  } finally {
    payBtn.disabled = false;
    payBtn.textContent = 'Pay ' + document.getElementById('pay-btn-amount').textContent;
  }
});

function renderConfirmation(orderId, total, items) {
  document.getElementById('confirm-token').textContent = orderId;
  document.getElementById('confirm-total').textContent = '₹' + total;

  const itemsEl = document.getElementById('confirm-items');
  itemsEl.innerHTML = '';
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

async function trackOrder(orderId) {
  const errorEl = document.getElementById('track-error');
  const resultEl = document.getElementById('track-result');
  errorEl.textContent = '';
  resultEl.innerHTML = 'Looking up order...';

  try {
    const res = await fetch('/api/orders/' + encodeURIComponent(orderId));
    const data = await res.json();

    if (!res.ok) {
      resultEl.innerHTML = '';
      errorEl.textContent = data.error || 'Order not found.';
      return;
    }

    let itemsHTML = '';
    data.items.forEach(i => {
      itemsHTML += `<div class="confirm-line"><span>${i.originalName} (${i.pages}p, ${i.sides}, ${i.color})</span><span>₹${i.price}</span></div>`;
    });

    resultEl.innerHTML = `
      <div class="status-badge">${data.status}</div>
      <p class="track-order-id">${data.orderId}</p>
      <p class="fsize">Placed on ${new Date(data.createdAt).toLocaleString()}</p>
      <div style="margin-top:14px;">${itemsHTML}</div>
      <div class="price-summary" style="margin-top:14px;">
        <span>Total</span><span>₹${data.total}</span>
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = '';
    errorEl.textContent = 'Could not reach the server.';
  }
}

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
