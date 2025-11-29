import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import nodemailer from 'nodemailer';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// ===================
// 🔧 Middleware
// ===================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(join(__dirname, '../dist')));

// ===================
// 🗄️ Database Setup
// ===================
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database.');

    db.run(`
      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        business TEXT NOT NULL,
        service TEXT NOT NULL,
        phone TEXT NOT NULL,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'new'
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      } else {
        console.log('Submissions table ready.');
      }
    });
  }
});

// ===================
// ✉️ Email Setup
// ===================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ===================
// 🔐 Authentication Middleware
// ===================
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API key required'
    });
  }
  
  if (apiKey !== process.env.API_KEY) {
    return res.status(403).json({
      success: false,
      message: 'Invalid API key'
    });
  }
  
  next();
};

const requireAdminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Admin authentication required'
    });
  }
  
  const token = authHeader.substring(7);
  
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({
      success: false,
      message: 'Invalid admin credentials'
    });
  }
  
  next();
};

// ===================
// 🟢 Health Check (Public)
// ===================
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running!' });
});

// ===================
// 🔐 Admin Panel Route
// ===================
app.get('/admin', (req, res) => {
  res.sendFile(join(__dirname, 'admin.html'));
});

// ===================
// 🔒 Admin Login
// ===================
app.post('/api/admin/login', requireApiKey, (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({
      success: false,
      message: 'Password required'
    });
  }
  
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: 'Invalid password'
    });
  }
  
  res.json({
    success: true,
    message: 'Login successful',
    token: process.env.ADMIN_PASSWORD
  });
});

// ===================
// 📩 Contact Form API (Protected with API Key)
// ===================
app.post('/api/contact', requireApiKey, async (req, res) => {
  try {
    const { name, business, service, phone, message } = req.body;

    console.log('Received form submission:', { name, business, service, phone, message });

    if (!name || !business || !service || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all required fields'
      });
    }

    const sql = `INSERT INTO submissions (name, business, service, phone, message) VALUES (?, ?, ?, ?, ?)`;

    db.run(sql, [name, business, service, phone, message || ''], function (err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({
          success: false,
          message: 'Database error'
        });
      }

      const submissionId = this.lastID;
      console.log('Submission saved with ID:', submissionId);

      // Send email notification
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_USER,
          subject: `🎯 New Lead: ${business} - MarketBloom Studio`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="border-bottom: 2px solid #facc6b; padding-bottom: 10px;">
                New Contact Form Submission
              </h2>
              
              <p><strong>👤 Name:</strong> ${name}</p>
              <p><strong>🏢 Business:</strong> ${business}</p>
              <p><strong>🎯 Service:</strong> ${service}</p>
              <p><strong>📱 Phone:</strong> ${phone}</p>
              <p><strong>💬 Message:</strong> ${message || 'No additional message'}</p>

              <p><strong>Submission ID:</strong> ${submissionId}</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
            </div>
          `
        };

        transporter.sendMail(mailOptions, (error) => {
          if (error) console.error('Email sending failed:', error);
          else console.log('Email sent successfully.');
        });
      }

      res.json({
        success: true,
        message: 'Form submitted successfully! We will contact you soon.',
        submissionId
      });
    });

  } catch (error) {
    console.error('Error processing submission:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ===================
// 📄 Fetch All Submissions (Admin Only)
// ===================
app.get('/api/submissions', requireAdminAuth, (req, res) => {
  db.all('SELECT * FROM submissions ORDER BY timestamp DESC', (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    res.json({
      success: true,
      data: rows
    });
  });
});

// ===================
// 🗑️ Delete Submission (Admin Only)
// ===================
app.delete('/api/submissions/:id', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  
  db.run('DELETE FROM submissions WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }
    
    res.json({
      success: true,
      message: 'Submission deleted successfully'
    });
  });
});

// =========================
// 🟢 FIXED EXPRESS 5 ROUTING
// Serve React App for ALL non-API routes
// =========================
app.use((req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

// ===================
// 🚀 Start Server
// ===================
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📧 Email notifications: ${process.env.EMAIL_USER ? 'Enabled' : 'Not configured'}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin`);
});