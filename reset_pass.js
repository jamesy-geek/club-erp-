const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

async function resetStudentPassword() {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  const db = createClient({
    url: dbUrl,
    authToken: authToken,
  });

  const email = "abbhay@gmail.com";
  const newPass = "7618704845";

  try {
    const hashed = await bcrypt.hash(newPass, 10);
    const result = await db.execute({
      sql: "UPDATE students SET password = ? WHERE LOWER(email) = LOWER(?)",
      args: [hashed, email]
    });

    if (result.rowsAffected > 0) {
      console.log(`Password reset successfully for ${email}`);
    } else {
      console.log(`Student not found with email: ${email}`);
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

resetStudentPassword();
