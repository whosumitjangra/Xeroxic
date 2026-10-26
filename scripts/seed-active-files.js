// Seed active order files into Supabase Storage, local uploads cache, and MongoDB
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  });
}

const { getSupabaseAdminClient, getBucketName } = require('../lib/supabase');
const { saveFiles, getStorageConfig } = require('../lib/storage');

const filesToSeed = [
  {
    orderId: 'stude17002',
    fileId: '572bef0aba8612b9d48ca19f24ad0020',
    ownerId: 'guest_27f4c6f944058a0c',
    originalName: 'WhatsApp Image 2026-09-22 at 09.59.48.jpeg',
    filePath: 'students/guest_27f4c6f944058a0c/572bef0aba8612b9d48ca19f24ad0020-WhatsApp Image 2026-09-22 at 09.59.48.jpeg',
    storedName: '572bef0aba8612b9d48ca19f24ad0020.jpeg',
    mimeType: 'image/jpeg',
    sourceFile: path.join(__dirname, '..', 'public', 'images', 'card-print.jpg')
  },
  {
    orderId: 'aksha13001',
    fileId: '693e0b20f0f7d0a0897cf335c1b48e58',
    ownerId: '345a131e227c7b3d',
    originalName: 'polymer composites final full edited and the final.docx',
    filePath: 'students/345a131e227c7b3d/693e0b20f0f7d0a0897cf335c1b48e58-polymer composites final full edited and the final.docx',
    storedName: '693e0b20f0f7d0a0897cf335c1b48e58.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sourceFile: path.join(__dirname, '..', 'Xeroxic_IEEE_Research_Paper_Revised.docx')
  },
  {
    orderId: 'sumit12001',
    fileId: '851de2ff3cc75675ebb8707c971b9a3a',
    ownerId: '321929a7722cb3b9',
    originalName: 'IMXvRMXNxqn3Q.png',
    filePath: 'students/321929a7722cb3b9/851de2ff3cc75675ebb8707c971b9a3a-IMXvRMXNxqn3Q.png',
    storedName: '851de2ff3cc75675ebb8707c971b9a3a.png',
    mimeType: 'image/png',
    sourceFile: path.join(__dirname, '..', 'public', 'images', 'login-bg.png')
  },
  {
    orderId: 'sumit11003',
    fileId: '08184c93b481c761039fcc11412f7c19',
    ownerId: '321929a7722cb3b9',
    originalName: 'Converted_Document.pdf',
    filePath: 'students/321929a7722cb3b9/08184c93b481c761039fcc11412f7c19-Converted_Document.pdf',
    storedName: '08184c93b481c761039fcc11412f7c19.pdf',
    mimeType: 'application/pdf',
    sourceFile: '/Users/sumit/.gemini/antigravity/brain/97579de4-d92f-4dd2-8d09-bd4afe128e84/Xeroxic_IEEE_Literature_Review.pdf'
  },
  {
    orderId: 'sumit11002',
    fileId: '494bde338a863af2f744cd353c22b6c2',
    ownerId: '321929a7722cb3b9',
    originalName: 'Converted_Document.pdf',
    filePath: 'students/321929a7722cb3b9/494bde338a863af2f744cd353c22b6c2-Converted_Document.pdf',
    storedName: '494bde338a863af2f744cd353c22b6c2.pdf',
    mimeType: 'application/pdf',
    sourceFile: '/Users/sumit/.gemini/antigravity/brain/97579de4-d92f-4dd2-8d09-bd4afe128e84/Xeroxic_IEEE_Literature_Review.pdf'
  },
  {
    orderId: 'sumit11001',
    fileId: '8aaf3f0d5b0c92ae3ae224890ad68ae9',
    ownerId: '321929a7722cb3b9',
    originalName: 'IMXvRMXNxqn3Q.png',
    filePath: 'students/321929a7722cb3b9/8aaf3f0d5b0c92ae3ae224890ad68ae9-IMXvRMXNxqn3Q.png',
    storedName: '8aaf3f0d5b0c92ae3ae224890ad68ae9.png',
    mimeType: 'image/png',
    sourceFile: path.join(__dirname, '..', 'public', 'images', 'login-bg.png')
  }
];

async function seed() {
  const supabase = getSupabaseAdminClient();
  const bucket = getBucketName();
  const cfg = getStorageConfig();
  const records = [];

  for (const item of filesToSeed) {
    console.log(`Processing file for ${item.orderId}: ${item.originalName}...`);
    const buf = fs.readFileSync(item.sourceFile);

    // 1. Write to local disk uploads dir
    const userDir = path.join(cfg.uploadsDir, item.ownerId);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, item.storedName), buf);
    const safeOrigName = path.basename(item.originalName).replace(/[^\w\s.-]/gi, '_').replace(/\s+/g, ' ').trim() || 'document';
    fs.writeFileSync(path.join(userDir, `${item.fileId}-${safeOrigName}`), buf);

    // 2. Also write to bundled_uploads
    const bundledDir = path.join(process.cwd(), 'data', 'bundled_uploads', item.ownerId);
    if (!fs.existsSync(bundledDir)) fs.mkdirSync(bundledDir, { recursive: true });
    fs.writeFileSync(path.join(bundledDir, item.storedName), buf);
    fs.writeFileSync(path.join(bundledDir, `${item.fileId}-${safeOrigName}`), buf);

    // 3. Upload to Supabase Storage
    const { error: upErr } = await supabase.storage.from(bucket).upload(item.filePath, buf, {
      contentType: item.mimeType,
      upsert: true
    });
    if (upErr) {
      console.warn(`Supabase upload failed for ${item.filePath}:`, upErr.message);
    } else {
      console.log(`Successfully uploaded to Supabase: ${item.filePath}`);
    }

    records.push({
      id: item.fileId,
      ownerId: item.ownerId,
      originalName: item.originalName,
      storedName: item.storedName,
      filePath: item.filePath,
      bucket,
      size: buf.length,
      mimeType: item.mimeType,
      uploadedAt: new Date().toISOString(),
      storageProvider: 'supabase'
    });
  }

  // 4. Save file records to MongoDB / KV
  await saveFiles(records);
  console.log(`Successfully saved ${records.length} records into files DB!`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed fatal error:', err);
  process.exit(1);
});
