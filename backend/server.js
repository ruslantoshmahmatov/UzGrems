import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "store.json");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOAD_DIR));

const MAX = {
  image: 10 * 1024 * 1024,
  game: 250 * 1024 * 1024,
  storyVideo: 100 * 1024 * 1024
};

const DEFAULT_DB = {
  "users:list": [],
  "games:list": [],
  "chat:messages": []
};

function loadDb() {
  try { return { ...DEFAULT_DB, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) }; }
  catch { return { ...DEFAULT_DB }; }
}
function saveDb(db) {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
let db = loadDb();

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(value), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(value, stored) {
  try {
    const [salt, expected] = String(stored).split(":");
    const actual = crypto.scryptSync(String(value), salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch { return false; }
}
function createToken(email) {
  const payload = Buffer.from(String(email)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function readToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (sig !== expected) return null;
  return Buffer.from(payload, "base64url").toString("utf8");
}
function publicUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}

const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (adminEmail && adminPassword && !db["users:list"].some(u => String(u.email).toLowerCase() === adminEmail)) {
  db["users:list"].push({
    email: adminEmail,
    password: hashPassword(adminPassword),
    name: process.env.ADMIN_NAME || "Ruslan",
    bio: "UzGrems asoschisi",
    isAdmin: true,
    registeredAt: Date.now()
  });
  saveDb(db);
}

function authUser(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Kirish talab qilinadi" });
  const email = readToken(token);
  if (!email) return res.status(401).json({ error: "Sessiya yaroqsiz" });
  const user = db["users:list"].find(u => String(u.email).toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Sessiya yaroqsiz" });
  req.user = user;
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").slice(0, 12);
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: MAX.game }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "UzGrems", time: Date.now() }));

app.post("/api/upload", authUser, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Fayl tanlanmagan" });
  const kind = req.body.kind || "file";
  let max = MAX.game;
  if (kind === "avatar" || kind === "cover" || kind === "game-cover" || kind === "story-image") max = MAX.image;
  if (kind === "story-video") max = MAX.storyVideo;
  if (req.file.size > max) {
    fs.unlinkSync(req.file.path);
    return res.status(413).json({ error: "Fayl hajmi juda katta" });
  }
  res.json({ url: `/uploads/${path.basename(req.file.path)}` });
});

app.get("/api/storage/:key", authUser, (req, res) => {
  const key = req.params.key;
  if (key.startsWith("progress:") || key.startsWith("avatar:") || key.startsWith("cover:") || key.startsWith("claudechat:")) {
    const owner = key.split(":").slice(1).join(":").toLowerCase();
    if (owner !== req.user.email.toLowerCase()) return res.status(403).json({ error: "Ruxsat yo'q" });
  }
  if (key === "users:list" && !req.user.isAdmin) return res.status(403).json({ error: "Admin kerak" });
  res.json({ value: db[key] ?? null });
});

app.put("/api/storage/:key", authUser, (req, res) => {
  const key = req.params.key;
  if (key === "users:list" || key === "games:list") {
    if (!req.user.isAdmin) return res.status(403).json({ error: "Admin kerak" });
  }
  if (key.startsWith("progress:") || key.startsWith("avatar:") || key.startsWith("cover:") || key.startsWith("claudechat:")) {
    const owner = key.split(":").slice(1).join(":").toLowerCase();
    if (owner !== req.user.email.toLowerCase()) return res.status(403).json({ error: "Ruxsat yo'q" });
  }
  db[key] = req.body.value;
  saveDb(db);
  res.json({ ok: true });
});

app.post("/api/auth/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");
  if (!email || !name || password.length < 4) return res.status(400).json({ error: "Ma'lumotlarni to'liq kiriting" });
  if (db["users:list"].some(u => String(u.email).toLowerCase() === email)) return res.status(409).json({ error: "Bu email band" });
  const user = { email, password: hashPassword(password), name, bio: "", isAdmin: false, registeredAt: Date.now() };
  db["users:list"].push(user); saveDb(db);
  const token = createToken(email);
  res.json({ token, user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db["users:list"].find(u => String(u.email).toLowerCase() === email);
  if (!user || !verifyPassword(password, user.password)) return res.status(401).json({ error: "Email yoki parol noto'g'ri" });
  const token = createToken(email);
  res.json({ token, user: publicUser(user) });
});

app.get("/api/auth/me", authUser, (req, res) => res.json({ user: publicUser(req.user) }));

app.put("/api/profile", authUser, (req, res) => {
  const patch = req.body && typeof req.body === "object" ? req.body : {};
  const allowed = {};
  if (typeof patch.name === "string" && patch.name.trim()) allowed.name = patch.name.trim();
  if (typeof patch.bio === "string") allowed.bio = patch.bio;
  const idx = db["users:list"].findIndex(u => u.email.toLowerCase() === req.user.email.toLowerCase());
  if (idx < 0) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
  db["users:list"][idx] = { ...db["users:list"][idx], ...allowed };
  saveDb(db);
  res.json({ user: publicUser(db["users:list"][idx]) });
});

app.post("/api/profile/password", authUser, (req, res) => {
  const current = String(req.body.currentPassword || "");
  const next = String(req.body.newPassword || "");
  if (next.length < 4) return res.status(400).json({ error: "Yangi parol kamida 4 belgi" });
  if (!verifyPassword(current, req.user.password)) return res.status(401).json({ error: "Joriy parol noto'g'ri" });
  req.user.password = hashPassword(next);
  saveDb(db);
  res.json({ ok: true });
});

app.delete("/api/profile", authUser, (req, res) => {
  db["users:list"] = db["users:list"].filter(u => u.email.toLowerCase() !== req.user.email.toLowerCase());
  saveDb(db);
  res.json({ ok: true });
});

app.post("/api/claude", authUser, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Claude API kaliti serverda sozlanmagan" });
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
      max_tokens: 1000,
      system: String(req.body.system || "Har doim o'zbek tilida javob bering."),
      messages: Array.isArray(req.body.messages) ? req.body.messages.slice(-40) : []
    });
    const text = (response.content || []).filter(x => x.type === "text").map(x => x.text).join("\n").trim();
    res.json({ text });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "Claude serveri bilan aloqa xatosi" });
  }
});

app.use(express.static(path.join(ROOT, "frontend-dist")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
  const file = path.join(ROOT, "frontend-dist", "index.html");
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send("Frontend hali build qilinmagan.");
});

app.listen(PORT, "0.0.0.0", () => console.log(`UzGrems server ${PORT}-portda ishlayapti`));
