const { createClient } = require("@libsql/client");
require("dotenv").config({ path: "c:\\Users\\Pragna\\.gemini\\antigravity\\scratch\\club-erp-\\.env" });

async function checkStudent() {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!dbUrl) {
    console.error("Missing TURSO_DATABASE_URL");
    return;
  }

  const db = createClient({
    url: dbUrl,
    authToken: authToken,
  });

  try {
    const result = await db.execute({
      sql: "SELECT * FROM students WHERE LOWER(email) = LOWER(?)",
      args: ["abbhay@gmail.com"]
    });

    if (result.rows.length === 0) {
      console.log("Student not found with email: abbhay@gmail.com");
      const allStudents = await db.execute("SELECT email, usn FROM students LIMIT 10");
      console.log("Recent students:", allStudents.rows);
    } else {
      console.log("Student found:", result.rows[0]);
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

checkStudent();
