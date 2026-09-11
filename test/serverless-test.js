// ===================================================================
// Xerox Centre — Automated Serverless & API Verification Test
// Tests both local execution and simulated Vercel serverless calls
// ===================================================================

process.env.VERCEL = '1'; // Test against serverless /tmp isolation

const fs = require('fs');
try {
  fs.rmSync('/tmp/xerox-data', { recursive: true, force: true });
  fs.rmSync('/tmp/xerox-uploads', { recursive: true, force: true });
} catch (e) {}

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
  assert.strictEqual(trackData.status, 'New');
  console.log('   ✅ Order tracking passed (initial status: New)');

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

  // Test 13: Admin Login
  console.log('13. Testing Admin Login with default seeded credentials...');
  const adminLoginRes = await invokeHandler({
    method: 'POST',
    url: '/api/login',
    body: { email: 'admin@aitpune.edu.in', password: 'admin123', role: 'admin' }
  });
  assert.strictEqual(adminLoginRes.statusCode, 200, `Admin login failed: ${adminLoginRes.text()}`);
  const adminLoginData = adminLoginRes.json();
  assert.strictEqual(adminLoginData.role, 'admin');
  assert.strictEqual(adminLoginData.redirect, 'admin.html');
  const adminCookie = adminLoginRes.headers['set-cookie'].split(';')[0];
  console.log('   ✅ Admin login passed (role: admin, redirect: admin.html)');

  // Test 14: Non-admin student blocked from Admin endpoint (403)
  console.log('14. Testing Role Protection (Student rejected from Admin endpoint with 403)...');
  const forbiddenRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/orders',
    headers: { cookie: sessionCookie } // sessionCookie is from the student user in Test 3
  });
  assert.strictEqual(forbiddenRes.statusCode, 403, 'Student must be rejected with 403');
  console.log('   ✅ Role protection passed (403 Forbidden verified)');

  // Test 15: Admin accessing all document requests & stats
  console.log('15. Testing Admin GET /api/admin/orders & GET /api/admin/stats...');
  const adminOrdersRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/orders',
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(adminOrdersRes.statusCode, 200);
  const adminOrdersData = adminOrdersRes.json();
  assert(Array.isArray(adminOrdersData.orders));
  assert(adminOrdersData.orders.some(o => o.orderId === createdOrderId));
  console.log(`   ✅ Admin successfully retrieved all ${adminOrdersData.orders.length} document requests`);

  // Test 16: Admin updating order status through 5 stages
  console.log('16. Testing 5-stage Order Status Workflow (New → Accepted → Printing → Ready for Collection → Collected)...');
  for (const st of ['Accepted', 'Printing', 'Ready for Collection', 'Collected']) {
    const updateStatusRes = await invokeHandler({
      method: 'PATCH',
      url: `/api/admin/orders/${createdOrderId}/status`,
      headers: { cookie: adminCookie },
      body: { status: st }
    });
    assert.strictEqual(updateStatusRes.statusCode, 200, `Failed to update status to ${st}`);
    assert.strictEqual(updateStatusRes.json().status, st);
  }
  console.log('   ✅ 5-stage status workflow passed (Accepted → Printing → Ready for Collection → Collected)');

  // Test 17: Admin downloading student document
  console.log('17. Testing Admin document download permission (GET /api/download/:id)...');
  const adminDownloadRes = await invokeHandler({
    method: 'GET',
    url: `/api/download/${uploadedFileId}`,
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(adminDownloadRes.statusCode, 200);
  assert.strictEqual(adminDownloadRes.text(), fileContent);
  console.log('   ✅ Admin document download verified successfully');

  // Test 18: Fetching Public Assignments as Student
  console.log('18. Testing GET /api/assignments (student view)...');
  const assignmentsRes = await invokeHandler({
    method: 'GET',
    url: '/api/assignments',
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(assignmentsRes.statusCode, 200);
  const assignmentsData = assignmentsRes.json();
  assert(Array.isArray(assignmentsData.assignments));
  assert(assignmentsData.assignments.length >= 1);
  console.log(`   ✅ Assignments list retrieved successfully (${assignmentsData.assignments.length} assignments found)`);

  // Test 19: Non-Admin blocked from creating assignment (403)
  console.log('19. Testing Role Protection on POST /api/admin/assignments (Student rejected with 403)...');
  const studentCreateAsgnRes = await invokeHandler({
    method: 'POST',
    url: '/api/admin/assignments',
    headers: { cookie: sessionCookie },
    body: { subject: 'Physics', title: 'Optics Lab' }
  });
  assert.strictEqual(studentCreateAsgnRes.statusCode, 403);
  console.log('   ✅ Student assignment creation rejected with 403');

  // Test 20: Admin creating assignment with demo attachment
  console.log('20. Testing Admin POST /api/admin/assignments (with demo attachment)...');
  const demoContent = 'DEMO_EXPERIMENT_ATTACHMENT_CONTENT';
  const newAsgnRes = await invokeHandler({
    method: 'POST',
    url: '/api/admin/assignments',
    headers: { cookie: adminCookie },
    body: {
      subject: 'Artificial Intelligence',
      experimentNo: 'Exp 01',
      title: 'A* Search Algorithm Implementation',
      info: 'Implement A* search algorithm for 8-puzzle problem with Manhattan heuristic.',
      submissionGuidelines: 'Submit printed spiral report before end of week.',
      deadline: '2026-10-15',
      attachment: {
        originalName: 'AI_Exp1_Demo.txt',
        mimeType: 'text/plain',
        size: demoContent.length,
        dataBase64: Buffer.from(demoContent).toString('base64')
      }
    }
  });
  assert.strictEqual(newAsgnRes.statusCode, 201);
  const createdAsgn = newAsgnRes.json().assignment;
  assert(createdAsgn.id);
  assert.strictEqual(createdAsgn.subject, 'Artificial Intelligence');
  console.log(`   ✅ Admin successfully created assignment: ${createdAsgn.id}`);

  // Test 21: Downloading/previewing demo attachment
  console.log('21. Testing GET /api/assignments/:id/attachment...');
  const attachRes = await invokeHandler({
    method: 'GET',
    url: `/api/assignments/${createdAsgn.id}/attachment`,
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(attachRes.statusCode, 200);
  assert.strictEqual(attachRes.text(), demoContent);
  console.log('   ✅ Demo attachment download/preview verified successfully');

  // Test 22: Placing Order with UPI Gateway & UTR Reference
  console.log('22. Testing POST /api/orders with UPI Payment & UTR reference...');
  const upiOrderRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders',
    headers: { cookie: sessionCookie },
    body: {
      items: [{ fileId: uploadedFileId, originalName: 'report.txt', pages: 2, sides: 'single', color: 'bw' }],
      paymentMethod: 'UPI',
      utr: '123456789012'
    }
  });
  assert.strictEqual(upiOrderRes.statusCode, 200);
  const upiOrderData = upiOrderRes.json();
  assert.strictEqual(upiOrderData.paymentMethod, 'UPI');

  const trackUpiRes = await invokeHandler({
    method: 'GET',
    url: `/api/orders/${upiOrderData.orderId}`,
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(trackUpiRes.json().paymentMethod, 'UPI');
  assert.strictEqual(trackUpiRes.json().utr, '123456789012');
  console.log('   ✅ UPI order placement & UTR tracking verified successfully');

  // Test 23: Admin deleting assignment
  console.log('23. Testing Admin DELETE /api/admin/assignments/:id...');
  const deleteAsgnRes = await invokeHandler({
    method: 'DELETE',
    url: `/api/admin/assignments/${createdAsgn.id}`,
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(deleteAsgnRes.statusCode, 200);
  assert.strictEqual(deleteAsgnRes.json().success, true);
  console.log('   ✅ Admin successfully deleted assignment');

  // Test 24: Super Admin Login
  console.log('24. Testing Super Admin Login (superadmin@aitpune.edu.in)...');
  const superLoginRes = await invokeHandler({
    method: 'POST',
    url: '/api/login',
    body: { email: 'superadmin@aitpune.edu.in', password: 'superadmin123', role: 'admin' }
  });
  assert.strictEqual(superLoginRes.statusCode, 200, `Super admin login failed: ${superLoginRes.text()}`);
  const superLoginData = superLoginRes.json();
  assert.strictEqual(superLoginData.role, 'superadmin');
  assert.strictEqual(superLoginData.redirect, 'super-admin.html');
  const superCookie = superLoginRes.headers['set-cookie'].split(';')[0];
  console.log('   ✅ Super Admin login passed (role: superadmin, redirect: super-admin.html)');

  // Test 25: Normal Admin blocked from Super Admin endpoint (403)
  console.log('25. Testing Super Admin Role Protection (Admin rejected with 403)...');
  const adminBlockedRes = await invokeHandler({
    method: 'GET',
    url: '/api/superadmin/staff',
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(adminBlockedRes.statusCode, 403, 'Normal admin must be rejected from superadmin routes with 403');
  console.log('   ✅ Role isolation passed: Admin rejected from Super Admin endpoint with 403');

  // Test 26: Super Admin creating a new staff account
  console.log('26. Testing Super Admin POST /api/superadmin/staff & GET /api/superadmin/staff...');
  const tempStaffEmail = `staff_${Date.now()}@aitpune.edu.in`;
  const createStaffRes = await invokeHandler({
    method: 'POST',
    url: '/api/superadmin/staff',
    headers: { cookie: superCookie },
    body: {
      name: 'Pooja Sharma',
      email: tempStaffEmail,
      password: 'password123',
      role: 'admin'
    }
  });
  assert.strictEqual(createStaffRes.statusCode, 201, `Failed to create staff: ${createStaffRes.text()}`);
  const createdStaff = createStaffRes.json().staff;
  assert.strictEqual(createdStaff.email, tempStaffEmail);
  assert.strictEqual(createdStaff.role, 'admin');
  assert.strictEqual(createdStaff.disabled, false);

  const getStaffRes = await invokeHandler({
    method: 'GET',
    url: '/api/superadmin/staff',
    headers: { cookie: superCookie }
  });
  assert.strictEqual(getStaffRes.statusCode, 200);
  assert(getStaffRes.json().staff.some(s => s.id === createdStaff.id));
  console.log('   ✅ Super Admin staff creation & listing passed');

  // Test 27: Super Admin disabling staff account & verifying blocked login
  console.log('27. Testing Staff Disable & Blocked Login...');
  const disableRes = await invokeHandler({
    method: 'PATCH',
    url: `/api/superadmin/staff/${createdStaff.id}/status`,
    headers: { cookie: superCookie },
    body: { disabled: true }
  });
  assert.strictEqual(disableRes.statusCode, 200);
  assert.strictEqual(disableRes.json().staff.disabled, true);

  // Attempt login with disabled account -> must return 403
  const disabledLoginRes = await invokeHandler({
    method: 'POST',
    url: '/api/login',
    body: { email: tempStaffEmail, password: 'password123', role: 'admin' }
  });
  assert.strictEqual(disabledLoginRes.statusCode, 403, 'Disabled account must be blocked from logging in with 403');
  console.log('   ✅ Disabled staff account successfully blocked with 403');

  // Test 28: Super Admin resetting staff password and re-enabling
  console.log('28. Testing Super Admin password reset and re-enabling staff account...');
  const resetPwdRes = await invokeHandler({
    method: 'POST',
    url: `/api/superadmin/staff/${createdStaff.id}/reset-password`,
    headers: { cookie: superCookie },
    body: { newPassword: 'newSecretPassword2026' }
  });
  assert.strictEqual(resetPwdRes.statusCode, 200);

  // Re-enable
  await invokeHandler({
    method: 'PATCH',
    url: `/api/superadmin/staff/${createdStaff.id}/status`,
    headers: { cookie: superCookie },
    body: { disabled: false }
  });

  // Login with new password
  const newPwdLoginRes = await invokeHandler({
    method: 'POST',
    url: '/api/login',
    body: { email: tempStaffEmail, password: 'newSecretPassword2026', role: 'admin' }
  });
  assert.strictEqual(newPwdLoginRes.statusCode, 200, 'Login with reset password failed');
  console.log('   ✅ Staff password reset & re-enabled login passed');

  // Test 29: Dynamic Pricing Management
  console.log('29. Testing Dynamic Pricing Management (GET /api/pricing & POST /api/superadmin/pricing)...');
  const initialPricingRes = await invokeHandler({ method: 'GET', url: '/api/pricing' });
  assert.strictEqual(initialPricingRes.statusCode, 200);

  const updatedPricingRes = await invokeHandler({
    method: 'POST',
    url: '/api/superadmin/pricing',
    headers: { cookie: superCookie },
    body: {
      'bw-single': 2.5,
      'bw-double': 3.5,
      'color-single': 6,
      'color-double': 9
    }
  });
  assert.strictEqual(updatedPricingRes.statusCode, 200);
  assert.strictEqual(updatedPricingRes.json().pricing['bw-single'], 2.5);

  const verifyPricingRes = await invokeHandler({ method: 'GET', url: '/api/pricing' });
  assert.strictEqual(verifyPricingRes.json()['bw-single'], 2.5);
  console.log('   ✅ Dynamic pricing update and public retrieval verified');

  // Test 30: Clean URL Routing (/admin, /admin/dashboard, /super-admin)
  console.log('30. Testing Clean URL Routing (/admin, /admin/dashboard, /super-admin)...');
  const adminPageRes = await invokeHandler({ method: 'GET', url: '/admin' });
  assert.strictEqual(adminPageRes.statusCode, 200);
  assert(adminPageRes.text().includes('Admin Portal Sign In'));

  const adminDashRes = await invokeHandler({ method: 'GET', url: '/admin/dashboard' });
  assert.strictEqual(adminDashRes.statusCode, 200);
  assert(adminDashRes.text().includes('Print Document Requests'));

  const superAdminPageRes = await invokeHandler({ method: 'GET', url: '/super-admin' });
  assert.strictEqual(superAdminPageRes.statusCode, 200);
  assert(superAdminPageRes.text().includes('Super Admin Control Centre'));
  console.log('   ✅ Clean URL routing passed (/admin, /admin/dashboard, /super-admin)');

  console.log('\n🎉 ALL 30 TESTS PASSED SUCCESSFULLY! Full admin & super-admin system verified.\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
