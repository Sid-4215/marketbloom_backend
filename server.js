import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import nodemailer from "nodemailer";
import pkg from "pg";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// ================================
// PostgreSQL Setup
// ================================
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create table if not exists
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        business TEXT NOT NULL,
        service TEXT NOT NULL,
        phone TEXT NOT NULL,
        message TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        status TEXT DEFAULT 'new'
      );
    `);

    console.log("📦 PostgreSQL ready");
  } catch (err) {
    console.error("❌ DB Init Error:", err);
  }
}
initDB();

// ================================
// Middlewares
// ================================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(join(__dirname, "../dist")));

// ================================
// Nodemailer (Gmail)
// ================================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ================================
// Security Middlewares
// ================================
const requireApiKey = (req, res, next) => {
  const key = req.headers["x-api-key"] || req.query.apiKey;
  if (!key) return res.status(401).json({ success: false, message: "API key required" });
  if (key !== process.env.API_KEY) return res.status(403).json({ success: false, message: "Invalid API key" });
  next();
};

const requireAdminAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer "))
    return res.status(401).json({ success: false, message: "Admin authentication required" });

  const token = header.substring(7);
  if (token !== process.env.ADMIN_PASSWORD)
    return res.status(403).json({ success: false, message: "Invalid admin credentials" });

  next();
};

// ================================
// Health Check
// ================================
app.get("/api/health", (req, res) => {
  res.json({ status: "Server is running" });
});

// ================================
// Admin Panel HTML
// ================================
app.get("/admin", (req, res) => {
  res.sendFile(join(__dirname, "admin.html"));
});

// ================================
// Admin Login
// ================================
app.post("/api/admin/login", requireApiKey, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: "Password required" });

  if (password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ success: false, message: "Invalid password" });

  res.json({ success: true, token: process.env.ADMIN_PASSWORD });
});

// ================================
// Handle Contact Form
// ================================
app.post("/api/contact", requireApiKey, async (req, res) => {
  try {
    const { name, business, service, phone, message } = req.body;

    if (!name || !business || !service || !phone) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    const result = await pool.query(
      `INSERT INTO submissions (name, business, service, phone, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, business, service, phone, message || ""]
    );

    const submissionId = result.rows[0].id;

    // Email Notification
    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `🎯 New Lead: ${business}`,
      html: `
        <h2>New Contact Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Business:</strong> ${business}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Message:</strong> ${message}</p>
      `
    });

    res.json({ success: true, message: "Form submitted!", submissionId });
  } catch (err) {
    console.log("❌ Contact Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ================================
// Fetch Submissions (Admin Only)
// ================================
app.get("/api/submissions", requireAdminAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM submissions ORDER BY timestamp DESC");
    res.json({ success: true, data: result.rows });
  } catch {
    res.status(500).json({ success: false, message: "Database error" });
  }
});

// ================================
// Delete Submission
// ================================
app.delete("/api/submissions/:id", requireAdminAuth, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM submissions WHERE id=$1", [req.params.id]);

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Not found" });

    res.json({ success: true, message: "Deleted" });
  } catch {
    res.status(500).json({ success: false, message: "Database error" });
  }
});

// ================================
// Serve Frontend
// ================================
app.use("*", (req, res) => {
  res.sendFile(join(__dirname, "../dist/index.html"));
});

// ================================
// Start Server
// ================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
