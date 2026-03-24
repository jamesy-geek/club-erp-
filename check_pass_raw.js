const { createClient } = require("@libsql/client");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

async function getPassLength() {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  const db = createClient({
    url: dbUrl,
    authToken: authToken,
  });

  try {
    const result = await db.execute({
      sql: "SELECT password, LENGTH(password) as len FROM students WHERE LOWER(email) = LOWER(?)",
      args: ["abbhay@gmail.com"]
    });

    console.log("Length:", result.rows[0].len);
    console.log("Raw Password:", JSON.stringify(result.rows[0].password));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

getPassLength();
