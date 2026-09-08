# Xerox Centre — AIT Pune (Full-Stack Project)

A complete print management website with authentication, real file uploads, order options, payment simulation, and order tracking.

Built with:
- **Frontend**: Pure HTML, CSS, JavaScript (served via Vercel CDN or local server)
- **Backend**: Pure Node.js Serverless Functions on Vercel / native Node.js HTTP server locally (no external npm dependencies required)

---

## Deploying to Vercel

This project is fully configured for zero-setup deployment on Vercel.

### Method 1: Deploy via Vercel Web Dashboard (Recommended)

1. Push this project to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Ready for Vercel deployment"
   git remote add origin https://github.com/your-username/your-repo.git
   git branch -M main
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com) and log in.
3. Click **"Add New..."** -> **"Project"**.
4. Import your GitHub repository.
5. Vercel will auto-detect the project configuration (`package.json` and `vercel.json`).
6. Click **"Deploy"**. Your application will be live in seconds!

### Method 2: Deploy via Vercel CLI

1. Open your terminal in this project folder.
2. Run:
   ```bash
   npx vercel
   ```
3. Follow the CLI prompts to log in and select default settings.
4. For production deployment, run:
   ```bash
   npx vercel --prod
   ```

---

## Environment Variables (Optional)

You can set these in your Vercel Project Settings under **Settings -> Environment Variables**:

| Variable | Description | Default |
|---|---|---|
| `SESSION_SECRET` | Secret key used to sign HMAC-SHA256 session cookies | Built-in fallback |
| `PORT` | Port for local server | `3000` |
| `KV_REST_API_URL` | (Optional) Upstash Redis or Vercel KV REST API URL for permanent cloud storage | None (uses `/tmp`) |
| `KV_REST_API_TOKEN` | (Optional) Upstash Redis or Vercel KV REST API Token | None |

> **Note on Storage in Serverless**:
> Out-of-the-box, the app automatically detects Vercel's serverless environment and uses `/tmp` storage seeded with the default demo data. To keep data persistent across serverless cold starts and multiple instances permanently in production, you can connect a free **Upstash Redis** or **Vercel KV** database simply by setting `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

---

## How to Run Locally

1. Make sure Node.js is installed (`node -v` >= 18.0.0).
2. Open terminal in this folder and start the server:
   ```bash
   npm start
   # or
   node server.js
   ```
3. Open your browser and go to: `http://localhost:3000`
4. Run automated serverless and API tests:
   ```bash
   npm test
   ```

---

## Project Architecture

- **`vercel.json`**: Configures Vercel URL rewrites to route `/api/*` to the serverless entrypoint.
- **`api/index.js`**: Primary Vercel Serverless Function and API router.
- **`lib/auth.js`**: Stateless authentication using HMAC-SHA256 signed HTTP-only cookies and scrypt password hashing. Works across serverless instances without dropping session state.
- **`lib/storage.js`**: Adaptive storage abstraction layer supporting local disk (`./data`), serverless `/tmp`, and optional cloud Redis KV.
- **`server.js`**: Local HTTP server runner that imports the same handler used on Vercel.
- **`public/`**: Frontend assets (HTML, CSS, client-side JS, logos) served directly by Vercel's global Edge CDN.
  - `login.html`, `signup.html` — Authentication pages
  - `index.html` — Dashboard, Print Centre, Print Options, Payment, and Order Tracking
- **`data/`**: Initial seed data (`users.json`, `files.json`, `orders.json`).
- **`test/serverless-test.js`**: Automated test suite simulating serverless invocation and validating all endpoints.

---

## Pricing (per page)

| Sides         | Black & White | Color |
|---------------|---------------|-------|
| Single-sided  | ₹2            | ₹5    |
| Double-sided  | ₹3            | ₹8    |
