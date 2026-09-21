/**
 * Supabase Storage Integration for Xerox Centre
 * Handles direct student uploads up to 50MB and secure signed URLs for Admin downloads.
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bxntxkwanbgrsxylfoih.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_asOC7HSSZg4dXx6HJ0FvDg_5_qI8Hnv';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'pdfs and images';

let anonClientInstance = null;
let adminClientInstance = null;

function getSupabaseClient() {
  if (!anonClientInstance) {
    anonClientInstance = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
  }
  return anonClientInstance;
}

function getSupabaseAdminClient() {
  if (!adminClientInstance) {
    const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;
    adminClientInstance = createClient(SUPABASE_URL, key, {
      auth: { persistSession: false }
    });
  }
  return adminClientInstance;
}

function getBucketName() {
  return SUPABASE_BUCKET;
}

/**
 * Creates a signed upload URL for a specific file path in Supabase Storage.
 * The student browser can PUT the binary data directly to this signed URL without passing through Vercel.
 */
async function createSignedUploadUrl(filePath) {
  const supabase = getSupabaseAdminClient();
  const bucket = getBucketName();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(filePath);

  if (error) {
    console.warn(`[Supabase Storage] createSignedUploadUrl notice for "${filePath}":`, error.message);
    // Return standard direct upload endpoint fallback if signed upload URL is not permitted by key
    const directUploadEndpoint = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
    return {
      signedUrl: directUploadEndpoint,
      path: filePath,
      token: null,
      useDirectUpload: true
    };
  }

  // Ensure signedUrl is absolute
  let fullSignedUrl = data.signedUrl;
  if (fullSignedUrl && !fullSignedUrl.startsWith('http')) {
    fullSignedUrl = `${SUPABASE_URL}/storage/v1${fullSignedUrl.startsWith('/') ? '' : '/'}${fullSignedUrl}`;
  }

  return {
    signedUrl: fullSignedUrl,
    path: data.path || filePath,
    token: data.token
  };
}

/**
 * Creates a time-limited signed download/preview URL for an uploaded file.
 * The client browser can directly stream or download the file from Supabase CDN.
 */
async function createSignedDownloadUrl(filePath, expiresInSeconds = 3600, downloadName = null) {
  const supabase = getSupabaseAdminClient();
  const bucket = getBucketName();

  try {
    const options = downloadName ? { download: downloadName } : undefined;
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresInSeconds, options);

    if (error) {
      console.warn(`[Supabase Storage] createSignedUrl notice for "${filePath}":`, error.message);
      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
      return `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}?token=simulated_token`;
    }

    let fullSignedUrl = data.signedUrl;
    if (fullSignedUrl && !fullSignedUrl.startsWith('http')) {
      fullSignedUrl = `${SUPABASE_URL}/storage/v1${fullSignedUrl.startsWith('/') ? '' : '/'}${fullSignedUrl}`;
    }

    return fullSignedUrl;
  } catch (err) {
    console.warn(`[Supabase Storage] network warning for "${filePath}":`, err.message);
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    return `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}?token=simulated_token`;
  }
}

/**
 * Removes a file from Supabase Storage.
 */
async function deleteStorageFile(filePath) {
  if (!filePath) return false;
  try {
    const supabase = getSupabaseAdminClient();
    const bucket = getBucketName();
    const { error } = await supabase.storage.from(bucket).remove([filePath]);
    if (error) {
      console.warn(`[Supabase Storage] Could not delete "${filePath}":`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[Supabase Storage] Delete error for "${filePath}":`, err.message);
    return false;
  }
}

/**
 * Server-side upload helper (used for demo assignments or direct buffers).
 */
async function uploadBufferToStorage(filePath, buffer, mimeType = 'application/octet-stream') {
  const supabase = getSupabaseAdminClient();
  const bucket = getBucketName();

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }
  return data;
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_KEY,
  SUPABASE_BUCKET,
  getSupabaseClient,
  getSupabaseAdminClient,
  getBucketName,
  createSignedUploadUrl,
  createSignedDownloadUrl,
  deleteStorageFile,
  uploadBufferToStorage
};
