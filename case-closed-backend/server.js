/**
 * server.js
 * Contact form backend for Case Closed
 *
 * Setup:
 *   npm init -y
 *   npm i express nodemailer cors helmet express-rate-limit dotenv
 *
 * Run:
 *   node server.js
 *
 * Env:
 *   PORT=3000
 *   CONTACT_TO_EMAIL=you@domain.com
 *   CONTACT_FROM_EMAIL=Case Closed <no-reply@yourdomain.com>   (or your gmail address)
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_SECURE=true
 *   SMTP_USER=your_gmail_or_smtp_user
 *   SMTP_PASS=your_app_password_or_smtp_password
 *   ALLOWED_ORIGIN=http://127.0.0.1:5500,http://localhost:5500,https://caseclosed-ai.netlify.app (or your deployed frontend URL)
 */

require("dotenv").config();
console.log("CONTACT_TO_EMAIL =", process.env.CONTACT_TO_EMAIL);


const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// --- Security / parsing ---
app.use(helmet());
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: [/\.netlify\.app$/, "http://localhost:5500", "http://127.0.0.1:5500"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

app.options(/.*/, cors());



// Rate limit to prevent spam
const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // 20 requests per IP per 10 minutes
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/contact", contactLimiter);

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

function isEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str || "").trim());
}

function sanitize(str) {
  // Minimal sanitization to prevent header injection + weird chars in email.
  return String(str || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 4000);
}

// --- Nodemailer transporter ---
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || "true") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "Missing SMTP config. Set SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT/SMTP_SECURE)."
    );
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

// --- Contact endpoint ---
app.post("/api/contact", async (req, res) => {
  try {
    const name = sanitize(req.body?.name);
    const email = sanitize(req.body?.email);
    const message = sanitize(req.body?.message);

    if (!name || name.length < 2) {
      return res.status(400).json({ ok: false, error: "Please enter your name." });
    }
    if (!email || !isEmail(email)) {
      return res.status(400).json({ ok: false, error: "Please enter a valid email." });
    }
    if (!message || message.length < 10) {
      return res.status(400).json({ ok: false, error: "Please enter a longer message." });
    }

    const to = process.env.CONTACT_TO_EMAIL;
    const from = process.env.CONTACT_FROM_EMAIL || process.env.SMTP_USER;

    if (!to) {
      return res
        .status(500)
        .json({ ok: false, error: "Server not configured: CONTACT_TO_EMAIL missing." });
    }

    const transporter = createTransporter();

    // Optional: verify SMTP connection (can be removed once stable)
    //await transporter.verify();

    const subject = `Case Closed Inquiry — ${name}`;
    const text = [
      "New inquiry from the Case Closed website",
      "---------------------------------------",
      `Name: ${name}`,
      `Email: ${email}`,
      "",
      "Message:",
      message,
      "",
      `Sent at: ${new Date().toISOString()}`,
      `IP: ${req.ip}`,
      `User-Agent: ${req.get("user-agent") || "unknown"}`,
    ].join("\n");

    const html = `
      <h2>New inquiry from the Case Closed website</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}<br/>
         <strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Message:</strong></p>
      <pre style="white-space:pre-wrap; font-family:Inter,system-ui,Arial; background:#f7f2ee; padding:12px; border-radius:10px; border:1px solid #e8d7cc;">${escapeHtml(
        message
      )}</pre>
      <p style="color:#6b625c; font-size:12px;">
        Sent at ${new Date().toISOString()} • IP ${escapeHtml(req.ip)} • UA ${escapeHtml(
      req.get("user-agent") || "unknown"
    )}
      </p>
    `;

    // Use replyTo so you can hit "Reply" and it replies to the user
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      replyTo: email,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Failed to send message." });
  }
});

// Helper to safely embed user text in HTML email
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Contact backend running on http://localhost:${PORT}`);
});

app.get("/", (req, res) => {
  res.send("Case Closed backend is running ✅");
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Server error" });
});
