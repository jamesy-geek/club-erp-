const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
const db = new sqlite3.Database("./database.db");

// ================= MIDDLEWARE =================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use(session({
  secret: "super_secret_erp_key",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

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

db.serialize(() => {

  // Admin table
  db.run(`
   CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )
`);

  // Components
  db.run(`
    CREATE TABLE IF NOT EXISTS components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      total_quantity INTEGER,
      available_quantity INTEGER,
      photo1 TEXT,
      photo2 TEXT
    )
  `);

  // Students
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT,
      usn TEXT UNIQUE,
      phone TEXT
    )
  `);

  // Issues
  db.run(`
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      issue_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(student_id) REFERENCES students(id)
    )
  `);

  // Issue Items
  db.run(`
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

});

// Create default admin if none exists
db.get("SELECT COUNT(*) as count FROM admins", [], async (err, row) => {
  if (row && row.count === 0) {
    const hashed = await bcrypt.hash("admin123", 10);
    db.run(
      "INSERT INTO admins (username, password) VALUES (?, ?)",
      ["admin", hashed]
    );
    console.log("Default admin created → admin / admin123");
  }
});

// ================= AUTH ROUTES =================

app.post("/login", (req, res) => {

  const { username, password } = req.body;

  db.get("SELECT * FROM admins WHERE username = ?", [username], async (err, admin) => {

    if (!admin)
      return res.json({ success: false });

    const match = await bcrypt.compare(password, admin.password);

    if (!match)
      return res.json({ success: false });

    req.session.admin = admin.id;
    res.json({ success: true });

  });

});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.post("/change-admin", requireAdmin, async (req, res) => {

  const { newUsername, newPassword } = req.body;

  if (!newUsername || !newPassword)
    return res.json({ success: false, message: "Missing fields" });

  const hashed = await bcrypt.hash(newPassword, 10);

  db.run(
    "UPDATE admins SET username = ?, password = ? WHERE id = ?",
    [newUsername, hashed, req.session.admin],
    function (err) {
      if (err)
        return res.json({ success: false, message: "Username already taken" });

      res.json({ success: true });
    }
  );

});

// ================= PROTECTED ROOT =================

app.get("/test-session", (req, res) => {
  res.json(req.session);
});

app.get("/", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

db.run(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )
`);

db.get("SELECT COUNT(*) as count FROM admins", [], async (err, row) => {
  if (row.count === 0) {
    const hashed = await bcrypt.hash("admin123", 10);
    db.run(
      "INSERT INTO admins (username, password) VALUES (?, ?)",
      ["admin", hashed]
    );
    console.log("Default admin created: admin / admin123");
  }
});

// ================= PAGE ROUTES =================

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/dashboard.html");
});

app.get("/components-page", (req, res) => {
  res.sendFile(__dirname + "/public/components.html");
});

app.get("/issue-page", (req, res) => {
  res.sendFile(__dirname + "/public/issue.html");
});

app.get("/transactions-page", (req, res) => {
  res.sendFile(__dirname + "/public/transactions.html");
});

app.get("/student.html", (req, res) => {
  res.sendFile(__dirname + "/public/student.html");
});

// ================= COMPONENT ROUTES =================

app.post("/add-component", requireAdmin, (req, res) => {
  const { name, quantity, photo1, photo2 } = req.body;

  db.get("SELECT * FROM components WHERE name = ?", [name], (err, row) => {

    if (row) {
      db.run(
        "UPDATE components SET total_quantity = total_quantity + ?, available_quantity = available_quantity + ? WHERE id = ?",
        [quantity, quantity, row.id]
      );
      return res.json({ message: "Component quantity updated" });
    }

    db.run(
      "INSERT INTO components (name, total_quantity, available_quantity, photo1, photo2) VALUES (?, ?, ?, ?, ?)",
      [name, quantity, quantity, photo1 || null, photo2 || null],
      () => res.json({ message: "Component Added" })
    );

  });
});

app.post("/edit-component", requireAdmin, (req, res) => {

  const { id, new_total_quantity } = req.body;

  db.get(
    "SELECT total_quantity, available_quantity FROM components WHERE id = ?",
    [id],
    (err, component) => {

      if (!component) return res.json({ message: "Component not found" });

      const difference = new_total_quantity - component.total_quantity;
      const new_available = component.available_quantity + difference;

      if (new_available < 0) {
        return res.json({
          message: "Cannot reduce below issued quantity"
        });
      }

      db.run(
        "UPDATE components SET total_quantity = ?, available_quantity = ? WHERE id = ?",
        [new_total_quantity, new_available, id],
        () => res.json({ message: "Component updated successfully" })
      );

    }
  );

});

app.get("/components", requireAdmin, (req, res) => {
  db.all("SELECT * FROM components", [], (err, rows) => {
    res.json(rows);
  });
});


// ================= ISSUE CREATION =================

app.post("/create-issue", requireAdmin, (req, res) => {

  const { student_name, usn, phone, items } = req.body;

  if (!items || items.length === 0)
    return res.json({ message: "No items provided" });

  db.serialize(() => {

    db.run(
     `
       INSERT INTO students (student_name, usn, phone)
       VALUES (?, ?, ?)
       ON CONFLICT(usn) DO UPDATE SET
       student_name = excluded.student_name,
       phone = excluded.phone
      `,
      [student_name, usn, phone]
     );

    db.get(
      "SELECT id FROM students WHERE usn = ?",
      [usn],
      (err, student) => {

        if (!student) return res.json({ message: "Student error" });

        const student_id = student.id;

        const query = `
          SELECT id, available_quantity
          FROM components
          WHERE id IN (${items.map(() => "?").join(",")})
        `;

        db.all(
          query,
          items.map(i => parseInt(i.component_id)),
          (err, rows) => {

            for (let item of items) {
              const comp = rows.find(r => r.id === parseInt(item.component_id));
              if (!comp || comp.available_quantity < parseInt(item.quantity)) {
                return res.json({
                  message: `Insufficient stock for component ID ${item.component_id}`
                });
              }
            }

            db.run(
              "INSERT INTO issues (student_id) VALUES (?)",
              [student_id],
              function () {

                const issue_id = this.lastID;

                items.forEach(item => {
                  const cid = parseInt(item.component_id);
                  const qty = parseInt(item.quantity);

                  db.run(
                    "INSERT INTO issue_items (issue_id, component_id, quantity) VALUES (?, ?, ?)",
                    [issue_id, cid, qty]
                  );

                  db.run(
                    "UPDATE components SET available_quantity = available_quantity - ? WHERE id = ?",
                    [qty, cid]
                  );
                });

                res.json({ message: "Issue Created Successfully" });

              }
            );

          }
        );

      }
    );

  });

});


// ================= RETURN SINGLE =================

app.post("/return-item", requireAdmin, (req, res) => {

  const { item_id, return_quantity, component_id } = req.body;

  db.get(
    "SELECT quantity, returned_quantity FROM issue_items WHERE id = ?",
    [item_id],
    (err, row) => {

      if (!row) return res.json({ message: "Item not found" });

      const remaining = row.quantity - row.returned_quantity;

      if (return_quantity > remaining)
        return res.json({ message: "Return exceeds remaining" });

      db.run(
        "UPDATE issue_items SET returned_quantity = returned_quantity + ? WHERE id = ?",
        [return_quantity, item_id]
      );

      db.run(
        "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?",
        [return_quantity, component_id]
      );

      res.json({ message: "Return processed" });

    }
  );

});


// ================= RETURN ALL =================

app.post("/return-all", requireAdmin, (req, res) => {

  const { issue_id } = req.body;

  db.all(
    "SELECT id, component_id, quantity, returned_quantity FROM issue_items WHERE issue_id = ?",
    [issue_id],
    (err, items) => {

      items.forEach(item => {

        const remaining = item.quantity - item.returned_quantity;

        if (remaining > 0) {

          db.run(
            "UPDATE issue_items SET returned_quantity = quantity WHERE id = ?",
            [item.id]
          );

          db.run(
            "UPDATE components SET available_quantity = available_quantity + ? WHERE id = ?",
            [remaining, item.component_id]
          );

        }

      });

      res.json({ message: "All items returned successfully" });

    }
  );

});


// ================= TRANSACTIONS =================

app.get("/transactions", (req, res) => {

  db.all(`
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
  `, [], (err, rows) => {
    res.json(rows);
  });

});


// ================= STUDENT PROFILE =================

app.get("/student/:usn", (req, res) => {

  db.all(`
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
  `, [req.params.usn], (err, rows) => {
    res.json(rows);
  });

});

// ================= DASHBOARD SUMMARY =================

app.get("/dashboard-summary", (req, res) => {

  db.serialize(() => {

    let summary = {};

    db.get("SELECT COUNT(*) AS total_components FROM components", [], (e, r) => {
      summary.total_components = r.total_components || 0;

      db.get(`
        SELECT SUM(quantity - returned_quantity) AS total_out 
        FROM issue_items
      `, [], (e2, r2) => {

        summary.total_out = r2.total_out || 0;

        db.get(`
          SELECT COUNT(*) AS total_students FROM students
        `, [], (e3, r3) => {

          summary.total_students = r3.total_students || 0;

          res.json(summary);
        });

      });

    });

  });

});

// ================= DELETE COMPONENT =================

app.post("/delete-component", requireAdmin, (req, res) => {

  const { id } = req.body;

  db.get(
    "SELECT COUNT(*) AS active FROM issue_items WHERE component_id = ? AND (quantity - returned_quantity) > 0",
    [id],
    (err, row) => {

      if (row.active > 0) {
        return res.json({
          message: "Cannot delete component with active issues"
        });
      }

      db.run(
        "DELETE FROM components WHERE id = ?",
        [id],
        () => res.json({ message: "Component deleted successfully" })
      );

    }
  );

});

// ================= RENAME COMPONENT =================

app.post("/rename-component", requireAdmin, (req, res) => {

  const { id, new_name } = req.body;

  db.run(
    "UPDATE components SET name = ? WHERE id = ?",
    [new_name, id],
    () => res.json({ message: "Renamed successfully" })
  );

});

app.listen(3000, () => {
  console.log("ERP running on http://localhost:3000");
});