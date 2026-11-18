require('dotenv').config();
const db = require('./db');

async function initializeDatabase() {
  try {
    await db.ready();
    console.log('Database schema and role/permission catalog are ready. No demo data was added.');
  } finally {
    await db.close();
  }
}

initializeDatabase().catch((err) => {
  console.error('Database initialization failed:', err.message);
  process.exitCode = 1;
});
