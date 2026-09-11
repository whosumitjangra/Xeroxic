# Xerox Centre — Project Progress & Working Document

This document summarizes the current architecture, progress, resolved issues, file structure, and upcoming features for the Xerox Centre full-stack web application.

---

## 1. Current Progress & Live Status

- **Production URL**: [https://xeroxic.vercel.app](https://xeroxic.vercel.app)
- **Deployment Platform**: Vercel Serverless Functions + Global Edge CDN
- **Repository**: [https://github.com/whosumitjangra/Xeroxic](https://github.com/whosumitjangra/Xeroxic)

### Key Milestones Achieved:
1. **Serverless Migration**:
   - Refactored native Node.js HTTP server into a dual-mode application (runs locally on `http://localhost:3000` via `server.js` and in cloud via `api/index.js`).
   - Fixed Vercel timeout bug caused by `server.listen()` in serverless containers.
   - Configured `vercel.json` rewrites and `outputDirectory: "public"` for zero-delay static CDN serving and seamless `/api/*` routing.
2. **Stateless Authentication**:
   - Converted in-memory sessions to **HMAC-SHA256 signed stateless cookies** (`lib/auth.js`).
   - Sessions now reliably persist across all distributed Vercel lambda instances and cold starts.
3. **Adaptive Storage**:
   - Created `lib/storage.js` with auto-fallback to `/tmp` storage when running in serverless read-only environments (`EROFS` prevention).
   - Bundled initial seed data for users, files, and orders.
   - Built optional Upstash Redis / Vercel KV REST integration.
4. **Automated Testing**:
   - `test/serverless-test.js` tests all 12 critical paths (signup, login, me, upload, download, orders, tracking, logout, and Vercel storage isolation).

---

## 2. File Structure Overview

```text
xerox-fullstack/
├── api/
│   └── index.js             # Primary Vercel Serverless Function & API router
├── data/
│   ├── files.json           # Uploaded files metadata (seed)
│   ├── orders.json          # Print orders (seed)
│   └── users.json           # User accounts (passwords hashed with scrypt)
├── lib/
│   ├── auth.js              # Password hashing & stateless HMAC-SHA256 sessions
│   └── storage.js           # Adaptive storage (/tmp fallback, local disk, Redis KV)
├── public/
│   ├── index.html           # Student Dashboard, Print Centre, Print Options & Tracking
│   ├── login.html           # Authentication / Sign In page
│   ├── signup.html          # Registration / Sign Up page
│   ├── logo.gif             # AIT Pune brand asset
│   ├── script.js            # Student frontend application logic
│   └── style.css            # Responsive dark green & teal glassmorphism stylesheet
├── test/
│   └── serverless-test.js   # Automated API & serverless verification suite
├── uploads/                 # Local directory for uploaded files
├── .env.example             # Environment variable template
├── .gitignore               # Standard git ignore rules
├── package.json             # NPM package scripts & configuration
├── server.js                # Local development server runner
├── vercel.json              # Vercel deployment & routing configuration
└── working.md               # Current document
```

---

## 3. Current Issues & Upcoming Enhancements

### Issue: Upload "Server Error" on High-Resolution Files
- **Cause**: Vercel Serverless Functions enforce a strict **4.5 MB body limit**. When uploading modern phone photos (5MB–15MB) or multi-page documents, Vercel edge proxy terminates the request with `503 SERVICE_UNAVAILABLE` or `413 Payload Too Large`.
- **Solution**:
  1. Add **client-side HTML5 canvas compression** in `public/script.js` that reduces image file sizes by ~90% (to ~400–600 KB) before sending, with zero perceptible loss in print quality.
  2. Implement **Cloud Storage Adapter** in `lib/storage.js` supporting Cloudinary, Vercel Blob, or direct base64 fallback.
  3. Add clear client-side validation messages so users never encounter an unhandled server error.

### Enhancement: User vs Admin Login & Document Request Management
- **Role Selection in Login & Signup**:
  - Two options: **Student** and **Admin (Xerox Staff)**.
  - Default Admin Account: `admin@aitpune.edu.in` / `admin123`.
  - Secure staff signup via Admin Passcode (`AITXEROX2026`).
- **Dedicated Admin Portal (`public/admin.html` + `public/admin.js`)**:
  - Displays all document print requests in real-time.
  - Document preview and **Direct Download** button so staff can immediately print requested documents.
  - Live status updater buttons/dropdown (`Order Received` ➔ `Printing in Progress` ➔ `Ready for Pickup` ➔ `Completed`).
  - Search and filter by student name, email, Order ID, or status.
  - Metric cards: Total Orders, Active Prints, Ready for Pickup, Total Revenue (₹).

---

## 4. Next Steps
1. User approves the implementation plan.
2. Implement role-based session logic in `lib/auth.js` and seed admin in `data/users.json`.
3. Update `login.html` and `signup.html` with Student/Admin role selectors.
4. Build `public/admin.html` and `public/admin.js` with complete Xerox request management.
5. Implement client-side image compression and cloud upload resilience in `public/script.js` and `lib/storage.js`.
6. Add backend admin endpoints (`/api/admin/orders`, `/api/admin/orders/:id/status`) in `api/index.js`.
7. Verify all functionality locally (`npm test`) and deploy live to Vercel via GitHub push.
