# CERP — Club Equipment Resource Portal
## Product Requirements Document
### Student Request Portal & Admin Approval Workflow

| Field | Value |
|---|---|
| Product | CERP — Club Ennovate ERP System |
| Feature | Student Request Portal |
| Version | 1.1 |
| Status | Draft — For Review |
| Author | Jishnu Abhay D |
| Organization | Club Ennovate |
| Date | March 2026 |

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [User Roles](#4-user-roles)
5. [Feature Specification](#5-feature-specification)
6. [Edit Permissions](#6-edit-permissions)
7. [User Flows](#7-user-flows)
8. [Request State Machine](#8-request-state-machine)
9. [Email Notifications](#9-email-notifications)
10. [Technical Requirements](#10-technical-requirements)
11. [Out of Scope](#11-out-of-scope-v10)
12. [Open Questions](#12-open-questions)

---

## 1. Executive Summary

CERP is Club Ennovate's internal inventory management system. Admins currently manage all component issuance manually — students have no self-service access.

This PRD defines the **Student Request Portal**: a new module that gives club members their own login, the ability to browse components and raise requests, and a structured admin approval + email confirmation workflow.

**Goal:** Reduce admin overhead, give students visibility into inventory, and create a complete digital audit trail from request through confirmed receipt.

---

## 2. Problem Statement

### Current Pain Points
- All issues are manually entered by the admin. Students request components verbally with no digital record.
- No self-service portal for students to check component availability.
- No automated confirmation sent to students after a component is issued.
- No structured queue for incoming requests — admins rely on memory or informal channels.
- Students cannot track their own request status without asking an admin.

### Impact
- High admin workload during project season and hackathons.
- Risk of missed requests, double issues, or lost accountability.
- No audit trail linking student acknowledgement to issued components.

---

## 3. Goals & Success Metrics

### Primary Goals
- Allow students to log in and browse the component catalog.
- Allow students to submit formal component requests into an admin-reviewable queue.
- Allow admins to approve or reject requests from the dashboard.
- Trigger an automated confirmation email to the student on approval.
- Allow students to acknowledge receipt via a link in the email.

### Success Metrics
- Admin time on manual issue creation reduced by at least 60%.
- 100% of approved requests result in a confirmation email within 30 seconds.
- Students can submit a request in under 2 minutes from login.
- Zero requests lost or untracked in the new queue system.

---

## 4. User Roles

| Role | Access Level | Capabilities |
|---|---|---|
| Admin | Full access to all modules | View all requests, approve/reject, manage components, students, transactions, reports |
| Student | Limited self-service access | Login, browse catalog, submit requests, edit/withdraw pending requests, view own history, confirm receipt via email |

---

## 5. Feature Specification

### 5.1 Student Authentication

A new Student Login page at `/student-login` (separate from admin login at `/login`). Student accounts are created by the admin from Admin Settings.

| Feature | Description | Priority |
|---|---|---|
| Student login page | Separate login route; email + password auth | High |
| Admin creates student accounts | Admin generates student credentials from Admin Settings | High |
| Session management | Student session persists across reloads; logout clears session | High |
| Role-based routing | Student → Student Dashboard; Admin → Admin Dashboard | High |

---

### 5.2 Student Dashboard

Personal dashboard showing active borrows, pending requests, and completed transaction history.

| Feature | Description | Priority |
|---|---|---|
| Active borrows | Currently issued components | High |
| Pending requests | Requests awaiting admin approval with status badge | High |
| Transaction history | Past completed and rejected requests | Medium |
| Quick request button | Prominent CTA to submit a new request | High |

---

### 5.3 Component Catalog (Student View)

Read-only browse view. Students cannot add, edit, or delete components.

| Feature | Description | Priority |
|---|---|---|
| Browse catalog | Read-only view with availability badge | High |
| Search components | Search by component name | High |
| Request button per component | Pre-fills the request form with the component | High |
| Availability indicator | Green = in stock, Grey = out of stock (request still allowed) | Medium |

---

### 5.4 Component Request Form

Opened from the catalog. Pre-filled with component name.

| Feature | Description | Priority |
|---|---|---|
| Pre-filled component name | Auto-populated from catalog selection | High |
| Quantity input | Numeric; max capped at available stock | High |
| Purpose / note field | Optional free-text reason | Medium |
| Submit button | Creates request with status PENDING | High |
| Confirmation toast | In-app confirmation on successful submission | Medium |

---

### 5.5 Admin Request Queue

New section in Admin Settings (or top-level nav). Lists all incoming student requests.

| Feature | Description | Priority |
|---|---|---|
| Request queue view | Paginated list of pending requests with student details | High |
| Approve action | Approves request; creates issue record; sends email to student | High |
| Reject action | Rejects with optional reason; student notified via email | High |
| Edit request before approving | Admin can change quantity or component before clicking Approve | High |
| Filter by status | Filter queue: Pending / Approved / Rejected tabs | Medium |
| Request detail modal | Expand any request for full student info and note | Medium |

---

### 5.6 Automated Email Notifications

Emails sent at two moments: on approval and on rejection. See Section 9 for content spec.

| Feature | Description | Priority |
|---|---|---|
| Approval email | Sent on admin approval; includes component details and Confirm Receipt link | High |
| Rejection email | Sent on admin rejection; includes optional reason | Medium |
| Updated approval email | Sent if admin edits an already-approved request | High |
| Confirmation link in email | Unique one-time URL for student to confirm receipt | High |
| Email delivery status | Admin can see if confirmation email was sent and if student confirmed | Medium |

---

### 5.7 Student Receipt Confirmation

The approval email contains a unique confirmation link. Clicking it marks the transaction as CONFIRMED.

| Feature | Description | Priority |
|---|---|---|
| Unique confirmation token | One-time URL token per approval | High |
| Confirmation landing page | Simple branded page; no login required | High |
| Token expiry | Link expires after 7 days if not clicked | Medium |
| Admin visibility | Admin sees confirmed vs pending confirmation on each transaction | High |

---

## 6. Edit Permissions

### Guiding Principle
- **Admins** have full CRUD access at every stage across all entities.
- **Students** can edit or withdraw their own request only while it is in DRAFT or PENDING. The edit window closes the moment an admin acts.

---

### 6.1 Student Edit Rights

| Entity / State | Student Can | Student Cannot |
|---|---|---|
| Request — DRAFT | Edit component, quantity, purpose note freely | Nothing blocked |
| Request — PENDING | Edit component, quantity, purpose note; or withdraw/cancel | Cannot edit once admin has acted |
| Request — APPROVED | No edits; request is locked | Cannot change quantity, component, or note |
| Request — REJECTED | Submit a new request | Cannot reopen or re-submit the same record |
| Own student profile | View only | Cannot edit name, USN, phone, email — admin-managed only |
| Components catalog | Browse only | Cannot add, edit, or delete components |

---

### 6.2 Admin Edit Rights

Admins have full CRUD across all entities at any stage, including retroactive edits to approved or completed records.

| Entity | Admin Access | Editable Fields |
|---|---|---|
| Student requests | Full CRUD at any status | Component, quantity, purpose note, status override, rejection reason |
| Student profiles | Full CRUD | Name, USN, phone number, email, password reset |
| Components | Full CRUD | Name, total quantity, images (primary + secondary), availability status |
| Transactions | Full edit + delete | Issued qty, returned qty, remaining qty, timestamps, linked student |
| Reports | Generate only | Filter by USN and date range |
| Student accounts | Create + edit + disable | Email, password, active/disabled status |

> **Audit requirement:** Every admin edit must write a log entry containing: editor ID, editor role, changed fields (old + new values), and timestamp.

> **Email trigger:** If an admin edits an already-approved request, the system must automatically send an updated confirmation email to the student.

---

### 6.3 Permission Matrix

| Action | Student (Draft) | Student (Pending) | Student (Post-decision) | Admin (Any stage) |
|---|:---:|:---:|:---:|:---:|
| Edit request (qty / component / note) | ✅ | ✅ | ❌ | ✅ |
| Withdraw / cancel request | ✅ | ✅ | ❌ | ✅ |
| Edit student profile | ❌ | ❌ | ❌ | ✅ |
| Edit component inventory | ❌ | ❌ | ❌ | ✅ |
| Edit transaction record | ❌ | ❌ | ❌ | ✅ |
| Override request status | ❌ | ❌ | ❌ | ✅ |

---

## 7. User Flows

### 7.1 Student — Submit a Request
1. Student navigates to `/student-login` and signs in.
2. Student is routed to the Student Dashboard.
3. Student clicks Browse Components or the quick-request CTA.
4. Student finds the desired component in the catalog.
5. Student clicks Request on the component card.
6. Request form opens pre-filled with the component name.
7. Student enters quantity and optional purpose note.
8. Student submits the form.
9. In-app toast confirms submission. Request appears in Student Dashboard under Pending Requests.
10. Admin receives the request in the Request Queue.

---

### 7.2 Student — Edit or Withdraw a Pending Request
1. Student navigates to My Requests on the Student Dashboard.
2. Student sees the request with a PENDING badge and an Edit button.
3. Student clicks Edit — the request form re-opens with current values.
4. Student updates quantity, component, or note.
5. Student clicks Save Changes. Request remains PENDING with a Last edited timestamp.
6. Alternatively, student clicks Withdraw. Status changes to WITHDRAWN and is removed from the admin queue.

---

### 7.3 Admin — Approve a Request
1. Admin navigates to the Request Queue.
2. Admin clicks on a request to expand details.
3. Admin reviews student info, component, quantity, and note.
4. Admin may edit the quantity or component before approving if needed.
5. Admin clicks Approve.
6. System automatically creates the Issue/Transaction record.
7. Approval email is sent to the student's registered email.
8. Request status updates to APPROVED in both admin queue and student dashboard.

---

### 7.4 Admin — Edit an Approved Request
1. Admin navigates to Transactions or the Request Queue.
2. Admin clicks Edit on any approved or completed request.
3. Admin modifies component, quantity, or status.
4. System saves the change with an audit log entry (admin ID + timestamp + old/new values).
5. If quantity or component changed, an updated confirmation email is sent to the student automatically.

---

### 7.5 Student — Confirm Receipt
1. Student receives approval email: *CERP: Your component request has been approved.*
2. Student collects the component from the admin/lab.
3. Student clicks the Confirm Receipt link in the email.
4. Browser opens the confirmation landing page on CERP.
5. Page shows: *Receipt confirmed. Thank you!*
6. Transaction record updates to CONFIRMED. Admin sees this in Transactions.

---

## 8. Request State Machine

| State | Description | Triggered By |
|---|---|---|
| DRAFT | Being composed; not yet submitted | Student saves/autosaves before submitting |
| PENDING | Submitted; awaiting admin review. Student can still edit or withdraw. | Student clicks Submit |
| WITHDRAWN | Student cancelled while PENDING | Student clicks Withdraw |
| APPROVED | Admin approved; issue record created; email sent. Locked for student edits. | Admin clicks Approve |
| REJECTED | Admin rejected; optional reason stored; student notified | Admin clicks Reject |
| CONFIRMED | Student clicked confirmation link in approval email | Student clicks email link |
| COMPLETED | Component returned; transaction closed | Admin marks as returned |
| EXPIRED | Confirmation link not clicked within 7 days | System scheduled check |

**Valid student transitions:** DRAFT → PENDING, PENDING → WITHDRAWN, PENDING → DRAFT (edit/recall)

**Admin can override to any state at any time.**

---

## 9. Email Notifications

### 9.1 Approval Email
Sent immediately on admin approval.

| Field | Value |
|---|---|
| To | Student's registered email address |
| Subject | `CERP: Your component request has been approved` |
| Body includes | Student name, component name, approved quantity, pickup instructions (if any), Confirm Receipt CTA button, CERP branding + Club Ennovate footer |
| CTA link | `/confirm-receipt?token={unique_token}` |
| Sender name | CERP — Club Ennovate |

---

### 9.2 Updated Approval Email (Admin Edits After Approval)
Sent if an admin edits an already-approved request.

| Field | Value |
|---|---|
| Subject | `CERP: Your approved request has been updated` |
| Body includes | What changed (old vs new quantity / component), updated Confirm Receipt link, admin note if provided |

---

### 9.3 Rejection Email

| Field | Value |
|---|---|
| To | Student's registered email address |
| Subject | `CERP: Update on your component request` |
| Body includes | Student name, component name, rejection reason if provided, invitation to resubmit or contact admin |
| CTA | Optional "Browse Catalog" link to student portal |

---

## 10. Technical Requirements

### 10.1 Authentication
- Student accounts stored in existing backend with a `role` field: `"admin"` or `"student"`.
- Passwords hashed with bcrypt (same as existing admin auth).
- JWT or session token issued on student login, separate from admin session.
- Route guards: student routes reject unauthenticated users; admin routes reject `student` role tokens.

---

### 10.2 Database Schema Changes

**New table: `component_requests`**
```
id                        UUID, primary key
student_id                FK → students
component_id              FK → components
quantity                  integer
purpose_note              text, nullable
status                    enum: DRAFT | PENDING | WITHDRAWN | APPROVED | REJECTED | CONFIRMED | COMPLETED | EXPIRED
admin_id                  FK → admins, nullable (who approved/rejected)
rejection_reason          text, nullable
confirmation_token        string, nullable
confirmation_token_expiry datetime, nullable
confirmed_at              datetime, nullable
last_edited_by            FK → users, nullable
last_edited_at            datetime, nullable
edit_log                  JSON array of { editor_id, editor_role, changed_fields: {field, old, new}, timestamp }
created_at                datetime
updated_at                datetime
```

**Modify: `students` table**
- Add `email` field (string, unique)

**Modify: `transactions` table**
- Add `request_id` (FK → component_requests, nullable)
- Add `confirmed_at` (datetime, nullable)
- Add `last_edited_by` (FK → users, nullable)
- Add `last_edited_at` (datetime, nullable)

---

### 10.3 Email Service
- Use Resend, SendGrid, or Nodemailer with SMTP (Resend recommended for Vercel).
- All emails sent server-side only.
- Confirmation token: cryptographically random UUID or signed JWT, 7-day expiry.
- HTML-formatted templates, mobile-friendly, with plain-text fallback.
- Trigger updated approval email automatically when admin edits an approved request.

---

### 10.4 Frontend — New Routes

| Route | Access | Description |
|---|---|---|
| `/student-login` | Public | Student login page |
| `/student-dashboard` | Student | Personal dashboard |
| `/student-catalog` | Student | Browse component catalog |
| `/student-requests` | Student | My Requests — view, edit, withdraw pending requests |
| `/confirm-receipt` | Public (token auth) | Receipt confirmation landing page |

**Student nav:** Dashboard, Catalog, My Requests, Logout.

**Edit button visibility rules:**
- Students: Edit + Withdraw buttons visible only on PENDING requests. Hidden once APPROVED or REJECTED.
- Admins: Edit button visible on every request, transaction, and student profile regardless of status.

---

### 10.5 Admin Panel Additions
- **Request Queue** (new nav item or in Admin Settings): paginated list with inline Edit, Approve, Reject actions.
- **Edit modal on requests:** change component, quantity, status, add admin note. Writes audit log entry on save.
- **Transactions page:** Edit button on every row including completed.
- **Students page:** Edit already partially exists — extend to include email field.
- **Admin Settings:** Create student accounts (name, USN, phone, email, password).
- **Audit log** (optional for v1): chronological list of all admin edits with editor, timestamp, and field diff.

---

## 11. Out of Scope (v1.0)
- Student-to-student component transfers
- Push notifications or in-app notifications (email only)
- Student ability to edit their own profile (admin-managed in v1)
- Multi-admin approval workflows
- Fine/penalty system for unreturned components
- Mobile app (web only)
- SSO / Google OAuth for student login

---

## 12. Open Questions

| # | Question | Notes |
|---|---|---|
| 1 | Should student accounts be admin-created only, or can students self-register? | Admin-created is safer for a closed club |
| 2 | Which email service for production — Resend, SendGrid, or Nodemailer? | Resend is easiest for Vercel |
| 3 | Should the confirmation link work without login (token in URL only)? | Currently specified as token-only |
| 4 | Is 7-day token expiry appropriate, or should it be shorter (48 hours)? | Depends on how fast components are handed over |
| 5 | Should rejected requests be archived or permanently deleted? | Archiving recommended for audit trail |
| 6 | When admin edits an approved request, should a new confirmation token be generated? | Current spec keeps the same token |
| 7 | Should students be notified by email when an admin edits their pending request? | Adds one more email trigger; useful for transparency |

---

*CERP — Club Ennovate | Built by Jishnu Abhay D | Version 1.1 | March 2026*
