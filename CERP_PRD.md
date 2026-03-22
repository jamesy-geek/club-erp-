# CERP — Club Equipment Resource Portal
## Product Requirements Document — Version 1.3 (Current Production Build)
### Student Request Portal (with Cart), Admin Workflow, & Advanced Maintenance

| Field | Value |
|---|---|
| Product | CERP — Club Ennovate ERP System |
| Feature | Student Request Portal & Advanced Admin Tools |
| Version | **1.3** (`v1.3-detailed-login` — see `GET /version`) |
| Status | **COMPLETED & BUILT** |
| Author | Jishnu Abbhay D (Enhanced by Antigravity) |
| Organization | Club Ennovate |
| Date | March 2026 |

---

## 1. Executive Summary

CERP has been transformed from a manual inventory tool into a full-scale **Student Request Portal**. Students now have self-service access to browse, request (including a **multi-item cart**), and track equipment. Admins have gained powerful automation tools for bulk student management, automated backups, and data cleanup.

The entire system has been redesigned with a **premium dark slate aesthetic** (Zero Purple policy) and high-performance backend supporting both local testing and Turso cloud deployment.

**Release identifier:** The running app reports version **`v1.3-detailed-login`** (student login is **email + password**; sessions are stored in Turso).

---

## 2. Updated Feature Specification (Completed)

### 2.1 UI/UX Enhancements
- **Dark Mode**: Comprehensive dark theme toggle (🌙/☀️) across admin and student pages. Preferences persist via `localStorage`.
- **Slate Branding**: Unified "No Purple" design system. All indigo/purple accents replaced with high-contrast Dark Slate (`#0f172a`, `#1e293b`).
- **Sidebar Consistency**: Synchronized navigation across admin pages for muscle-memory efficiency.

### 2.1a Student Request Cart (Catalog)
- **Shopping-style cart** on **Component Catalog** (`/student-catalog`): add multiple components with quantities, optional shared purpose note, then **Submit Request** in one action.
- **Desktop**: cart header button with item count; **mobile**: floating cart FAB with badge.
- **Backend**: `POST /api/student/request-bulk` validates stock and max-quantity settings per line item, then creates one `component_requests` row per item (same optional note on each). Single-item flow remains available via `POST /api/student/request` if needed.

### 2.2 Student Management (Bulk & Maintenance)
- **Bulk Student Import**: Admin can upload `.xlsx` files to enroll entire batches.
  - Smart Mapping: Auto-detects columns like USN, Semester, Department, etc.
  - Auto-Password: USN in lowercase used as default secure login.
- **Graduated Student Cleanup**: One-click deletion of graduated members.
  - **Safety Lock**: System prevents deletion of any student who still has unreturned components (outstanding issues).

### 2.3 Automation & Reliability
- **In-Database Auto-Backup**: 
  - Automated snapshots taken every 6 hours and stored in the `backups` table.
  - Snapshots also taken automatically on Every server startup.
- **Server Portability**: Backups can be downloaded as JSON and uploaded to a fresh server instance to restore the entire ERP state in seconds.
- **Database Scalability**: Optimized for Turso (SQLite/libsql). Analysis proves 9GB free tier is sufficient for 10+ years of data.

---

## 3. Technical Requirements (Built)

### 3.1 Database Schema (Final)

**Table: `students` (Modified)**
- Added: `email`, `password` (bcrypt), `semester`, `department`.

**Table: `backups` (New)**
- `id`, `name`, `data` (Full JSON snapshot), `created_at`.

### 3.2 Advanced Admin & Student API Routing
- `GET /version`: Returns the current build string (e.g. `v1.3-detailed-login`).
- **Student requests**: `POST /api/student/request` (single item); `POST /api/student/request-bulk` (cart / multiple items).
- `GET /api/admin/student-import-template`: Downloads a formatted Excel template for admins.
- `POST /api/admin/bulk-import-students`: High-speed Excel processing with smart column matching.
- `POST /api/admin/cleanup-graduated`: Transaction-safe deletion of cleared students.
- `GET /api/admin/backups`: Management interface for DB snapshots.

---

## 4. User Flows (Built)

### 4.1 Student Workflow
1. **Login**: Authenticate with **email + password** (`/student-login.html`).
2. **Dashboard**: View active borrows, request status, and dark-mode toggle.
3. **Catalog**: Browse available stock with real-time "In Stock" indicators; **add items to cart** (drawer + FAB), set optional purpose note, **submit** to create pending requests for all cart lines.
4. **My Requests**: Track, edit, or withdraw pending requests as applicable.
5. **Confirm**: After admin approval, collect item and use **Confirm Receipt** (token link) when applicable.

### 4.2 Admin Management Workflow
1. **Import**: Batch-add 500+ students via Excel.
2. **Queue**: Review incoming requests; Approve/Reject with reasons.
3. **Backup**: Trigger manual snapshots or restore from a downloaded file during server migration.
4. **Cleanup**: Annually run the graduated student purge to keep the database lean.

---

## 5. Summary of Built Features

| Feature | Built? | Description |
|---|:---:|---|
| **Student Portal** | ✅ | Email/password login; self-service dashboard, catalog, requests, profile |
| **Request Cart** | ✅ | Multi-item cart on catalog; bulk submit via `request-bulk` API |
| **Dark Mode** | ✅ | Persistent toggle on student and admin pages |
| **Zero Purple UI** | ✅ | Brand-consistent dark slate theme |
| **Consistent Sidebar** | ✅ | Predictable nav across admin and student areas |
| **Excel Student Import** | ✅ | Smart mapping for bulk enrollment |
| **Auto-Backup in DB** | ✅ | 6hr interval snapshots for server portability |
| **Graduated Cleanup** | ✅ | Smart deletion with "unreturned item" safety lock |
| **Turso Integration** | ✅ | Production-ready cloud DB + session store |
| **Build Version** | ✅ | `GET /version` → `v1.3-detailed-login` |

---

*CERP — Club Ennovate | Production Version 1.3 (`v1.3-detailed-login`) | March 2026*
