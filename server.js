const express = require("express");
const { createClient } = require("@libsql/client");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const helmet = require("helmet");
const PDFDocument = require("pdfkit-table");
const ExcelJS = require("exceljs");


// Load .env in development
if (process.env.NODE_ENV !== "production") {
  try { require("dotenv").config(); } catch (e) { /* dotenv optional in prod */ }
}

// Validate required environment variables
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("\n============================================");
  console.error("ERROR: Missing required environment variables!");
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN");
  console.error("============================================\n");
}

const app = express();

// Trust Render's reverse proxy (required for sessions & secure cookies behind HTTPS)
app.set("trust proxy", 1);

// ================= TURSO DATABASE =================

// Initialize database client with safety check
let db;
try {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL is not defined");
  }
  db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
} catch (err) {
  console.error("Failed to create database client:", err.message);
  // Create a mock db to prevent crashes, but it will error on use
  db = {
    execute: () => { throw new Error("Database client not initialized. Check your environment variables."); }
  };
}


// ================= SECURITY MIDDLEWARE =================

app.use(helmet({
  contentSecurityPolicy: false
}));

// Rate limiting for login attempts
const loginAttempts = new Map();

function loginRateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 10;
  const record = loginAttempts.get(ip);
  if (record) {
    if (now - record.lastAttempt > windowMs) {
      loginAttempts.delete(ip);
    } else if (record.count >= maxAttempts) {
      return res.status(429).json({ success: false, message: "Too many login attempts. Try again in 15 minutes." });
    }
  }
  next();
}

// No setInterval in serverless environment


// ================= CUSTOM SESSION STORE (Turso) =================

class TursoStore extends session.Store {
  constructor(dbClient) {
    super();
    this.db = dbClient;
  }
  async get(sid, callback) {
    try {
      const result = await this.db.execute({ sql: "SELECT data FROM sessions WHERE sid = ? AND expires > ?", args: [sid, Date.now()] });
      if (result.rows.length > 0) {
        callback(null, JSON.parse(result.rows[0].data));
      } else {
        callback(null, null);
      }
    } catch (err) {
      console.error("Session GET error:", err.message);
      // Return null session instead of propagating error (prevents 500 on every request)
      callback(null, null);
    }
  }
  async set(sid, sessionData, callback) {
    try {
      const maxAge = sessionData.cookie && sessionData.cookie.maxAge ? sessionData.cookie.maxAge : 86400000;
      const expires = Date.now() + maxAge;
      const data = JSON.stringify(sessionData);
      await this.db.execute({ sql: "INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)", args: [sid, data, expires] });
      if (callback) callback(null);
    } catch (err) {
      console.error("Session SET error:", err.message);
      if (callback) callback(null); // Don't propagate — session just won't persist
    }
  }
  async destroy(sid, callback) {
    try {
      await this.db.execute({ sql: "DELETE FROM sessions WHERE sid = ?", args: [sid] });
      if (callback) callback(null);
    } catch (err) {
      console.error("Session DESTROY error:", err.message);
      if (callback) callback(null); // Don't propagate
    }
  }
}

// ================= MIDDLEWARE =================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use(session({
  store: new TursoStore(db),
  secret: process.env.SESSION_SECRET || "change_this_to_a_random_secret_string",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

// ================= AUTH MIDDLEWARE =================

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    next();
  } else {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

// ================= DATABASE SETUP =================

async function initDatabase() {
  // Drop and recreate sessions table to fix schema mismatches
  // (sessions are transient — users just re-login)
  // Removed DROP TABLE IF EXISTS sessions to prevent logout on serverless cold starts

  await db.execute(`CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT,
    expires INTEGER
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    total_quantity INTEGER,
    available_quantity INTEGER,
    photo1 TEXT,
    photo2 TEXT
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT,
    usn TEXT UNIQUE,
    phone TEXT
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    issue_timestamp DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    FOREIGN KEY(student_id) REFERENCES students(id)
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS issue_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER,
    component_id INTEGER,
    quantity INTEGER,
    returned_quantity INTEGER DEFAULT 0,
    FOREIGN KEY(issue_id) REFERENCES issues(id),
    FOREIGN KEY(component_id) REFERENCES components(id)
  )`);

  // Create default admin if none exists
  const adminCheck = await db.execute("SELECT COUNT(*) as count FROM admins");
  if (adminCheck.rows[0].count === 0) {
    const hashed = await bcrypt.hash("admin123", 10);
    await db.execute({ sql: "INSERT INTO admins (username, password) VALUES (?, ?)", args: ["admin", hashed] });
    console.log("Default admin created → admin / admin123");
  }
}

// Database ready flag
let dbReady = false;

// Middleware to check DB readiness — return 503 for API routes when DB isn't ready
app.use((req, res, next) => {
  const staticPaths = ['/login.html', '/style.css', '/ennovate-logo.png', '/favicon.ico'];
  if (!dbReady && !staticPaths.includes(req.path) && !req.path.startsWith('/login') && req.path !== '/') {
    return res.status(503).json({ message: "Database is still initializing. Please try again in a moment." });
  }
  next();
});

async function startApp() {
  try {
    await initDatabase();
    dbReady = true;
    console.log("Database initialized successfully");
  } catch (err) {
    console.error("CRITICAL: Database initialization failed:", err);
    console.error("The app will start but database operations will fail.");
    console.error("Check your TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables.");
  }

  const PORT = process.env.PORT || 3000;
  // Only listen if not running in a serverless environment (Vercel)
  if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log(`ERP running on http://localhost:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Database ready: ${dbReady}`);
    });
  }
}

// Export the app for Vercel
module.exports = app;

// ================= AUTH ROUTES =================

app.post("/login", loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    if (!dbReady) {
      console.error("Login attempt but database is not ready");
      return res.status(503).json({ success: false, message: "Database not ready. Please try again in a moment." });
    }
    const result = await db.execute({ sql: "SELECT * FROM admins WHERE username = ?", args: [username] });
    if (result.rows.length === 0) {
      const record = loginAttempts.get(req.ip) || { count: 0, lastAttempt: Date.now() };
      record.count++; record.lastAttempt = Date.now();
      loginAttempts.set(req.ip, record);
      return res.json({ success: false });
    }
    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password);
    if (!match) {
      const record = loginAttempts.get(req.ip) || { count: 0, lastAttempt: Date.now() };
      record.count++; record.lastAttempt = Date.now();
      loginAttempts.set(req.ip, record);
      return res.json({ success: false });
    }
    loginAttempts.delete(req.ip);
    req.session.admin = admin.id;
    // Explicitly save the session before responding
    req.session.save((err) => {
      if (err) {
        console.error("Session save error after login:", err);
        return res.status(500).json({ success: false, message: "Session error. Please try again." });
      }
      console.log("Login successful for user:", username, "| Session ID:", req.sessionID);
      res.json({ success: true });
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.post("/change-admin", requireAdmin, async (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newUsername || !newPassword) return res.json({ success: false, message: "Missing fields" });
  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute({ sql: "UPDATE admins SET username = ?, password = ? WHERE id = ?", args: [newUsername, hashed, req.session.admin] });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: "Username already taken" });
  }
});

// ================= ADMIN MANAGEMENT =================

app.post("/create-admin", requireAdmin, async (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newUsername || !newPassword) return res.json({ success: false, message: "Missing fields" });
  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute({ sql: "INSERT INTO admins (username, password) VALUES (?, ?)", args: [newUsername, hashed] });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: "Username already taken" });
  }
});

app.get("/admins", requireAdmin, async (req, res) => {
  const result = await db.execute("SELECT id, username FROM admins");
  res.json(result.rows);
});

app.post("/delete-admin", requireAdmin, async (req, res) => {
  const { id } = req.body;
  if (id === req.session.admin) return res.json({ success: false, message: "Cannot delete yourself" });
  const count = await db.execute("SELECT COUNT(*) as count FROM admins");
  if (count.rows[0].count <= 1) return res.json({ success: false, message: "Cannot delete the last admin" });
  await db.execute({ sql: "DELETE FROM admins WHERE id = ?", args: [id] });
  res.json({ success: true });
});

// ================= PAGE ROUTES =================

function safeSendFile(res, filePath) {
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`sendFile error for ${filePath}:`, err.message);
      if (!res.headersSent) {
        res.status(404).sendFile(path.join(__dirname, "public", "404.html"), (err2) => {
          if (err2) res.status(404).send("Page not found");
        });
      }
    }
  });
}

app.get("/", requireAdmin, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "dashboard.html"));
});

app.get("/components-page", requireAdmin, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "components.html"));
});

app.get("/issue-page", requireAdmin, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "issue.html"));
});

app.get("/transactions-page", requireAdmin, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "transactions.html"));
});

app.get("/reports-page", requireAdmin, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "reports.html"));
});

app.get("/students-page", requireAdmin, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "students.html"));
});

app.get("/student.html", (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "student.html"));
});

// ================= COMPONENT ROUTES =================

app.post("/add-component", requireAdmin, async (req, res) => {
  const { name, quantity, photo1, photo2 } = req.body;
  try {
    const existing = await db.execute({ sql: "SELECT * FROM components WHERE name = ?", args: [name] });
    if (existing.rows.length > 0) {
      await db.execute({ sql: "UPDATE components SET total_quantity = total_quantity + ?, available_quantity = available_quantity + ? WHERE id = ?", args: [quantity, quantity, existing.rows[0].id] });
      return res.json({ message: "Component quantity updated" });
    }
    await db.execute({ sql: "INSERT INTO components (name, total_quantity, available_quantity, photo1, photo2) VALUES (?, ?, ?, ?, ?)", args: [name, quantity, quantity, photo1 || null, photo2 || null] });
    res.json({ message: "Component Added" });
  } catch (err) {
    console.error("Add component error:", err);
    res.json({ message: "Error adding component" });
  }
});

app.post("/edit-component", requireAdmin, async (req, res) => {
  const { id, new_total_quantity } = req.body;
  try {
    const result = await db.execute({ sql: "SELECT total_quantity, available_quantity FROM components WHERE id = ?", args: [id] });
    if (result.rows.length === 0) return res.json({ message: "Component not found" });
    const component = result.rows[0];
    const difference = new_total_quantity - component.total_quantity;
    const new_available = component.available_quantity + difference;
    if (new_available < 0) return res.json({ message: "Cannot reduce below issued quantity" });
    await db.execute({ sql: "UPDATE components SET total_quantity = ?, available_quantity = ? WHERE id = ?", args: [new_total_quantity, new_available, id] });
    res.json({ message: "Component updated successfully" });
  } catch (err) {
    res.json({ message: "Error updating component" });
  }
});

app.get("/components", requireAdmin, async (req, res) => {
  const result = await db.execute("SELECT * FROM components");
  res.json(result.rows);
});

app.post("/delete-component", requireAdmin, async (req, res) => {
  const { id } = req.body;
  try {
    const active = await db.execute({ sql: "SELECT COUNT(*) AS active FROM issue_items WHERE component_id = ? AND (quantity - returned_quantity) > 0", args: [id] });
    if (active.rows[0].active > 0) return res.json({ message: "Cannot delete component with active issues" });
    await db.execute({ sql: "DELETE FROM components WHERE id = ?", args: [id] });
    res.json({ message: "Component deleted successfully" });
  } catch (err) {
    res.json({ message: "Error deleting component" });
  }
});

app.post("/rename-component", requireAdmin, async (req, res) => {
  const { id, new_name } = req.body;
  await db.execute({ sql: "UPDATE components SET name = ? WHERE id = ?", args: [new_name, id] });
  res.json({ message: "Renamed successfully" });
});

// ================= ISSUE CREATION =================

app.post("/create-issue", requireAdmin, async (req, res) => {
  const { student_name, usn, phone, items } = req.body;
  if (!items || items.length === 0) return res.json({ message: "No items provided" });

  try {
    // Upsert student
    await db.execute({
      sql: `INSERT INTO students (student_name, usn, phone) VALUES (?, ?, ?)
            ON CONFLICT(usn) DO UPDATE SET student_name = excluded.student_name, phone = excluded.phone`,
      args: [student_name, usn, phone]
    });

    const studentResult = await db.execute({ sql: "SELECT id FROM students WHERE usn = ?", args: [usn] });
    if (studentResult.rows.length === 0) return res.json({ message: "Student error" });
    const student_id = studentResult.rows[0].id;

    // Check stock for all items
    for (const item of items) {
      const comp = await db.execute({ sql: "SELECT id, available_quantity, name FROM components WHERE id = ?", args: [parseInt(item.component_id)] });
      if (comp.rows.length === 0) return res.json({ message: `Component not found` });
      if (comp.rows[0].available_quantity < parseInt(item.quantity)) {
        return res.json({ message: `Insufficient stock for "${comp.rows[0].name}". Only ${comp.rows[0].available_quantity} available.` });
      }
    }

    // Create issue
    const issueResult = await db.execute({ sql: "INSERT INTO issues (student_id) VALUES (?)", args: [student_id] });
    const issue_id = Number(issueResult.lastInsertRowid);

    // Insert items and update stock
    for (const item of items) {
      const cid = parseInt(item.component_id);
      const qty = parseInt(item.quantity);
      await db.execute({ sql: "INSERT INTO issue_items (issue_id, component_id, quantity) VALUES (?, ?, ?)", args: [issue_id, cid, qty] });
      await db.execute({ sql: "UPDATE components SET available_quantity = available_quantity - ? WHERE id = ?", args: [qty, cid] });
    }

    res.json({ message: "Issue Created Successfully" });
  } catch (err) {
    console.error("Issue creation error:", err);
    res.json({ message: "Error creating issue" });
  }
});

// ================= RETURN SINGLE =================

app.post("/return-item", requireAdmin, async (req, res) => {
  const { item_id, return_quantity, component_id } = req.body;
  try {
    const result = await db.execute({ sql: "SELECT quantity, returned_quantity FROM issue_items WHERE id = ?", args: [item_id] });
    if (result.rows.length === 0) return res.json({ message: "Item not found" });
    const row = result.rows[0];
    const remaining = row.quantity - row.returned_quantity;
    if (return_quantity > remaining) return res.json({ message: "Return exceeds remaining" });
    await db.execute({ sql: "UPDATE issue_items SET returned_quantity = returned_quantity + ? WHERE id = ?", args: [return_quantity, item_id] });
    await db.execute({ sql: "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?", args: [return_quantity, component_id] });
    res.json({ message: "Return processed" });
  } catch (err) {
    res.json({ message: "Error processing return" });
  }
});

// ================= RETURN ALL =================

app.post("/return-all", requireAdmin, async (req, res) => {
  const { issue_id } = req.body;
  try {
    const result = await db.execute({ sql: "SELECT id, component_id, quantity, returned_quantity FROM issue_items WHERE issue_id = ?", args: [issue_id] });
    for (const item of result.rows) {
      const remaining = item.quantity - item.returned_quantity;
      if (remaining > 0) {
        await db.execute({ sql: "UPDATE issue_items SET returned_quantity = quantity WHERE id = ?", args: [item.id] });
        await db.execute({ sql: "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?", args: [remaining, item.component_id] });
      }
    }
    res.json({ message: "All items returned successfully" });
  } catch (err) {
    res.json({ message: "Error returning items" });
  }
});

// ================= TRANSACTIONS =================

app.get("/transactions", requireAdmin, async (req, res) => {
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

app.post("/delete-transaction", requireAdmin, async (req, res) => {
  const { issue_id } = req.body;
  try {
    const items = await db.execute({ sql: "SELECT component_id, quantity, returned_quantity FROM issue_items WHERE issue_id = ?", args: [issue_id] });
    for (const item of items.rows) {
      const unreturned = item.quantity - item.returned_quantity;
      if (unreturned > 0) {
        await db.execute({ sql: "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?", args: [unreturned, item.component_id] });
      }
    }
    await db.execute({ sql: "DELETE FROM issue_items WHERE issue_id = ?", args: [issue_id] });
    await db.execute({ sql: "DELETE FROM issues WHERE id = ?", args: [issue_id] });
    res.json({ success: true, message: "Transaction deleted" });
  } catch (err) {
    res.json({ success: false, message: "Error deleting transaction" });
  }
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
    `, args: [req.params.usn]
  });
  res.json(result.rows);
});

// ================= STUDENTS DIRECTORY =================

app.get("/students", requireAdmin, async (req, res) => {
  const result = await db.execute("SELECT * FROM students ORDER BY student_name ASC");
  res.json(result.rows);
});

app.post("/edit-student", requireAdmin, async (req, res) => {
  const { id, student_name, usn, phone } = req.body;
  try {
    await db.execute({ sql: "UPDATE students SET student_name = ?, usn = ?, phone = ? WHERE id = ?", args: [student_name, usn, phone, id] });
    res.json({ success: true, message: "Student updated" });
  } catch (err) {
    res.json({ success: false, message: "Error updating student (USN may conflict)" });
  }
});

app.post("/delete-student", requireAdmin, async (req, res) => {
  const { id } = req.body;
  try {
    const active = await db.execute({ sql: `SELECT COUNT(*) AS count FROM issue_items JOIN issues ON issue_items.issue_id = issues.id WHERE issues.student_id = ? AND (issue_items.quantity - issue_items.returned_quantity) > 0`, args: [id] });
    if (active.rows[0].count > 0) return res.json({ success: false, message: "Cannot delete student with unreturned items" });
    await db.execute({ sql: "DELETE FROM issue_items WHERE issue_id IN (SELECT id FROM issues WHERE student_id = ?)", args: [id] });
    await db.execute({ sql: "DELETE FROM issues WHERE student_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM students WHERE id = ?", args: [id] });
    res.json({ success: true, message: "Student deleted" });
  } catch (err) {
    res.json({ success: false, message: "Error deleting student" });
  }
});

// ================= DASHBOARD SUMMARY =================

app.get("/dashboard-summary", requireAdmin, async (req, res) => {
  try {
    const comp = await db.execute("SELECT COUNT(*) AS total_components FROM components");
    const out = await db.execute("SELECT COALESCE(SUM(quantity - returned_quantity), 0) AS total_out FROM issue_items");
    const stud = await db.execute("SELECT COUNT(*) AS total_students FROM students");
    const lowStock = await db.execute("SELECT name, available_quantity FROM components WHERE available_quantity < 5 ORDER BY available_quantity ASC");

    res.json({
      total_components: comp.rows[0].total_components || 0,
      total_out: out.rows[0].total_out || 0,
      total_students: stud.rows[0].total_students || 0,
      low_stock: lowStock.rows
    });
  } catch (err) {
    console.error("Dashboard summary error:", err);
    res.json({ total_components: 0, total_out: 0, total_students: 0, low_stock: [] });
  }
});

// ================= DATABASE EXPORT (JSON Backup) =================

app.get("/export-database", requireAdmin, async (req, res) => {
  try {
    const admins = await db.execute("SELECT id, username FROM admins");
    const components = await db.execute("SELECT * FROM components");
    const students = await db.execute("SELECT * FROM students");
    const issues = await db.execute("SELECT * FROM issues");
    const issueItems = await db.execute("SELECT * FROM issue_items");

    const exportData = {
      exported_at: new Date().toISOString(),
      tables: {
        admins: admins.rows,
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

// ================= PDF DATABASE BACKUP =================

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.get("/export-database-pdf", requireAdmin, async (req, res) => {
  try {
    const components = await db.execute("SELECT * FROM components");
    const students = await db.execute("SELECT * FROM students");
    const transactions = await db.execute(`
      SELECT issues.issue_timestamp, students.student_name, students.usn,
        components.name AS component_name, issue_items.quantity, issue_items.returned_quantity
      FROM issues
      JOIN students ON issues.student_id = students.id
      JOIN issue_items ON issue_items.issue_id = issues.id
      JOIN components ON issue_items.component_id = components.id
      ORDER BY issues.issue_timestamp DESC LIMIT 200
    `);

    // PDFDocument is now required at the top of the file
    const doc = new PDFDocument({ margin: 40, size: "A4" });


    const filename = `club-erp-backup-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    doc.pipe(res);

    // Header Banner
    doc.rect(0, 0, doc.page.width, 80).fill("#1e293b");
    doc.fill("#ffffff").fontSize(22).font("Helvetica-Bold").text("Club ERP", 40, 20);
    doc.fontSize(11).font("Helvetica").text("Database Backup Report", 40, 46);
    doc.fontSize(9).text(`Generated: ${new Date().toLocaleString()}`, doc.page.width - 220, 46, { width: 180, align: "right" });
    doc.fill("#000000");
    doc.y = 100;

    // Summary Strip
    doc.rect(40, 100, doc.page.width - 80, 30).fill("#f1f5f9");
    doc.fill("#334155").fontSize(9).font("Helvetica-Bold");
    const colW = (doc.page.width - 80) / 3;
    doc.text(`Components: ${components.rows.length}`, 50, 110, { width: colW });
    doc.text(`Students: ${students.rows.length}`, 50 + colW, 110, { width: colW, align: "center" });
    doc.text(`Transactions: ${transactions.rows.length}`, 50 + colW * 2, 110, { width: colW, align: "right" });
    doc.fill("#000000");
    doc.y = 150;

    // Components Table
    doc.moveDown(0.5);
    doc.rect(40, doc.y, 4, 16).fill("#2563eb");
    doc.fill("#1e293b").fontSize(13).font("Helvetica-Bold").text("  Components Inventory", 46, doc.y + 1);
    doc.fill("#000000"); doc.moveDown(0.8);

    if (components.rows.length > 0) {
      await doc.table({
        headers: [
          { label: "Component Name", width: 250, headerColor: "#2563eb", headerOpacity: 1 },
          { label: "Total Qty", width: 120, headerColor: "#2563eb", headerOpacity: 1, align: "center" },
          { label: "Available", width: 120, headerColor: "#2563eb", headerOpacity: 1, align: "center" }
        ],
        rows: components.rows.map(c => [c.name, String(c.total_quantity), String(c.available_quantity)])
      }, { prepareHeader: () => doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff"), prepareRow: () => { doc.font("Helvetica").fontSize(8).fillColor("#334155"); return doc; }, padding: 6, columnsSize: [250, 120, 120] });
    } else { doc.fontSize(10).fillColor("#94a3b8").text("  No components."); doc.fillColor("#000000"); }

    doc.moveDown(1.5);

    // Students Table
    doc.rect(40, doc.y, 4, 16).fill("#7c3aed");
    doc.fill("#1e293b").fontSize(13).font("Helvetica-Bold").text("  Registered Students", 46, doc.y + 1);
    doc.fill("#000000"); doc.moveDown(0.8);

    if (students.rows.length > 0) {
      await doc.table({
        headers: [
          { label: "Student Name", width: 200, headerColor: "#7c3aed", headerOpacity: 1 },
          { label: "USN", width: 150, headerColor: "#7c3aed", headerOpacity: 1 },
          { label: "Phone", width: 140, headerColor: "#7c3aed", headerOpacity: 1 }
        ],
        rows: students.rows.map(s => [s.student_name, s.usn, s.phone || "N/A"])
      }, { prepareHeader: () => doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff"), prepareRow: () => { doc.font("Helvetica").fontSize(8).fillColor("#334155"); return doc; }, padding: 6, columnsSize: [200, 150, 140] });
    } else { doc.fontSize(10).fillColor("#94a3b8").text("  No students."); doc.fillColor("#000000"); }

    doc.moveDown(1.5);

    // Transactions Table
    doc.rect(40, doc.y, 4, 16).fill("#059669");
    doc.fill("#1e293b").fontSize(13).font("Helvetica-Bold").text("  Recent Transactions", 46, doc.y + 1);
    doc.fill("#000000"); doc.moveDown(0.8);

    if (transactions.rows.length > 0) {
      await doc.table({
        headers: [
          { label: "Date", width: 95, headerColor: "#059669", headerOpacity: 1 },
          { label: "Student", width: 100, headerColor: "#059669", headerOpacity: 1 },
          { label: "USN", width: 90, headerColor: "#059669", headerOpacity: 1 },
          { label: "Component", width: 100, headerColor: "#059669", headerOpacity: 1 },
          { label: "Issued", width: 55, headerColor: "#059669", headerOpacity: 1, align: "center" },
          { label: "Returned", width: 55, headerColor: "#059669", headerOpacity: 1, align: "center" }
        ],
        rows: transactions.rows.map(r => [r.issue_timestamp, r.student_name, r.usn, r.component_name, String(r.quantity), String(r.returned_quantity)])
      }, { prepareHeader: () => doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff"), prepareRow: () => { doc.font("Helvetica").fontSize(7).fillColor("#334155"); return doc; }, padding: 5, columnsSize: [95, 100, 90, 100, 55, 55] });
    } else { doc.fontSize(10).fillColor("#94a3b8").text("  No transactions."); doc.fillColor("#000000"); }

    // Footer
    doc.moveDown(2);
    doc.fontSize(9).fillColor("#1e293b").font("Helvetica-Bold")
      .text("Built by Jishnu Abbhay D  •  Auto-generated by Club ERP", 40, doc.y, { align: "center", width: doc.page.width - 80 });

    doc.end();
  } catch (error) {
    console.error("PDF export error:", error);
    res.status(500).json({ message: "PDF export failed" });
  }
});

// ================= BULK COMPONENT IMPORT (Excel & PDF) =================

app.post("/import-components", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: "No file uploaded" });

    const ext = path.extname(req.file.originalname).toLowerCase();
    let parsed = [];

    if (ext === ".xlsx" || ext === ".csv") {
      const workbook = new ExcelJS.Workbook();

      if (ext === ".csv") {
        await workbook.csv.read(require("stream").Readable.from(req.file.buffer));
      } else {
        await workbook.xlsx.load(req.file.buffer);
      }
      const sheet = workbook.worksheets[0];
      if (!sheet) return res.json({ success: false, message: "No worksheet found" });

      let nameCol = -1, qtyCol = -1;
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        const val = String(cell.value || "").toLowerCase().trim();
        if (val.includes("name") || val.includes("component")) nameCol = colNumber;
        if (val.includes("qty") || val.includes("quantity") || val.includes("count")) qtyCol = colNumber;
      });
      if (nameCol === -1 || qtyCol === -1) return res.json({ success: false, message: "Could not find 'Name' and 'Quantity' columns." });

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const name = String(row.getCell(nameCol).value || "").trim();
        const quantity = parseInt(row.getCell(qtyCol).value);
        if (name && !isNaN(quantity) && quantity > 0) parsed.push({ name, quantity });
      });

    } else if (ext === ".pdf") {
      const pdfParse = require("pdf-parse");
      const pdfData = await pdfParse(req.file.buffer);
      const lines = pdfData.text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      for (const line of lines) {
        if (/^(name|component|item|sr|no|#|sl)/i.test(line)) continue;
        let name = null, quantity = null;

        const delimMatch = line.match(/^(.+?)[|,;]\s*(\d+)\s*$/);
        if (delimMatch) { name = delimMatch[1].trim(); quantity = parseInt(delimMatch[2]); }

        if (!name) {
          const spaceMatch = line.match(/^(.+?)\s{2,}(\d+)\s*$/);
          if (spaceMatch) { name = spaceMatch[1].trim(); quantity = parseInt(spaceMatch[2]); }
        }

        if (!name) {
          const numberedMatch = line.match(/^\d+[\.)\s]+(.+?)\s{2,}(\d+)\s*$/);
          if (numberedMatch) { name = numberedMatch[1].trim(); quantity = parseInt(numberedMatch[2]); }
        }

        if (name && !isNaN(quantity) && quantity > 0 && name.length > 1) {
          name = name.replace(/^\d+[\.)\s]+/, "").trim();
          if (name.length > 0) parsed.push({ name, quantity });
        }
      }

      if (parsed.length === 0) return res.json({ success: false, message: "Could not extract data from PDF. Ensure it has a table with names and quantities." });
    } else {
      return res.json({ success: false, message: "Unsupported file type. Use .xlsx, .csv, or .pdf" });
    }

    if (parsed.length === 0) return res.json({ success: false, message: "No valid component data found." });

    let added = 0, updated = 0;
    for (const item of parsed) {
      const existing = await db.execute({ sql: "SELECT * FROM components WHERE LOWER(name) = LOWER(?)", args: [item.name] });
      if (existing.rows.length > 0) {
        await db.execute({ sql: "UPDATE components SET total_quantity = total_quantity + ?, available_quantity = available_quantity + ? WHERE id = ?", args: [item.quantity, item.quantity, existing.rows[0].id] });
        updated++;
      } else {
        await db.execute({ sql: "INSERT INTO components (name, total_quantity, available_quantity) VALUES (?, ?, ?)", args: [item.name, item.quantity, item.quantity] });
        added++;
      }
    }

    res.json({ success: true, message: `Import complete! ${added} new, ${updated} updated.`, details: { added, updated, total: parsed.length } });
  } catch (error) {
    console.error("Import error:", error);
    res.json({ success: false, message: "Import failed: " + error.message });
  }
});

// ================= REPORT DOWNLOADS =================

// PDFDocument is already required at the top


app.get("/download-report-pdf", requireAdmin, async (req, res) => {
  const { usn, startDate, endDate } = req.query;

  let query = `
    SELECT issues.issue_timestamp, students.student_name, students.usn,
      components.name AS component_name, issue_items.quantity, issue_items.returned_quantity
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
  if (startDate) { conditions.push("date(issues.issue_timestamp) >= ?"); params.push(startDate); }
  if (endDate) { conditions.push("date(issues.issue_timestamp) <= ?"); params.push(endDate); }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY issues.issue_timestamp DESC";

  const result = await db.execute({ sql: query, args: params });
  const rows = result.rows;

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=report.pdf");
  doc.pipe(res);

  // Header Banner
  doc.rect(0, 0, doc.page.width, 75).fill("#1e293b");
  doc.fill("#ffffff").fontSize(22).font("Helvetica-Bold").text("Club ERP", 40, 18);
  doc.fontSize(11).font("Helvetica").text("Transactions Report", 40, 44);
  doc.fontSize(9).text(`Generated: ${new Date().toLocaleString()}`, doc.page.width - 220, 44, { width: 180, align: "right" });
  doc.fill("#000000"); doc.y = 90;

  // Filter Info
  const filterParts = [];
  if (usn) filterParts.push(`USN: ${usn}`);
  if (startDate) filterParts.push(`From: ${startDate}`);
  if (endDate) filterParts.push(`To: ${endDate}`);
  const filterText = filterParts.length > 0 ? filterParts.join("  |  ") : "All Records (No filters applied)";

  doc.rect(40, 90, doc.page.width - 80, 25).fill("#f1f5f9");
  doc.fill("#475569").fontSize(9).font("Helvetica").text(filterText, 50, 98, { width: doc.page.width - 100 });
  doc.fill("#000000"); doc.y = 130;

  // Transaction Table
  doc.moveDown(0.5);
  doc.rect(40, doc.y, 4, 16).fill("#2563eb");
  doc.fill("#1e293b").fontSize(13).font("Helvetica-Bold").text("  Transaction Details", 46, doc.y + 1);
  doc.fill("#000000"); doc.moveDown(0.8);

  let totalIssued = 0, totalReturned = 0;

  if (rows.length > 0) {
    await doc.table({
      headers: [
        { label: "Date", width: 90, headerColor: "#2563eb", headerOpacity: 1 },
        { label: "Student", width: 100, headerColor: "#2563eb", headerOpacity: 1 },
        { label: "USN", width: 85, headerColor: "#2563eb", headerOpacity: 1 },
        { label: "Component", width: 105, headerColor: "#2563eb", headerOpacity: 1 },
        { label: "Issued", width: 55, headerColor: "#2563eb", headerOpacity: 1, align: "center" },
        { label: "Returned", width: 60, headerColor: "#2563eb", headerOpacity: 1, align: "center" }
      ],
      rows: rows.map(r => {
        totalIssued += r.quantity;
        totalReturned += r.returned_quantity;
        return [r.issue_timestamp, r.student_name, r.usn, r.component_name, String(r.quantity), String(r.returned_quantity)];
      })
    }, { prepareHeader: () => doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff"), prepareRow: () => { doc.font("Helvetica").fontSize(8).fillColor("#334155"); return doc; }, padding: 5, columnsSize: [90, 100, 85, 105, 55, 60] });

    // Summary Box
    doc.moveDown(1.5);
    const boxY = doc.y;
    doc.rect(40, boxY, doc.page.width - 80, 70).fill("#f8fafc").stroke("#e2e8f0");
    doc.fill("#1e293b").fontSize(12).font("Helvetica-Bold").text("Summary", 55, boxY + 10);
    doc.fontSize(10).font("Helvetica").fillColor("#334155");
    doc.text(`Total Issued: ${totalIssued}`, 55, boxY + 28);
    doc.text(`Total Returned: ${totalReturned}`, 55, boxY + 42);
    doc.font("Helvetica-Bold").fillColor("#dc2626").text(`Currently Out: ${totalIssued - totalReturned}`, 55, boxY + 56);
    doc.fillColor("#000000");
  } else {
    doc.fontSize(10).fillColor("#94a3b8").text("  No transactions match the specified filters.");
    doc.fillColor("#000000");
  }

  // Footer
  doc.moveDown(2);
  doc.fontSize(9).fillColor("#1e293b").font("Helvetica-Bold")
    .text("Built by Jishnu Abbhay D  •  Auto-generated by Club ERP", 40, doc.y, { align: "center", width: doc.page.width - 80 });

  doc.end();
});

// ExcelJS is already required at the top


app.get("/download-report-excel", requireAdmin, async (req, res) => {
  const { usn, startDate, endDate } = req.query;

  let query = `
    SELECT issues.issue_timestamp, students.student_name, students.usn,
      components.name AS component_name, issue_items.quantity, issue_items.returned_quantity
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
  if (startDate) { conditions.push("date(issues.issue_timestamp) >= ?"); params.push(startDate); }
  if (endDate) { conditions.push("date(issues.issue_timestamp) <= ?"); params.push(endDate); }
  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
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

  let totalIssued = 0, totalReturned = 0;

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

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=report.xlsx");

  await workbook.xlsx.write(res);
  res.end();
});

// ================= GLOBAL ERROR HANDLER =================

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack || err.message || err);
  if (!res.headersSent) {
    res.status(500).json({ message: "Internal server error" });
  }
});

// ================= START SERVER =================

startApp();
