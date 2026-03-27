const express = require("express");
const { createClient } = require("@libsql/client");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const helmet = require("helmet");
const PDFDocument = require("pdfkit-table");
const ExcelJS = require("exceljs");
const crypto = require("crypto");
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });


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

// ================= CRASH LOGGING =================
process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});


// Trust Render's reverse proxy (required for sessions & secure cookies behind HTTPS)
app.set("trust proxy", 1);

// ================= TURSO DATABASE =================

// Initialize database client with flexibility for different naming conventions
let db;
try {
  const dbUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_DB_URL || process.env.DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;

  if (!dbUrl) {
    throw new Error("No database URL found (checked TURSO_DATABASE_URL, LIBSQL_DB_URL, and DATABASE_URL)");
  }

  db = createClient({
    url: dbUrl,
    authToken: authToken,
  });
  console.log("Database client created successfully");
} catch (err) {
  console.error("Failed to create database client:", err.message);
  db = {
    execute: () => { throw new Error(`DB Error: ${err.message}. Ensure env variables are set in Vercel.`); }
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
  const maxAttempts = 50; // Increased for troubleshooting
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
    const maxRetries = 2;
    let lastErr;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await this.db.execute({ 
          sql: "SELECT data FROM sessions WHERE sid = ? AND expires > ?", 
          args: [sid, Date.now()] 
        });
        if (result.rows.length > 0) {
          return callback(null, JSON.parse(result.rows[0].data));
        }
        return callback(null, null);
      } catch (err) {
        lastErr = err;
        console.warn(`[RETRY ${i+1}/${maxRetries}] Session GET error:`, err.message);
        if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 200 * (i + 1)));
      }
    }
    console.error("Session GET failed after retries:", lastErr.message);
    callback(null, null);
  }
  async set(sid, sessionData, callback) {
    const maxRetries = 2;
    let lastErr;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const maxAge = sessionData.cookie && sessionData.cookie.maxAge ? sessionData.cookie.maxAge : 86400000;
        const expires = Date.now() + maxAge;
        const data = JSON.stringify(sessionData);
        await this.db.execute({ 
          sql: "INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)", 
          args: [sid, data, expires] 
        });
        if (callback) callback(null);
        return;
      } catch (err) {
        lastErr = err;
        console.warn(`[RETRY ${i+1}/${maxRetries}] Session SET error:`, err.message);
        if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 200 * (i + 1)));
      }
    }
    console.error("Session SET failed after retries:", lastErr.message);
    if (callback) callback(null);
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

/**
 * Access levels:
 * - ADMIN: Full access to everything.
 * - SUB_ADMIN: Access to Request Queue, Transactions, Reports, Damage Log.
 */
const RESTRICTED_FOR_SUB_ADMIN = [
  "/students-page", "/api/admin/bulk-import-students", "/api/admin/cleanup-graduated",
  "/components-page", "/add-component", "/edit-component", "/delete-component", "/update-stock",
  "/admin-settings-page", "/api/admin/settings", "/create-admin", "/delete-admin", "/change-admin", "/admins",
  "/backup", "/list-backups", "/restore-backup", "/delete-backup"
];

function requireAccess(req, res, next) {
  if (!req.session || !req.session.admin) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  const role = req.session.role;
  const path = req.path;
  
  if (role === 'SUB_ADMIN' && RESTRICTED_FOR_SUB_ADMIN.some(p => path.startsWith(p))) {
    return res.status(403).json({ success: false, message: "Access denied: Full Admin privileges required." });
  }
  
  next();
}

const STUDENT_HTML_PATHS = ["/student-dashboard", "/student-catalog", "/student-requests-page", "/student-my-profile"];

function requireStudent(req, res, next) {
  const sessId = req.session ? req.session.student_id : 'NO_SESSION';
  const role = req.session ? req.session.role : 'NO_ROLE';
  
  if (req.session && req.session.student_id) {
    next();
  } else if (req.method === "GET" && STUDENT_HTML_PATHS.includes(req.path)) {
    console.log(`[AUTH] Redirecting Student Access: ${req.path} | Method: ${req.method} | SID: ${sessId} | Role: ${role}`);
    res.redirect(302, "/student-login.html");
  } else {
    if (!STUDENT_HTML_PATHS.includes(req.path) && req.path.startsWith("/api/student")) {
       console.log(`[AUTH] Unauthorized API Access: ${req.path} | Method: ${req.method} | SID: ${sessId}`);
    }
    return res.status(401).json({ message: "Unauthorized" });
  }
}



// ================= DATABASE SETUP =================

  async function initDatabase() {
  await db.execute(`CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT,
    expires INTEGER
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT NOT NULL DEFAULT 'ADMIN'
  )`);
  
  try { await db.execute(`ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'ADMIN'`); } catch (e) { /* column exists */ }

  const admin_check = await db.execute({ sql: "SELECT * FROM admins WHERE username = ?", args: ["admin"] });
  if (admin_check.rows.length === 0) {
    const hp = await bcrypt.hash("admin123", 10);
    await db.execute({ sql: "INSERT INTO admins (username, password, role) VALUES (?, ?, ?)", args: ["admin", hp, "ADMIN"] });
    console.log("Default admin created: admin / admin123");
  }

  const debug_check = await db.execute({ sql: "SELECT * FROM admins WHERE username = ?", args: ["debug_admin"] });
  if (debug_check.rows.length === 0) {
    const hp = await bcrypt.hash("debug123", 10);
    await db.execute({ sql: "INSERT INTO admins (username, password, role) VALUES (?, ?, ?)", args: ["debug_admin", hp, "ADMIN"] });
  }

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

  try { await db.execute(`ALTER TABLE students ADD COLUMN email TEXT`); } catch (e) { /* column exists */ }
  try { await db.execute(`ALTER TABLE students ADD COLUMN password TEXT`); } catch (e) { /* column exists */ }
  try { await db.execute(`ALTER TABLE students ADD COLUMN semester TEXT`); } catch (e) { /* column exists */ }
  try { await db.execute(`ALTER TABLE students ADD COLUMN department TEXT`); } catch (e) { /* column exists */ }

  await db.execute(`CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    issue_timestamp DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    request_id INTEGER,
    FOREIGN KEY(student_id) REFERENCES students(id)
  )`);

  try { await db.execute(`ALTER TABLE issues ADD COLUMN request_id INTEGER`); } catch (e) { /* column exists */ }

  await db.execute(`CREATE TABLE IF NOT EXISTS issue_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER,
    component_id INTEGER,
    quantity INTEGER,
    returned_quantity INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    FOREIGN KEY(issue_id) REFERENCES issues(id),
    FOREIGN KEY(component_id) REFERENCES components(id)
  )`);
  try { await db.execute(`ALTER TABLE issue_items ADD COLUMN updated_at DATETIME`); } catch (e) {}

  await db.execute(`CREATE TABLE IF NOT EXISTS component_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    component_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    purpose_note TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    admin_id INTEGER,
    rejection_reason TEXT,
    confirmation_token TEXT,
    confirmation_token_expiry DATETIME,
    confirmed_at DATETIME,
    last_edited_by INTEGER,
    last_edited_at DATETIME,
    edit_log TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    updated_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    cart_id TEXT,
    FOREIGN KEY(student_id) REFERENCES students(id),
    FOREIGN KEY(component_id) REFERENCES components(id)
  )`);

  try { await db.execute(`ALTER TABLE component_requests ADD COLUMN cart_id TEXT`); } catch (e) {}

  await db.execute(`CREATE TABLE IF NOT EXISTS damage_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    student_id INTEGER,
    component_id INTEGER,
    severity TEXT,
    note TEXT,
    status TEXT DEFAULT 'PENDING',
    reported_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    updated_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    admin_id INTEGER,
    quantity INTEGER DEFAULT 1
  )`);
  try { await db.execute(`ALTER TABLE damage_reports ADD COLUMN updated_at DATETIME`); } catch (e) {}
  try { await db.execute(`ALTER TABLE damage_reports ADD COLUMN admin_id INTEGER`); } catch (e) {}
  try { await db.execute(`ALTER TABLE damage_reports ADD COLUMN quantity INTEGER DEFAULT 1`); } catch (e) {}

  // Settings table
  await db.execute(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes'))
  )`);

  // Default Settings Seed
  const defaultSettings = [
    { k: 'club_name', v: 'CERP' },
    { k: 'club_tagline', v: 'Club ERP — Manage your club\'s inventory' },
    { k: 'low_stock_threshold', v: '5' },
    { k: 'max_borrow_quantity', v: '5' },
    { k: 'allow_out_of_stock_requests', v: 'false' },
    { k: 'session_timeout_hours', v: '24' },
    { k: 'max_login_attempts', v: '10' },
    { k: 'login_lockout_minutes', v: '15' },
    { k: 'auto_backup_interval_hours', v: '6' },
    { k: 'max_backups_to_keep', v: '10' },
    { k: 'student_self_registration', v: 'false' }
  ];

  for (const s of defaultSettings) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
      args: [s.k, s.v]
    });
  }

  // Cleanup redundant admin re-creation (already handled above)
}

// ================= SETTINGS HELPER =================

let settingsCache = {};
let lastFetch = 0;

async function getSettings() {
  const now = Date.now();
  if (now - lastFetch < 60000 && Object.keys(settingsCache).length > 0) return settingsCache;

  try {
    const result = await db.execute("SELECT key, value FROM settings");
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    settingsCache = settings;
    lastFetch = now;
    return settings;
  } catch (err) {
    console.error("Error fetching settings:", err);
    return settingsCache; // Return stale cache on error
  }
}

// Database ready flag
let dbReady = false;
let dbInitializationPromise = null;

async function ensureDbInitialized() {
  if (dbReady) return true;
  if (dbInitializationPromise) return dbInitializationPromise;

  dbInitializationPromise = (async () => {
    try {
      console.log("Starting database initialization...");
      await initDatabase();
      dbReady = true;
      console.log("Database initialized successfully");
      return true;
    } catch (err) {
      console.error("CRITICAL: Database initialization failed:", err.message);
      dbInitializationPromise = null; // Allow retry on next request
      throw err;
    }
  })();

  return dbInitializationPromise;
}

app.use(async (req, res, next) => {
  // Allow these paths without DB
  const staticPaths = ['/login.html', '/student-login.html', '/confirm-receipt.html', '/style.css', '/ennovate-logo.png', '/favicon.ico', '/debug-env', '/version'];
  if (staticPaths.includes(req.path)) return next();

  if (!dbReady) {
    try {
      await ensureDbInitialized();
    } catch (err) {
      return res.status(503).json({
        success: false,
        message: "Database failed to initialize: " + err.message
      });
    }
  }
  next();
});

async function startApp() {
  try {
    console.log("Pre-initializing database...");
    await ensureDbInitialized();
    
    const PORT = process.env.PORT || 3000;
    // Only listen if not running in a serverless environment (Vercel)
    if (!process.env.VERCEL) {
      app.listen(PORT, () => {
        console.log(`ERP running on http://localhost:${PORT}`);
        console.log(`Version: ${CURRENT_VERSION}`);
      });
    }
  } catch (err) {
    console.error("FAILED TO START APP:", err);
    if (process.env.NODE_ENV === "production") process.exit(1);
  }
}


// Export the app for Vercel
module.exports = app;

app.get("/version", (req, res) => res.send(CURRENT_VERSION));


const CURRENT_VERSION = "v1.3-damage-fix-v2";

// ================= DEBUG ROUTE =================
app.get("/debug-env", (req, res) => {
  res.json({
    VERSION: CURRENT_VERSION,


    DATABASE_URL_PRESENT: !!(process.env.TURSO_DATABASE_URL || process.env.LIBSQL_DB_URL || process.env.DATABASE_URL),
    AUTH_TOKEN_PRESENT: !!(process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN),
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: !!process.env.VERCEL,
    DB_READY_FLAG: dbReady
  });
});

app.get("/student-login", (req, res) => {
  res.redirect(302, "/student-login.html");
});




// ================= AUTH ROUTES =================

app.post("/login", loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    // No more manual dbReady check here, handled by middleware

    console.log(`Login attempt for username: "${username}"`);

    // Case-insensitive lookup for more reliability
    const result = await db.execute({
      sql: "SELECT * FROM admins WHERE LOWER(username) = LOWER(?)",
      args: [username]
    });

    if (result.rows.length === 0) {
      console.warn(`Login failed: Username "${username}" not found in database.`);
      const record = loginAttempts.get(req.ip) || { count: 0, lastAttempt: Date.now() };
      record.count++; record.lastAttempt = Date.now();
      loginAttempts.set(req.ip, record);
      return res.json({ success: false, message: "Username not found in database" });
    }

    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password);

    if (!match) {
      console.warn(`Login failed: Incorrect password for "${username}".`);
      const record = loginAttempts.get(req.ip) || { count: 0, lastAttempt: Date.now() };
      record.count++; record.lastAttempt = Date.now();
      loginAttempts.set(req.ip, record);
      return res.json({ success: false, message: "Incorrect password" });
    }


    loginAttempts.delete(req.ip);
    req.session.admin = admin.id;
    req.session.role = admin.role || 'ADMIN';
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

app.post("/change-admin", requireAccess, async (req, res) => {
  const { newUsername, newPassword } = req.body;
  if (!newUsername || !newPassword) return res.json({ success: false, message: "Missing fields" });
  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    const roleRes = await db.execute({ sql: "SELECT role FROM admins WHERE id = ?", args: [req.session.admin] });
    const currentRole = roleRes.rows[0].role;
    // Don't allow self-downgrade unless another admin exists? 
    // Actually, user_request says "How sub-admins are created/assigned (by a full admin in settings)".
    await db.execute({ sql: "UPDATE admins SET username = ?, password = ? WHERE id = ?", args: [newUsername, hashed, req.session.admin] });
    res.json({ success: true });
  } catch (err) {
    console.error("Change admin error:", err);
    if (err.message && err.message.includes("UNIQUE")) {
      res.json({ success: false, message: "Username already taken" });
    } else {
      res.json({ success: false, message: "Server error: " + err.message });
    }
  }
});

app.get("/api/admin/me", requireAccess, (req, res) => {
  res.json({ id: req.session.admin, role: req.session.role });
});

// ================= REQUEST QUEUE APIS =================

app.get("/api/admin/request-queue", requireAccess, async (req, res) => {
  // Groups pending requests by cart_id (using a fallback for items without a cart_id)
  const result = await db.execute(`
    SELECT 
      COALESCE(cr.cart_id, 'SINGLE-' || cr.id) as cart_id,
      MIN(cr.created_at) as request_timestamp,
      s.student_name,
      s.usn,
      s.phone,
      COUNT(cr.id) as item_count,
      GROUP_CONCAT(c.name || ' (x' || cr.quantity || ')') as summary
    FROM component_requests cr
    JOIN students s ON cr.student_id = s.id
    JOIN components c ON cr.component_id = c.id
    WHERE cr.status = 'PENDING'
    GROUP BY COALESCE(cr.cart_id, 'SINGLE-' || cr.id)
    ORDER BY request_timestamp DESC
  `);
  res.json(result.rows);
});

app.get("/api/admin/request-cart/:cart_id", requireAccess, async (req, res) => {
  const { cart_id } = req.params;
  
  // Get items
  const items = await db.execute({
    sql: `
      SELECT 
        cr.id, 
        cr.component_id,
        cr.quantity,
        cr.purpose_note,
        cr.status,
        c.name as component_name,
        c.available_quantity,
        cr.rejection_reason
      FROM component_requests cr
      JOIN components c ON cr.component_id = c.id
      WHERE COALESCE(cr.cart_id, 'SINGLE-' || cr.id) = ?
    `,
    args: [cart_id]
  });

  // Get student info from first item
  let student_info = {};
  if (items.rows.length > 0) {
    const sRes = await db.execute({
      sql: `SELECT s.student_name as name, s.usn, s.email, s.phone 
            FROM component_requests cr 
            JOIN students s ON cr.student_id = s.id 
            WHERE COALESCE(cr.cart_id, 'SINGLE-' || cr.id) = ? LIMIT 1`,
      args: [cart_id]
    });
    student_info = sRes.rows[0] || {};
  }

  res.json({ items: items.rows, student_info });
});

app.get("/api/admin/request-history", requireAccess, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT 
        cr.*,
        s.student_name,
        s.usn,
        c.name as component_name,
        a.username as admin_name
      FROM component_requests cr
      JOIN students s ON cr.student_id = s.id
      JOIN components c ON cr.component_id = c.id
      LEFT JOIN admins a ON cr.admin_id = a.id
      WHERE cr.status != 'PENDING'
      ORDER BY cr.updated_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Request history error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/admin/requests/bulk-action", requireAccess, async (req, res) => {
  const { cart_id, items, action, main_note } = req.body;
  try {
    const admin_id = req.session.admin;
    const results = [];
    let shared_issue_id = null;
    
    console.log(`[QUEUE] Processing bulk-action for Cart: ${cart_id} | Action: ${action}`);
    for (const item of items) {
      try {
        const crId = item.id;
        const itemAction = item.action || action;
        const note = item.note || main_note;
        
        if (itemAction === 'APPROVE') {
          const reqRow = (await db.execute({ sql: "SELECT * FROM component_requests WHERE id = ?", args: [crId] })).rows[0];
          if (!reqRow || reqRow.status !== 'PENDING') {
             console.warn(`[QUEUE] Item ${crId} already processed or missing.`);
             continue;
          }
          
          const comp = (await db.execute({ sql: "SELECT available_quantity, name FROM components WHERE id = ?", args: [reqRow.component_id] })).rows[0];
          if (!comp || comp.available_quantity < reqRow.quantity) {
             console.warn(`[QUEUE] Stock fail for ${crId}: ${comp ? comp.available_quantity : 'NA'} < ${reqRow.quantity}`);
             await db.execute({ sql: "UPDATE component_requests SET status = 'REJECTED', rejection_reason = 'Insufficient stock', admin_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?", args: [admin_id, crId] });
             continue;
          }
          
          // 1. Mark as Approved
          await db.execute({ sql: "UPDATE component_requests SET status = 'APPROVED', admin_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?", args: [admin_id, crId] });
          
          // 2. Create Transaction (Issue) - ONLY ONCE PER CART
          if (!shared_issue_id) {
            const issueRes = await db.execute({ 
              sql: "INSERT INTO issues (student_id, request_id) VALUES (?, ?)", 
              args: [reqRow.student_id, crId] 
            });
            shared_issue_id = Number(issueRes.lastInsertRowid);
            console.log(`[QUEUE] Created Shared Issue ID: ${shared_issue_id} for Cart: ${cart_id}`);
          }
          
          // 3. Link Item to Issue
          await db.execute({ 
            sql: "INSERT INTO issue_items (issue_id, component_id, quantity, returned_quantity) VALUES (?, ?, ?, 0)", 
            args: [shared_issue_id, reqRow.component_id, reqRow.quantity] 
          });
          
          // 4. Update Stock
          await db.execute({ 
            sql: "UPDATE components SET available_quantity = available_quantity - ? WHERE id = ?", 
            args: [reqRow.quantity, reqRow.component_id] 
          });
          
          results.push({ id: crId, success: true });
          
        } else if (itemAction === 'REJECT') {
          await db.execute({ 
            sql: "UPDATE component_requests SET status = 'REJECTED', rejection_reason = ?, admin_id = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?", 
            args: [note, admin_id, crId] 
          });
          results.push({ id: crId, success: true, rejected: true });
        }
      } catch (e) { 
        console.error(`[QUEUE] Error processing item ${item.id}:`, e);
        results.push({ id: item.id, success: false, error: e.message });
      }
    }
    res.json({ success: true, message: "Cart processed successfully", results });
  } catch (err) {
    console.error("Bulk action error:", err);
    res.status(500).json({ success: false, message: "Processing failed" });
  }
});

// ================= ADMIN MANAGEMENT =================

app.post("/create-admin", requireAccess, async (req, res) => {
  const { newUsername, newPassword, role } = req.body;
  if (!newUsername || !newPassword) return res.json({ success: false, message: "Missing fields" });
  console.log(`[ADMIN] Creating new admin: ${newUsername} with role ${role}`);
  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute({ 
      sql: "INSERT INTO admins (username, password, role) VALUES (?, ?, ?)", 
      args: [newUsername, hashed, role || 'SUB_ADMIN'] 
    });
    console.log(`[ADMIN] Successfully created admin: ${newUsername}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ADMIN] Failed to create admin: ${newUsername}`, err);
    res.json({ success: false, message: "Username already taken or database error" });
  }
});

app.post("/update-admin", requireAccess, async (req, res) => {
  const { id, newUsername, newPassword, role } = req.body;
  if (!id) return res.json({ success: false, message: "Admin ID required" });
  console.log(`[ADMIN] Updating admin ID: ${id}`);
  
  try {
    let sql = "UPDATE admins SET ";
    const args = [];
    const updates = [];
    
    if (newUsername) {
      updates.push("username = ?");
      args.push(newUsername);
    }
    if (newPassword) {
      const hashed = await bcrypt.hash(newPassword, 10);
      updates.push("password = ?");
      args.push(hashed);
    }
    if (role) {
      updates.push("role = ?");
      args.push(role);
    }
    
    if (updates.length === 0) return res.json({ success: false, message: "No updates provided" });
    
    sql += updates.join(", ") + " WHERE id = ?";
    args.push(id);
    
    await db.execute({ sql, args });
    console.log(`[ADMIN] Successfully updated admin ID: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ADMIN] Failed to update admin ID: ${id}`, err);
    res.json({ success: false, message: "Update failed: " + err.message });
  }
});

app.get("/admins", requireAccess, async (req, res) => {
  const result = await db.execute("SELECT id, username, role FROM admins");
  res.json(result.rows);
});

app.post("/delete-admin", requireAccess, async (req, res) => {
  const { id } = req.body;
  console.log(`[ADMIN] Deletion attempt for Admin ID: ${id} by Session Admin: ${req.session.admin}`);
  if (id === req.session.admin) return res.json({ success: false, message: "Cannot delete yourself" });
  try {
    const count = await db.execute("SELECT COUNT(*) as count FROM admins");
    if (count.rows[0].count <= 1) return res.json({ success: false, message: "Cannot delete the last admin" });
    await db.execute({ sql: "DELETE FROM admins WHERE id = ?", args: [id] });
    console.log(`[ADMIN] Successfully deleted Admin ID: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ADMIN] Failed to delete Admin ID: ${id}`, err);
    res.json({ success: false, message: "Deletion failed: " + err.message });
  }
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

app.get("/", requireAccess, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "dashboard.html"));
});

app.get("/components-page", requireAccess, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "components.html"));
});

// Issue page removed — all issuing now goes through student request → admin approve flow


app.get("/transactions-page", requireAccess, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "transactions.html"));
});

app.get("/reports-page", requireAccess, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "reports.html"));
});

app.get("/students-page", requireAccess, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "students.html"));
});

app.get("/student_profile.html", (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "student_profile.html"));
});

app.get("/admin-requests-page", requireAccess, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "admin-requests.html"));
});

// Student portal page routes
app.get("/student-dashboard", requireStudent, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "student-dashboard.html"));
});

app.get("/student-catalog", requireStudent, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "student-catalog.html"));
});

app.get("/student-requests-page", requireStudent, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "student-requests.html"));
});

app.get("/student-my-profile", requireStudent, (req, res) => {
  safeSendFile(res, path.join(__dirname, "public", "student-my-profile.html"));
});


// ================= COMPONENT ROUTES =================

app.post("/add-component", requireAccess, async (req, res) => {
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

app.post("/edit-component", requireAccess, async (req, res) => {
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

app.get("/components", requireAccess, async (req, res) => {
  const result = await db.execute("SELECT * FROM components");
  res.json(result.rows);
});

app.post("/delete-component", requireAccess, async (req, res) => {
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

app.post("/rename-component", requireAccess, async (req, res) => {
  const { id, new_name } = req.body;
  await db.execute({ sql: "UPDATE components SET name = ? WHERE id = ?", args: [new_name, id] });
  res.json({ message: "Renamed successfully" });
});

// ================= ISSUE CREATION =================

app.post("/create-issue", requireAccess, async (req, res) => {
  const { student_name, usn: rawUsn, phone, items } = req.body;
  const usn = (rawUsn || '').toUpperCase();
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

// ================= PUBLIC SETTINGS =================

app.get("/api/public/settings", async (req, res) => {
  const settings = await getSettings();
  res.json({
    club_name: settings.club_name,
    club_tagline: settings.club_tagline
  });
});

// ================= SETTINGS ROUTES =================

app.get("/api/admin/settings", requireAccess, async (req, res) => {
  const settings = await getSettings();
  res.json(settings);
});

app.put("/api/admin/settings", requireAccess, async (req, res) => {
  const updates = req.body;
  try {
    for (const [key, value] of Object.entries(updates)) {
      await db.execute({
        sql: "UPDATE settings SET value = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE key = ?",
        args: [String(value), key]
      });
    }
    lastFetch = 0; // Invalidate cache
    res.json({ success: true, message: "Settings updated successfully" });
  } catch (err) {
    console.error("Update settings error:", err);
    res.status(500).json({ success: false, message: "Error updating settings" });
  }
});

// ================= RETURN SINGLE =================

app.post("/return-item", requireAccess, async (req, res) => {
  const { item_id, return_quantity, component_id, is_damaged, damage_severity, damage_note } = req.body;
  console.log(`[RETURN] Request received: ItemID=${item_id}, Qty=${return_quantity}, Dmg=${is_damaged}`);
  const itemIdInt = parseInt(item_id);
  const compIdInt = parseInt(component_id);
  const qtyInt = parseInt(return_quantity);
  
  console.log(`[RETURN] Processing Item: ${itemIdInt} | Qty: ${qtyInt} | Damaged: ${is_damaged}`);
  try {
    const result = await db.execute({ 
      sql: "SELECT ii.quantity, ii.returned_quantity, i.student_id FROM issue_items ii JOIN issues i ON ii.issue_id = i.id WHERE ii.id = ?", 
      args: [itemIdInt] 
    });
    if (result.rows.length === 0) {
      console.warn(`[RETURN] Item ${itemIdInt} not found in issue_items`);
      return res.status(404).json({ success: false, message: "Item not found" });
    }
    const row = result.rows[0];
    const remaining = row.quantity - row.returned_quantity;
    if (qtyInt > remaining) {
      console.warn(`[RETURN] Qty ${qtyInt} exceeds remaining ${remaining}`);
      return res.status(400).json({ success: false, message: `Return exceeds remaining (${remaining})` });
    }

    // Update issue_items
    console.log(`[RETURN] Updating issue_items: ${itemIdInt} | Qty: +${qtyInt}`);
    await db.execute({ 
      sql: "UPDATE issue_items SET returned_quantity = returned_quantity + ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?", 
      args: [qtyInt, itemIdInt] 
    });
    
    // Update stock
    if (damage_severity !== 'DESTROYED') {
      await db.execute({ 
        sql: "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?", 
        args: [qtyInt, compIdInt] 
      });
    }

    // Report damage if needed
    if (is_damaged) {
      const adminId = req.session.admin || 1; // Fallback to first admin if session is weird
      console.log(`[RETURN] Reporting Damage for Item: ${itemIdInt} | Qty: ${qtyInt} | Severity: ${damage_severity} | Admin: ${adminId}`);
      try {
        await db.execute({
          sql: "INSERT INTO damage_reports (item_id, student_id, component_id, severity, note, admin_id, quantity, reported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+5 hours', '+30 minutes'), datetime('now', '+5 hours', '+30 minutes'))",
          args: [itemIdInt, row.student_id, compIdInt, damage_severity, damage_note, adminId, qtyInt]
        });
        console.log(`[RETURN] Damage Report inserted successfully`);
      } catch (insertErr) {
        console.error(`[RETURN] Damage Report INSERT failed:`, insertErr.message);
        return res.status(500).json({ success: false, message: "Return updated, but damage report failed to save: " + insertErr.message });
      }
    }

    res.json({ success: true, message: "Return processed" + (is_damaged ? " and damage reported" : "") });
  } catch (err) {
    console.error("Return item error:", err);
    res.status(500).json({ success: false, message: "Error processing return: " + err.message });
  }
});

// ================= RETURN ALL =================

// ================= RETURN ALL =================

app.post("/return-all", requireAccess, async (req, res) => {
  const { issue_id } = req.body;
  const issueIdInt = parseInt(issue_id);
  try {
    const items = await db.execute({ 
      sql: "SELECT id, component_id, (quantity - returned_quantity) AS unreturned FROM issue_items WHERE issue_id = ?", 
      args: [issueIdInt] 
    });
    
    for (const item of items.rows) {
      if (item.unreturned > 0) {
        // Simple return all (no damage reporting in bulk for now)
        await db.execute({ 
          sql: "UPDATE issue_items SET returned_quantity = quantity, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?", 
          args: [item.id] 
        });
        await db.execute({ 
          sql: "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?", 
          args: [item.unreturned, item.component_id] 
        });
      }
    }
    res.json({ success: true, message: "Transaction completed. All items returned." });
  } catch (err) {
    console.error("Bulk return error:", err);
    res.status(500).json({ success: false, message: "Error in bulk return" });
  }
});

// ================= DAMAGE REPORTS API =================

app.get("/api/admin/damage-reports", requireAccess, async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT dr.*, c.name as component_name, s.student_name, s.usn, s.email, a.username as admin_name
      FROM damage_reports dr
      JOIN components c ON dr.component_id = c.id
      JOIN students s ON dr.student_id = s.id
      LEFT JOIN admins a ON dr.admin_id = a.id
      ORDER BY dr.reported_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Damage reports error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/admin/damage-report-resolve", requireAccess, async (req, res) => {
  const { id, status } = req.body;
  try {
    await db.execute({ 
      sql: "UPDATE damage_reports SET status = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?", 
      args: [status, id] 
    });
    res.json({ success: true, message: "Status updated" });
  } catch (err) {
    res.json({ success: false, message: "Error updating status" });
  }
});

// ================= TRANSACTIONS =================

app.get("/transactions", requireAccess, async (req, res) => {
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
      (issue_items.quantity - issue_items.returned_quantity) AS remaining,
      issue_items.updated_at AS return_timestamp,
      dr.severity AS damage_severity,
      dr.note AS damage_note,
      dr.reported_at AS damage_timestamp
    FROM issues
    JOIN students ON issues.student_id = students.id
    JOIN issue_items ON issue_items.issue_id = issues.id
    JOIN components ON issue_items.component_id = components.id
    LEFT JOIN damage_reports dr ON dr.item_id = issue_items.id
    ORDER BY issues.issue_timestamp DESC
  `);
  res.json(result.rows);
});

app.post("/delete-transaction", requireAccess, async (req, res) => {
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
    await db.execute({ sql: "DELETE FROM issues WHERE issue_id = ?", args: [issue_id] });
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
        issues.id AS issue_id,
        students.student_name,
        students.usn,
        students.phone,
        students.email,
        students.semester,
        students.department,
        issues.issue_timestamp,
        components.name AS component_name,
        issue_items.quantity,
        issue_items.returned_quantity,
        (issue_items.quantity - issue_items.returned_quantity) AS remaining,
        issue_items.updated_at AS return_timestamp
      FROM issues
      JOIN students ON issues.student_id = students.id
      JOIN issue_items ON issue_items.issue_id = issues.id
      JOIN components ON issue_items.component_id = components.id
      WHERE students.usn = ?
      ORDER BY issues.issue_timestamp DESC
    `, args: [req.params.usn]
  });

  // If no transactions found, try to get just the student info
  if (result.rows.length === 0) {
    const studentInfo = await db.execute({
      sql: "SELECT student_name, usn, phone, email, semester, department FROM students WHERE usn = ?",
      args: [req.params.usn]
    });
    if (studentInfo.rows.length > 0) {
      const s = studentInfo.rows[0];
      // Return a "dummy" row with just info so header populates
      return res.json([{ 
        ...s, 
        usn: s.usn.toUpperCase(), 
        is_empty: true 
      }]);
    }
  }

  const rows = result.rows.map(r => ({ ...r, usn: r.usn.toUpperCase() }));
  res.json(rows);
});


// ================= STUDENTS DIRECTORY =================

app.get("/students", requireAccess, async (req, res) => {
  const result = await db.execute("SELECT * FROM students ORDER BY student_name ASC");
  // Force USN uppercase in output
  const rows = result.rows.map(r => ({ ...r, usn: (r.usn || '').toUpperCase() }));
  res.json(rows);
});

app.post("/edit-student", requireAccess, async (req, res) => {
  const { id, student_name, usn, phone, email, semester, department } = req.body;
  try {
    await db.execute({ 
      sql: "UPDATE students SET student_name = ?, usn = ?, phone = ?, email = ?, semester = ?, department = ? WHERE id = ?", 
      args: [student_name, usn, phone || null, email, semester || null, department || null, id] 
    });
    res.json({ success: true, message: "Student updated" });
  } catch (err) {
    console.error("Edit student error:", err);
    res.json({ success: false, message: "Error updating student (USN or Email may conflict)" });
  }
});

app.post("/delete-student", requireAccess, async (req, res) => {
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

app.get("/dashboard-summary", requireAccess, async (req, res) => {
  try {
    const settings = await getSettings();
    const threshold = parseInt(settings.low_stock_threshold || '5');

    const comp = await db.execute("SELECT COUNT(*) AS total_components FROM components");
    const out = await db.execute("SELECT COALESCE(SUM(quantity - returned_quantity), 0) AS total_out FROM issue_items");
    const stud = await db.execute("SELECT COUNT(*) AS total_students FROM students");
    const lowStock = await db.execute({
      sql: "SELECT name, available_quantity FROM components WHERE available_quantity < ? ORDER BY available_quantity ASC",
      args: [threshold]
    });

    res.json({
      club_name: settings.club_name,
      club_tagline: settings.club_tagline,
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

app.get("/export-database", requireAccess, async (req, res) => {
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

app.get("/export-database-pdf", requireAccess, async (req, res) => {
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

app.post("/import-components", requireAccess, upload.single("file"), async (req, res) => {
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


app.get("/download-report-pdf", requireAccess, async (req, res) => {
  const { usn, startDate, endDate } = req.query;

  let query = `
    SELECT issues.id AS issue_id, issues.issue_timestamp, students.student_name, students.usn,
      components.name AS component_name, issue_items.quantity, issue_items.returned_quantity,
      issue_items.updated_at AS return_timestamp
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
        { label: "Cart ID", width: 55, headerColor: "#2563eb", headerOpacity: 1, align: "center" },
        { label: "Date", width: 85, headerColor: "#2563eb", headerOpacity: 1 },
        { label: "Student", width: 95, headerColor: "#2563eb", headerOpacity: 1 },
        { label: "USN", width: 80, headerColor: "#2563eb", headerOpacity: 1 },
        { label: "Component", width: 95, headerColor: "#2563eb", headerOpacity: 1 },
        { label: "Issued", width: 45, headerColor: "#2563eb", headerOpacity: 1, align: "center" },
        { label: "Returned", width: 40, headerColor: "#2563eb", headerOpacity: 1, align: "center" }
      ],
      rows: rows.map(r => {
        totalIssued += r.quantity;
        totalReturned += r.returned_quantity;
        return [String(r.issue_id), r.issue_timestamp.split(" ")[0], r.student_name, r.usn, r.component_name, String(r.quantity), String(r.returned_quantity)];
      })
    }, { prepareHeader: () => doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff"), prepareRow: () => { doc.font("Helvetica").fontSize(7).fillColor("#334155"); return doc; }, padding: 4, columnsSize: [55, 85, 95, 80, 95, 45, 40] });

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


app.get("/download-report-excel", requireAccess, async (req, res) => {
  const { usn, startDate, endDate } = req.query;

  let query = `
    SELECT issues.id AS issue_id, issues.issue_timestamp, students.student_name, students.usn,
      components.name AS component_name, issue_items.quantity, issue_items.returned_quantity,
      issue_items.updated_at AS return_timestamp
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
    { header: "Cart ID", key: "issue_id", width: 10 },
    { header: "Timestamp", key: "timestamp", width: 20 },
    { header: "Student Name", key: "name", width: 20 },
    { header: "USN", key: "usn", width: 15 },
    { header: "Component", key: "component", width: 20 },
    { header: "Issued", key: "issued", width: 10 },
    { header: "Returned", key: "returned", width: 10 },
    { header: "Returned At", key: "return_timestamp", width: 20 }
  ];

  let totalIssued = 0, totalReturned = 0;

  rows.forEach(row => {
    totalIssued += row.quantity;
    totalReturned += row.returned_quantity;
    sheet.addRow({
      issue_id: row.issue_id,
      timestamp: row.issue_timestamp,
      name: row.student_name,
      usn: row.usn,
      component: row.component_name,
      issued: row.quantity,
      returned: row.returned_quantity,
      return_timestamp: row.return_timestamp || ''
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

// ================= STUDENT AUTH ROUTES =================


app.post("/student-login", loginRateLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    console.log(`Student login attempt for email: "${email}"`);
    const result = await db.execute({ sql: "SELECT * FROM students WHERE LOWER(email) = LOWER(?)", args: [email] });
    if (result.rows.length === 0) {
      console.warn(`Student login failed: Email "${email}" not found.`);
      return res.json({ success: false, message: "Email not found" });
    }
    const student = result.rows[0];
    if (!student.password) {
      console.warn(`Student login failed: Password not set for "${email}".`);
      return res.json({ success: false, message: "Account not configured. Contact admin." });
    }
    const match = await bcrypt.compare(password, student.password);
    if (!match) {
      console.warn(`Student login failed: Incorrect password for "${email}".`);
      return res.json({ success: false, message: "Incorrect password" });
    }
    req.session.student_id = student.id;
    req.session.role = "student";
    req.session.save((err) => {
      if (err) {
        console.error(`Session save error for student "${email}":`, err);
        return res.status(500).json({ success: false, message: "Session error" });
      }
      console.log(`Student login successful: "${email}" | Session ID: ${req.sessionID}`);
      res.json({ success: true });
    });
  } catch (err) {
    console.error("Student login error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


app.post("/student-logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/student-session", requireStudent, async (req, res) => {
  try {
    const result = await db.execute({ sql: "SELECT id, student_name, usn, email, phone, semester, department FROM students WHERE id = ?", args: [req.session.student_id] });
    if (result.rows.length === 0) return res.status(404).json({ message: "Student not found" });
    const student = { ...result.rows[0], usn: (result.rows[0].usn || '').toUpperCase() };
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/student/change-password", requireStudent, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.json({ success: false, message: "Both fields required" });

  try {
    const sResult = await db.execute({ sql: "SELECT password FROM students WHERE id = ?", args: [req.session.student_id] });
    if (sResult.rows.length === 0) return res.json({ success: false, message: "Student not found" });

    const student = sResult.rows[0];
    const match = await bcrypt.compare(currentPassword, student.password);
    if (!match) return res.json({ success: false, message: "Current password incorrect" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute({ sql: "UPDATE students SET password = ? WHERE id = ?", args: [hashed, req.session.student_id] });
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ================= STUDENT PORTAL API =================

// Student Dashboard Data
app.get("/api/student/dashboard", requireStudent, async (req, res) => {
  try {
    const sid = req.session.student_id;
    // Active borrows
    const borrows = await db.execute({
      sql: `SELECT components.name AS component_name, issue_items.quantity, issue_items.returned_quantity,
              (issue_items.quantity - issue_items.returned_quantity) AS remaining, issues.issue_timestamp
            FROM issues JOIN issue_items ON issue_items.issue_id = issues.id
            JOIN components ON issue_items.component_id = components.id
            WHERE issues.student_id = ? AND (issue_items.quantity - issue_items.returned_quantity) > 0
            ORDER BY issues.issue_timestamp DESC`, args: [sid]
    });
    // Pending requests
    const pending = await db.execute({
      sql: `SELECT cr.id, cr.quantity, cr.purpose_note, cr.status, cr.created_at, cr.updated_at,
              c.name AS component_name, cr.cart_id
            FROM component_requests cr JOIN components c ON cr.component_id = c.id
            WHERE cr.student_id = ? AND cr.status IN ('PENDING', 'DRAFT')
            ORDER BY cr.created_at DESC`, args: [sid]
    });
    // Recent history
    const history = await db.execute({
      sql: `SELECT cr.id, cr.quantity, cr.purpose_note, cr.status, cr.created_at, cr.confirmed_at,
              c.name AS component_name, cr.rejection_reason, cr.cart_id
            FROM component_requests cr JOIN components c ON cr.component_id = c.id
            WHERE cr.student_id = ? AND cr.status NOT IN ('PENDING', 'DRAFT')
            ORDER BY cr.updated_at DESC LIMIT 50`, args: [sid]
    });
    res.json({ borrows: borrows.rows, pending: pending.rows, history: history.rows });
  } catch (err) {
    console.error("Student dashboard error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Profile page: stats, active hold rows, monthly request counts (last 8 months)
app.get("/api/student/profile-summary", requireStudent, async (req, res) => {
  try {
    const sid = req.session.student_id;
    const totalIssued = await db.execute({
      sql: `SELECT COALESCE(SUM(ii.quantity), 0) AS n FROM issue_items ii
            JOIN issues i ON ii.issue_id = i.id WHERE i.student_id = ?`,
      args: [sid]
    });
    const totalReturned = await db.execute({
      sql: `SELECT COALESCE(SUM(ii.returned_quantity), 0) AS n FROM issue_items ii
            JOIN issues i ON ii.issue_id = i.id WHERE i.student_id = ?`,
      args: [sid]
    });
    const activeHolds = await db.execute({
      sql: `SELECT COALESCE(SUM(ii.quantity - ii.returned_quantity), 0) AS n FROM issue_items ii
            JOIN issues i ON ii.issue_id = i.id WHERE i.student_id = ?`,
      args: [sid]
    });
    const requestsMade = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM component_requests WHERE student_id = ?`,
      args: [sid]
    });
    const holdsDetail = await db.execute({
      sql: `SELECT c.name AS component_name, c.total_quantity AS component_total,
              (ii.quantity - ii.returned_quantity) AS held
            FROM issue_items ii
            JOIN issues i ON ii.issue_id = i.id
            JOIN components c ON ii.component_id = c.id
            WHERE i.student_id = ? AND (ii.quantity - ii.returned_quantity) > 0`,
      args: [sid]
    });
    const monthly = await db.execute({
      sql: `SELECT strftime('%Y-%m', created_at) AS ym, COUNT(*) AS cnt
            FROM component_requests WHERE student_id = ?
            GROUP BY ym ORDER BY ym ASC`,
      args: [sid]
    });
    const rows = monthly.rows || [];
    const last8 = rows.slice(-8);
    res.json({
      stats: {
        totalBorrowed: Number(totalIssued.rows[0].n) || 0,
        totalReturned: Number(totalReturned.rows[0].n) || 0,
        activeHolds: Number(activeHolds.rows[0].n) || 0,
        requestsMade: Number(requestsMade.rows[0].n) || 0
      },
      activeHoldRows: holdsDetail.rows,
      monthlyRequests: last8
    });
  } catch (err) {
    console.error("Profile summary error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Student Catalog (read-only)
app.get("/api/student/catalog", requireStudent, async (req, res) => {
  try {
    const result = await db.execute("SELECT id, name, total_quantity, available_quantity, photo1, photo2 FROM components ORDER BY name ASC");
    // Normalize IDs to String for consistent frontend comparison
    const rows = result.rows.map(r => ({
      ...r,
      id: String(r.id),
      total_quantity: Number(r.total_quantity),
      available_quantity: Number(r.available_quantity)
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Submit a component request
app.post("/api/student/request", requireStudent, async (req, res) => {
  const { component_id, quantity, purpose_note } = req.body;
  if (!component_id || !quantity || quantity < 1) return res.json({ success: false, message: "Invalid request" });
  try {
    const settings = await getSettings();
    const maxQty = parseInt(settings.max_borrow_quantity || '5');
    const allowOutOfStock = settings.allow_out_of_stock_requests === 'true';

    if (quantity > maxQty) {
      return res.json({ success: false, message: `Request exceeds limit. Max allowed is ${maxQty} per item.` });
    }

    const comp = await db.execute({ sql: "SELECT * FROM components WHERE id = ?", args: [component_id] });
    if (comp.rows.length === 0) return res.json({ success: false, message: "Component not found" });

    if (!allowOutOfStock && comp.rows[0].available_quantity < quantity) {
      return res.json({ success: false, message: `Insufficient stock. Only ${comp.rows[0].available_quantity} available.` });
    }

    const cart_id = "SINGLE-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    await db.execute({
      sql: `INSERT INTO component_requests (student_id, component_id, quantity, purpose_note, status, cart_id) VALUES (?, ?, ?, ?, 'PENDING', ?)`,
      args: [req.session.student_id, component_id, quantity, purpose_note || null, cart_id]
    });
    res.json({ success: true, message: "Request submitted successfully" });
  } catch (err) {
    console.error("Request submit error:", err);
    res.json({ success: false, message: "Error submitting request" });
  }
});

// Submit bulk component requests (Cart System)
app.post("/api/student/request-bulk", requireStudent, async (req, res) => {
  const { items, purpose_note } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.json({ success: false, message: "Invalid request: No items provided" });
  }

  try {
    const settings = await getSettings();
    const maxQty = parseInt(settings.max_borrow_quantity || '5');
    const allowOutOfStock = settings.allow_out_of_stock_requests === 'true';

    // 1. Validation loop
    for (const item of items) {
      const { component_id, quantity } = item;
      if (!component_id || !quantity || quantity < 1) {
        return res.json({ success: false, message: "Invalid item data in cart" });
      }

      if (quantity > maxQty) {
        return res.json({ success: false, message: `Request exceeds limit for an item. Max allowed is ${maxQty} per item.` });
      }

      const comp = await db.execute({ sql: "SELECT * FROM components WHERE id = ?", args: [component_id] });
      if (comp.rows.length === 0) return res.json({ success: false, message: "One of the items was not found" });

      if (!allowOutOfStock && comp.rows[0].available_quantity < quantity) {
        return res.json({ success: false, message: `Insufficient stock for "${comp.rows[0].name}". Only ${comp.rows[0].available_quantity} available.` });
      }
    }

    // 2. Insertion loop
    const student_id = req.session.student_id;
    const cart_id = "CART-" + Date.now() + "-" + Math.floor(Math.random() * 1000);

    for (const item of items) {
      await db.execute({
        sql: `INSERT INTO component_requests (student_id, component_id, quantity, purpose_note, status, cart_id) VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        args: [student_id, item.component_id, item.quantity, purpose_note || null, cart_id]
      });
    }

    res.json({ success: true, message: "All requests submitted successfully! ✅", cart_id });
  } catch (err) {
    console.error("Bulk request submit error:", err);
    res.json({ success: false, message: "Error submitting requests" });
  }
});

// Get own requests
app.get("/api/student/requests", requireStudent, async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT cr.id, cr.quantity, cr.purpose_note, cr.status, cr.created_at, cr.updated_at,
              cr.rejection_reason, cr.confirmed_at, cr.cart_id,
              c.name AS component_name, c.id AS component_id
            FROM component_requests cr JOIN components c ON cr.component_id = c.id
            WHERE cr.student_id = ?
            ORDER BY cr.created_at DESC`, args: [req.session.student_id]
    });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Edit own pending request
app.put("/api/student/request/:id", requireStudent, async (req, res) => {
  const { component_id, quantity, purpose_note } = req.body;
  try {
    const req_result = await db.execute({ sql: "SELECT * FROM component_requests WHERE id = ? AND student_id = ?", args: [req.params.id, req.session.student_id] });
    if (req_result.rows.length === 0) return res.json({ success: false, message: "Request not found" });
    const request = req_result.rows[0];
    if (request.status !== 'PENDING' && request.status !== 'DRAFT') {
      return res.json({ success: false, message: "Cannot edit — request already processed" });
    }
    await db.execute({
      sql: `UPDATE component_requests SET component_id = ?, quantity = ?, purpose_note = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`,
      args: [component_id || request.component_id, quantity || request.quantity, purpose_note !== undefined ? purpose_note : request.purpose_note, req.params.id]
    });
    res.json({ success: true, message: "Request updated" });
  } catch (err) {
    console.error("Request edit error:", err);
    res.json({ success: false, message: "Error updating request" });
  }
});

// Withdraw own pending request
app.post("/api/student/request/:id/withdraw", requireStudent, async (req, res) => {
  try {
    const req_result = await db.execute({ sql: "SELECT * FROM component_requests WHERE id = ? AND student_id = ?", args: [req.params.id, req.session.student_id] });
    if (req_result.rows.length === 0) return res.json({ success: false, message: "Request not found" });
    if (req_result.rows[0].status !== 'PENDING' && req_result.rows[0].status !== 'DRAFT') {
      return res.json({ success: false, message: "Cannot withdraw — request already processed" });
    }
    await db.execute({ sql: "UPDATE component_requests SET status = 'WITHDRAWN', updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?", args: [req.params.id] });
    res.json({ success: true, message: "Request withdrawn" });
  } catch (err) {
    res.json({ success: false, message: "Error withdrawing request" });
  }
});

// ================= ADMIN REQUEST QUEUE API =================

// Get all requests (admin)
app.get("/api/admin/requests", requireAccess, async (req, res) => {
  try {
    const statusFilter = req.query.status;
    let sql = `SELECT cr.*, c.name AS component_name, c.available_quantity,
                s.student_name, s.usn, s.email, s.phone
              FROM component_requests cr
              JOIN components c ON cr.component_id = c.id
              JOIN students s ON cr.student_id = s.id`;
    const args = [];
    if (statusFilter && statusFilter !== 'ALL') {
      sql += ` WHERE cr.status = ?`;
      args.push(statusFilter);
    }
    sql += ` ORDER BY cr.created_at DESC`;
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) {
    console.error("Admin requests error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Approve a request (admin)
app.post("/api/admin/requests/:id/approve", requireAccess, async (req, res) => {
  try {
    const reqRow = await db.execute({ sql: "SELECT cr.*, c.name AS component_name, c.available_quantity, s.student_name, s.email FROM component_requests cr JOIN components c ON cr.component_id = c.id JOIN students s ON cr.student_id = s.id WHERE cr.id = ?", args: [req.params.id] });
    if (reqRow.rows.length === 0) return res.json({ success: false, message: "Request not found" });
    const request = reqRow.rows[0];
    if (request.status === 'APPROVED') return res.json({ success: false, message: "Already approved" });
    // Check stock
    if (request.available_quantity < request.quantity) {
      return res.json({ success: false, message: `Insufficient stock. Only ${request.available_quantity} available.` });
    }
    // Generate confirmation token
    const token = crypto.randomUUID();
    const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    // Update request status
    await db.execute({
      sql: `UPDATE component_requests SET status = 'APPROVED', admin_id = ?, confirmation_token = ?, confirmation_token_expiry = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`,
      args: [req.session.admin, token, expiryDate, req.params.id]
    });
    // Create issue record
    const issueResult = await db.execute({ sql: "INSERT INTO issues (student_id, request_id) VALUES (?, ?)", args: [request.student_id, req.params.id] });
    const issue_id = Number(issueResult.lastInsertRowid);
    await db.execute({ sql: "INSERT INTO issue_items (issue_id, component_id, quantity) VALUES (?, ?, ?)", args: [issue_id, request.component_id, request.quantity] });
    // Decrement stock
    await db.execute({ sql: "UPDATE components SET available_quantity = available_quantity - ? WHERE id = ?", args: [request.quantity, request.component_id] });
    res.json({ success: true, message: "Request approved" });

  } catch (err) {
    console.error("Approve error:", err);
    res.json({ success: false, message: "Error approving request" });
  }
});

// Reject a request (admin)
app.post("/api/admin/requests/:id/reject", requireAccess, async (req, res) => {
  const { reason } = req.body;
  try {
    const reqRow = await db.execute({ sql: "SELECT cr.*, c.name AS component_name, s.student_name, s.email FROM component_requests cr JOIN components c ON cr.component_id = c.id JOIN students s ON cr.student_id = s.id WHERE cr.id = ?", args: [req.params.id] });
    if (reqRow.rows.length === 0) return res.json({ success: false, message: "Request not found" });
    const request = reqRow.rows[0];
    await db.execute({
      sql: `UPDATE component_requests SET status = 'REJECTED', admin_id = ?, rejection_reason = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`,
      args: [req.session.admin, reason || null, req.params.id]
    });
    res.json({ success: true, message: "Request rejected" });

  } catch (err) {
    console.error("Reject error:", err);
    res.json({ success: false, message: "Error rejecting request" });
  }
});

// Admin edit a request
app.put("/api/admin/requests/:id", requireAccess, async (req, res) => {
  const { component_id, quantity, purpose_note, status } = req.body;
  try {
    const reqRow = await db.execute({ sql: "SELECT * FROM component_requests WHERE id = ?", args: [req.params.id] });
    if (reqRow.rows.length === 0) return res.json({ success: false, message: "Request not found" });
    const original = reqRow.rows[0];
    const changes = [];
    if (component_id && component_id !== original.component_id) changes.push({ field: 'component_id', old: original.component_id, new: component_id });
    if (quantity && quantity !== original.quantity) changes.push({ field: 'quantity', old: original.quantity, new: quantity });
    if (purpose_note !== undefined && purpose_note !== original.purpose_note) changes.push({ field: 'purpose_note', old: original.purpose_note, new: purpose_note });
    if (status && status !== original.status) changes.push({ field: 'status', old: original.status, new: status });
    const editLog = JSON.parse(original.edit_log || '[]');
    editLog.push({ editor_id: req.session.admin, editor_role: 'admin', changed_fields: changes, timestamp: new Date().toISOString() });
    await db.execute({
      sql: `UPDATE component_requests SET component_id = ?, quantity = ?, purpose_note = ?, status = ?, last_edited_by = ?, last_edited_at = datetime('now', '+5 hours', '+30 minutes'), edit_log = ?, updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`,
      args: [component_id || original.component_id, quantity || original.quantity, purpose_note !== undefined ? purpose_note : original.purpose_note, status || original.status, req.session.admin, JSON.stringify(editLog), req.params.id]
    });
    res.json({ success: true, message: "Request updated" });
  } catch (err) {
    console.error("Admin edit request error:", err);
    res.json({ success: false, message: "Error updating request" });
  }
});

// Create student account (admin)
app.post("/api/admin/create-student-account", requireAccess, async (req, res) => {
  const { student_name, usn, phone, email, password } = req.body;
  if (!student_name || !usn || !email || !password) return res.json({ success: false, message: "Name, USN, email, and password are required" });
  try {
    const hashedPw = await bcrypt.hash(password, 10);
    // Try to upsert
    const existing = await db.execute({ sql: "SELECT id FROM students WHERE usn = ?", args: [usn] });
    if (existing.rows.length > 0) {
      await db.execute({ sql: "UPDATE students SET student_name = ?, phone = ?, email = ?, password = ? WHERE usn = ?", args: [student_name, phone || null, email, hashedPw, usn] });
      res.json({ success: true, message: "Student account updated" });
    } else {
      await db.execute({ sql: "INSERT INTO students (student_name, usn, phone, email, password) VALUES (?, ?, ?, ?, ?)", args: [student_name, usn, phone || null, email, hashedPw] });
      res.json({ success: true, message: "Student account created" });
    }
  } catch (err) {
    console.error("Create student account error:", err);
    res.json({ success: false, message: "Error: " + err.message });
  }
});

// ================= CONFIRM RECEIPT (PUBLIC) =================

app.get("/api/confirm-receipt", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ success: false, message: "No token provided" });
  try {
    const result = await db.execute({ sql: "SELECT * FROM component_requests WHERE confirmation_token = ?", args: [token] });
    if (result.rows.length === 0) return res.json({ success: false, message: "Invalid or expired token" });
    const request = result.rows[0];
    if (request.confirmed_at) return res.json({ success: true, message: "Already confirmed", already_confirmed: true });
    if (request.confirmation_token_expiry && new Date(request.confirmation_token_expiry) < new Date()) {
      return res.json({ success: false, message: "Token has expired" });
    }
    await db.execute({
      sql: `UPDATE component_requests SET status = 'CONFIRMED', confirmed_at = datetime('now', '+5 hours', '+30 minutes'), updated_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`,
      args: [request.id]
    });
    res.json({ success: true, message: "Receipt confirmed. Thank you!" });
  } catch (err) {
    console.error("Confirm receipt error:", err);
    res.json({ success: false, message: "Error confirming receipt" });
  }
});

// ================= ADMIN DASHBOARD SUMMARY (updated) =================

app.get("/pending-requests-count", requireAccess, async (req, res) => {
  try {
    const result = await db.execute("SELECT COUNT(*) AS count FROM component_requests WHERE status = 'PENDING'");
    res.json({ count: result.rows[0].count || 0 });
  } catch (err) {
    res.json({ count: 0 });
  }
});

// ================= BULK IMPORT STUDENTS =================

app.get("/api/admin/student-import-template", requireAccess, async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Students");
  sheet.columns = [
    { header: "Name", key: "name", width: 25 },
    { header: "USN", key: "usn", width: 18 },
    { header: "Semester", key: "semester", width: 12 },
    { header: "Mobile Number", key: "phone", width: 18 },
    { header: "Email ID", key: "email", width: 30 },
    { header: "Department", key: "department", width: 15 }
  ];
  sheet.addRow({ name: "Example Student", usn: "4NN22CS001", semester: "4th", phone: "9876543210", email: "student@college.edu", department: "CSE" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=student_import_template.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

app.post("/api/admin/bulk-import-students", requireAccess, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: "No file uploaded" });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.json({ success: false, message: "No worksheet found in file" });

    // Find header row
    const headers = [];
    sheet.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.value || "").trim().toLowerCase();
    });

    // Map headers to columns
    const colMap = {};
    const fieldAliases = {
      name: ["name", "student name", "student_name", "full name"],
      usn: ["usn", "id", "registration number", "reg no", "enrollment"],
      semester: ["semester", "sem", "year"],
      phone: ["mobile number", "phone", "mobile", "phone number", "contact", "mobile no"],
      email: ["email", "email id", "email address", "mail"],
      department: ["department", "dept", "branch", "stream"]
    };

    for (const [field, aliases] of Object.entries(fieldAliases)) {
      for (let i = 1; i < headers.length; i++) {
        if (aliases.includes(headers[i])) { colMap[field] = i; break; }
      }
    }

    const requiredFields = ['name', 'usn', 'phone', 'email', 'semester', 'department'];
    const missingCols = requiredFields.filter(f => !colMap[f]);
    if (missingCols.length > 0) {
      return res.json({ success: false, message: `Excel is missing required columns: ${missingCols.join(', ')}. All 6 fields (Name, USN, Phone, Email, Semester, Department) are required.` });
    }

    let created = 0, updated = 0, errors = [];
    const defaultPassword = await bcrypt.hash("student123", 10);

    for (let r = 2; r <= sheet.actualRowCount; r++) {
      const row = sheet.getRow(r);
      const name = String(row.getCell(colMap.name).value || "").trim();
      let usn = String(row.getCell(colMap.usn).value || "").trim().toUpperCase();
      const phone = String(row.getCell(colMap.phone).value || "").trim();
      const email = String(row.getCell(colMap.email).value || "").trim();
      const semester = String(row.getCell(colMap.semester).value || "").trim();
      const department = String(row.getCell(colMap.department).value || "").trim();

      if (!name || !usn || !phone || !email || !semester || !department) {
        errors.push(`Row ${r}: Missing required field(s)`);
        continue;
      }
      const password = await bcrypt.hash(usn.toLowerCase(), 10);

      try {
        const existing = await db.execute({ sql: "SELECT id FROM students WHERE usn = ?", args: [usn] });
        if (existing.rows.length > 0) {
          await db.execute({
            sql: `UPDATE students SET student_name=?, phone=?, email=?, semester=?, department=? WHERE usn=?`,
            args: [name, phone, email, semester, department, usn]
          });
          updated++;
        } else {
          await db.execute({
            sql: `INSERT INTO students (student_name, usn, phone, email, password, semester, department) VALUES (?,?,?,?,?,?,?)`,
            args: [name, usn, phone, email, password, semester, department]
          });
          created++;
        }
      } catch (e) {
        errors.push(`Row ${r}: ${e.message}`);
      }
    }

    res.json({ success: true, message: `Import complete: ${created} created, ${updated} updated${errors.length > 0 ? ', ' + errors.length + ' errors' : ''}`, created, updated, errors });
  } catch (err) {
    console.error("Bulk import error:", err);
    res.json({ success: false, message: "Error processing file: " + err.message });
  }
});

// ================= GRADUATED STUDENT CLEANUP =================

app.post("/api/admin/cleanup-graduated", requireAccess, async (req, res) => {
  try {
    // Find students who have NO unreturned items
    const graduatedStudents = await db.execute(`
      SELECT s.id, s.student_name, s.usn
      FROM students s
      WHERE NOT EXISTS (
        SELECT 1 FROM issues i
        JOIN issue_items ii ON ii.issue_id = i.id
        WHERE i.student_id = s.id AND ii.quantity > ii.returned_quantity
      )
    `);

    if (graduatedStudents.rows.length === 0) {
      return res.json({ success: true, message: "No students eligible for cleanup (all have unreturned items)", deleted: 0 });
    }

    let deleted = 0;
    for (const student of graduatedStudents.rows) {
      // Delete their request records first
      await db.execute({ sql: "DELETE FROM component_requests WHERE student_id = ?", args: [student.id] });
      // Delete issue items for completed issues
      const issues = await db.execute({ sql: "SELECT id FROM issues WHERE student_id = ?", args: [student.id] });
      for (const issue of issues.rows) {
        await db.execute({ sql: "DELETE FROM issue_items WHERE issue_id = ?", args: [issue.id] });
      }
      // Delete issues
      await db.execute({ sql: "DELETE FROM issues WHERE student_id = ?", args: [student.id] });
      // Delete student
      await db.execute({ sql: "DELETE FROM students WHERE id = ?", args: [student.id] });
      deleted++;
    }

    res.json({ success: true, message: `Cleaned up ${deleted} graduated students`, deleted });
  } catch (err) {
    console.error("Cleanup error:", err);
    res.json({ success: false, message: "Error during cleanup: " + err.message });
  }
});

// ================= AUTO-BACKUP (In-Database) =================

async function createBackup(name) {
  try {
    const tables = ['admins', 'components', 'students', 'issues', 'issue_items', 'component_requests', 'settings'];
    const backup = {};
    for (const table of tables) {
      try {
        const result = await db.execute(`SELECT * FROM ${table}`);
        backup[table] = result.rows;
      } catch (e) {
        backup[table] = [];
      }
    }
    const data = JSON.stringify(backup);
    await db.execute({ sql: "INSERT INTO backups (name, data) VALUES (?, ?)", args: [name, data] });

    // Retention Policy
    const settings = await getSettings();
    const keep = parseInt(settings.max_backups_to_keep || '10');
    
    // Find old backups to delete (offset by 'keep' count)
    const old = await db.execute({
      sql: `SELECT id FROM backups ORDER BY created_at DESC LIMIT -1 OFFSET ?`,
      args: [keep]
    });
    
    for (const row of old.rows) {
      await db.execute({ sql: "DELETE FROM backups WHERE id = ?", args: [row.id] });
    }

    console.log(`Backup created: ${name}`);
    return true;
  } catch (e) {
    console.error("Backup error:", e);
    return false;
  }
}

// Scheduled auto-backup
let backupIntervalId = null;
async function refreshBackupSchedule() {
  if (backupIntervalId) clearInterval(backupIntervalId);

  const settings = await getSettings();
  const hours = parseInt(settings.auto_backup_interval_hours || '6');

  backupIntervalId = setInterval(async () => {
    if (!dbReady) return;
    const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await createBackup(`auto_${now}`);
  }, hours * 60 * 60 * 1000);
}

// Start initial schedule
setTimeout(() => refreshBackupSchedule(), 5000);

// Schedule auto-backup (startup backup disabled temporarily for stability)
/*
setTimeout(async () => {
  if (dbReady) {
    const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await createBackup(`startup_${now}`);
  }
}, 30000);
*/

// Manual backup trigger
app.post("/api/admin/create-backup", requireAccess, async (req, res) => {
  const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const success = await createBackup(`manual_${now}`);
  res.json({ success, message: success ? "Backup created successfully" : "Failed to create backup" });
});

// List backups
app.get("/api/admin/backups", requireAccess, async (req, res) => {
  try {
    const result = await db.execute("SELECT id, name, created_at, LENGTH(data) as size_bytes FROM backups ORDER BY created_at DESC");
    res.json({ success: true, backups: result.rows });
  } catch (err) {
    res.json({ success: true, backups: [] });
  }
});

// Download specific backup
app.get("/api/admin/backup/:id", requireAccess, async (req, res) => {
  try {
    const result = await db.execute({ sql: "SELECT * FROM backups WHERE id = ?", args: [req.params.id] });
    if (result.rows.length === 0) return res.status(404).json({ message: "Backup not found" });
    const backup = result.rows[0];
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=cerp_backup_${backup.name}.json`);
    res.send(backup.data);
  } catch (err) {
    res.status(500).json({ message: "Error downloading backup" });
  }
});

// Restore from backup
app.post("/api/admin/restore-backup", requireAccess, upload.single("file"), async (req, res) => {
  try {
    let backupData;
    if (req.file) {
      backupData = JSON.parse(req.file.buffer.toString());
    } else if (req.body.backup_id) {
      const result = await db.execute({ sql: "SELECT data FROM backups WHERE id = ?", args: [req.body.backup_id] });
      if (result.rows.length === 0) return res.json({ success: false, message: "Backup not found" });
      backupData = JSON.parse(result.rows[0].data);
    } else {
      return res.json({ success: false, message: "No backup file or ID provided" });
    }

    // Restore each table
    const restoreOrder = ['admins', 'components', 'students', 'issues', 'issue_items', 'component_requests'];
    for (const table of restoreOrder) {
      if (!backupData[table]) continue;
      await db.execute(`DELETE FROM ${table}`);
      for (const row of backupData[table]) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(',');
        await db.execute({ sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, args: cols.map(c => row[c]) });
      }
    }

    res.json({ success: true, message: "Database restored successfully from backup" });
  } catch (err) {
    console.error("Restore error:", err);
    res.json({ success: false, message: "Restore failed: " + err.message });
  }
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
