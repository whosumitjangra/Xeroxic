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
      pricingFile: path.join(BUNDLED_DATA_DIR, 'pricing.json')
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

    // Seed data files into /tmp if not already present
    seedFile(path.join(BUNDLED_DATA_DIR, 'users.json'), usersFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'files.json'), filesFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'orders.json'), ordersFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'print_requests.json'), printRequestsFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'assignments.json'), assignmentsFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'pricing.json'), pricingFile, '{}');

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
      pricingFile
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

  return req;
}

// ---------- Subject Assignments Storage ----------
async function getAssignments() {
  const kvAssignments = await kvGet('xerox_assignments');
  if (kvAssignments) return kvAssignments;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.assignmentsFile, []);
}

async function saveAssignments(assignments) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.assignmentsFile, assignments);
  await kvSet('xerox_assignments', assignments);
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
  const assignments = await getAssignments();
  const filtered = assignments.filter(a => a.id !== id);
  const deleted = filtered.length !== assignments.length;
  if (deleted) {
    await saveAssignments(filtered);
  }
  return deleted;
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
