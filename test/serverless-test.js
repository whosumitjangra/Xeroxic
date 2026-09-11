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

  // Ensure default pricing is initialized
  const storage = require('../lib/storage');
  await storage.savePricing({ 'bw-single': 2, 'bw-double': 3, 'color-single': 5, 'color-double': 8 });

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
  assert.strictEqual(trackData.status, 'REQUEST_RECEIVED');
  console.log('   ✅ Order tracking passed (initial status: REQUEST_RECEIVED)');

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
  assert.strictEqual(adminLoginData.role, 'ADMIN');
  assert.strictEqual(adminLoginData.redirect, 'admin.html');
  const adminCookie = adminLoginRes.headers['set-cookie'].split(';')[0];
  console.log('   ✅ Admin login passed (role: ADMIN, redirect: admin.html)');

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
  console.log('16. Testing 5-stage Order Status Workflow (REQUEST_RECEIVED → ACCEPTED → PRINTING → READY → COMPLETED)...');
  const expectedNorm = {
    'Accepted': 'ACCEPTED',
    'Printing': 'PRINTING',
    'Ready for Collection': 'READY',
    'Collected': 'COMPLETED'
  };
  for (const st of ['Accepted', 'Printing', 'Ready for Collection', 'Collected']) {
    const updateStatusRes = await invokeHandler({
      method: 'PATCH',
      url: `/api/admin/orders/${createdOrderId}/status`,
      headers: { cookie: adminCookie },
      body: { status: st }
    });
    assert.strictEqual(updateStatusRes.statusCode, 200, `Failed to update status to ${st}`);
    assert.strictEqual(updateStatusRes.json().status, expectedNorm[st]);
  }
  console.log('   ✅ 5-stage status workflow passed (ACCEPTED → PRINTING → READY → COMPLETED)');

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
  assert.strictEqual(superLoginData.role, 'SUPER_ADMIN');
  assert.strictEqual(superLoginData.redirect, 'super-admin.html');
  const superCookie = superLoginRes.headers['set-cookie'].split(';')[0];
  console.log('   ✅ Super Admin login passed (role: SUPER_ADMIN, redirect: super-admin.html)');

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
  assert(superAdminPageRes.text().includes('SUPER ADMIN') || superAdminPageRes.text().includes('Staff & Admin Accounts'));
  console.log('   ✅ Clean URL routing passed (/admin, /admin/dashboard, /super-admin)');

  // ===================================================================
  // STAGE 2 HARDENING TESTS (31 - 36): RBAC, 2-STEP PAYMENT & REQUEST QUEUE
  // ===================================================================

  // Test 31: Scenario 1 — Order Initiation -> Verify SUCCESS -> Order marked PAID -> Permanent PrintRequest created -> Admin Queue
  console.log('31. Testing Scenario 1: Order Initiation -> Verify SUCCESS -> Order marked PAID & PrintRequest created...');
  const initRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: sessionCookie },
    body: {
      items: [{ fileId: uploadedFileId, originalName: 'sample-notes.txt', pages: 3, sides: 'single', color: 'bw' }],
      copies: 2,
      pageRange: '1-3',
      paymentMethod: 'UPI'
    }
  });
  assert.strictEqual(initRes.statusCode, 200);
  const initData = initRes.json();
  assert(initData.orderId, 'Must return orderId');
  assert.strictEqual(initData.paymentStatus, 'PENDING_PAYMENT');
  assert.strictEqual(initData.status, 'REQUEST_RECEIVED');
  assert.strictEqual(initData.copies, 2);
  assert.strictEqual(initData.pageRange, '1-3');
  // bw-single was updated to 2.5 in Test 29. 3 pages * 2 copies * 2.5 = 15
  assert.strictEqual(initData.total, 15);
  const orderIdScenario1 = initData.orderId;

  // Verify payment with SUCCESS simulation
  const verifySuccessRes = await invokeHandler({
    method: 'POST',
    url: '/api/payments/verify',
    headers: { cookie: sessionCookie },
    body: {
      orderId: orderIdScenario1,
      simulationStatus: 'SUCCESS',
      utr: 'UTR_TEST_31_9999'
    }
  });
  assert.strictEqual(verifySuccessRes.statusCode, 200);
  const verifyData = verifySuccessRes.json();
  assert.strictEqual(verifyData.success, true);
  assert.strictEqual(verifyData.paymentStatus, 'PAID');
  assert.strictEqual(verifyData.requestStatus, 'REQUEST_RECEIVED');
  assert(verifyData.printRequestId, 'Must return printRequestId');

  // Verify that Admin can see this in GET /api/admin/requests
  const adminReqsRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/requests',
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(adminReqsRes.statusCode, 200);
  const adminReqs = adminReqsRes.json().requests;
  assert(Array.isArray(adminReqs));
  const foundReq = adminReqs.find(r => r.orderId === orderIdScenario1);
  assert(foundReq, 'Order must be present in admin requests queue');
  assert.strictEqual(foundReq.paymentStatus, 'PAID');
  assert.strictEqual(foundReq.requestStatus, 'REQUEST_RECEIVED');
  assert.strictEqual(foundReq.copies, 2);
  assert.strictEqual(foundReq.pageRange, '1-3');

  // Admin updates request status: REQUEST_RECEIVED -> ACCEPTED
  const updateReqRes = await invokeHandler({
    method: 'PATCH',
    url: `/api/admin/requests/${foundReq.id}/status`,
    headers: { cookie: adminCookie },
    body: { status: 'ACCEPTED' }
  });
  assert.strictEqual(updateReqRes.statusCode, 200);
  assert.strictEqual(updateReqRes.json().success, true);

  // Student checks order status -> should now be ACCEPTED
  const studentTrackRes = await invokeHandler({
    method: 'GET',
    url: `/api/orders/${orderIdScenario1}`,
    headers: { cookie: sessionCookie }
  });
  assert.strictEqual(studentTrackRes.statusCode, 200);
  assert.strictEqual(studentTrackRes.json().status, 'ACCEPTED');
  console.log('   ✅ Scenario 1 passed: Order initiated, verified SUCCESS, saved to PrintRequests, and updated by admin');

  // Test 32: Scenario 2 — Order Initiation -> Verify CANCELLED -> Order marked CANCELLED -> No PrintRequest created
  console.log('32. Testing Scenario 2: Order Initiation -> Verify CANCELLED -> Order CANCELLED & no PrintRequest...');
  const initCancelRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: sessionCookie },
    body: {
      items: [{ fileId: uploadedFileId, originalName: 'sample-notes.txt', pages: 1, sides: 'single', color: 'bw' }],
      copies: 1,
      paymentMethod: 'UPI'
    }
  });
  assert.strictEqual(initCancelRes.statusCode, 200);
  const cancelOrderId = initCancelRes.json().orderId;

  const verifyCancelRes = await invokeHandler({
    method: 'POST',
    url: '/api/payments/verify',
    headers: { cookie: sessionCookie },
    body: {
      orderId: cancelOrderId,
      simulationStatus: 'CANCELLED'
    }
  });
  assert.strictEqual(verifyCancelRes.statusCode, 200);
  assert.strictEqual(verifyCancelRes.json().success, false);
  assert.strictEqual(verifyCancelRes.json().paymentStatus, 'CANCELLED');

  // Check admin requests queue -> must NOT contain this cancelled order
  const checkCancelReqsRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/requests',
    headers: { cookie: adminCookie }
  });
  const cancelReqFound = checkCancelReqsRes.json().requests.find(r => r.orderId === cancelOrderId);
  assert.strictEqual(cancelReqFound, undefined, 'Cancelled payment order must not produce a PrintRequest');
  console.log('   ✅ Scenario 2 passed: Cancelled payment handled cleanly without print request creation');

  // Test 33: Scenario 3 — Order Initiation -> Verify FAILED -> 400 error -> No PrintRequest created
  console.log('33. Testing Scenario 3: Order Initiation -> Verify FAILED -> 400 error & no PrintRequest...');
  const initFailRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: sessionCookie },
    body: {
      items: [{ fileId: uploadedFileId, originalName: 'sample-notes.txt', pages: 2, sides: 'single', color: 'bw' }],
      copies: 1,
      paymentMethod: 'UPI'
    }
  });
  assert.strictEqual(initFailRes.statusCode, 200);
  const failOrderId = initFailRes.json().orderId;

  const verifyFailRes = await invokeHandler({
    method: 'POST',
    url: '/api/payments/verify',
    headers: { cookie: sessionCookie },
    body: {
      orderId: failOrderId,
      simulationStatus: 'FAILED'
    }
  });
  assert.strictEqual(verifyFailRes.statusCode, 400);
  assert.strictEqual(verifyFailRes.json().success, false);
  assert.strictEqual(verifyFailRes.json().paymentStatus, 'FAILED');

  // Check admin requests queue -> must NOT contain this failed order
  const checkFailReqsRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/requests',
    headers: { cookie: adminCookie }
  });
  const failReqFound = checkFailReqsRes.json().requests.find(r => r.orderId === failOrderId);
  assert.strictEqual(failReqFound, undefined, 'Failed payment order must not produce a PrintRequest');
  console.log('   ✅ Scenario 3 passed: Failed payment returned 400 and created no print request');

  // Test 34: Scenario 4 — Admin Role Security: Admin rejected with 403 on Student-only endpoints
  console.log('34. Testing Scenario 4: Admin Role Security (403 Forbidden on Student endpoints)...');
  const adminUploadRes = await invokeHandler({
    method: 'POST',
    url: '/api/upload',
    headers: { cookie: adminCookie },
    body: 'dummy'
  });
  assert.strictEqual(adminUploadRes.statusCode, 403);
  assert(adminUploadRes.json().error.includes('Forbidden'));

  const adminInitRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: adminCookie },
    body: { items: [] }
  });
  assert.strictEqual(adminInitRes.statusCode, 403);
  assert(adminInitRes.json().error.includes('Forbidden'));

  const adminFilesRes = await invokeHandler({
    method: 'GET',
    url: '/api/files',
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(adminFilesRes.statusCode, 403);
  console.log('   ✅ Scenario 4 passed: Admin blocked with 403 on all student-only endpoints');

  // Test 35: Scenario 5 — Super Admin Role Security: Super Admin rejected with 403 on Student endpoints
  console.log('35. Testing Scenario 5: Super Admin Role Security (403 Forbidden on Student endpoints)...');
  const superUploadRes = await invokeHandler({
    method: 'POST',
    url: '/api/upload',
    headers: { cookie: superCookie },
    body: 'dummy'
  });
  assert.strictEqual(superUploadRes.statusCode, 403);
  assert(superUploadRes.json().error.includes('Forbidden'));

  const superInitRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: superCookie },
    body: { items: [] }
  });
  assert.strictEqual(superInitRes.statusCode, 403);
  assert(superInitRes.json().error.includes('Forbidden'));

  const superFilesRes = await invokeHandler({
    method: 'GET',
    url: '/api/files',
    headers: { cookie: superCookie }
  });
  assert.strictEqual(superFilesRes.statusCode, 403);
  console.log('   ✅ Scenario 5 passed: Super Admin blocked with 403 on all student-only endpoints');

  // Test 36: Scenario 6 — Student Order Ownership Security: Student B cannot view Student A's order
  console.log('36. Testing Scenario 6: Student Order Ownership Security (403 Forbidden for other students)...');
  const signupBRes = await invokeHandler({
    method: 'POST',
    url: '/api/signup',
    body: { name: 'Student B', email: `studentB_${Date.now()}@aitpune.edu.in`, password: 'password123' }
  });
  assert.strictEqual(signupBRes.statusCode, 200);
  const studentBCookie = signupBRes.headers['set-cookie'].split(';')[0];

  const studentBAccessRes = await invokeHandler({
    method: 'GET',
    url: `/api/orders/${orderIdScenario1}`,
    headers: { cookie: studentBCookie }
  });
  assert.strictEqual(studentBAccessRes.statusCode, 403);
  assert(studentBAccessRes.json().error.includes('Forbidden'));
  console.log('   ✅ Scenario 6 passed: Student B correctly blocked with 403 when accessing Student A order');

  // Test 37: Student Portal Login Cross-Role Isolation (Admin & Super Admin blocked with 403 from Student login)
  console.log('37. Testing Student Portal Cross-Role Isolation (Admin & Super Admin blocked from Student login)...');
  const adminStudentLoginRes = await invokeHandler({
    method: 'POST',
    url: '/api/login',
    body: { email: 'admin@aitpune.edu.in', password: 'admin123', role: 'student' }
  });
  assert.strictEqual(adminStudentLoginRes.statusCode, 403);
  assert(adminStudentLoginRes.json().error.includes('Admin / Staff account'));

  const superStudentLoginRes = await invokeHandler({
    method: 'POST',
    url: '/api/login',
    body: { email: 'superadmin@aitpune.edu.in', password: 'superadmin123', role: 'student' }
  });
  assert.strictEqual(superStudentLoginRes.statusCode, 403);
  assert(superStudentLoginRes.json().error.includes('Admin / Staff account'));
  console.log('   ✅ Scenario 7 passed: Admin & Super Admin strictly prevented from signing in through Student portal');

  // Test 38: Asset Fallback (/admin/style.css, /admin/admin.js, /super-admin/style.css)
  console.log('38. Testing Asset Fallback for Subpaths (/admin/style.css, /admin/admin.js)...');
  const adminCssRes = await invokeHandler({ method: 'GET', url: '/admin/style.css' });
  assert.strictEqual(adminCssRes.statusCode, 200);
  assert(adminCssRes.text().includes('--green-main') || adminCssRes.text().includes('body'));

  const adminJsRes = await invokeHandler({ method: 'GET', url: '/admin/admin.js' });
  assert.strictEqual(adminJsRes.statusCode, 200);
  assert(adminJsRes.text().includes('checkAdminAuth'));

  const superCssRes = await invokeHandler({ method: 'GET', url: '/super-admin/style.css' });
  assert.strictEqual(superCssRes.statusCode, 200);
  assert(superCssRes.text().includes('--green-main') || superCssRes.text().includes('body'));
  console.log('   ✅ Subpath asset fallback verified: CSS and JS load properly for Admin and Super Admin');

  // Test 39: Persistent Database-Driven Admin Notifications
  console.log('39. Testing Persistent Database-Driven Admin Notifications (GET /api/admin/notifications)...');
  const notifsRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/notifications',
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(notifsRes.statusCode, 200);
  const notifsData = notifsRes.json();
  assert.strictEqual(notifsData.success, true);
  assert(Array.isArray(notifsData.notifications));
  assert(Array.isArray(notifsData.unread));
  console.log(`   ✅ Notifications retrieved successfully (${notifsData.notifications.length} total, ${notifsData.unreadCount} unread)`);

  // Test 40: Notification Acknowledgment & Deduplication
  console.log('40. Testing Notification Acknowledgment & Deduplication...');
  if (notifsData.unread.length > 0) {
    const targetNotif = notifsData.unread[0];
    const ackRes = await invokeHandler({
      method: 'POST',
      url: `/api/admin/notifications/${targetNotif.id}/acknowledge`,
      headers: { cookie: adminCookie }
    });
    assert.strictEqual(ackRes.statusCode, 200);
    assert.strictEqual(ackRes.json().success, true);

    // Verify it is acknowledged on next retrieval
    const afterAckRes = await invokeHandler({
      method: 'GET',
      url: '/api/admin/notifications',
      headers: { cookie: adminCookie }
    });
    const afterAckData = afterAckRes.json();
    const foundStillUnread = afterAckData.unread.some(n => n.id === targetNotif.id);
    assert.strictEqual(foundStillUnread, false, 'Acknowledged notification must not remain unread');
    console.log(`   ✅ Notification #${targetNotif.id} successfully acknowledged and removed from unread queue`);
  }

  // Test 41: Permanent Assignment Deletion & Resurrection Prevention (Create A & B -> Delete A -> Create C -> Verify A never returns)
  console.log('41. Testing Permanent Assignment Deletion & Resurrection Prevention...');
  const asgnAlphaRes = await invokeHandler({
    method: 'POST',
    url: '/api/admin/assignments',
    headers: { cookie: adminCookie },
    body: {
      subject: 'Physics Lab',
      experimentNo: 'Exp 01',
      title: 'Assignment Alpha - Laser Diffraction',
      info: 'Measure wavelength of He-Ne laser',
      submissionGuidelines: 'Submit spiral bound copy'
    }
  });
  assert.strictEqual(asgnAlphaRes.statusCode, 201);
  const asgnAlpha = asgnAlphaRes.json().assignment;

  const asgnBetaRes = await invokeHandler({
    method: 'POST',
    url: '/api/admin/assignments',
    headers: { cookie: adminCookie },
    body: {
      subject: 'Physics Lab',
      experimentNo: 'Exp 02',
      title: 'Assignment Beta - Optics Bench',
      info: 'Verify lens formula'
    }
  });
  assert.strictEqual(asgnBetaRes.statusCode, 201);
  const asgnBeta = asgnBetaRes.json().assignment;

  // Delete Assignment Alpha
  const delAlphaRes = await invokeHandler({
    method: 'DELETE',
    url: `/api/admin/assignments/${asgnAlpha.id}`,
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(delAlphaRes.statusCode, 200);

  // Verify Alpha is gone
  const checkAfterDel = await invokeHandler({
    method: 'GET',
    url: '/api/assignments',
    headers: { cookie: sessionCookie }
  });
  const listAfterDel = checkAfterDel.json().assignments;
  assert(!listAfterDel.some(a => a.id === asgnAlpha.id), 'Deleted assignment Alpha must not appear in list');

  // Create Assignment Gamma
  const asgnGammaRes = await invokeHandler({
    method: 'POST',
    url: '/api/admin/assignments',
    headers: { cookie: adminCookie },
    body: {
      subject: 'Physics Lab',
      experimentNo: 'Exp 03',
      title: 'Assignment Gamma - Hall Effect',
      info: 'Calculate Hall coefficient'
    }
  });
  assert.strictEqual(asgnGammaRes.statusCode, 201);

  // Verify list: Beta and Gamma exist, but Alpha MUST NOT return!
  const finalCheck = await invokeHandler({
    method: 'GET',
    url: '/api/assignments',
    headers: { cookie: sessionCookie }
  });
  const finalList = finalCheck.json().assignments;
  assert(!finalList.some(a => a.id === asgnAlpha.id), 'Deleted assignment Alpha MUST NOT reappear after adding Gamma!');
  assert(finalList.some(a => a.id === asgnBeta.id), 'Assignment Beta must still be present');
  assert(finalList.some(a => a.id === asgnGammaRes.json().assignment.id), 'Assignment Gamma must be present');
  console.log('   ✅ Assignment deletion persistence verified: deleted assignment does NOT reappear after adding new assignment');

  // Test 42: API Anti-Caching Headers Verification
  console.log('42. Testing Strict Anti-Caching Headers on API Endpoints...');
  const cacheCheckRes = await invokeHandler({
    method: 'GET',
    url: '/api/assignments',
    headers: { cookie: sessionCookie }
  });
  const cc = cacheCheckRes.headers['cache-control'] || '';
  assert(cc.includes('no-store'), 'API response must contain Cache-Control: no-store');
  assert(cc.includes('no-cache'), 'API response must contain Cache-Control: no-cache');
  console.log('   ✅ Strict Cache-Control: no-store, no-cache verified on API responses');

  // ===================================================================
  // AUDIT VERIFICATION TESTS: 8 REQUIRED SCENARIOS
  // ===================================================================

  // Test 43: Audit Scenario 1 — Complete/Review an item -> multiple query cycles -> confirm it never reappears in pending
  console.log('43. Testing Audit Scenario 1: Review/Complete item & verify it never reappears in pending across polling cycles...');
  const initAudit1 = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: sessionCookie },
    body: {
      items: [{ fileId: uploadedFileId, originalName: 'AuditDoc1.pdf', pages: 2, sides: 'single', color: 'bw' }],
      copies: 1
    }
  });
  const audit1OrderId = initAudit1.json().orderId;
  await invokeHandler({
    method: 'POST',
    url: '/api/payments/verify',
    headers: { cookie: sessionCookie },
    body: { orderId: audit1OrderId, simulationStatus: 'SUCCESS' }
  });

  // Admin marks completed
  const markDoneRes = await invokeHandler({
    method: 'PATCH',
    url: `/api/admin/orders/${audit1OrderId}/status`,
    headers: { cookie: adminCookie },
    body: { status: 'COMPLETED' }
  });
  assert.strictEqual(markDoneRes.statusCode, 200);

  // Poll 5 times (simulating polling intervals) and verify status is strictly COMPLETED and never reverts to REQUEST_RECEIVED
  for (let cycle = 1; cycle <= 5; cycle++) {
    const pollRes = await invokeHandler({
      method: 'GET',
      url: `/api/admin/orders?orderId=${audit1OrderId}`,
      headers: { cookie: adminCookie }
    });
    const foundOrder = pollRes.json().orders[0];
    assert.strictEqual(foundOrder.status, 'COMPLETED', `Cycle ${cycle}: Order status must remain COMPLETED and not revert`);
  }
  console.log('   ✅ Scenario 1 passed: Reviewed item permanently completed and never reverts to pending');

  // Test 44: Audit Scenario 2 — Filter changes (All, Pending, Completed) consistency
  console.log('44. Testing Audit Scenario 2: Filter consistency across All, Pending, Completed...');
  const allOrdersRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/orders',
    headers: { cookie: adminCookie }
  });
  const pendingOrdersRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/orders?status=pending',
    headers: { cookie: adminCookie }
  });
  const completedOrdersRes = await invokeHandler({
    method: 'GET',
    url: '/api/admin/orders?status=completed',
    headers: { cookie: adminCookie }
  });

  const pendingList = pendingOrdersRes.json().orders;
  const completedList = completedOrdersRes.json().orders;
  assert(!pendingList.some(o => o.orderId === audit1OrderId), 'Completed order must NOT be in pending filter list');
  assert(completedList.some(o => o.orderId === audit1OrderId), 'Completed order must be in completed filter list');
  console.log('   ✅ Scenario 2 passed: Filters strictly partition pending vs completed items');

  // Test 45: Audit Scenario 3 — Multiple payment-pending orders produce exactly 1 notification each (no duplicates)
  console.log('45. Testing Audit Scenario 3: Multiple payment-pending orders emit exactly 1 notification each...');
  const initPendingA = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: sessionCookie },
    body: { items: [{ fileId: uploadedFileId, originalName: 'DocA.pdf', pages: 1, sides: 'single', color: 'bw' }] }
  });
  const idPendingA = initPendingA.json().orderId;

  const notifsCheck1 = await invokeHandler({
    method: 'GET',
    url: '/api/admin/notifications',
    headers: { cookie: adminCookie }
  });
  const notifsForA = notifsCheck1.json().notifications.filter(n => n.orderId === idPendingA);
  assert.strictEqual(notifsForA.length, 1, 'Exactly one notification must exist for pending order');
  assert.strictEqual(notifsForA[0].paymentStatus, 'PENDING_PAYMENT');
  console.log('   ✅ Scenario 3 passed: Exactly one payment-pending notification created without duplicates');

  // Test 46: Audit Scenario 4 — Payment confirmation updates notification in-place without duplication
  console.log('46. Testing Audit Scenario 4: Payment confirmation updates notification to PAID in-place...');
  await invokeHandler({
    method: 'POST',
    url: '/api/payments/verify',
    headers: { cookie: sessionCookie },
    body: { orderId: idPendingA, simulationStatus: 'SUCCESS' }
  });

  const notifsCheck2 = await invokeHandler({
    method: 'GET',
    url: '/api/admin/notifications',
    headers: { cookie: adminCookie }
  });
  const notifsForAAfterPay = notifsCheck2.json().notifications.filter(n => n.orderId === idPendingA);
  assert.strictEqual(notifsForAAfterPay.length, 1, 'Still exactly one notification must exist (no duplicate created on payment)');
  assert.strictEqual(notifsForAAfterPay[0].paymentStatus, 'PAID');
  console.log('   ✅ Scenario 4 passed: Notification updated to PAID smoothly without duplication');

  // Test 47: Audit Scenario 5 — Tap notification resolves exact order by canonical ID even if not on active page
  console.log('47. Testing Audit Scenario 5: Notification click resolves exact canonical order record...');
  const singleOrderRes = await invokeHandler({
    method: 'GET',
    url: `/api/orders/${idPendingA}`,
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(singleOrderRes.statusCode, 200);
  assert.strictEqual(singleOrderRes.json().orderId, idPendingA);
  assert.strictEqual(singleOrderRes.json().paymentStatus, 'PAID');
  console.log('   ✅ Scenario 5 passed: Exact order record retrieved by canonical ID');

  // Test 48: Audit Scenario 6 — Tap notification for non-existent order returns 404
  console.log('48. Testing Audit Scenario 6: Non-existent order request returns clean 404...');
  const missingOrderRes = await invokeHandler({
    method: 'GET',
    url: '/api/orders/ORD-NONEXISTENT999',
    headers: { cookie: adminCookie }
  });
  assert.strictEqual(missingOrderRes.statusCode, 404);
  assert(missingOrderRes.json().error.includes('No order found'));
  console.log('   ✅ Scenario 6 passed: Non-existent order returns clean 404');

  // Test 49: Audit Scenario 7 — User identity integrity across multiple distinct student accounts
  console.log('49. Testing Audit Scenario 7: User identity integrity (real registered names displayed)...');
  const userPriyaRes = await invokeHandler({
    method: 'POST',
    url: '/api/signup',
    body: { name: 'Priya Sharma', email: `priya_${Date.now()}@aitpune.edu.in`, password: 'password123' }
  });
  const priyaCookie = userPriyaRes.headers['set-cookie'].split(';')[0];
  const priyaOrderRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: priyaCookie },
    body: { items: [{ fileId: uploadedFileId, originalName: 'PriyaReport.pdf', pages: 3, sides: 'single', color: 'color' }] }
  });
  const priyaOrderId = priyaOrderRes.json().orderId;

  const adminOrdersCheck = await invokeHandler({
    method: 'GET',
    url: `/api/admin/orders?orderId=${priyaOrderId}`,
    headers: { cookie: adminCookie }
  });
  const priyaFetched = adminOrdersCheck.json().orders[0];
  assert.strictEqual(priyaFetched.ownerName, 'Priya Sharma', 'Admin dashboard must display canonical user name');
  console.log('   ✅ Scenario 7 passed: Real user name "Priya Sharma" correctly displayed on admin dashboard');

  // Test 50: Audit Scenario 8 — Item options fidelity between submission and admin dashboard
  console.log('50. Testing Audit Scenario 8: Print options fidelity (copies, sides, color, pageRange)...');
  const optionsOrderRes = await invokeHandler({
    method: 'POST',
    url: '/api/orders/initiate',
    headers: { cookie: priyaCookie },
    body: {
      items: [{
        fileId: uploadedFileId,
        originalName: 'ComplexDoc.pdf',
        pages: 5,
        sides: 'double',
        color: 'color',
        copies: 3,
        pageRange: '1-5'
      }],
      copies: 3,
      pageRange: '1-5'
    }
  });
  const optionsOrderId = optionsOrderRes.json().orderId;
  const optionsAdminRes = await invokeHandler({
    method: 'GET',
    url: `/api/admin/orders?orderId=${optionsOrderId}`,
    headers: { cookie: adminCookie }
  });
  const verifiedOptionsOrder = optionsAdminRes.json().orders[0];
  const verifiedItem = verifiedOptionsOrder.items[0];
  assert.strictEqual(verifiedItem.copies, 3);
  assert.strictEqual(verifiedItem.sides, 'double');
  assert.strictEqual(verifiedItem.color, 'color');
  assert.strictEqual(verifiedItem.pageRange, '1-5');
  assert.strictEqual(verifiedOptionsOrder.pageRange, '1-5');
  console.log('   ✅ Scenario 8 passed: 100% options fidelity verified on admin dashboard');

  console.log('\n🎉 ALL 50 TESTS PASSED SUCCESSFULLY! All 8 admin workflow audit scenarios verified.\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
