# CERP — Club Equipment Resource Portal
## Product Requirements Document — Version 1.2 (Final Built)
### Student Request Portal, Admin Workflow, & Advanced Maintenance

| Field | Value |
|---|---|
| Product | CERP — Club Ennovate ERP System |
| Feature | Student Request Portal & Advanced Admin Tools |
| Version | 1.2 |
| Status | **COMPLETED & BUILT** |
| Author | Jishnu Abhay D (Enhanced by Antigravity) |
| Organization | Club Ennovate |
| Date | March 2026 |

---

## 1. Executive Summary

CERP has been transformed from a manual inventory tool into a full-scale **Student Request Portal**. Students now have self-service access to browse, request, and track equipment. Admins have gained powerful automation tools for bulk student management, automated backups, and data cleanup.

The entire system has been redesigned with a **premium dark slate aesthetic** (Zero Purple policy) and high-performance backend supporting both local testing and Turso cloud deployment.

---

## 2. Updated Feature Specification (Completed)

### 2.1 UI/UX Enhancements
- **Dark Mode**: Comprehensive dark theme toggle (🌙/☀️) on all 17 pages. Preferences persist via `localStorage`.
- **Slate Branding**: Unified "No Purple" design system. All indigo/purple accents replaced with high-contrast Dark Slate (`#0f172a`, `#1e293b`).
- **Sidebar Consistency**: Synchronized 8-item navigation across all admin pages for muscle-memory efficiency.

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

### 3.2 Advanced Admin Routing
- `GET /api/admin/student-import-template`: Downloads a formatted Excel template for admins.
- `POST /api/admin/bulk-import-students`: High-speed Excel processing with smart column matching.
- `POST /api/admin/cleanup-graduated`: Transaction-safe deletion of cleared students.
- `GET /api/admin/backups`: Management interface for DB snapshots.

---

## 4. User Flows (Built)

### 4.1 Student Workflow
1. **Login**: Authenticate via USN/Email.
2. **Dashboard**: View active borrows, request status, and dark-mode toggle.
3. **Catalog**: Browse available stock with real-time "In Stock" indicators.
4. **Request**: Submit request with quantity and purpose note.
5. **Confirm**: Receive approval email → Collect item → Click "Confirm Receipt" link.

### 4.2 Admin Management Workflow
1. **Import**: Batch-add 500+ students via Excel.
2. **Queue**: Review incoming requests; Approve/Reject with reasons.
3. **Backup**: Trigger manual snapshots or restore from a downloaded file during server migration.
4. **Cleanup**: Annually run the graduated student purge to keep the database lean.

---

## 5. Summary of Built Features

| Feature | Built? | Description |
|---|:---:|---|
| **Student Portal** | ✅ | Full self-service login and requests |
| **Dark Mode** | ✅ | Persistent toggle on every page |
| **Zero Purple UI** | ✅ | Brand-consistent dark slate theme |
| **Consistent Sidebar** | ✅ | Identical nav order on 17+ pages |
| **Excel Student Import** | ✅ | Smart mapping for bulk enrollment |
| **Auto-Backup in DB** | ✅ | 6hr interval snapshots for server portability |
| **Graduated Cleanup** | ✅ | Smart deletion with "unreturned item" safety lock |
| **Turso Integration** | ✅ | Production-ready cloud DB support |
| **Email Workflow** | ✅ | SMTP integration for request confirmations |

---

*CERP — Club Ennovate | Final Production Version 1.2 | March 2026*
