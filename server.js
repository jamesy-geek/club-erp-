const express = require("express");
const { createClient } = require("@libsql/client");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
const helmet = require("helmet");

// Load .env in development
if (process.env.NODE_ENV !== "production") {
  try { require("dotenv").config(); } catch (e) { /* dotenv optional in prod */ }
}

const app = express();

// ================= TURSO DATABASE =================

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ================= SECURITY MIDDLEWARE =================

// HTTP security headers
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts in your HTML
}));

// Rate limiting for login attempts
const loginAttempts = new Map(); // IP -> { count, lastAttempt }

function loginRateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 10;

  const record = loginAttempts.get(ip);

  if (record) {
    // Reset if window expired
    if (now - record.lastAttempt > windowMs) {
      loginAttempts.delete(ip);
    } else if (record.count >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: "Too many login attempts. Try again in 15 minutes."
      });
    }
  }

  next();
}

// Clean up old entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  for (const [ip, record] of loginAttempts) {
    if (now - record.lastAttempt > windowMs) {
      loginAttempts.delete(ip);
    }
  }
}, 30 * 60 * 1000);

// ================= MIDDLEWARE =================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "super_secret_erp_key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production" && process.env.RENDER === "true",
    httpOnly: true,       // Prevents JavaScript access to cookies
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    sameSite: "lax"       // CSRF protection
  }
}));

app.set("trust proxy", 1); // Trust Render's reverse proxy

// Root route MUST be before express.static to take priority over index.html
app.get("/", (req, res) => {
  if (req.session && req.session.admin) {
    res.redirect("/dashboard.html");
  } else {
    res.redirect("/login.html");
  }
});

app.use(express.static("public"));

// ================= AUTH MIDDLEWARE =================

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    next();
  } else {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

// ================= DATABASE SETUP =================

async function initDB() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      total_quantity INTEGER,
      available_quantity INTEGER,
      photo1 TEXT,
      photo2 TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT,
      usn TEXT UNIQUE,
      phone TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      issue_timestamp DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
      FOREIGN KEY(student_id) REFERENCES students(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS issue_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER,
      component_id INTEGER,
      quantity INTEGER,
      returned_quantity INTEGER DEFAULT 0,
      FOREIGN KEY(issue_id) REFERENCES issues(id),
      FOREIGN KEY(component_id) REFERENCES components(id)
    )
  `);

  // Create default admin if none exists (password is bcrypt-hashed, NEVER plain text)
  const result = await db.execute("SELECT COUNT(*) as count FROM admins");
  if (result.rows[0].count === 0) {
    const hashed = await bcrypt.hash("admin123", 12); // 12 salt rounds for extra security
    await db.execute({
      sql: "INSERT INTO admins (username, password) VALUES (?, ?)",
      args: ["admin", hashed]
    });
    console.log("Default admin created → admin / admin123 (bcrypt-hashed)");
  }
}

initDB().catch(console.error);

// ================= AUTH ROUTES =================

app.post("/login", loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "Missing credentials" });
  }

  const result = await db.execute({
    sql: "SELECT * FROM admins WHERE username = ?",
    args: [username]
  });

  if (result.rows.length === 0) {
    // Track failed attempt
    const ip = req.ip;
    const record = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = Date.now();
    loginAttempts.set(ip, record);

    return res.json({ success: false });
  }

  const admin = result.rows[0];
  const match = await bcrypt.compare(password, admin.password);

  if (!match) {
    // Track failed attempt
    const ip = req.ip;
    const record = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = Date.now();
    loginAttempts.set(ip, record);

    return res.json({ success: false });
  }

  // Reset rate limit on successful login
  loginAttempts.delete(req.ip);

  // Regenerate session to prevent session fixation
  req.session.regenerate((err) => {
    if (err) return res.json({ success: false });
    req.session.admin = admin.id;
    res.json({ success: true });
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

app.post("/change-admin", requireAdmin, async (req, res) => {
  const { newUsername, newPassword } = req.body;

  if (!newUsername || !newPassword)
    return res.json({ success: false, message: "Missing fields" });

  if (newPassword.length < 6)
    return res.json({ success: false, message: "Password must be at least 6 characters" });

  // bcrypt hash — NEVER store plain text
  const hashed = await bcrypt.hash(newPassword, 12);

  try {
    await db.execute({
      sql: "UPDATE admins SET username = ?, password = ? WHERE id = ?",
      args: [newUsername, hashed, req.session.admin]
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: "Username already taken" });
  }
});

// ================= ADMIN MANAGEMENT =================

app.get("/admins", requireAdmin, async (req, res) => {
  // NEVER return password field — only return safe fields
  const result = await db.execute("SELECT id, username FROM admins");
  const admins = result.rows.map(a => ({
    id: a.id,
    username: a.username,
    role: "admin"
  }));
  res.json(admins);
});

app.post("/create-admin", requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password)
    return res.json({ success: false, message: "Missing fields" });

  if (password.length < 6)
    return res.json({ success: false, message: "Password must be at least 6 characters" });

  try {
    // bcrypt hash — NEVER store plain text
    const hashed = await bcrypt.hash(password, 12);
    await db.execute({
      sql: "INSERT INTO admins (username, password) VALUES (?, ?)",
      args: [username, hashed]
    });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: "Username already taken" });
  }
});

app.post("/delete-admin", requireAdmin, async (req, res) => {
  const { id } = req.body;

  // Prevent deleting yourself
  if (id == req.session.admin) {
    return res.json({ success: false, message: "Cannot delete your own account" });
  }

  await db.execute({ sql: "DELETE FROM admins WHERE id = ?", args: [id] });
  res.json({ success: true });
});

// ================= PROTECTED ROOT =================

app.get("/test-session", (req, res) => {
  res.json({ loggedIn: !!req.session.admin }); // Don't expose session internals
});

// ================= PAGE ROUTES =================

app.get("/components-page", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "components.html"));
});

app.get("/issue-page", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "issue.html"));
});

app.get("/transactions-page", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "transactions.html"));
});

app.get("/reports-page", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reports.html"));
});

// ================= COMPONENT ROUTES =================

app.post("/add-component", requireAdmin, async (req, res) => {
  const { name, quantity, photo1, photo2 } = req.body;

  const existing = await db.execute({
    sql: "SELECT * FROM components WHERE name = ?",
    args: [name]
  });

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    await db.execute({
      sql: "UPDATE components SET total_quantity = total_quantity + ?, available_quantity = available_quantity + ? WHERE id = ?",
      args: [quantity, quantity, row.id]
    });
    return res.json({ message: "Component quantity updated" });
  }

  await db.execute({
    sql: "INSERT INTO components (name, total_quantity, available_quantity, photo1, photo2) VALUES (?, ?, ?, ?, ?)",
    args: [name, quantity, quantity, photo1 || null, photo2 || null]
  });
  res.json({ message: "Component Added" });
});

app.post("/edit-component", requireAdmin, async (req, res) => {
  const { id, new_total_quantity } = req.body;

  const result = await db.execute({
    sql: "SELECT total_quantity, available_quantity FROM components WHERE id = ?",
    args: [id]
  });

  if (result.rows.length === 0)
    return res.json({ message: "Component not found" });

  const component = result.rows[0];
  const difference = new_total_quantity - component.total_quantity;
  const new_available = component.available_quantity + difference;

  if (new_available < 0) {
    return res.json({ message: "Cannot reduce below issued quantity" });
  }

  await db.execute({
    sql: "UPDATE components SET total_quantity = ?, available_quantity = ? WHERE id = ?",
    args: [new_total_quantity, new_available, id]
  });
  res.json({ message: "Component updated successfully" });
});

app.get("/components", requireAdmin, async (req, res) => {
  const result = await db.execute("SELECT * FROM components");
  res.json(result.rows);
});

// ================= ISSUE CREATION =================

app.post("/create-issue", requireAdmin, async (req, res) => {
  const { student_name, usn, phone, items } = req.body;

  if (!items || items.length === 0)
    return res.json({ message: "No items provided" });

  try {
    await db.execute({
      sql: `INSERT INTO students (student_name, usn, phone)
            VALUES (?, ?, ?)
            ON CONFLICT(usn) DO UPDATE SET
            student_name = excluded.student_name,
            phone = excluded.phone`,
      args: [student_name, usn, phone]
    });

    const studentResult = await db.execute({
      sql: "SELECT id FROM students WHERE usn = ?",
      args: [usn]
    });

    if (studentResult.rows.length === 0)
      return res.json({ message: "Student error" });

    const student_id = studentResult.rows[0].id;

    for (const item of items) {
      const compResult = await db.execute({
        sql: "SELECT id, available_quantity FROM components WHERE id = ?",
        args: [parseInt(item.component_id)]
      });
      if (compResult.rows.length === 0 || compResult.rows[0].available_quantity < parseInt(item.quantity)) {
        return res.json({ message: `Insufficient stock for component ID ${item.component_id}` });
      }
    }

    const issueResult = await db.execute({
      sql: "INSERT INTO issues (student_id) VALUES (?)",
      args: [student_id]
    });

    const issue_id = issueResult.lastInsertRowid;

    for (const item of items) {
      const cid = parseInt(item.component_id);
      const qty = parseInt(item.quantity);

      await db.execute({
        sql: "INSERT INTO issue_items (issue_id, component_id, quantity) VALUES (?, ?, ?)",
        args: [issue_id, cid, qty]
      });

      await db.execute({
        sql: "UPDATE components SET available_quantity = available_quantity - ? WHERE id = ?",
        args: [qty, cid]
      });
    }

    res.json({ message: "Issue Created Successfully" });
  } catch (error) {
    console.error("Error creating issue:", error);
    res.json({ message: "Error creating issue" });
  }
});

// ================= RETURN SINGLE =================

app.post("/return-item", requireAdmin, async (req, res) => {
  const { item_id, return_quantity, component_id } = req.body;

  const result = await db.execute({
    sql: "SELECT quantity, returned_quantity FROM issue_items WHERE id = ?",
    args: [item_id]
  });

  if (result.rows.length === 0)
    return res.json({ message: "Item not found" });

  const row = result.rows[0];
  const remaining = row.quantity - row.returned_quantity;

  if (return_quantity > remaining)
    return res.json({ message: "Return exceeds remaining" });

  await db.execute({
    sql: "UPDATE issue_items SET returned_quantity = returned_quantity + ? WHERE id = ?",
    args: [return_quantity, item_id]
  });

  await db.execute({
    sql: "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?",
    args: [return_quantity, component_id]
  });

  res.json({ message: "Return processed" });
});

// ================= RETURN ALL =================

app.post("/return-all", requireAdmin, async (req, res) => {
  const { issue_id } = req.body;

  const result = await db.execute({
    sql: "SELECT id, component_id, quantity, returned_quantity FROM issue_items WHERE issue_id = ?",
    args: [issue_id]
  });

  for (const item of result.rows) {
    const remaining = item.quantity - item.returned_quantity;

    if (remaining > 0) {
      await db.execute({
        sql: "UPDATE issue_items SET returned_quantity = quantity WHERE id = ?",
        args: [item.id]
      });

      await db.execute({
        sql: "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?",
        args: [remaining, item.component_id]
      });
    }
  }

  res.json({ message: "All items returned successfully" });
});

// ================= TRANSACTIONS =================

app.get("/transactions", async (req, res) => {
  const result = await db.execute(`
    SELECT 
      issues.id AS issue_id,
      issues.issue_timestamp,
      students.student_name,
      students.usn,
      students.phone,
      issue_items.id AS item_id,
      issue_items.component_id,
      components.name AS component_name,
      issue_items.quantity,
      issue_items.returned_quantity,
      (issue_items.quantity - issue_items.returned_quantity) AS remaining
    FROM issues
    JOIN students ON issues.student_id = students.id
    JOIN issue_items ON issue_items.issue_id = issues.id
    JOIN components ON issue_items.component_id = components.id
    ORDER BY issues.issue_timestamp DESC
  `);
  res.json(result.rows);
});

// ================= STUDENT PROFILE =================

app.get("/student/:usn", async (req, res) => {
  const result = await db.execute({
    sql: `
      SELECT 
        issues.issue_timestamp,
        components.name AS component_name,
        issue_items.quantity,
        issue_items.returned_quantity,
        (issue_items.quantity - issue_items.returned_quantity) AS remaining
      FROM issues
      JOIN students ON issues.student_id = students.id
      JOIN issue_items ON issue_items.issue_id = issues.id
      JOIN components ON issue_items.component_id = components.id
      WHERE students.usn = ?
      ORDER BY issues.issue_timestamp DESC
    `,
    args: [req.params.usn]
  });
  res.json(result.rows);
});

// ================= DASHBOARD SUMMARY =================

app.get("/dashboard-summary", async (req, res) => {
  const r1 = await db.execute("SELECT COUNT(*) AS total_components FROM components");
  const r2 = await db.execute("SELECT SUM(quantity - returned_quantity) AS total_out FROM issue_items");
  const r3 = await db.execute("SELECT COUNT(*) AS total_students FROM students");

  res.json({
    total_components: r1.rows[0].total_components || 0,
    total_out: r2.rows[0].total_out || 0,
    total_students: r3.rows[0].total_students || 0
  });
});

// ================= DELETE COMPONENT =================

app.post("/delete-component", requireAdmin, async (req, res) => {
  const { id } = req.body;

  const result = await db.execute({
    sql: "SELECT COUNT(*) AS active FROM issue_items WHERE component_id = ? AND (quantity - returned_quantity) > 0",
    args: [id]
  });

  if (result.rows[0].active > 0) {
    return res.json({ message: "Cannot delete component with active issues" });
  }

  await db.execute({ sql: "DELETE FROM components WHERE id = ?", args: [id] });
  res.json({ message: "Component deleted successfully" });
});

// ================= RENAME COMPONENT =================

app.post("/rename-component", requireAdmin, async (req, res) => {
  const { id, new_name } = req.body;
  await db.execute({
    sql: "UPDATE components SET name = ? WHERE id = ?",
    args: [new_name, id]
  });
  res.json({ message: "Renamed successfully" });
});

// ================= DATABASE EXPORT (Monthly Backup) =================

app.get("/export-database", requireAdmin, async (req, res) => {
  try {
    const admins = await db.execute("SELECT id, username FROM admins"); // Exclude passwords!
    const components = await db.execute("SELECT * FROM components");
    const students = await db.execute("SELECT * FROM students");
    const issues = await db.execute("SELECT * FROM issues");
    const issueItems = await db.execute("SELECT * FROM issue_items");

    const exportData = {
      exported_at: new Date().toISOString(),
      tables: {
        admins: admins.rows,        // No passwords exported
        components: components.rows,
        students: students.rows,
        issues: issues.rows,
        issue_items: issueItems.rows
      },
      summary: {
        total_admins: admins.rows.length,
        total_components: components.rows.length,
        total_students: students.rows.length,
        total_issues: issues.rows.length,
        total_issue_items: issueItems.rows.length
      }
    };

    const filename = `club-erp-backup-${new Date().toISOString().slice(0, 10)}.json`;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.json(exportData);
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ message: "Export failed" });
  }
});

// ================= REPORT DOWNLOADS =================

const PDFDocument = require("pdfkit-table");

app.get("/download-report-pdf", requireAdmin, async (req, res) => {
  const { usn, startDate, endDate } = req.query;

  let query = `
    SELECT 
      issues.issue_timestamp,
      students.student_name,
      students.usn,
      components.name AS component_name,
      issue_items.quantity,
      issue_items.returned_quantity
    FROM issues
    JOIN students ON issues.student_id = students.id
    JOIN issue_items ON issue_items.issue_id = issues.id
    JOIN components ON issue_items.component_id = components.id
  `;

  let conditions = [];
  let params = [];

  if (usn) {
    const usnArray = usn.split(",");
    conditions.push(`students.usn IN (${usnArray.map(() => "?").join(",")})`);
    params.push(...usnArray);
  }

  if (startDate) {
    conditions.push("date(issues.issue_timestamp) >= ?");
    params.push(startDate);
  }

  if (endDate) {
    conditions.push("date(issues.issue_timestamp) <= ?");
    params.push(endDate);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY issues.issue_timestamp DESC";

  const result = await db.execute({ sql: query, args: params });
  const rows = result.rows;

  const doc = new PDFDocument({ margin: 30 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=report.pdf");
  doc.pipe(res);

  doc.fontSize(18).text("ERP Transactions Report", { align: "center" });
  doc.moveDown();

  let totalIssued = 0;
  let totalReturned = 0;

  const table = {
    headers: ["Timestamp", "Student", "USN", "Component", "Issued", "Returned"],
    rows: rows.map(r => {
      totalIssued += r.quantity;
      totalReturned += r.returned_quantity;
      return [
        r.issue_timestamp,
        r.student_name,
        r.usn,
        r.component_name,
        r.quantity,
        r.returned_quantity
      ];
    })
  };

  await doc.table(table, {
    prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
    prepareRow: () => doc.font("Helvetica").fontSize(9)
  });

  doc.moveDown();
  doc.fontSize(12).text("Summary", { underline: true });
  doc.moveDown(0.5);
  doc.text(`Total Issued: ${totalIssued}`);
  doc.text(`Total Returned: ${totalReturned}`);
  doc.text(`Currently Out: ${totalIssued - totalReturned}`);

  doc.end();
});

const ExcelJS = require("exceljs");

app.get("/download-report-excel", requireAdmin, async (req, res) => {
  const { usn, startDate, endDate } = req.query;

  let query = `
    SELECT 
      issues.issue_timestamp,
      students.student_name,
      students.usn,
      components.name AS component_name,
      issue_items.quantity,
      issue_items.returned_quantity
    FROM issues
    JOIN students ON issues.student_id = students.id
    JOIN issue_items ON issue_items.issue_id = issues.id
    JOIN components ON issue_items.component_id = components.id
  `;

  let conditions = [];
  let params = [];

  if (usn) {
    const usnArray = usn.split(",");
    conditions.push(`students.usn IN (${usnArray.map(() => "?").join(",")})`);
    params.push(...usnArray);
  }

  if (startDate) {
    conditions.push("date(issues.issue_timestamp) >= ?");
    params.push(startDate);
  }

  if (endDate) {
    conditions.push("date(issues.issue_timestamp) <= ?");
    params.push(endDate);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  query += " ORDER BY issues.issue_timestamp DESC";

  const result = await db.execute({ sql: query, args: params });
  const rows = result.rows;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");

  sheet.columns = [
    { header: "Timestamp", key: "timestamp", width: 20 },
    { header: "Student Name", key: "name", width: 20 },
    { header: "USN", key: "usn", width: 15 },
    { header: "Component", key: "component", width: 20 },
    { header: "Issued", key: "issued", width: 10 },
    { header: "Returned", key: "returned", width: 10 }
  ];

  let totalIssued = 0;
  let totalReturned = 0;

  rows.forEach(row => {
    totalIssued += row.quantity;
    totalReturned += row.returned_quantity;

    sheet.addRow({
      timestamp: row.issue_timestamp,
      name: row.student_name,
      usn: row.usn,
      component: row.component_name,
      issued: row.quantity,
      returned: row.returned_quantity
    });
  });

  sheet.addRow([]);
  sheet.addRow(["Summary"]);
  sheet.addRow(["Total Issued", totalIssued]);
  sheet.addRow(["Total Returned", totalReturned]);
  sheet.addRow(["Currently Out", totalIssued - totalReturned]);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=report.xlsx");

  await workbook.xlsx.write(res);
  res.end();
});

// ================= START SERVER =================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ERP running on http://localhost:${PORT}`);
});
