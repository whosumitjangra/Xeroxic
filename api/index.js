// ===================================================================
// Xerox Centre — Vercel Serverless Function & API Router
// ===================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  hashPassword,
  makeSalt,
  createSessionToken,
  getSessionFromReq
} = require('../lib/auth');
const {
  getUsers,
  saveUsers,
  getFiles,
  saveFiles,
  getOrders,
  saveOrders,
  updateOrderStatus,
  normalizeRole,
  getPrintRequests,
  savePrintRequests,
  createPrintRequest,
  updatePrintRequestStatus,
  getAssignments,
  saveAssignments,
  createAssignment,
  deleteAssignment,
  getNotifications,
  saveNotifications,
  createNotification,
  acknowledgeNotification,
  acknowledgeAllNotifications,
  getUnreadNotifications,
  getPricing,
  savePricing,
  getStaffUsers,
  createAdminUser,
  toggleUserDisabled,
  resetUserPassword,
  saveUploadedFile,
  getUploadedFileBuffer,
  deleteUploadedFile,
  REPO_ROOT
} = require('../lib/storage');

const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

// Fallback pricing rules (₹ per page)
const PRICE_TABLE = {
  'bw-single': 2,
  'bw-double': 3,
  'color-single': 5,
  'color-double': 8
};

// Check if authenticated session role matches one of allowed roles
function checkRoleAccess(session, allowedRoles, res) {
  if (!session) {
    sendJSON(res, 401, { error: 'Authentication required. Please log in.' });
    return false;
  }
  const userRole = normalizeRole(session.role);
  const normalizedAllowed = allowedRoles.map(r => normalizeRole(r));
  if (!normalizedAllowed.includes(userRole)) {
    sendJSON(res, 403, {
      error: `Forbidden: Access restricted to ${allowedRoles.join('/')}. Current role: ${userRole}`
    });
    return false;
  }
  return true;
}

// Order status helper (supports 5-stage workflow: REQUEST_RECEIVED → ACCEPTED → PRINTING → READY → COMPLETED)
function computeOrderStatus(orderOrDate) {
  if (typeof orderOrDate === 'object' && orderOrDate && orderOrDate.status) {
    const s = String(orderOrDate.status);
    if (s === 'Order Received' || s === 'New' || s === 'REQUEST_RECEIVED') return 'REQUEST_RECEIVED';
    if (s === 'Accepted' || s === 'ACCEPTED') return 'ACCEPTED';
    if (s === 'Printing in Progress' || s === 'Printing' || s === 'PRINTING') return 'PRINTING';
    if (s === 'Ready for Pickup' || s === 'Ready for Collection' || s === 'READY') return 'READY';
    if (s === 'Completed' || s === 'Collected' || s === 'COMPLETED') return 'COMPLETED';
    if (s === 'Cancelled' || s === 'CANCELLED') return 'CANCELLED';
    return s;
  }
  const createdAt = typeof orderOrDate === 'object' && orderOrDate ? orderOrDate.createdAt : orderOrDate;
  const minutesElapsed = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (minutesElapsed < 1) return 'REQUEST_RECEIVED';
  if (minutesElapsed < 3) return 'ACCEPTED';
  if (minutesElapsed < 6) return 'PRINTING';
  if (minutesElapsed < 15) return 'READY';
  return 'COMPLETED';
}

// MIME dictionary
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8'
};

// Response helpers
function sendJSON(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length
    });
    res.end(data);
  });
}

// Body parsing helpers (handles both raw streams and pre-parsed bodies)
async function readRawBody(req) {
  if (req.body) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    if (typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 60 * 1024 * 1024; // 60MB hard cap
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('File too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSONBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = await readRawBody(req);
  if (!raw || raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf-8'));
  } catch (e) {
    return {};
  }
}

// Minimal multipart/form-data parser (no external dependencies)
async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!match) throw new Error('No boundary found in Content-Type');
  const boundary = '--' + (match[1] || match[2]).trim();
  const raw = await readRawBody(req);

  const boundaryBuf = Buffer.from(boundary);
  const parts = [];
  let start = raw.indexOf(boundaryBuf, 0);
  while (start !== -1) {
    const next = raw.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (next === -1) break;
    let chunk = raw.slice(start + boundaryBuf.length, next);
    if (chunk.slice(0, 2).toString() === '\r\n') chunk = chunk.slice(2);
    if (chunk.slice(-2).toString() === '\r\n') chunk = chunk.slice(0, -2);
    if (chunk.length > 0 && chunk.toString() !== '--') {
      parts.push(chunk);
    }
    start = next;
  }

  const fields = {};
  const files = [];

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString('utf-8');
    const body = part.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]*)"/);
    const fieldName = nameMatch ? nameMatch[1] : null;

    if (filenameMatch && filenameMatch[1] !== '') {
      files.push({
        fieldName,
        filename: filenameMatch[1],
        data: body
      });
    } else if (fieldName) {
      fields[fieldName] = body.toString('utf-8');
    }
  }

  return { fields, files };
}

// ===================================================================
// REQUEST HANDLER
// ===================================================================

async function handler(req, res) {
  const parsed = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(parsed.pathname || '');

  // Handle Vercel rewrites: /api/(.*) -> /api/index.js?__route=$1
  if (pathname === '/api' || pathname === '/api/index.js' || pathname === '/api/') {
    const routeParam = parsed.searchParams.get('__route');
    if (routeParam) {
      pathname = '/api/' + routeParam.split('?')[0];
    } else if (req.headers['x-matched-path']) {
      pathname = req.headers['x-matched-path'].split('?')[0];
    }
  }

  try {
    // ---------------- AUTH: SIGNUP ----------------
    if (pathname === '/api/signup' && req.method === 'POST') {
      const { name, email, password, role = 'STUDENT', adminPasscode } = await readJSONBody(req);
      if (!name || !email || !password) {
        return sendJSON(res, 400, { error: 'Name, email and password are required.' });
      }
      const targetRole = normalizeRole(role);
      if (targetRole === 'ADMIN' || targetRole === 'SUPER_ADMIN') {
        const expectedPasscode = process.env.ADMIN_PASSCODE || 'AITXEROX2026';
        if (adminPasscode !== expectedPasscode) {
          return sendJSON(res, 403, { error: 'Invalid Admin Passcode. Contact Xerox in-charge.' });
        }
      }
      const users = await getUsers();
      if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return sendJSON(res, 409, { error: 'An account with this email already exists.' });
      }
      const salt = makeSalt();
      const passwordHash = hashPassword(password, salt);
      const newUser = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        email,
        role: targetRole,
        salt,
        passwordHash,
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      await saveUsers(users);

      const token = createSessionToken(newUser);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
      return sendJSON(res, 200, {
        success: true,
        name: newUser.name,
        email: newUser.email,
        role: targetRole,
        redirect: targetRole === 'SUPER_ADMIN' ? 'super-admin.html' : (targetRole === 'ADMIN' ? 'admin.html' : 'index.html')
      });
    }

    // ---------------- AUTH: LOGIN ----------------
    if (pathname === '/api/login' && req.method === 'POST') {
      const { email, password, role } = await readJSONBody(req);
      if (!email || !password) {
        return sendJSON(res, 400, { error: 'Email and password are required.' });
      }
      const users = await getUsers();
      const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user) {
        return sendJSON(res, 401, { error: 'Invalid email or password.' });
      }
      const hash = hashPassword(password, user.salt);
      if (hash !== user.passwordHash) {
        return sendJSON(res, 401, { error: 'Invalid email or password.' });
      }

      // Check if account is disabled by Super Admin
      if (user.disabled) {
        return sendJSON(res, 403, { error: 'This account has been disabled by Super Admin.' });
      }

      const userRole = normalizeRole(user.role);
      if (role) {
        const requestedRole = normalizeRole(role);
        if (requestedRole === 'ADMIN' && userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
          return sendJSON(res, 403, { error: 'This account does not have Admin access. Please sign in as Student.' });
        }
        if (requestedRole === 'SUPER_ADMIN' && userRole !== 'SUPER_ADMIN') {
          return sendJSON(res, 403, { error: 'This account does not have Super Admin access.' });
        }
        if (requestedRole === 'STUDENT' && userRole !== 'STUDENT') {
          return sendJSON(res, 403, { error: 'This is an Admin / Staff account. Please sign in via the Admin Portal at /admin.' });
        }
      }

      const token = createSessionToken(user);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);

      let redirect = 'index.html';
      if (userRole === 'SUPER_ADMIN') {
        redirect = 'super-admin.html';
      } else if (userRole === 'ADMIN') {
        redirect = 'admin.html';
      }

      return sendJSON(res, 200, {
        success: true,
        name: user.name,
        email: user.email,
        role: userRole,
        redirect
      });
    }

    // ---------------- AUTH: LOGOUT ----------------
    if (pathname === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
      return sendJSON(res, 200, { success: true });
    }

    // ---------------- AUTH: CURRENT USER ----------------
    if (pathname === '/api/me' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      return sendJSON(res, 200, {
        name: session.name,
        email: session.email,
        role: normalizeRole(session.role)
      });
    }

    // ---------------- FILES: UPLOAD (STUDENTS ONLY) ----------------
    if (pathname === '/api/upload' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['STUDENT'], res)) return;

      try {
        const { files } = await parseMultipart(req);
        if (!files || !files.length) return sendJSON(res, 400, { error: 'No files received. Please select a valid document.' });

        const filesDb = await getFiles();
        const saved = [];

        for (const f of files) {
          const record = await saveUploadedFile(session.userId, f.filename, f.data);
          filesDb.push(record);
          // Exclude large dataBase64 from immediate client response
          const { dataBase64, ...cleanRecord } = record;
          saved.push(cleanRecord);
        }

        await saveFiles(filesDb);
        return sendJSON(res, 200, { success: true, files: saved });
      } catch (uploadErr) {
        console.error('Upload processing error:', uploadErr);
        return sendJSON(res, 400, { error: uploadErr.message || 'File upload failed. Please verify file format and size.' });
      }
    }

    // ---------------- FILES: LIST (STUDENTS ONLY) ----------------
    if (pathname === '/api/files' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['STUDENT'], res)) return;
      const filesDb = await getFiles();
      const mine = filesDb
        .filter(f => f.ownerId === session.userId)
        .map(({ dataBase64, ...rest }) => rest);
      return sendJSON(res, 200, { files: mine });
    }

    // ---------------- FILES: DELETE (STUDENTS ONLY) ----------------
    if (pathname.startsWith('/api/files/') && req.method === 'DELETE') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['STUDENT'], res)) return;
      const id = pathname.split('/').pop();
      const filesDb = await getFiles();
      const idx = filesDb.findIndex(f => f.id === id && f.ownerId === session.userId);
      if (idx === -1) return sendJSON(res, 404, { error: 'File not found.' });

      const record = filesDb[idx];
      await deleteUploadedFile(record);
      filesDb.splice(idx, 1);
      await saveFiles(filesDb);
      return sendJSON(res, 200, { success: true });
    }

    // ---------------- ORDERS: INITIATE (STUDENTS ONLY) ----------------
    if ((pathname === '/api/orders/initiate' || pathname === '/api/orders') && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['STUDENT'], res)) return;

      const { items, copies = 1, pageRange = 'all', paymentMethod = 'UPI', utr = '' } = await readJSONBody(req);
      if (!Array.isArray(items) || items.length === 0) {
        return sendJSON(res, 400, { error: 'No items in this order.' });
      }

      const numCopies = Math.max(1, parseInt(copies, 10) || 1);
      const pricing = await getPricing();
      let total = 0;
      const cleanItems = [];

      for (const item of items) {
        const itemCopies = Math.max(1, parseInt(item.copies, 10) || numCopies);
        const itemPageRange = item.pageRange || pageRange || 'all';
        const pages = parseInt(item.pages, 10);
        const sides = item.sides === 'double' ? 'double' : 'single';
        const color = item.color === 'color' ? 'color' : 'bw';
        if (!pages || pages < 1) {
          return sendJSON(res, 400, { error: `Invalid page count for ${item.originalName || 'a file'}.` });
        }
        const rate = (pricing && pricing[`${color}-${sides}`]) ? Number(pricing[`${color}-${sides}`]) : (PRICE_TABLE[`${color}-${sides}`] || 2);
        const linePrice = rate * pages * itemCopies;
        total += linePrice;
        cleanItems.push({
          fileId: item.fileId,
          originalName: item.originalName,
          pages,
          sides,
          color,
          copies: itemCopies,
          pageRange: itemPageRange,
          price: linePrice
        });
      }

      const orders = await getOrders();
      const orderId = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const order = {
        orderId,
        ownerId: session.userId,
        ownerName: session.name,
        ownerEmail: session.email,
        items: cleanItems,
        copies: numCopies,
        pageRange: pageRange || 'all',
        total,
        paymentMethod: paymentMethod || 'UPI',
        utr: utr || null,
        paymentStatus: 'PENDING_PAYMENT',
        status: 'REQUEST_RECEIVED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      orders.push(order);
      await saveOrders(orders);

      // Immediately queue persistent notification for admin
      try {
        await createNotification({
          orderId: order.orderId,
          studentName: session.name,
          studentEmail: session.email,
          amount: order.total,
          fileCount: cleanItems.length,
          message: `New Print Request #${order.orderId} from ${session.name}`
        });
      } catch (e) {}

      return sendJSON(res, 200, {
        success: true,
        orderId,
        amount: total,
        total,
        copies: numCopies,
        pageRange: order.pageRange,
        paymentMethod: order.paymentMethod,
        utr: order.utr,
        paymentStatus: 'PENDING_PAYMENT',
        status: 'REQUEST_RECEIVED',
        testMode: true
      });
    }

    // ---------------- PAYMENTS: VERIFY & CONFIRM (STUDENTS ONLY) ----------------
    if (pathname === '/api/payments/verify' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['STUDENT'], res)) return;

      const { orderId, paymentStatus, simulationStatus, utr } = await readJSONBody(req);
      if (!orderId) {
        return sendJSON(res, 400, { error: 'Order ID is required for payment verification.' });
      }

      const orders = await getOrders();
      const order = orders.find(o => o.orderId.toUpperCase() === orderId.trim().toUpperCase());
      if (!order) {
        return sendJSON(res, 404, { error: 'Order not found.' });
      }

      // Security check: Student can only verify their own order
      if (order.ownerId !== session.userId) {
        return sendJSON(res, 403, { error: 'Forbidden: You cannot verify payment for another student’s order.' });
      }

      const statusToProcess = (simulationStatus || paymentStatus || 'SUCCESS').toUpperCase();

      if (statusToProcess === 'SUCCESS' || statusToProcess === 'PAID') {
        order.paymentStatus = 'PAID';
        order.status = 'REQUEST_RECEIVED';
        if (utr) order.utr = utr;
        order.updatedAt = new Date().toISOString();
        await saveOrders(orders);

        // Create permanent PrintRequest in print_requests.json
        const printRequest = await createPrintRequest({
          orderId: order.orderId,
          studentId: session.userId,
          studentName: session.name,
          studentEmail: session.email,
          items: order.items,
          copies: order.copies || 1,
          pageRange: order.pageRange || 'all',
          amount: order.total,
          paymentStatus: 'PAID',
          requestStatus: 'REQUEST_RECEIVED'
        });

        return sendJSON(res, 200, {
          success: true,
          orderId: order.orderId,
          amount: order.total,
          total: order.total,
          paymentStatus: 'PAID',
          requestStatus: 'REQUEST_RECEIVED',
          printRequestId: printRequest.id
        });
      } else if (statusToProcess === 'CANCELLED') {
        order.paymentStatus = 'CANCELLED';
        order.updatedAt = new Date().toISOString();
        await saveOrders(orders);

        return sendJSON(res, 200, {
          success: false,
          orderId: order.orderId,
          paymentStatus: 'CANCELLED',
          message: 'Payment was cancelled by the student. Order is not submitted to Xerox print queue.'
        });
      } else {
        // FAILED or other error
        order.paymentStatus = 'FAILED';
        order.updatedAt = new Date().toISOString();
        await saveOrders(orders);

        return sendJSON(res, 400, {
          success: false,
          orderId: order.orderId,
          paymentStatus: 'FAILED',
          error: 'Payment transaction failed or was declined by the bank in test mode.'
        });
      }
    }

    // ---------------- ORDERS: LIST MY ORDERS (STUDENTS ONLY) ----------------
    if (pathname === '/api/orders' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['STUDENT'], res)) return;
      const orders = await getOrders();
      const mine = orders
        .filter(o => o.ownerId === session.userId)
        .map(o => ({
          orderId: o.orderId,
          total: o.total,
          copies: o.copies || 1,
          pageRange: o.pageRange || 'all',
          paymentStatus: o.paymentStatus || 'PENDING_PAYMENT',
          paymentMethod: o.paymentMethod || 'UPI',
          createdAt: o.createdAt,
          status: computeOrderStatus(o),
          items: o.items || []
        }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJSON(res, 200, { orders: mine });
    }

    // ---------------- PRICING: PUBLIC GET PRICING ----------------
    if (pathname === '/api/pricing' && req.method === 'GET') {
      const pricing = await getPricing();
      return sendJSON(res, 200, pricing || PRICE_TABLE);
    }

    // ---------------- ORDERS: TRACK / GET ONE (STUDENT OWNERSHIP CHECK) ----------------
    if (pathname.startsWith('/api/orders/') && !pathname.endsWith('/status') && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const orderId = decodeURIComponent(pathname.split('/').pop());
      const orders = await getOrders();
      const order = orders.find(o => o.orderId.toLowerCase() === orderId.toLowerCase());
      if (!order) return sendJSON(res, 404, { error: 'No order found with that ID.' });

      const userRole = normalizeRole(session.role);
      // Student security check: Student can only view their own order!
      if (userRole === 'STUDENT' && order.ownerId !== session.userId) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have access to view this order.' });
      }

      return sendJSON(res, 200, {
        orderId: order.orderId,
        studentId: order.ownerId,
        studentName: order.ownerName,
        studentEmail: order.ownerEmail,
        items: order.items,
        copies: order.copies || 1,
        pageRange: order.pageRange || 'all',
        total: order.total,
        amount: order.total,
        paymentStatus: order.paymentStatus || 'PAID',
        paymentMethod: order.paymentMethod || 'UPI',
        utr: order.utr || null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt || order.createdAt,
        status: computeOrderStatus(order)
      });
    }

    // ---------------- ADMIN: GET PRINT REQUESTS (NEW SECTION) ----------------
    if (pathname === '/api/admin/requests' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const requests = await getPrintRequests();
      const filesDb = await getFiles();

      const enriched = requests.map(r => {
        const items = (r.items || []).map(item => {
          const fileRecord = filesDb.find(f => f.id === item.fileId);
          return {
            ...item,
            storedName: fileRecord ? fileRecord.storedName : null,
            size: fileRecord ? fileRecord.size : null
          };
        });
        return {
          ...r,
          items,
          status: r.requestStatus || 'REQUEST_RECEIVED'
        };
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return sendJSON(res, 200, { success: true, requests: enriched });
    }

    // ---------------- ADMIN: UPDATE PRINT REQUEST STATUS ----------------
    if (pathname.startsWith('/api/admin/requests/') && pathname.endsWith('/status') && (req.method === 'PATCH' || req.method === 'POST')) {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const parts = pathname.split('/');
      const reqIdOrOrderId = decodeURIComponent(parts[parts.length - 2]);
      const { status } = await readJSONBody(req);
      const validStatuses = [
        'REQUEST_RECEIVED', 'ACCEPTED', 'PRINTING', 'READY', 'COMPLETED', 'CANCELLED',
        'New', 'Accepted', 'Printing', 'Ready for Collection', 'Collected'
      ];
      if (!status || !validStatuses.includes(status)) {
        return sendJSON(res, 400, { error: 'Invalid status. Must be one of: REQUEST_RECEIVED, ACCEPTED, PRINTING, READY, COMPLETED, CANCELLED' });
      }

      let normStatus = status;
      if (status === 'New') normStatus = 'REQUEST_RECEIVED';
      if (status === 'Accepted') normStatus = 'ACCEPTED';
      if (status === 'Printing') normStatus = 'PRINTING';
      if (status === 'Ready for Collection') normStatus = 'READY';
      if (status === 'Collected') normStatus = 'COMPLETED';

      const updatedReq = await updatePrintRequestStatus(reqIdOrOrderId, normStatus);
      // Sync corresponding order in orders.json so student tracking reflects stage immediately
      const orders = await getOrders();
      const order = orders.find(o => o.orderId === reqIdOrOrderId || (updatedReq && o.orderId === updatedReq.orderId));
      if (order) {
        order.status = normStatus;
        order.updatedAt = new Date().toISOString();
        await saveOrders(orders);
      }

      return sendJSON(res, 200, { success: true, request: updatedReq || { id: reqIdOrOrderId, requestStatus: normStatus } });
    }

    // ---------------- ADMIN: GET NOTIFICATIONS ----------------
    if (pathname === '/api/admin/notifications' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      // Self-healing check: Ensure any active REQUEST_RECEIVED/New order has an unread notification
      try {
        const orders = await getOrders();
        const existingNotifs = await getNotifications();
        const existingOrderIds = new Set(existingNotifs.map(n => n.orderId ? n.orderId.toUpperCase() : ''));

        for (const o of orders) {
          const st = String(o.status || '').toUpperCase();
          const paySt = String(o.paymentStatus || '').toUpperCase();
          if ((st === 'REQUEST_RECEIVED' || o.status === 'New' || o.status === 'Order Received') &&
              paySt !== 'CANCELLED' && paySt !== 'FAILED') {
            if (!existingOrderIds.has(o.orderId.toUpperCase())) {
              await createNotification({
                orderId: o.orderId,
                studentName: o.ownerName || 'Student',
                studentEmail: o.ownerEmail || 'N/A',
                amount: o.total || 0,
                fileCount: (o.items || []).length,
                message: `New Print Request #${o.orderId} from ${o.ownerName || 'Student'}`
              });
              existingOrderIds.add(o.orderId.toUpperCase());
            }
          }
        }
      } catch (e) {
        console.warn('Sync unnotified orders warning:', e.message);
      }

      const allNotifs = await getNotifications();
      const unread = allNotifs.filter(n => n.status === 'UNREAD');

      return sendJSON(res, 200, {
        success: true,
        notifications: allNotifs,
        unread,
        unreadCount: unread.length
      });
    }

    // ---------------- ADMIN: ACKNOWLEDGE NOTIFICATION BY ID ----------------
    if (pathname.startsWith('/api/admin/notifications/') && pathname.endsWith('/acknowledge') && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const rawId = pathname.replace('/api/admin/notifications/', '').replace('/acknowledge', '').trim();
      const id = decodeURIComponent(rawId);

      const acknowledged = await acknowledgeNotification(id);
      const unread = await getUnreadNotifications();
      return sendJSON(res, 200, {
        success: true,
        acknowledgedId: id,
        acknowledged,
        unreadCount: unread.length
      });
    }

    // ---------------- ADMIN: ACKNOWLEDGE NOTIFICATION BY ORDER ID ----------------
    if (pathname.startsWith('/api/admin/notifications/acknowledge-by-order/') && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const rawId = pathname.replace('/api/admin/notifications/acknowledge-by-order/', '').split('?')[0].trim();
      const orderId = decodeURIComponent(rawId);

      const acknowledged = await acknowledgeNotification(orderId);
      const unread = await getUnreadNotifications();
      return sendJSON(res, 200, {
        success: true,
        orderId,
        acknowledged,
        unreadCount: unread.length
      });
    }

    // ---------------- ADMIN: ACKNOWLEDGE ALL NOTIFICATIONS ----------------
    if (pathname === '/api/admin/notifications/acknowledge-all' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      await acknowledgeAllNotifications();
      return sendJSON(res, 200, { success: true, unreadCount: 0 });
    }

    // ---------------- ADMIN: GET ALL ORDERS / DOCUMENT REQUESTS ----------------
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const orders = await getOrders();
      const users = await getUsers();
      const filesDb = await getFiles();

      const userMap = new Map(users.map(u => [u.id, u]));

      const enriched = orders.map(o => {
        const owner = userMap.get(o.ownerId) || {};
        const items = (o.items || []).map(item => {
          const fileRecord = filesDb.find(f => f.id === item.fileId);
          return {
            ...item,
            storedName: fileRecord ? fileRecord.storedName : null,
            size: fileRecord ? fileRecord.size : null
          };
        });
        return {
          orderId: o.orderId,
          ownerId: o.ownerId,
          ownerName: o.ownerName || owner.name || 'Student',
          ownerEmail: owner.email || 'N/A',
          items,
          copies: o.copies || 1,
          pageRange: o.pageRange || 'all',
          total: o.total,
          paymentStatus: o.paymentStatus || 'PAID',
          createdAt: o.createdAt,
          status: computeOrderStatus(o),
          updatedAt: o.updatedAt || null
        };
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return sendJSON(res, 200, { success: true, orders: enriched });
    }

    // ---------------- ADMIN: UPDATE ORDER STATUS ----------------
    if (pathname.startsWith('/api/admin/orders/') && pathname.endsWith('/status') && (req.method === 'PATCH' || req.method === 'POST')) {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const parts = pathname.split('/');
      const orderId = decodeURIComponent(parts[parts.length - 2]);
      const { status } = await readJSONBody(req);
      const validStatuses = [
        'REQUEST_RECEIVED', 'ACCEPTED', 'PRINTING', 'READY', 'COMPLETED', 'CANCELLED',
        'New', 'Accepted', 'Printing', 'Ready for Collection', 'Collected',
        'Order Received', 'Printing in Progress', 'Ready for Pickup', 'Completed'
      ];
      if (!status || !validStatuses.includes(status)) {
        return sendJSON(res, 400, { error: `Invalid status. Must be one of: REQUEST_RECEIVED, ACCEPTED, PRINTING, READY, COMPLETED, CANCELLED` });
      }

      let normStatus = status;
      if (status === 'New' || status === 'Order Received') normStatus = 'REQUEST_RECEIVED';
      if (status === 'Accepted') normStatus = 'ACCEPTED';
      if (status === 'Printing' || status === 'Printing in Progress') normStatus = 'PRINTING';
      if (status === 'Ready for Collection' || status === 'Ready for Pickup') normStatus = 'READY';
      if (status === 'Collected' || status === 'Completed') normStatus = 'COMPLETED';

      const updated = await updateOrderStatus(orderId, normStatus);
      await updatePrintRequestStatus(orderId, normStatus);

      if (!updated) return sendJSON(res, 404, { error: 'Order not found.' });
      return sendJSON(res, 200, { success: true, orderId: updated.orderId, status: updated.status });
    }

    // ---------------- ADMIN: GET STATS ----------------
    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const orders = await getOrders();
      const printRequests = await getPrintRequests();
      let totalRevenue = 0;
      let newCount = 0;
      let acceptedCount = 0;
      let printingCount = 0;
      let readyCount = 0;
      let collectedCount = 0;

      for (const o of orders) {
        if (o.paymentStatus !== 'CANCELLED' && o.paymentStatus !== 'FAILED') {
          totalRevenue += (o.total || 0);
        }
        const st = computeOrderStatus(o);
        if (st === 'REQUEST_RECEIVED') newCount++;
        else if (st === 'ACCEPTED') acceptedCount++;
        else if (st === 'PRINTING') printingCount++;
        else if (st === 'READY') readyCount++;
        else if (st === 'COMPLETED') collectedCount++;
      }

      const activeRequests = printRequests.filter(r => r.requestStatus !== 'COMPLETED' && r.requestStatus !== 'CANCELLED');

      return sendJSON(res, 200, {
        totalOrders: orders.length,
        newCount,
        newRequestsCount: newCount,
        activeRequestsCount: activeRequests.length,
        acceptedCount,
        printingCount,
        readyCount,
        collectedCount,
        inProgressCount: newCount + acceptedCount + printingCount,
        totalRevenue
      });
    }

    // ===================================================================
    // SUPER ADMIN SPECIFIC ENDPOINTS
    // ===================================================================

    // ---------------- SUPER ADMIN: GET STAFF LIST ----------------
    if (pathname === '/api/superadmin/staff' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['SUPER_ADMIN'], res)) return;
      const staff = await getStaffUsers();
      return sendJSON(res, 200, { success: true, staff });
    }

    // ---------------- SUPER ADMIN: CREATE STAFF ACCOUNT ----------------
    if (pathname === '/api/superadmin/staff' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['SUPER_ADMIN'], res)) return;
      const { name, email, password, role = 'admin' } = await readJSONBody(req);
      if (!name || !email || !password) {
        return sendJSON(res, 400, { error: 'Name, email and password are required.' });
      }
      try {
        const newStaff = await createAdminUser({ name, email, password, role });
        return sendJSON(res, 201, { success: true, staff: newStaff });
      } catch (err) {
        return sendJSON(res, 400, { error: err.message });
      }
    }

    // ---------------- SUPER ADMIN: TOGGLE STAFF ACTIVE/DISABLED ----------------
    if (pathname.startsWith('/api/superadmin/staff/') && pathname.endsWith('/status') && (req.method === 'PATCH' || req.method === 'POST')) {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['SUPER_ADMIN'], res)) return;
      const parts = pathname.split('/');
      const staffId = decodeURIComponent(parts[parts.length - 2]);
      if (staffId === session.userId) {
        return sendJSON(res, 400, { error: 'Cannot disable your own Super Admin account.' });
      }
      const { disabled } = await readJSONBody(req);
      const updated = await toggleUserDisabled(staffId, Boolean(disabled));
      if (!updated) return sendJSON(res, 404, { error: 'Staff account not found.' });
      return sendJSON(res, 200, { success: true, staff: updated });
    }

    // ---------------- SUPER ADMIN: RESET STAFF PASSWORD ----------------
    if (pathname.startsWith('/api/superadmin/staff/') && pathname.endsWith('/reset-password') && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['SUPER_ADMIN'], res)) return;
      const parts = pathname.split('/');
      const staffId = decodeURIComponent(parts[parts.length - 2]);
      const { newPassword } = await readJSONBody(req);
      if (!newPassword || newPassword.length < 6) {
        return sendJSON(res, 400, { error: 'New password must be at least 6 characters long.' });
      }
      const updated = await resetUserPassword(staffId, newPassword);
      if (!updated) return sendJSON(res, 404, { error: 'Staff account not found.' });
      return sendJSON(res, 200, { success: true, message: 'Password reset successfully.' });
    }

    // ---------------- SUPER ADMIN: GET PRICING ----------------
    if (pathname === '/api/superadmin/pricing' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['SUPER_ADMIN'], res)) return;
      const pricing = await getPricing();
      return sendJSON(res, 200, { success: true, pricing });
    }

    // ---------------- SUPER ADMIN: UPDATE PRICING ----------------
    if (pathname === '/api/superadmin/pricing' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['SUPER_ADMIN'], res)) return;
      const body = await readJSONBody(req);
      const newPricing = {
        'bw-single': Number(body['bw-single']) || 2,
        'bw-double': Number(body['bw-double']) || 3,
        'color-single': Number(body['color-single']) || 5,
        'color-double': Number(body['color-double']) || 8
      };
      await savePricing(newPricing);
      return sendJSON(res, 200, { success: true, pricing: newPricing });
    }

    // ---------------- SUPER ADMIN: GET SYSTEM STATS ----------------
    if (pathname === '/api/superadmin/stats' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['SUPER_ADMIN'], res)) return;
      const orders = await getOrders();
      const staffList = await getStaffUsers();
      const users = await getUsers();
      let totalRevenue = 0;
      const statusCounts = {
        'REQUEST_RECEIVED': 0,
        'ACCEPTED': 0,
        'PRINTING': 0,
        'READY': 0,
        'COMPLETED': 0
      };

      for (const o of orders) {
        if (o.paymentStatus !== 'CANCELLED' && o.paymentStatus !== 'FAILED') {
          totalRevenue += (o.total || 0);
        }
        const st = computeOrderStatus(o);
        if (statusCounts[st] !== undefined) statusCounts[st]++;
      }

      return sendJSON(res, 200, {
        success: true,
        totalOrders: orders.length,
        totalRevenue,
        totalStaff: staffList.length,
        totalStudents: users.filter(u => normalizeRole(u.role) === 'STUDENT').length,
        statusCounts
      });
    }

    // ---------------- ASSIGNMENTS: LIST (STUDENTS & ADMIN) ----------------
    if (pathname === '/api/assignments' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });

      const assignments = await getAssignments();
      const sanitized = assignments.map(a => ({
        id: a.id,
        subject: a.subject,
        experimentNo: a.experimentNo,
        title: a.title,
        info: a.info,
        submissionGuidelines: a.submissionGuidelines,
        deadline: a.deadline,
        createdAt: a.createdAt,
        hasAttachment: !!a.attachment,
        attachmentName: a.attachment ? a.attachment.originalName : null,
        attachmentSize: a.attachment ? a.attachment.size : null
      }));

      return sendJSON(res, 200, { success: true, assignments: sanitized });
    }

    // ---------------- ASSIGNMENTS: CREATE (ADMIN & SUPER ADMIN) ----------------
    if (pathname === '/api/admin/assignments' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const body = await readJSONBody(req);
      const { subject, experimentNo, title, info, submissionGuidelines, deadline, attachment } = body;

      if (!subject || !title) {
        return sendJSON(res, 400, { error: 'Subject and title are required.' });
      }

      let cleanAttachment = null;
      if (attachment && attachment.dataBase64) {
        cleanAttachment = {
          originalName: attachment.originalName || 'demo_assignment.pdf',
          mimeType: attachment.mimeType || 'application/pdf',
          size: attachment.size || Buffer.byteLength(attachment.dataBase64, 'base64'),
          dataBase64: attachment.dataBase64
        };
      }

      const newAssignment = await createAssignment({
        subject,
        experimentNo: experimentNo || '',
        title,
        info: info || '',
        submissionGuidelines: submissionGuidelines || '',
        deadline: deadline || '',
        attachment: cleanAttachment
      });

      return sendJSON(res, 201, { success: true, assignment: newAssignment });
    }

    // ---------------- ASSIGNMENTS: DELETE (ADMIN & SUPER ADMIN) ----------------
    if (pathname.startsWith('/api/admin/assignments/') && req.method === 'DELETE') {
      const session = getSessionFromReq(req);
      if (!checkRoleAccess(session, ['ADMIN', 'SUPER_ADMIN'], res)) return;

      const rawId = pathname.replace('/api/admin/assignments/', '').split('/')[0].split('?')[0].trim();
      const id = decodeURIComponent(rawId);
      if (!id) {
        return sendJSON(res, 400, { error: 'Assignment ID is required.' });
      }

      const deleted = await deleteAssignment(id);
      if (!deleted) {
        return sendJSON(res, 404, { error: 'Assignment not found.' });
      }

      return sendJSON(res, 200, { success: true, id });
    }

    // ---------------- ASSIGNMENTS: DOWNLOAD / PREVIEW DEMO ATTACHMENT ----------------
    if (pathname.startsWith('/api/assignments/') && pathname.endsWith('/attachment') && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });

      const parts = pathname.split('/');
      const id = parts[3];
      const assignments = await getAssignments();
      const assignment = assignments.find(a => a.id === id);

      if (!assignment || !assignment.attachment || !assignment.attachment.dataBase64) {
        return sendJSON(res, 404, { error: 'No demo attachment found for this assignment.' });
      }

      const att = assignment.attachment;
      const fileBuffer = Buffer.from(att.dataBase64, 'base64');
      const ext = path.extname(att.originalName).toLowerCase();
      const contentType = att.mimeType || MIME[ext] || 'application/octet-stream';
      const wantsInline = parsed.searchParams.get('inline') === '1' || parsed.searchParams.get('inline') === 'true';

      if (!wantsInline) {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.originalName)}"`);
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.originalName)}"`);
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length
      });
      return res.end(fileBuffer);
    }

    // ---------------- FILES: DOWNLOAD / PREVIEW ----------------
    if (pathname.startsWith('/api/download/') && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const id = pathname.split('/').pop();
      const filesDb = await getFiles();
      const record = filesDb.find(f => f.id === id);
      if (!record) return sendJSON(res, 404, { error: 'File not found.' });

      // Permission check: owner, admin, or superadmin can download/preview
      const isOwner = record.ownerId === session.userId;
      const userRole = normalizeRole(session.role);
      const isStaff = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
      if (!isOwner && !isStaff) {
        return sendJSON(res, 403, { error: 'Forbidden: You do not have permission to access this file.' });
      }

      const fileBuffer = await getUploadedFileBuffer(record);
      if (!fileBuffer) return sendJSON(res, 404, { error: 'File data unavailable.' });

      const ext = path.extname(record.originalName).toLowerCase();
      const isPreviewable = ['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext);
      const wantsInline = parsed.searchParams.get('inline') === '1' || parsed.searchParams.get('inline') === 'true';

      if (!(isPreviewable && wantsInline)) {
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(record.originalName)}"`);
      }
      const contentType = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length
      });
      return res.end(fileBuffer);
    }

    // ---------------- ROUTE SHORTCUTS FOR CLEAN URLS ----------------
    if (pathname === '/admin' || pathname === '/admin/') {
      return sendFile(res, path.join(PUBLIC_DIR, 'admin-login.html'), MIME['.html']);
    }
    if (pathname === '/admin/dashboard' || pathname === '/admin/dashboard/') {
      return sendFile(res, path.join(PUBLIC_DIR, 'admin.html'), MIME['.html']);
    }
    if (pathname === '/super-admin' || pathname === '/super-admin/') {
      return sendFile(res, path.join(PUBLIC_DIR, 'super-admin.html'), MIME['.html']);
    }

    // ---------------- STATIC FILES (Fallback for local dev & direct invocation) ----------------
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(PUBLIC_DIR, filePath);

    // Security check: prevent path traversal outside PUBLIC_DIR
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }

    // Fallback: If asset requested with subpath (e.g. /admin/style.css, /super-admin/style.css), check root of PUBLIC_DIR
    if (!fs.existsSync(filePath) && (pathname.startsWith('/admin/') || pathname.startsWith('/super-admin/'))) {
      const assetName = path.basename(pathname);
      const rootAssetPath = path.join(PUBLIC_DIR, assetName);
      if (fs.existsSync(rootAssetPath) && fs.statSync(rootAssetPath).isFile()) {
        filePath = rootAssetPath;
      }
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      return sendFile(res, filePath, MIME[ext] || 'application/octet-stream');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');

  } catch (err) {
    console.error('Server error:', err);
    sendJSON(res, 500, { error: 'Server error: ' + err.message });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false
  }
};
