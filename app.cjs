// Startup file for cPanel "Setup Node.js App" (Phusion Passenger).
// Passenger loads the startup file with require(), so this CommonJS file loads the ES-module server.
// Local development still uses `npm run dev`; this file is only the entry point on the host.
import('./backend/server.js').catch(error => {
  console.error(error);
  process.exit(1);
});
