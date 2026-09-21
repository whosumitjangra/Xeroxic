// ===================================================================
// Xerox Centre — Storage Abstraction Layer
// Handles MongoDB Atlas (primary), Upstash KV, and local/serverless fallback
// ===================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// Resolve repository root relative to this file
const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLED_DATA_DIR = path.join(REPO_ROOT, 'data');
const BUNDLED_UPLOADS_DIR = path.join(REPO_ROOT, 'uploads');

// Optional Upstash / Vercel KV REST configuration
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;

// Primary MongoDB Atlas Configuration (Secrets loaded strictly from environment)
const MONGODB_URI = process.env.MONGODB_URI || null;

// Whitelist of strictly permitted document and photo extensions for Xerox printing
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp'
]);

// Maximum permitted file upload size: 25 MB
const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Escapes characters with special meaning in Regular Expressions
 * Prevents NoSQL Injection and ReDoS attacks on regex-matching queries
 */
function escapeRegex(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let cachedClient = null;
let cachedDb = null;
let mongoDisabledUntil = 0;

/**
 * Get an active MongoDB database instance with automatic connection caching
 * and fast, graceful fallback to local /tmp when offline or sandboxed.
 */
async function getMongoDb() {
  if (process.env.NO_MONGO === '1') return null;
  if (!MONGODB_URI) return null;
  if (cachedDb) return cachedDb;
  if (Date.now() < mongoDisabledUntil) return null;

  try {
    if (!cachedClient) {
      cachedClient = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 2500,
        connectTimeoutMS: 2500
      });
      await cachedClient.connect();
    }
    cachedDb = cachedClient.db('xerox');
    return cachedDb;
  } catch (err) {
    // If offline, DNS blocked (sandbox), or connection error, back off and gracefully fallback
    console.warn('MongoDB Atlas connection skipped/failed, using local fallback:', err.message);
    mongoDisabledUntil = Date.now() + 45000;
    cachedClient = null;
    cachedDb = null;
    return null;
  }
}

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
  const db = await getMongoDb();
  if (db) {
    try {
      const docs = await db.collection('users').find({}).toArray();
      if (docs && docs.length > 0) {
        return docs.map(d => {
          const { _id, ...rest } = d;
          return { id: d.id || String(_id), ...rest };
        });
      }
    } catch (e) {
      console.warn('MongoDB getUsers error:', e.message);
    }
  }

  const kvUsers = await kvGet('xerox_users');
  if (kvUsers) return kvUsers;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.usersFile, []);
}

async function saveUsers(users) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.usersFile, users);
  await kvSet('xerox_users', users);

  const db = await getMongoDb();
  if (db && Array.isArray(users) && users.length > 0) {
    try {
      const ops = users.map(u => ({
        replaceOne: {
          filter: { $or: [{ id: u.id }, { email: (u.email || '').toLowerCase() }] },
          replacement: u,
          upsert: true
        }
      }));
      await db.collection('users').bulkWrite(ops);
    } catch (e) {
      console.warn('MongoDB saveUsers error:', e.message);
    }
  }
}

async function getFiles() {
  const db = await getMongoDb();
  if (db) {
    try {
      const docs = await db.collection('files').find({}).sort({ uploadedAt: -1 }).toArray();
      if (docs && docs.length > 0) {
        return docs.map(d => {
          const { _id, ...rest } = d;
          return rest;
        });
      }
    } catch (e) {
      console.warn('MongoDB getFiles error:', e.message);
    }
  }

  const kvFiles = await kvGet('xerox_files');
  if (kvFiles) return kvFiles;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.filesFile, []);
}

async function saveFiles(files) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.filesFile, files);
  await kvSet('xerox_files', files);

  const db = await getMongoDb();
  if (db && Array.isArray(files) && files.length > 0) {
    try {
      const ops = files.map(f => ({
        replaceOne: {
          filter: { id: f.id },
          replacement: f,
          upsert: true
        }
      }));
      await db.collection('files').bulkWrite(ops);
    } catch (e) {
      console.warn('MongoDB saveFiles error:', e.message);
    }
  }
}

async function getOrders() {
  const db = await getMongoDb();
  if (db) {
    try {
      const docs = await db.collection('orders').find({}).sort({ createdAt: -1 }).toArray();
      if (docs && docs.length > 0) {
        return docs.map(d => {
          const { _id, ...rest } = d;
          return rest;
        });
      }
    } catch (e) {
      console.warn('MongoDB getOrders error:', e.message);
    }
  }

  const kvOrders = await kvGet('xerox_orders');
  if (kvOrders) return kvOrders;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.ordersFile, []);
}

async function saveOrders(orders) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.ordersFile, orders);
  await kvSet('xerox_orders', orders);

  const db = await getMongoDb();
  if (db && Array.isArray(orders) && orders.length > 0) {
    try {
      const ops = orders.map(o => ({
        replaceOne: {
          filter: { orderId: o.orderId },
          replacement: o,
          upsert: true
        }
      }));
      await db.collection('orders').bulkWrite(ops);
    } catch (e) {
      console.warn('MongoDB saveOrders error:', e.message);
    }
  }
}

async function updateOrderStatus(orderId, newStatus) {
  const orders = await getOrders();
  const order = orders.find(o => o.orderId.toLowerCase() === orderId.toLowerCase());
  if (!order) return null;
  order.status = newStatus;
  order.updatedAt = new Date().toISOString();
  await saveOrders(orders);

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('orders').updateOne(
        { orderId: { $regex: new RegExp(`^${escapeRegex(orderId)}$`, 'i') } },
        { $set: { status: newStatus, updatedAt: order.updatedAt } }
      );
    } catch (e) {
      console.warn('MongoDB updateOrderStatus error:', e.message);
    }
  }

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
  const db = await getMongoDb();
  if (db) {
    try {
      const docs = await db.collection('print_requests').find({}).sort({ createdAt: -1 }).toArray();
      if (docs && docs.length > 0) {
        return docs.map(d => {
          const { _id, ...rest } = d;
          return rest;
        });
      }
    } catch (e) {
      console.warn('MongoDB getPrintRequests error:', e.message);
    }
  }

  const kvRequests = await kvGet('xerox_print_requests');
  if (kvRequests) return kvRequests;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.printRequestsFile, []);
}

async function savePrintRequests(requests) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.printRequestsFile, requests);
  await kvSet('xerox_print_requests', requests);

  const db = await getMongoDb();
  if (db && Array.isArray(requests) && requests.length > 0) {
    try {
      const ops = requests.map(r => ({
        replaceOne: {
          filter: { orderId: r.orderId },
          replacement: r,
          upsert: true
        }
      }));
      await db.collection('print_requests').bulkWrite(ops);
    } catch (e) {
      console.warn('MongoDB savePrintRequests error:', e.message);
    }
  }
}

async function createPrintRequest(data) {
  const requests = await getPrintRequests();
  const canonicalId = data.orderId || ('ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase());
  const newRequest = {
    id: canonicalId,
    orderId: canonicalId,
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

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('print_requests').updateOne(
        { orderId: newRequest.orderId },
        { $set: newRequest },
        { upsert: true }
      );
    } catch (e) {
      console.warn('MongoDB createPrintRequest error:', e.message);
    }
  }

  // Automatically record / update persistent notification for admin
  try {
    await createNotification({
      orderId: newRequest.orderId,
      studentName: newRequest.studentName,
      studentEmail: newRequest.studentEmail,
      amount: newRequest.amount,
      fileCount: (newRequest.items || []).length,
      paymentStatus: 'PAID',
      type: 'NEW_PRINT_REQUEST',
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

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('print_requests').updateOne(
        { $or: [
          { id: { $regex: new RegExp(`^${escapeRegex(idOrOrderId)}$`, 'i') } },
          { orderId: { $regex: new RegExp(`^${escapeRegex(idOrOrderId)}$`, 'i') } }
        ]},
        { $set: { requestStatus: newStatus, updatedAt: req.updatedAt } }
      );
    } catch (e) {
      console.warn('MongoDB updatePrintRequestStatus error:', e.message);
    }
  }

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
  const db = await getMongoDb();
  if (db) {
    try {
      const doc = await db.collection('system_metadata').findOne({ _id: 'deleted_assignment_ids' });
      if (doc && Array.isArray(doc.ids)) {
        return new Set(doc.ids.map(id => String(id).trim().toLowerCase()));
      }
    } catch (e) {
      console.warn('MongoDB getDeletedAssignmentIds error:', e.message);
    }
  }

  const kvDeleted = await kvGet('xerox_deleted_assignment_ids');
  if (kvDeleted !== null) {
    const arr = Array.isArray(kvDeleted) ? kvDeleted : [];
    return new Set(arr.map(id => String(id).trim().toLowerCase()));
  }

  if (KV_URL && KV_TOKEN) {
    return new Set();
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

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('system_metadata').updateOne(
        { _id: 'deleted_assignment_ids' },
        { $set: { ids: arr, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    } catch (e) {
      console.warn('MongoDB saveDeletedAssignmentIds error:', e.message);
    }
  }
}

// ---------- Subject Assignments Storage ----------
/**
 * Checks if an assignment's submission deadline passed more than 1 day (24 hours) ago.
 */
function isAssignmentExpiredPastOneDay(assignment, now = Date.now()) {
  if (!assignment || !assignment.deadline) return false;
  const deadlineStr = String(assignment.deadline).trim();
  if (!deadlineStr) return false;

  let deadlineEndTimestamp;
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadlineStr)) {
    // Standard YYYY-MM-DD: the deadline date concludes at 23:59:59.999
    deadlineEndTimestamp = new Date(deadlineStr + 'T23:59:59.999').getTime();
    if (isNaN(deadlineEndTimestamp)) {
      deadlineEndTimestamp = new Date(deadlineStr).getTime() + (24 * 60 * 60 * 1000 - 1);
    }
  } else {
    deadlineEndTimestamp = new Date(deadlineStr).getTime();
  }

  if (isNaN(deadlineEndTimestamp)) return false;

  const oneDayGracePeriodMs = 24 * 60 * 60 * 1000; // exactly 1 day (24 hours) after deadline
  return now > (deadlineEndTimestamp + oneDayGracePeriodMs);
}

async function getAssignments() {
  const deletedIds = await getDeletedAssignmentIds();
  let raw = [];

  const db = await getMongoDb();
  if (db) {
    try {
      const docs = await db.collection('assignments').find({}).sort({ createdAt: -1 }).toArray();
      if (docs && docs.length > 0) {
        raw = docs.map(d => {
          const { _id, ...rest } = d;
          return { id: d.id || String(_id), ...rest };
        });
      }
    } catch (e) {
      console.warn('MongoDB getAssignments error:', e.message);
    }
  }

  if (raw.length === 0) {
    const kvAssignments = await kvGet('xerox_assignments');
    if (kvAssignments !== null) {
      raw = Array.isArray(kvAssignments) ? kvAssignments : [];
    } else if (KV_URL && KV_TOKEN) {
      raw = [];
    } else {
      const cfg = getStorageConfig();
      raw = readLocalJSON(cfg.assignmentsFile, []);
    }
  }

  // Filter out any tombstoned IDs
  let active = raw.filter(a => !deletedIds.has(String(a.id || '').trim().toLowerCase()));

  // Auto-delete: Identify assignments that have passed 1 day after their deadline
  const expired = active.filter(a => isAssignmentExpiredPastOneDay(a));
  if (expired.length > 0) {
    const expiredIds = new Set(expired.map(a => String(a.id || '').trim().toLowerCase()));
    active = active.filter(a => !expiredIds.has(String(a.id || '').trim().toLowerCase()));

    // Record tombstones and persist clean assignments
    for (const exp of expired) {
      deletedIds.add(String(exp.id).trim().toLowerCase());
    }
    saveDeletedAssignmentIds(deletedIds).catch(() => {});
    saveAssignments(active).catch(() => {});
  }

  return active;
}

async function saveAssignments(assignments) {
  const deletedIds = await getDeletedAssignmentIds();
  const clean = assignments.filter(a => !deletedIds.has(String(a.id || '').trim().toLowerCase()));
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.assignmentsFile, clean);
  await kvSet('xerox_assignments', clean);

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('assignments').deleteMany({});
      if (clean.length > 0) {
        const docs = clean.map(a => ({ ...a, _id: a.id }));
        await db.collection('assignments').insertMany(docs);
      }
    } catch (e) {
      console.warn('MongoDB saveAssignments error:', e.message);
    }
  }
}

async function createAssignment({ subject, category, deadline, attachment, attachments, experimentNo, title, info, submissionGuidelines, targetClass, batch, year, branch }) {
  const id = 'asgn-' + crypto.randomBytes(6).toString('hex');
  const normalizedYear = year || (targetClass && targetClass !== 'All Classes' ? targetClass.split(' ')[0] : 'All');
  const normalizedBranch = branch || (targetClass && targetClass !== 'All Classes' ? targetClass.split(' ').slice(1).join(' ') || 'All' : 'All');
  const finalClass = targetClass || (year && branch ? `${year} ${branch}` : 'All Classes');
  const normalizedCategory = (category && category.trim()) || 'Lab Experiments';

  // Normalize attachments array and primary attachment
  let normalizedAttachments = [];
  if (Array.isArray(attachments) && attachments.length > 0) {
    normalizedAttachments = attachments;
  } else if (attachment && attachment.dataBase64) {
    normalizedAttachments = [attachment];
  }
  const primaryAttachment = normalizedAttachments.length > 0 ? normalizedAttachments[0] : (attachment || null);

  const newAssignment = {
    id,
    subject: subject || 'General',
    category: normalizedCategory,
    year: normalizedYear,
    branch: normalizedBranch,
    targetClass: finalClass,
    batch: batch || 'All Batches',
    deadline: deadline || '',
    attachment: primaryAttachment,
    attachments: normalizedAttachments,
    experimentNo: experimentNo || '',
    title: title || subject || 'Lab Assignment',
    info: info || '',
    submissionGuidelines: submissionGuidelines || '',
    createdAt: new Date().toISOString()
  };

  const assignments = await getAssignments();
  assignments.unshift(newAssignment);
  await saveAssignments(assignments);

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('assignments').updateOne(
        { id: newAssignment.id },
        { $set: { ...newAssignment, _id: newAssignment.id } },
        { upsert: true }
      );
    } catch (e) {
      console.warn('MongoDB createAssignment error:', e.message);
    }
  }

  return newAssignment;
}

async function deleteAssignment(id) {
  if (!id) return false;
  const cleanId = String(id).trim().toLowerCase();

  // 1. Record tombstone
  const deletedIds = await getDeletedAssignmentIds();
  deletedIds.add(cleanId);
  await saveDeletedAssignmentIds(deletedIds);

  // 2. Delete from MongoDB
  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('assignments').deleteMany({
        $or: [
          { id: cleanId },
          { _id: cleanId },
          { id: { $regex: new RegExp(`^${escapeRegex(cleanId)}$`, 'i') } }
        ]
      });
    } catch (e) {
      console.warn('MongoDB deleteAssignment error:', e.message);
    }
  }

  // 3. Filter out all tombstoned IDs from local / KV cache
  let raw = [];
  const kvAssignments = await kvGet('xerox_assignments');
  if (kvAssignments && Array.isArray(kvAssignments)) {
    raw = kvAssignments;
  } else {
    const cfg = getStorageConfig();
    raw = readLocalJSON(cfg.assignmentsFile, []);
  }

  const filtered = raw.filter(a => !deletedIds.has(String(a.id || '').trim().toLowerCase()));
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.assignmentsFile, filtered);
  await kvSet('xerox_assignments', filtered);

  return true;
}

// ---------- Persistent Admin Notifications Storage ----------
async function getNotifications() {
  const db = await getMongoDb();
  if (db) {
    try {
      const docs = await db.collection('notifications').find({}).sort({ createdAt: -1 }).toArray();
      if (docs && docs.length > 0) {
        return docs.map(d => {
          const { _id, ...rest } = d;
          return { id: d.id || String(_id), ...rest };
        });
      }
    } catch (e) {
      console.warn('MongoDB getNotifications error:', e.message);
    }
  }

  const kvNotifs = await kvGet('xerox_notifications');
  if (kvNotifs && Array.isArray(kvNotifs)) return kvNotifs;
  const cfg = getStorageConfig();
  return readLocalJSON(cfg.notificationsFile, []);
}

async function saveNotifications(notifications) {
  const cfg = getStorageConfig();
  writeLocalJSON(cfg.notificationsFile, notifications);
  await kvSet('xerox_notifications', notifications);

  const db = await getMongoDb();
  if (db && Array.isArray(notifications) && notifications.length > 0) {
    try {
      const ops = notifications.map(n => ({
        replaceOne: {
          filter: { orderId: n.orderId },
          replacement: n,
          upsert: true
        }
      }));
      await db.collection('notifications').bulkWrite(ops);
    } catch (e) {
      console.warn('MongoDB saveNotifications error:', e.message);
    }
  }
}

async function createNotification(data) {
  if (!data || !data.orderId) return null;
  const notifications = await getNotifications();
  const cleanOrderId = String(data.orderId).trim().toUpperCase();

  // Deduplication check: Do NOT create duplicate notifications for the same orderId
  const existing = notifications.find(n => n.orderId && n.orderId.trim().toUpperCase() === cleanOrderId);
  if (existing) {
    let modified = false;
    if (data.status && existing.status !== data.status) {
      existing.status = data.status;
      modified = true;
    }
    if (data.paymentStatus && existing.paymentStatus !== data.paymentStatus) {
      existing.paymentStatus = data.paymentStatus;
      modified = true;
    }
    if (data.message && existing.message !== data.message) {
      existing.message = data.message;
      modified = true;
    }
    if (data.type && existing.type !== data.type) {
      existing.type = data.type;
      modified = true;
    }
    if (data.studentName && data.studentName !== 'Student' && existing.studentName !== data.studentName) {
      existing.studentName = data.studentName;
      modified = true;
    }
    if (modified) {
      existing.updatedAt = new Date().toISOString();
      await saveNotifications(notifications);
    }
    return existing;
  }

  const id = 'notif-' + crypto.randomBytes(4).toString('hex');
  const newNotif = {
    id,
    orderId: data.orderId,
    type: data.type || 'NEW_PRINT_REQUEST',
    paymentStatus: data.paymentStatus || 'PAID',
    studentName: data.studentName || 'Student',
    studentEmail: data.studentEmail || 'N/A',
    amount: data.amount || 0,
    fileCount: data.fileCount || 1,
    message: data.message || `New Print Request #${data.orderId} from ${data.studentName || 'Student'}`,
    status: data.status || 'UNREAD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    acknowledgedAt: null
  };

  notifications.unshift(newNotif);
  await saveNotifications(notifications);

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('notifications').updateOne(
        { orderId: newNotif.orderId },
        { $set: newNotif },
        { upsert: true }
      );
    } catch (e) {}
  }

  return newNotif;
}

async function updateNotificationByOrderId(orderId, updates) {
  if (!orderId) return null;
  const notifications = await getNotifications();
  const cleanId = String(orderId).trim().toLowerCase();
  let updatedRecord = null;
  for (const n of notifications) {
    if (n.orderId && n.orderId.toLowerCase() === cleanId) {
      Object.assign(n, updates, { updatedAt: new Date().toISOString() });
      updatedRecord = n;
      break;
    }
  }
  if (updatedRecord) {
    await saveNotifications(notifications);
  }

  const db = await getMongoDb();
  if (db && updatedRecord) {
    try {
      await db.collection('notifications').updateOne(
        { orderId: { $regex: new RegExp(`^${escapeRegex(orderId)}$`, 'i') } },
        { $set: updates }
      );
    } catch (e) {}
  }

  return updatedRecord;
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

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('notifications').updateMany(
        { $or: [
          { id: { $regex: new RegExp(`^${escapeRegex(query)}$`, 'i') } },
          { orderId: { $regex: new RegExp(`^${escapeRegex(query)}$`, 'i') } }
        ]},
        { $set: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date().toISOString() } }
      );
    } catch (e) {}
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

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('notifications').updateMany(
        { status: { $ne: 'ACKNOWLEDGED' } },
        { $set: { status: 'ACKNOWLEDGED', acknowledgedAt: now } }
      );
    } catch (e) {}
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
  const db = await getMongoDb();
  if (db) {
    try {
      const doc = await db.collection('pricing').findOne({ _id: 'current_pricing' });
      if (doc) {
        const { _id, ...rest } = doc;
        return { ...DEFAULT_PRICING, ...rest };
      }
    } catch (e) {
      console.warn('MongoDB getPricing error:', e.message);
    }
  }

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

  const db = await getMongoDb();
  if (db) {
    try {
      await db.collection('pricing').updateOne(
        { _id: 'current_pricing' },
        { $set: merged },
        { upsert: true }
      );
    } catch (e) {
      console.warn('MongoDB savePricing error:', e.message);
    }
  }

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

// ---------- Uploaded Files Storage (Hardened) ----------
async function saveUploadedFile(userId, originalName, fileBuffer) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new Error('Invalid file payload.');
  }
  if (fileBuffer.length > MAX_UPLOAD_FILE_SIZE) {
    throw new Error(`File exceeds maximum permitted size of ${Math.round(MAX_UPLOAD_FILE_SIZE / (1024 * 1024))}MB.`);
  }

  // Strip path traversal attempts and special characters
  const rawBaseName = path.basename(originalName || 'document');
  const safeOriginalName = rawBaseName.replace(/[^\w\s.-]/gi, '_').replace(/\s+/g, ' ').trim() || 'document';
  const ext = path.extname(safeOriginalName).toLowerCase();

  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error(`File type "${ext}" is not permitted. Permitted formats: PDF, DOC, DOCX, PPT, PPTX, TXT, RTF, PNG, JPG, JPEG, GIF, WEBP.`);
  }

  const cfg = getStorageConfig();
  const id = crypto.randomBytes(16).toString('hex');
  const storedName = `${id}${ext}`;

  // Confine user directory strictly inside cfg.uploadsDir
  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '');
  const userUploadDir = path.join(cfg.uploadsDir, safeUserId);
  if (!userUploadDir.startsWith(cfg.uploadsDir)) {
    throw new Error('Directory traversal attempt detected.');
  }

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
    originalName: safeOriginalName,
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
  const db = await getMongoDb();
  if (db && fileRecord.id) {
    try {
      await db.collection('files').deleteOne({ id: fileRecord.id });
    } catch (e) {}
  }
}

async function cleanupOrderFiles(order) {
  if (!order || !order.items || !Array.isArray(order.items)) return;
  const db = await getMongoDb();
  const cfg = getStorageConfig();

  for (const item of order.items) {
    const fileId = item.fileId || item.id;
    if (!fileId) continue;

    // 1. Purge from MongoDB files collection
    if (db) {
      try {
        await db.collection('files').deleteOne({ id: fileId });
      } catch (e) {
        console.warn(`Could not purge file ${fileId} from MongoDB:`, e.message);
      }
    }

    // 2. Purge from local /tmp files.json
    try {
      const allFiles = await getFiles();
      const remaining = allFiles.filter(f => f.id !== fileId);
      if (remaining.length !== allFiles.length) {
        await saveFiles(remaining);
      }
    } catch (e) {}

    // 3. Purge physical disk file if exists
    try {
      const ownerId = order.ownerId || order.studentId || item.ownerId;
      if (ownerId) {
        const userDir = path.join(cfg.uploadsDir, ownerId);
        if (fs.existsSync(userDir)) {
          const filesInDir = fs.readdirSync(userDir);
          for (const f of filesInDir) {
            if (f.startsWith(fileId)) {
              try { fs.unlinkSync(path.join(userDir, f)); } catch (e) {}
            }
          }
        }
      }
    } catch (e) {}

    // Mark item metadata as purged
    item.filePurged = true;
  }
}

async function closeMongo() {
  if (cachedClient) {
    try {
      await cachedClient.close();
    } catch (e) {}
    cachedClient = null;
    cachedDb = null;
  }
}

module.exports = {
  getStorageConfig,
  getMongoDb,
  closeMongo,
  getUsers,
  saveUsers,
  getFiles,
  saveFiles,
  getOrders,
  saveOrders,
  updateOrderStatus,
  cleanupOrderFiles,
  normalizeRole,
  getPrintRequests,
  savePrintRequests,
  createPrintRequest,
  updatePrintRequestStatus,
  getAssignments,
  saveAssignments,
  createAssignment,
  deleteAssignment,
  isAssignmentExpiredPastOneDay,
  getDeletedAssignmentIds,
  saveDeletedAssignmentIds,
  getNotifications,
  saveNotifications,
  createNotification,
  updateNotificationByOrderId,
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

