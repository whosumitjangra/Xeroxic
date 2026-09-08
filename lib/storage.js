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
      ordersFile: path.join(BUNDLED_DATA_DIR, 'orders.json')
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

    // Seed data files into /tmp if not already present
    seedFile(path.join(BUNDLED_DATA_DIR, 'users.json'), usersFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'files.json'), filesFile, '[]');
    seedFile(path.join(BUNDLED_DATA_DIR, 'orders.json'), ordersFile, '[]');

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
      ordersFile
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

// ---------- Uploaded Files Storage ----------
async function saveUploadedFile(userId, originalName, fileBuffer) {
  const cfg = getStorageConfig();
  const id = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName);
  const storedName = id + ext;

  const userUploadDir = path.join(cfg.uploadsDir, userId);
  if (!fs.existsSync(userUploadDir)) {
    fs.mkdirSync(userUploadDir, { recursive: true });
  }

  const diskPath = path.join(userUploadDir, storedName);
  fs.writeFileSync(diskPath, fileBuffer);

  // Store base64 data for files under 4MB to enable seamless previews
  // across isolated serverless container instances
  let dataBase64 = null;
  if (fileBuffer.length <= 4 * 1024 * 1024) {
    dataBase64 = fileBuffer.toString('base64');
  }

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
  saveUploadedFile,
  getUploadedFileBuffer,
  deleteUploadedFile,
  REPO_ROOT,
  BUNDLED_DATA_DIR,
  BUNDLED_UPLOADS_DIR
};
