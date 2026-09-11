// ===================================================================
// Xerox Centre — Storage Abstraction Layer
// Handles local disk, serverless /tmp fallback, and optional Redis KV
// ===================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve repository root relative to this file
const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLED_DATA_DIR = path.join(REPO_ROOT, 'data');
const BUNDLED_UPLOADS_DIR = path.join(REPO_ROOT, 'uploads');

// Optional Upstash / Vercel KV REST configuration
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;

// Determine if we can write to the local data directory
function isWritable(dir) {
  try {
    if (process.env.VERCEL) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

// Storage paths (switches to /tmp automatically when running in serverless / read-only)
let storageConfig = null;

function getStorageConfig() {
  if (storageConfig) return storageConfig;

  const canWriteLocal = isWritable(BUNDLED_DATA_DIR);

  if (canWriteLocal) {
    storageConfig = {
      isServerlessTmp: false,
      dataDir: BUNDLED_DATA_DIR,
      uploadsDir: BUNDLED_UPLOADS_DIR,
      usersFile: path.join(BUNDLED_DATA_DIR, 'users.json'),
      filesFile: path.join(BUNDLED_DATA_DIR, 'files.json'),
      ordersFile: path.join(BUNDLED_DATA_DIR, 'orders.json'),
      printRequestsFile: path.join(BUNDLED_DATA_DIR, 'print_requests.json'),
      assignmentsFile: path.join(BUNDLED_DATA_DIR, 'assignments.json'),
      pricingFile: path.join(BUNDLED_DATA_DIR, 'pricing.json'),
      notificationsFile: path.join(BUNDLED_DATA_DIR, 'notifications.json'),
      deletedAssignmentsFile: path.join(BUNDLED_DATA_DIR, 'deleted_assignment_ids.json')
    };
  } else {
    // Serverless (e.g. Vercel) -> use /tmp
    const tmpDataDir = path.join('/tmp', 'xerox-data');
    const tmpUploadsDir = path.join('/tmp', 'xerox-uploads');

    if (!fs.existsSync(tmpDataDir)) fs.mkdirSync(tmpDataDir, { recursive: true });
    if (!fs.existsSync(tmpUploadsDir)) fs.mkdirSync(tmpUploadsDir, { recursive: true });

    const usersFile = path.join(tmpDataDir, 'users.json');
    const filesFile = path.join(tmpDataDir, 'files.json');
    const ordersFile = path.join(tmpDataDir, 'orders.json');
    const printRequestsFile = path.join(tmpDataDir, 'print_requests.json');
    const assignmentsFile = path.join(tmpDataDir, 'assignments.json');
    const pricingFile = path.join(tmpDataDir, 'pricing.json');
    const notificationsFile = path.join(tmpDataDir, 'notifications.json');
    const deletedAssignmentsFile = path.join(tmpDataDir, 'deleted_assignment_ids.json');

    // Seed data files into /tmp if not already present
    seedFile(path.join(BUNDLED_DATA_DIR, 'users.json'), usersFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'files.json'), filesFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'orders.json'), ordersFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'print_requests.json'), printRequestsFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'assignments.json'), assignmentsFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'pricing.json'), pricingFile, '{}');
    seedFile(path.join(BUNDLED_DATA_DIR, 'notifications.json'), notificationsFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'deleted_assignment_ids.json'), deletedAssignmentsFile, '[]');

    // Seed existing uploads if any
    if (fs.existsSync(BUNDLED_UPLOADS_DIR)) {
      try {
        fs.cpSync(BUNDLED_UPLOADS_DIR, tmpUploadsDir, { recursive: true, errorOnExist: false });
      } catch (e) {
        // Ignore copy errors if files already exist
      }
    }

    storageConfig = {
      isServerlessTmp: true,
      dataDir: tmpDataDir,
      uploadsDir: tmpUploadsDir,
      usersFile,
      filesFile,
      ordersFile,
      printRequestsFile,
      assignmentsFile,
      pricingFile,
      notificationsFile,
      deletedAssignmentsFile
    };
  }

  // Ensure folders exist
  if (!fs.existsSync(storageConfig.uploadsDir)) {
    try { fs.mkdirSync(storageConfig.uploadsDir, { recursive: true }); } catch (e) {}
  }
  if (!fs.existsSync(storageConfig.dataDir)) {
    try { fs.mkdirSync(storageConfig.dataDir, { recursive: true }); } catch (e) {}
  }

  return storageConfig;
}

function seedFile(src, dest, fallback) {
  if (!fs.existsSync(dest)) {
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      } else {
        fs.writeFileSync(dest, fallback, 'utf-8');
      }
    } catch (e) {
      console.warn(`Could not seed ${dest}:`, e.message);
    }
  }
}

// ---------- Optional Redis KV REST Helpers ----------
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL.replace(/\/$/, '')}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.result) return null;
    return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
  } catch (err) {
    console.warn(`KV get error for ${key}:`, err.message);
    return null;
  }
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    const res = await fetch(`${KV_URL.replace(/\/$/, '')}/set/${key}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(value)
    });
    return res.ok;
  } catch (err) {
    console.warn(`KV set error for ${key}:`, err.message);
    return false;
  }
}

// ---------- File Read/Write Helpers ----------
function readLocalJSON(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return defaultValue;
  }
}

function writeLocalJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing to ${filePath}:`, err.message);
  }

  // Dual-write to BUNDLED_DATA_DIR whenever writable to ensure persistent local dev & commit sync
  try {
    if (!process.env.VERCEL) {
      const filename = path.basename(filePath);
      const bundledPath = path.join(BUNDLED_DATA_DIR, filename);
      if (bundledPath !== filePath) {
        fs.writeFileSync(bundledPath, JSON.stringify(data, null, 2), 'utf-8');
      }
    }
  } catch (e) {
    // Read-only filesystem in serverless runtime (expected)
  }
}

// ---------- Unified Storage API ----------
async function getUsers() {
  const kvUsers = await kvGet('xerox_users');
  if (kvUsers) return kvUsers;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.usersFile, []);
}

async function saveUsers(users) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.usersFile, users);
  await kvSet('xerox_users', users);
}

async function getFiles() {
  const kvFiles = await kvGet('xerox_files');
  if (kvFiles) return kvFiles;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.filesFile, []);
}

async function saveFiles(files) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.filesFile, files);
  await kvSet('xerox_files', files);
}

async function getOrders() {
  const kvOrders = await kvGet('xerox_orders');
  if (kvOrders) return kvOrders;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.ordersFile, []);
}

async function saveOrders(orders) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.ordersFile, orders);
  await kvSet('xerox_orders', orders);
}

async function updateOrderStatus(orderId, newStatus) {
  const orders = await getOrders();
  const order = orders.find(o => o.orderId.toLowerCase() === orderId.toLowerCase());
  if (!order) return null;
  order.status = newStatus;
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);

  // Acknowledge notification if order moved past initial state
  const normSt = String(newStatus || '').toUpperCase();
  if (normSt && normSt !== 'REQUEST_RECEIVED' && normSt !== 'NEW') {
    try {
      await acknowledgeNotification(order.orderId);
    } catch (e) {}
  }

  return order;
}

// ---------- Role Normalization Helper ----------
function normalizeRole(role) {
  if (!role) return 'STUDENT';
  const r = String(role).toUpperCase().trim();
  if (r === 'SUPERADMIN' || r === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  if (r === 'ADMIN' || r === 'STAFF') return 'ADMIN';
  return 'STUDENT';
}

// ---------- Print Requests Storage (Database Records Created After Payment) ----------
async function getPrintRequests() {
  const kvRequests = await kvGet('xerox_print_requests');
  if (kvRequests) return kvRequests;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.printRequestsFile, []);
}

async function savePrintRequests(requests) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.printRequestsFile, requests);
  await kvSet('xerox_print_requests', requests);
}

async function createPrintRequest(data) {
  const requests = await getPrintRequests();
  const id = 'REQ-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const newRequest = {
    id,
    orderId: data.orderId,
    studentId: data.studentId,
    studentName: data.studentName || 'Student',
    studentEmail: data.studentEmail || 'N/A',
    items: data.items || [],
    copies: parseInt(data.copies, 10) || 1,
    pageRange: data.pageRange || 'All',
    amount: data.amount || 0,
    paymentStatus: 'PAID',
    requestStatus: 'REQUEST_RECEIVED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  requests.unshift(newRequest);
  await savePrintRequests(requests);

  // Automatically record persistent notification for admin
  try {
    await createNotification({
      orderId: newRequest.orderId,
      studentName: newRequest.studentName,
      studentEmail: newRequest.studentEmail,
      amount: newRequest.amount,
      fileCount: (newRequest.items || []).length,
      message: `New Print Request #${newRequest.orderId} from ${newRequest.studentName}`
    });
  } catch (e) {
    console.warn('Could not record notification for print request:', e.message);
  }

  return newRequest;
}

async function updatePrintRequestStatus(idOrOrderId, newStatus) {
  const requests = await getPrintRequests();
  const req = requests.find(r => 
    (r.id && r.id.toLowerCase() === idOrOrderId.toLowerCase()) || 
    (r.orderId && r.orderId.toLowerCase() === idOrOrderId.toLowerCase())
  );
  if (!req) return null;
  req.requestStatus = newStatus;
  req.updatedAt = new Date().toISOString();
  await savePrintRequests(requests);

  // Synchronize order status
  try {
    await updateOrderStatus(req.orderId, newStatus);
  } catch (e) {}

  const normSt = String(newStatus || '').toUpperCase();
  if (normSt && normSt !== 'REQUEST_RECEIVED' && normSt !== 'NEW') {
    try {
      await acknowledgeNotification(req.orderId);
    } catch (e) {}
  }

  return req;
}

// ---------- Persistent Deleted Assignment IDs (Tombstones) ----------
async function getDeletedAssignmentIds() {
  const kvDeleted = await kvGet('xerox_deleted_assignment_ids');
  if (kvDeleted && Array.isArray(kvDeleted)) {
    return new Set(kvDeleted.map(id => String(id).trim().toLowerCase()));
  }
  const cfg = getStorageConfig();
  const list = readLocalJSON(cfg.deletedAssignmentsFile, []);
  return new Set(Array.isArray(list) ? list.map(id => String(id).trim().toLowerCase()) : []);
}

async function saveDeletedAssignmentIds(idsSet) {
  const arr = Array.from(idsSet);
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.deletedAssignmentsFile, arr);
  await kvSet('xerox_deleted_assignment_ids', arr);
}

// ---------- Subject Assignments Storage ----------
async function getAssignments() {
  const deletedIds = await getDeletedAssignmentIds();
  const kvAssignments = await kvGet('xerox_assignments');
  let raw = [];
  if (kvAssignments && Array.isArray(kvAssignments)) {
    raw = kvAssignments;
  } else {
    const cfg = getStorageConfig();
    raw = readLocalJSON(cfg.assignmentsFile, []);
  }

  // Filter out any tombstoned IDs
  const active = raw.filter(a => !deletedIds.has(String(a.id || '').trim().toLowerCase()));
  return active;
}

async function saveAssignments(assignments) {
  const deletedIds = await getDeletedAssignmentIds();
  const clean = assignments.filter(a => !deletedIds.has(String(a.id || '').trim().toLowerCase()));
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.assignmentsFile, clean);
  await kvSet('xerox_assignments', clean);
}

async function createAssignment({ subject, experimentNo, title, info, submissionGuidelines, deadline, attachment }) {
  const assignments = await getAssignments();
  const id = 'asgn-' + crypto.randomBytes(6).toString('hex');
  const newAssignment = {
    id,
    subject: subject || 'General',
    experimentNo: experimentNo || '',
    title: title || 'Lab Assignment',
    info: info || '',
    submissionGuidelines: submissionGuidelines || '',
    deadline: deadline || '',
    createdAt: new Date().toISOString(),
    attachment: attachment || null
  };
  assignments.unshift(newAssignment);
  await saveAssignments(assignments);
  return newAssignment;
}

async function deleteAssignment(id) {
  if (!id) return false;
  const cleanId = String(id).trim().toLowerCase();
  
  // 1. Record in persistent tombstone registry
  const deletedIds = await getDeletedAssignmentIds();
  deletedIds.add(cleanId);
  await saveDeletedAssignmentIds(deletedIds);

  // 2. Remove from active assignments and persist
  const assignments = await getAssignments();
  const filtered = assignments.filter(a => String(a.id || '').trim().toLowerCase() !== cleanId);
  await saveAssignments(filtered);
  return true;
}

// ---------- Persistent Admin Notifications Storage ----------
async function getNotifications() {
  const kvNotifs = await kvGet('xerox_notifications');
  if (kvNotifs && Array.isArray(kvNotifs)) return kvNotifs;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.notificationsFile, []);
}

async function saveNotifications(notifications) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.notificationsFile, notifications);
  await kvSet('xerox_notifications', notifications);
}

async function createNotification(data) {
  if (!data || !data.orderId) return null;
  const notifications = await getNotifications();
  const cleanOrderId = String(data.orderId).trim().toUpperCase();

  // Deduplication check: Do NOT create duplicate notifications for the same orderId
  const existing = notifications.find(n => n.orderId && n.orderId.trim().toUpperCase() === cleanOrderId);
  if (existing) {
    return existing;
  }

  const id = 'notif-' + crypto.randomBytes(4).toString('hex');
  const newNotif = {
    id,
    orderId: data.orderId,
    type: data.type || 'NEW_PRINT_REQUEST',
    studentName: data.studentName || 'Student',
    studentEmail: data.studentEmail || 'N/A',
    amount: data.amount || 0,
    fileCount: data.fileCount || 1,
    message: data.message || `New Print Request #${data.orderId} from ${data.studentName || 'Student'}`,
    status: 'UNREAD',
    createdAt: new Date().toISOString(),
    acknowledgedAt: null
  };

  notifications.unshift(newNotif);
  await saveNotifications(notifications);
  return newNotif;
}

async function acknowledgeNotification(idOrOrderId) {
  if (!idOrOrderId) return null;
  const notifications = await getNotifications();
  const query = String(idOrOrderId).trim().toLowerCase();

  let modified = false;
  let acknowledgedRecord = null;

  for (const n of notifications) {
    const matchId = n.id && n.id.toLowerCase() === query;
    const matchOrder = n.orderId && n.orderId.toLowerCase() === query;
    if (matchId || matchOrder) {
      if (n.status !== 'ACKNOWLEDGED') {
        n.status = 'ACKNOWLEDGED';
        n.acknowledgedAt = new Date().toISOString();
        modified = true;
        acknowledgedRecord = n;
      }
    }
  }

  if (modified) {
    await saveNotifications(notifications);
  }
  return acknowledgedRecord;
}

async function acknowledgeAllNotifications() {
  const notifications = await getNotifications();
  let modified = false;
  const now = new Date().toISOString();
  for (const n of notifications) {
    if (n.status !== 'ACKNOWLEDGED') {
      n.status = 'ACKNOWLEDGED';
      n.acknowledgedAt = now;
      modified = true;
    }
  }
  if (modified) {
    await saveNotifications(notifications);
  }
  return true;
}

async function getUnreadNotifications() {
  const notifications = await getNotifications();
  return notifications.filter(n => n.status === 'UNREAD');
}

// ---------- Dynamic Pricing Storage ----------
const DEFAULT_PRICING = {
  'bw-single': 2,
  'bw-double': 3,
  'color-single': 5,
  'color-double': 8
};

async function getPricing() {
  const kvPricing = await kvGet('xerox_pricing');
  if (kvPricing) return { ...DEFAULT_PRICING, ...kvPricing };
  const cfg = getStorageConfig();
  const loaded = readLocalJSON(cfg.pricingFile, DEFAULT_PRICING);
  return { ...DEFAULT_PRICING, ...loaded };
}

async function savePricing(pricing) {
  const cfg = getStorageConfig();
  const merged = { ...DEFAULT_PRICING, ...pricing };
  writeLocalJSON(cfg.pricingFile, merged);
  await kvSet('xerox_pricing', merged);
  return merged;
}

// ---------- Staff & Admin User Management ----------
async function getStaffUsers() {
  const users = await getUsers();
  return users
    .filter(u => u.role === 'admin' || u.role === 'superadmin')
    .map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      disabled: !!u.disabled,
      createdAt: u.createdAt
    }));
}

async function createAdminUser({ name, email, password, role = 'admin' }) {
  const users = await getUsers();
  const cleanEmail = email.toLowerCase().trim();
  if (users.some(u => u.email.toLowerCase() === cleanEmail)) {
    throw new Error('An account with this email already exists.');
  }
  const { hashPassword, makeSalt } = require('./auth');
  const salt = makeSalt();
  const passwordHash = hashPassword(password, salt);
  const newUser = {
    id: 'staff_' + crypto.randomBytes(6).toString('hex'),
    name: name || 'Staff Admin',
    email: cleanEmail,
    role: role === 'superadmin' ? 'superadmin' : 'admin',
    disabled: false,
    salt,
    passwordHash,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  await saveUsers(users);
  return {
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    role: newUser.role,
    disabled: false,
    createdAt: newUser.createdAt
  };
}

async function toggleUserDisabled(userId, disabled) {
  const users = await getUsers();
  const user = users.find(u => u.id === userId || u.email.toLowerCase() === userId.toLowerCase());
  if (!user) return null;
  if (user.role === 'superadmin') {
    throw new Error('Cannot disable Super Admin account.');
  }
  user.disabled = Boolean(disabled);
  await saveUsers(users);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    disabled: user.disabled
  };
}

async function resetUserPassword(userId, newPassword) {
  const users = await getUsers();
  const user = users.find(u => u.id === userId || u.email.toLowerCase() === userId.toLowerCase());
  if (!user) return null;
  const { hashPassword, makeSalt } = require('./auth');
  const salt = makeSalt();
  user.salt = salt;
  user.passwordHash = hashPassword(newPassword, salt);
  await saveUsers(users);
  return true;
}

// ---------- Uploaded Files Storage ----------
async function saveUploadedFile(userId, originalName, fileBuffer) {
  const cfg = getStorageConfig();
  const id = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  const storedName = id + ext;

  const userUploadDir = path.join(cfg.uploadsDir, userId);
  if (!fs.existsSync(userUploadDir)) {
    try { fs.mkdirSync(userUploadDir, { recursive: true }); } catch (e) {}
  }

  const diskPath = path.join(userUploadDir, storedName);
  try {
    fs.writeFileSync(diskPath, fileBuffer);
  } catch (e) {
    console.warn('Could not write file to disk, relying on base64 memory store:', e.message);
  }

  // Always store base64 data to ensure files survive across serverless container recycles
  const dataBase64 = fileBuffer.toString('base64');

  return {
    id,
    ownerId: userId,
    originalName,
    storedName,
    size: fileBuffer.length,
    uploadedAt: new Date().toISOString(),
    dataBase64
  };
}

async function getUploadedFileBuffer(fileRecord) {
  const cfg = getStorageConfig();
  const diskPath = path.join(cfg.uploadsDir, fileRecord.ownerId, fileRecord.storedName);

  if (fs.existsSync(diskPath)) {
    return fs.readFileSync(diskPath);
  }

  // Also check bundled seed directory if not found in /tmp
  const seedPath = path.join(BUNDLED_UPLOADS_DIR, fileRecord.ownerId, fileRecord.storedName);
  if (fs.existsSync(seedPath)) {
    return fs.readFileSync(seedPath);
  }

  // Reconstitute from stored base64 if container was recycled
  if (fileRecord.dataBase64) {
    const buf = Buffer.from(fileRecord.dataBase64, 'base64');
    try {
      const userUploadDir = path.join(cfg.uploadsDir, fileRecord.ownerId);
      if (!fs.existsSync(userUploadDir)) fs.mkdirSync(userUploadDir, { recursive: true });
      fs.writeFileSync(diskPath, buf);
    } catch (e) {}
    return buf;
  }

  return null;
}

async function deleteUploadedFile(fileRecord) {
  const cfg = getStorageConfig();
  const diskPath = path.join(cfg.uploadsDir, fileRecord.ownerId, fileRecord.storedName);
  if (fs.existsSync(diskPath)) {
    try {
      fs.unlinkSync(diskPath);
    } catch (e) {}
  }
}

module.exports = {
  getStorageConfig,
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
  getDeletedAssignmentIds,
  saveDeletedAssignmentIds,
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
  REPO_ROOT,
  BUNDLED_DATA_DIR,
  BUNDLED_UPLOADS_DIR
};
