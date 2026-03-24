const { createClient } = require("@libsql/client");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

async function checkSessions() {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  const db = createClient({
    url: dbUrl,
    authToken: authToken,
  });

  try {
    const result = await db.execute("SELECT * FROM sessions");
    console.log("Total sessions:", result.rows.length);
    console.log("Session details:", result.rows.map(r => ({ sid: r.sid, expires: r.expires, now: Date.now(), expired: r.expires < Date.now() })));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

checkSessions();
