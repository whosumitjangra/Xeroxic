// ===================================================================
// Xerox Centre — Automated Serverless & API Verification Test
// Tests both local execution and simulated Vercel serverless calls
// ===================================================================

process.env.VERCEL = '1'; // Test against serverless /tmp isolation

const assert = require('assert');
const EventEmitter = require('events');
const handler = require('../api/index');
const { createSessionToken, verifySessionToken } = require('../lib/auth');

// Helper to mock an HTTP request and response for handler(req, res)
function invokeHandler({ method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = { ...headers };

    let bodyBuffer = null;
    if (body !== null) {
      if (Buffer.isBuffer(body)) {
        bodyBuffer = body;
      } else if (typeof body === 'string') {
        bodyBuffer = Buffer.from(body);
      } else {
        bodyBuffer = Buffer.from(JSON.stringify(body));
        if (!req.headers['content-type']) {
          req.headers['content-type'] = 'application/json';
        }
      }
      req.headers['content-length'] = bodyBuffer.length;
    }

    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    const chunks = [];

    res.setHeader = (key, val) => {
      res.headers[key.toLowerCase()] = val;
    };
    res.writeHead = (statusCode, headers = {}) => {
      res.statusCode = statusCode;
      for (const [k, v] of Object.entries(headers)) {
        res.headers[k.toLowerCase()] = v;
      }
    };
    res.write = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    res.end = (chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const responseBuffer = Buffer.concat(chunks);
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        bodyBuffer,
        text: () => responseBuffer.toString('utf-8'),
        json: () => JSON.parse(responseBuffer.toString('utf-8'))
      });
    };

    // Execute handler
    handler(req, res).catch(reject);

    // Push body chunks if any
    setImmediate(() => {
      if (bodyBuffer) {
        req.emit('data', bodyBuffer);
      }
      req.emit('end');
    });
  });
}

async function runTests() {
  console.log('🧪 Starting Xerox Centre Serverless & API Test Suite...\n');

  // Test 1: Auth Library Token Generation & Verification
  console.log('1. Testing Stateless HMAC-SHA256 Auth Tokens...');
  const testUser = { id: 'usr_123', name: 'AIT Student', email: 'student@aitpune.edu.in' };
  const token = createSessionToken(testUser);
  assert(token && token.includes('.'), 'Token must be in payload.signature format');
  const verified = verifySessionToken(token);
  assert.strictEqual(verified.userId, testUser.id);
  assert.strictEqual(verified.email, testUser.email);
  // Verify tampering fails
  const tamperedToken = token.slice(0, -4) + 'abcd';
  assert.strictEqual(verifySessionToken(tamperedToken), null, 'Tampered token must be rejected');
  console.log('   ✅ Auth token verification passed');

  // Test 2: Static file serving (e.g. index.html)
  console.log('2. Testing Static File Serving via handler...');
  const indexRes = await invokeHandler({ method: 'GET', url: '/' });
  assert.strictEqual(indexRes.statusCode, 200);
  assert(indexRes.text().includes('Xerox Centre'), 'Index page must contain Xerox Centre branding');
  console.log('   ✅ Static file handler passed');

  // Test 3: User Signup via API
  console.log('3. Testing POST /api/signup...');
  const randomSuffix = Math.random().toString(36).substring(7);
  const newEmail = `user_${randomSuffix}@aitpune.edu.in`;
  const signupRes = await invokeHandler({
    method: 'POST',
    url: '/api/signup',
    body: { name: 'Test User', email: newEmail, password: 'password123' }
  });
  assert.strictEqual(signupRes.statusCode, 200, `Signup failed: ${signupRes.text()}`);
  const signupData = signupRes.json();
  assert.strictEqual(signupData.success, true);
  const cookieHeader = signupRes.headers['set-cookie'];
  assert(cookieHeader && cookieHeader.includes('session='), 'Set-Cookie header must be present');
  const sessionCookie = cookieHeader.split(';')[0];
  console.log('   ✅ User signup & session cookie set passed');

  // Test 4: Current user check via GET /api/me with session cookie
  console.log('4. Testing GET /api/me (stateless session across requests)...');
  const meRes = await invokeHandler({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(meRes.statusCode, 200, `GET /api/me failed: ${meRes.text()}`);
  assert.strictEqual(meRes.json().email, newEmail);
  console.log('   ✅ Stateless session verification passed');

  // Test 5: Vercel Rewrite simulation (__route query parameter)
  console.log('5. Testing Vercel Rewrite URL mapping (/api/index.js?__route=me)...');
  const rewriteRes = await invokeHandler({
    method: 'GET',
    url: '/api/index.js?__route=me',
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(rewriteRes.statusCode, 200, `Rewrite routing failed: ${rewriteRes.text()}`);
  assert.strictEqual(rewriteRes.json().email, newEmail);
  console.log('   ✅ Vercel rewrite route mapping passed');

  // Test 6: File Upload via multipart/form-data
  console.log('6. Testing POST /api/upload...');
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const fileContent = 'Hello Xerox Centre Print Job Test Content';
  const multipartBody = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="files"; filename="sample-notes.txt"',
    'Content-Type: text/plain',
    '',
    fileContent,
    `--${boundary}--`,
    ''
  ].join('\r\n');

  const uploadRes = await invokeHandler({
    method: 'POST',
    url: '/api/upload',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: sessionCookie
    },
    body: multipartBody
  });
  assert.strictEqual(uploadRes.statusCode, 200, `Upload failed: ${uploadRes.text()}`);
  const uploadData = uploadRes.json();
  assert(uploadData.success && uploadData.files.length > 0);
  const uploadedFileId = uploadData.files[0].id;
  console.log(`   ✅ File upload passed (File ID: ${uploadedFileId})`);

  // Test 7: List Files via GET /api/files
  console.log('7. Testing GET /api/files...');
  const listFilesRes = await invokeHandler({
    method: 'GET',
    url: '/api/files',
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(listFilesRes.statusCode, 200);
  const filesList = listFilesRes.json().files;
  assert(filesList.some(f => f.id === uploadedFileId), 'Uploaded file must be in list');
  console.log('   ✅ File list retrieval passed');

  // Test 8: Download uploaded file via GET /api/download/:id
  console.log('8. Testing GET /api/download/:id...');
  const downloadRes = await invokeHandler({
    method: 'GET',
    url: `/api/download/${uploadedFileId}`,
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(downloadRes.statusCode, 200);
  assert.strictEqual(downloadRes.text(), fileContent);
  console.log('   ✅ File download & content verification passed');

  // Test 9: Place an Order via POST /api/orders
  console.log('9. Testing POST /api/orders...');
  const orderRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders',
    headers: { cookie: sessionCookie },
    body: {
      items: [
        {
          fileId: uploadedFileId,
          originalName: 'sample-notes.txt',
          pages: 10,
          sides: 'double',
          color: 'bw'
        }
      ]
    }
  });
  assert.strictEqual(orderRes.statusCode, 200, `Order creation failed: ${orderRes.text()}`);
  const orderData = orderRes.json();
  assert(orderData.success);
  assert.strictEqual(orderData.total, 30); // 10 pages * bw-double (₹3) = ₹30
  const createdOrderId = orderData.orderId;
  console.log(`   ✅ Order placed successfully (Order ID: ${createdOrderId}, Total: ₹${orderData.total})`);

  // Test 10: Track Order via GET /api/orders/:id
  console.log('10. Testing GET /api/orders/:id (order tracking)...');
  const trackRes = await invokeHandler({
    method: 'GET',
    url: `/api/orders/${createdOrderId}`,
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(trackRes.statusCode, 200);
  const trackData = trackRes.json();
  assert.strictEqual(trackData.orderId, createdOrderId);
  assert.strictEqual(trackData.total, 30);
  assert.strictEqual(trackData.status, 'Order Received');
  console.log('   ✅ Order tracking passed');

  // Test 11: Logout via POST /api/logout
  console.log('11. Testing POST /api/logout...');
  const logoutRes = await invokeHandler({
    method: 'POST',
    url: '/api/logout',
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(logoutRes.statusCode, 200);
  assert(logoutRes.headers['set-cookie'].includes('Max-Age=0'), 'Logout must clear cookie');
  console.log('   ✅ Logout passed');

  // Test 12: Storage configuration in simulated Vercel environment (VERCEL=1)
  console.log('12. Testing Storage isolation in simulated Vercel environment (VERCEL=1)...');
  const { execSync } = require('child_process');
  const out = execSync('VERCEL=1 node -e "const { getStorageConfig } = require(\'./lib/storage\'); const cfg = getStorageConfig(); console.log(JSON.stringify(cfg));"', {
    cwd: require('path').resolve(__dirname, '..'),
    encoding: 'utf-8'
  });
  const cfg = JSON.parse(out.trim());
  assert.strictEqual(cfg.isServerlessTmp, true, 'Must use /tmp storage when VERCEL=1');
  assert(cfg.dataDir.startsWith('/tmp'), 'Data directory must be in /tmp');
  console.log('   ✅ VERCEL=1 /tmp storage isolation passed');

  console.log('\n🎉 ALL 12 TESTS PASSED SUCCESSFULLY! Ready for Vercel deployment.\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
