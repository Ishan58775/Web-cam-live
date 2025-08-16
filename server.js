require('dotenv').config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const bodyParser = require("body-parser");
const cloudinary = require("cloudinary").v2;

// Cloudinary config (reads CLOUDINARY_URL automatically from env)
if (!process.env.CLOUDINARY_URL) {
  console.warn("⚠️  CLOUDINARY_URL is not set in .env. Uploads will fail.");
}
cloudinary.config({ secure: true });

const app = express();

// View + static
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// Sessions (for admin auth only)
app.use(session({
  secret: process.env.SESSION_SECRET || "change-me",
  resave: false,
  saveUninitialized: true
}));

// In-memory store of capture sessions (resets when server restarts)
/**
 * sessions = {
 *   sessionId: {
 *     userName: "Ishan",
 *     timestamp: "2025-08-16 10:00",
 *     accessed: false,
 *     images: [{ url, type, public_id }]
 *   }
 * }
 */
let sessions = {};

// Routes
app.get("/", (req, res) => res.render("index"));

app.get("/capture", (req, res) => res.render("capture"));

// Upload from client
app.post("/upload", async (req, res) => {
  try {
    const { image, name, type, sessionId } = req.body;
    if (!image || !name || !type || !sessionId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const folder = `webcam_live/${sessionId}`;
    const publicId = `${type}_${Date.now()}`;

    const upload = await cloudinary.uploader.upload(image, {
      folder,
      public_id: publicId,
      overwrite: true,
      resource_type: "image"
    });

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        userName: name,
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        accessed: false,
        images: []
      };
    }
    sessions[sessionId].images.push({ url: upload.secure_url, type, public_id: upload.public_id });

    res.json({ success: true });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Admin auth
app.get("/admin", (req, res) => {
  if (req.session.loggedIn) return res.redirect("/admin/panel");
  res.render("admin_login");
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username === (process.env.ADMIN_USER || "admin") &&
      password === (process.env.ADMIN_PASS || "password")) {
    req.session.loggedIn = true;
    res.redirect("/admin/panel");
  } else {
    res.send("Invalid credentials");
  }
});

// Admin panel
app.get("/admin/panel", (req, res) => {
  if (!req.session.loggedIn) return res.redirect("/admin");
  res.render("admin", { sessions });
});

// Show captures
app.get("/show-captures/:id", (req, res) => {
  if (!req.session.loggedIn) return res.redirect("/admin");
  const id = req.params.id;
  const s = sessions[id];
  if (!s) return res.send("No data found");
  res.render("show_captures", {
    userName: s.userName,
    images: s.images.map(img => img.url)
  });
});

// Delete a session (also delete from Cloudinary)
app.delete("/delete-session/:id", async (req, res) => {
  const id = req.params.id;
  const s = sessions[id];
  if (!s) return res.json({ success: false });

  try {
    const publicIds = s.images.map(x => x.public_id);
    if (publicIds.length) {
      await cloudinary.api.delete_resources(publicIds);
    }
    await cloudinary.api.delete_folder(`webcam_live/${id}`);
  } catch (e) {
    console.warn("Cloudinary delete warning:", e.message);
  }

  delete sessions[id];
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
