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
  getAssignments,
  saveAssignments,
  createAssignment,
  deleteAssignment,
  saveUploadedFile,
  getUploadedFileBuffer,
  deleteUploadedFile,
  REPO_ROOT
} = require('../lib/storage');

const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

// Pricing rules (₹ per page)
const PRICE_TABLE = {
  'bw-single': 2,
  'bw-double': 3,
  'color-single': 5,
  'color-double': 8
};

// Order status helper (supports manual admin status or fallback to elapsed time)
function computeOrderStatus(orderOrDate) {
  if (typeof orderOrDate === 'object' && orderOrDate && orderOrDate.status) {
    return orderOrDate.status;
  }
  const createdAt = typeof orderOrDate === 'object' && orderOrDate ? orderOrDate.createdAt : orderOrDate;
  const minutesElapsed = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (minutesElapsed < 1) return 'Order Received';
  if (minutesElapsed < 3) return 'Printing in Progress';
  if (minutesElapsed < 6) return 'Ready for Pickup';
  return 'Completed';
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
    'Content-Length': Buffer.byteLength(body)
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
      const { name, email, password, role = 'user', adminPasscode } = await readJSONBody(req);
      if (!name || !email || !password) {
        return sendJSON(res, 400, { error: 'Name, email and password are required.' });
      }
      if (role === 'admin') {
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
        role: role === 'admin' ? 'admin' : 'user',
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
        role: newUser.role,
        redirect: newUser.role === 'admin' ? 'admin.html' : 'index.html'
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
      const userRole = user.role || 'user';
      if (role === 'admin' && userRole !== 'admin') {
        return sendJSON(res, 403, { error: 'This account does not have Admin access. Please sign in as Student.' });
      }
      const token = createSessionToken(user);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
      return sendJSON(res, 200, {
        success: true,
        name: user.name,
        email: user.email,
        role: userRole,
        redirect: userRole === 'admin' ? 'admin.html' : 'index.html'
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
      return sendJSON(res, 200, { name: session.name, email: session.email, role: session.role || 'user' });
    }

    // ---------------- FILES: UPLOAD ----------------
    if (pathname === '/api/upload' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'You must be logged in to upload files.' });

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

    // ---------------- FILES: LIST ----------------
    if (pathname === '/api/files' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const filesDb = await getFiles();
      const mine = filesDb
        .filter(f => f.ownerId === session.userId)
        .map(({ dataBase64, ...rest }) => rest);
      return sendJSON(res, 200, { files: mine });
    }

    // ---------------- FILES: DELETE ----------------
    if (pathname.startsWith('/api/files/') && req.method === 'DELETE') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
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

    // ---------------- ORDERS: CREATE ----------------
    if (pathname === '/api/orders' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'You must be logged in to place an order.' });

      const { items, paymentMethod = 'UPI', utr = '' } = await readJSONBody(req);
      if (!Array.isArray(items) || items.length === 0) {
        return sendJSON(res, 400, { error: 'No items in this order.' });
      }

      let total = 0;
      const cleanItems = [];
      for (const item of items) {
        const pages = parseInt(item.pages, 10);
        const sides = item.sides === 'double' ? 'double' : 'single';
        const color = item.color === 'color' ? 'color' : 'bw';
        if (!pages || pages < 1) {
          return sendJSON(res, 400, { error: `Invalid page count for ${item.originalName || 'a file'}.` });
        }
        const rate = PRICE_TABLE[`${color}-${sides}`] || 2;
        const linePrice = rate * pages;
        total += linePrice;
        cleanItems.push({
          fileId: item.fileId,
          originalName: item.originalName,
          pages,
          sides,
          color,
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
        total,
        paymentMethod: paymentMethod || 'UPI',
        utr: utr || null,
        createdAt: new Date().toISOString()
      };
      orders.push(order);
      await saveOrders(orders);

      return sendJSON(res, 200, { success: true, orderId, total, paymentMethod: order.paymentMethod });
    }

    // ---------------- ORDERS: LIST MY ORDERS ----------------
    if (pathname === '/api/orders' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const orders = await getOrders();
      const mine = orders
        .filter(o => o.ownerId === session.userId)
        .map(o => ({
          orderId: o.orderId,
          total: o.total,
          paymentMethod: o.paymentMethod || 'UPI',
          createdAt: o.createdAt,
          status: computeOrderStatus(o)
        }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJSON(res, 200, { orders: mine });
    }

    // ---------------- ORDERS: TRACK / GET ONE ----------------
    if (pathname.startsWith('/api/orders/') && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJSON(res, 401, { error: 'Not logged in.' });
      const orderId = decodeURIComponent(pathname.split('/').pop());
      const orders = await getOrders();
      const order = orders.find(o => o.orderId.toLowerCase() === orderId.toLowerCase());
      if (!order) return sendJSON(res, 404, { error: 'No order found with that ID.' });
      return sendJSON(res, 200, {
        orderId: order.orderId,
        items: order.items,
        total: order.total,
        paymentMethod: order.paymentMethod || 'UPI',
        utr: order.utr || null,
        createdAt: order.createdAt,
        status: computeOrderStatus(order)
      });
    }

    // ---------------- ADMIN: GET ALL ORDERS / DOCUMENT REQUESTS ----------------
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'admin') {
        return sendJSON(res, 403, { error: 'Forbidden: Admin access required.' });
      }
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
          total: o.total,
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
      if (!session || session.role !== 'admin') {
        return sendJSON(res, 403, { error: 'Forbidden: Admin access required.' });
      }
      const parts = pathname.split('/');
      const orderId = decodeURIComponent(parts[parts.length - 2]);
      const { status } = await readJSONBody(req);
      const validStatuses = ['Order Received', 'Printing in Progress', 'Ready for Pickup', 'Completed'];
      if (!status || !validStatuses.includes(status)) {
        return sendJSON(res, 400, { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }
      const updated = await updateOrderStatus(orderId, status);
      if (!updated) return sendJSON(res, 404, { error: 'Order not found.' });
      return sendJSON(res, 200, { success: true, orderId: updated.orderId, status: updated.status });
    }

    // ---------------- ADMIN: GET STATS ----------------
    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'admin') {
        return sendJSON(res, 403, { error: 'Forbidden: Admin access required.' });
      }
      const orders = await getOrders();
      let totalRevenue = 0;
      let inProgressCount = 0;
      let readyCount = 0;
      let completedCount = 0;

      for (const o of orders) {
        totalRevenue += (o.total || 0);
        const st = computeOrderStatus(o);
        if (st === 'Printing in Progress' || st === 'Order Received') inProgressCount++;
        else if (st === 'Ready for Pickup') readyCount++;
        else if (st === 'Completed') completedCount++;
      }

      return sendJSON(res, 200, {
        totalOrders: orders.length,
        inProgressCount,
        readyCount,
        completedCount,
        totalRevenue
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

    // ---------------- ASSIGNMENTS: CREATE (ADMIN ONLY) ----------------
    if (pathname === '/api/admin/assignments' && req.method === 'POST') {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'admin') {
        return sendJSON(res, 403, { error: 'Forbidden: Admin access required.' });
      }

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

    // ---------------- ASSIGNMENTS: DELETE (ADMIN ONLY) ----------------
    if (pathname.startsWith('/api/admin/assignments/') && req.method === 'DELETE') {
      const session = getSessionFromReq(req);
      if (!session || session.role !== 'admin') {
        return sendJSON(res, 403, { error: 'Forbidden: Admin access required.' });
      }

      const id = pathname.split('/').pop();
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
      // /api/assignments/:id/attachment -> parts: ['', 'api', 'assignments', id, 'attachment']
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

      // Permission check: owner or admin can download/preview
      const isOwner = record.ownerId === session.userId;
      const isAdmin = session.role === 'admin';
      if (!isOwner && !isAdmin) {
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

    // ---------------- STATIC FILES (Fallback for local dev & direct invocation) ----------------
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(PUBLIC_DIR, filePath);

    // Security check: prevent path traversal outside PUBLIC_DIR
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
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
