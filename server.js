// ===================================================================
// Xerox Centre — AIT Pune | Local Development Server
// Run with: node server.js or npm start
// For Vercel deployment, requests are automatically routed to api/index.js
// ===================================================================

const http = require('http');
const handler = require('./api/index');

const PORT = process.env.PORT || 3000;

const server = http.createServer(handler);

server.listen(PORT, () => {
  console.log(`\n🚀 Xerox Centre server running at http://localhost:${PORT}`);
  console.log(`📁 Static files served from public/`);
  console.log(`⚡ Ready for local testing and Vercel deployment\n`);
});

module.exports = server;
