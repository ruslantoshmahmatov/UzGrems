import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Gamepad2, MessageCircle, User, Shield, Send, LogOut, Trash2,
  Upload, Play, X, Plus, Lock, Mail, Download, Camera, Image as ImageIcon,
  Send as TelegramIcon, Instagram, Music2, ChevronRight, Loader2, Eye, EyeOff,
  Users as UsersIcon, PlusCircle, Film, Pencil, Sparkles, Link as LinkIcon
} from "lucide-react";

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "";
const SOCIALS = [
  { key: "telegram", label: "Telegram", handle: "@The_Toshmahmatov", url: "https://t.me/The_Toshmahmatov", Icon: TelegramIcon },
  { key: "instagram", label: "Instagram", handle: "@_toshmahmatov_rw", url: "https://instagram.com/_toshmahmatov_rw", Icon: Instagram },
  { key: "tiktok", label: "TikTok", handle: "@ruslan_toshmahmatov", url: "https://tiktok.com/@ruslan_toshmahmatov", Icon: Music2 },
];
const BG = "#0B0B14";
const SURFACE = "#14141F";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GAME_BYTES = 250 * 1024 * 1024;
const MAX_STORY_VIDEO_BYTES = 100 * 1024 * 1024;

async function apiUpload(file, kind) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error || "Fayl serverga yuklanmadi");
  return data.url;
}

function checkFileSize(file, maxBytes, label) {
  if (file.size > maxBytes) throw new Error(`${label} hajmi juda katta`);
}

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "hozir";
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} soat`;
  const d = Math.floor(h / 24);
  return `${d} kun`;
}

// Downscale + re-encode images client-side so a photo straight from a phone camera
// (often several MB) shrinks to a small JPEG before it ever touches shared storage.
function compressImage(file, maxDim = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Rasmni o'qib bo'lmadi"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Faylni o'qib bo'lmadi"));
    reader.readAsDataURL(file);
  });
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("O'qib bo'lmadi"));
    r.readAsDataURL(file);
  });
}

async function safeGet(key, shared) {
  try {
    const token = localStorage.getItem("uzgrems_token");
    const res = await fetch(`/api/storage/${encodeURIComponent(key)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch (e) { return null; }
}
async function safeSet(key, value, shared) {
  try {
    const token = localStorage.getItem("uzgrems_token");
    if (!token) return false;
    const res = await fetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ value })
    });
    return res.ok;
  } catch (e) { return false; }
}

function Avatar({ src, name, size = 40, ring }) {
  const initials = (name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center overflow-hidden ${ring ? "ring-2 ring-violet-400/60" : ""}`}
      style={{ width: size, height: size, background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}
    >
      {src ? <img src={src} alt={name} className="w-full h-full object-cover" /> : <span className="text-white font-bold" style={{ fontSize: size * 0.4 }}>{initials}</span>}
    </div>
  );
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [users, setUsers] = useState([]);
  const [games, setGames] = useState([]);
  const [gameCovers, setGameCovers] = useState({});
  const [messages, setMessages] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [tab, setTab] = useState("market");
  const [toast, setToast] = useState(null);
  const [storySlot, setStorySlot] = useState(null);
  const [playSlot, setPlaySlot] = useState(null);

  const showToast = useCallback((msg, tone = "ok") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("uzgrems_token");
      if (!token) { setBooted(true); return; }
      try {
        const meRes = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!meRes.ok) { localStorage.removeItem("uzgrems_token"); setBooted(true); return; }
        const me = await meRes.json();
        setCurrentUser(me.user);
        const [g, m] = await Promise.all([
          safeGet("games:list", true),
          safeGet("chat:messages", true),
        ]);
        setGames(g || []);
        setMessages(m || []);
        if (me.user.isAdmin) setUsers((await safeGet("users:list", true)) || []);
        if (g?.length) setGameCovers(Object.fromEntries(g.filter((x) => x.coverUrl).map((x) => [x.id, x.coverUrl])));
      } catch {}
      setBooted(true);
    })();
  }, []);

  useEffect(() => {
    if (tab !== "chat") return;
    const id = setInterval(async () => {
      const m = await safeGet("chat:messages", true);
      if (m) setMessages(m);
    }, 4000);
    return () => clearInterval(id);
  }, [tab]);

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      const p = await safeGet(`progress:${currentUser.email}`, true);
      setProgressMap(p || {});
      const [avatar, cover] = await Promise.all([safeGet(`avatar:${currentUser.email}`, true), safeGet(`cover:${currentUser.email}`, true)]);
      setCurrentUser((c) => (c ? { ...c, avatar: avatar || "", cover: cover || "" } : c));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.email]);

  async function persistUsers(next) { setUsers(next); return safeSet("users:list", next, true); }
  async function persistGames(next) { setGames(next); return safeSet("games:list", next, true); }
  async function persistMessages(next) { setMessages(next); return safeSet("chat:messages", next, true); }
  async function persistProgress(next) { setProgressMap(next); if (currentUser) return safeSet(`progress:${currentUser.email}`, next, true); }

  async function handleLogin(email, password) {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Kirish amalga oshmadi");
      localStorage.setItem("uzgrems_token", data.token);
      setCurrentUser(data.user);
      if (data.user.isAdmin) setUsers((await safeGet("users:list", true)) || []);
      setTab("market");
      showToast(`Xush kelibsiz, ${data.user.name}!`);
    } catch (e) { showToast(e.message || "Email yoki parol noto'g'ri", "err"); }
  }

  async function handleRegister(email, name, password) {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ro'yxatdan o'tish amalga oshmadi");
      localStorage.setItem("uzgrems_token", data.token);
      setCurrentUser(data.user);
      setTab("market");
      showToast("Ro'yxatdan o'tdingiz!");
    } catch (e) { showToast(e.message || "Ro'yxatdan o'tish xatosi", "err"); }
  }

  async function updateCurrentUser(patch) {
    const { avatar, cover, password, ...metaPatch } = patch;
    try {
      if (password) {
        throw new Error("Parolni alohida almashtirish oynasidan yangilang");
      }
      if (Object.keys(metaPatch).length) {
        const token = localStorage.getItem("uzgrems_token");
        const res = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(metaPatch)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Profil saqlanmadi");
        setCurrentUser((c) => ({ ...c, ...data.user }));
      }
      if (avatar || cover) setCurrentUser((c) => ({ ...c, ...patch }));
    } catch (e) { showToast(e.message || "Profil saqlanmadi", "err"); }
  }
  async function setAvatarImage(file) {
    try {
      checkFileSize(file, MAX_IMAGE_BYTES, "Profil rasmi");
      const url = await apiUpload(file, "avatar");
      const ok = await safeSet(`avatar:${currentUser.email}`, url, true);
      if (!ok) throw new Error("Profil rasmi manzili saqlanmadi");
      setCurrentUser((c) => ({ ...c, avatar: url }));
      showToast("Profil rasmi yangilandi");
    } catch (e) {
      showToast(e.message || "Profil rasmi yuklanmadi", "err");
    }
  }

  async function setCoverImage(file) {
    try {
      checkFileSize(file, MAX_IMAGE_BYTES, "Profil foni");
      const url = await apiUpload(file, "cover");
      const ok = await safeSet(`cover:${currentUser.email}`, url, true);
      if (!ok) throw new Error("Profil foni manzili saqlanmadi");
      setCurrentUser((c) => ({ ...c, cover: url }));
      showToast("Fon rasmi yangilandi");
    } catch (e) {
      showToast(e.message || "Fon rasmi yuklanmadi", "err");
    }
  }

  async function deleteAccount() {
    try {
      const token = localStorage.getItem("uzgrems_token");
      const res = await fetch("/api/profile", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Akkaunt o'chirilmadi");
      localStorage.removeItem("uzgrems_token");
      setCurrentUser(null);
      showToast("Akkaunt o'chirildi");
    } catch (e) { showToast(e.message || "Akkaunt o'chirilmadi", "err"); }
  }

  async function sendMessage(text) {
    if (!text.trim() || !currentUser) return;
    const next = [...messages, { id: `${Date.now()}-${Math.random()}`, email: currentUser.email, name: currentUser.name, text: text.trim(), time: Date.now() }].slice(-300);
    setMessages(next); // show instantly regardless of network
    const ok = await safeSet("chat:messages", next, true);
    if (!ok) showToast("Xabar saqlanmadi, qayta urinib ko'ring", "err");
  }

  async function addGame(game) {
    const id = `g${Date.now()}`;
    const { coverUrl, ...rest } = game;
    const entry = { ...rest, id, hasCover: !!coverUrl, hasStory: false, storyType: null };
    const next = [...games, entry];
    const ok = await persistGames(next);
    if (!ok) { showToast("O'yin ma'lumotlari saqlanmadi", "err"); return; }
    if (coverUrl) setGameCovers((m) => ({ ...m, [id]: coverUrl }));
    showToast("O'yin qo'shildi");
  }

  async function setStory(gameId, storyUrl, storyType) {
    if (!storyUrl) { showToast("Treyler URL topilmadi", "err"); return; }
    const next = games.map((g) => (g.id === gameId ? { ...g, hasStory: true, storyType, storyUrl } : g));
    const ok = await persistGames(next);
    if (!ok) { showToast("Treyler ma'lumotlari saqlanmadi", "err"); return; }
    showToast("Treyler joylandi");
  }

  function bumpProgress(gameId, delta) {
    const cur = progressMap[gameId] || { level: 1, score: 0 };
    const score = cur.score + delta;
    const level = 1 + Math.floor(score / 50);
    persistProgress({ ...progressMap, [gameId]: { level, score } });
  }

  if (!booted) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}><Loader2 className="animate-spin text-violet-400" size={32} /></div>;
  }

  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: BG, fontFamily: "Inter, sans-serif", maxWidth: "100vw" }}>
      <style>{FONT_IMPORT}</style>
      {!currentUser ? (
        <AuthScreen mode={authMode} setMode={setAuthMode} onLogin={handleLogin} onRegister={handleRegister} />
      ) : (
        <MainApp
          currentUser={currentUser} users={users} games={games} gameCovers={gameCovers}
          messages={messages} progressMap={progressMap} tab={tab} setTab={setTab}
          onLogout={() => { localStorage.removeItem("uzgrems_token"); setCurrentUser(null); }} onUpdateUser={updateCurrentUser}
          onSetAvatarImage={setAvatarImage} onSetCoverImage={setCoverImage}
          onDeleteAccount={deleteAccount} onSendMessage={sendMessage}
          onAddGame={addGame} onSetStory={setStory}
          storySlot={storySlot} setStorySlot={setStorySlot}
          playSlot={playSlot} setPlaySlot={setPlaySlot}
          onBumpProgress={bumpProgress} showToast={showToast}
        />
      )}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-medium shadow-lg z-50"
          style={{ background: toast.tone === "err" ? "#3a1420" : "#12241f", color: toast.tone === "err" ? "#FF9DB1" : "#7CF3D4", border: `1px solid ${toast.tone === "err" ? "#FF5C7A44" : "#00E5C944"}` }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');
.display-font{font-family:'Rajdhani',sans-serif;letter-spacing:0.02em;}
html,body{overflow-x:hidden;max-width:100vw;}
*{box-sizing:border-box;}`;

function AuthScreen({ mode, setMode, onLogin, onRegister }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl opacity-30" style={{ background: "#7C5CFC" }} />
      <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-30" style={{ background: "#00E5C9" }} />
      <div className="flex items-center gap-2 mb-8 relative z-10">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}><Gamepad2 className="text-black" size={22} /></div>
        <span className="display-font text-3xl font-bold text-white">UzGrems</span>
      </div>
      <div className="w-full max-w-sm rounded-2xl p-6 relative z-10" style={{ background: SURFACE, border: "1px solid #24243a" }}>
        <div className="flex mb-6 rounded-xl p-1" style={{ background: "#0B0B14" }}>
          <button onClick={() => setMode("login")} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === "login" ? "text-black" : "text-gray-400"}`} style={mode === "login" ? { background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" } : {}}>Kirish</button>
          <button onClick={() => setMode("register")} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === "register" ? "text-black" : "text-gray-400"}`} style={mode === "register" ? { background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" } : {}}>Ro'yxatdan o'tish</button>
        </div>
        <div className="space-y-3">
          {mode === "register" && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: "#0B0B14", border: "1px solid #24243a" }}>
              <User size={16} className="text-gray-500" />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ismingiz" className="bg-transparent outline-none text-sm text-white w-full placeholder:text-gray-600" />
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: "#0B0B14", border: "1px solid #24243a" }}>
            <Mail size={16} className="text-gray-500" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className="bg-transparent outline-none text-sm text-white w-full placeholder:text-gray-600" />
          </div>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: "#0B0B14", border: "1px solid #24243a" }}>
            <Lock size={16} className="text-gray-500" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPass ? "text" : "password"} placeholder="Parol" className="bg-transparent outline-none text-sm text-white w-full placeholder:text-gray-600" />
            <button onClick={() => setShowPass((s) => !s)} className="text-gray-500">{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <button onClick={() => (mode === "login" ? onLogin(email, password) : onRegister(email, name, password))} className="w-full py-2.5 rounded-lg font-semibold text-black text-sm mt-2 active:scale-[0.98] transition-transform" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}>
            {mode === "login" ? "Kirish" : "Ro'yxatdan o'tish"}
          </button>
        </div>
      </div>
      <p className="text-gray-600 text-xs mt-6 relative z-10 text-center max-w-xs">O'yinlar market, umumiy chat va profilingiz — barchasi bitta joyda.</p>
    </div>
  );
}

function MainApp(props) {
  const {
    currentUser, users, games, gameCovers, messages, progressMap, tab, setTab,
    onLogout, onUpdateUser, onSetAvatarImage, onSetCoverImage, onDeleteAccount, onSendMessage,
    onAddGame, onSetStory, storySlot, setStorySlot, playSlot, setPlaySlot, onBumpProgress, showToast,
  } = props;

  const tabs = [
    { key: "market", label: "Market", Icon: Gamepad2 },
    { key: "chat", label: "Chat", Icon: MessageCircle },
    { key: "profile", label: "Profil", Icon: User },
    ...(currentUser.isAdmin ? [{ key: "admin", label: "Admin", Icon: Shield }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 sticky top-0 z-30" style={{ background: "#0B0B14EE", backdropFilter: "blur(8px)", borderBottom: "1px solid #1c1c2c" }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}><Gamepad2 className="text-black" size={16} /></div>
          <span className="display-font text-xl font-bold text-white">UzGrems</span>
        </div>
        <div className="flex items-center gap-3">
          {SOCIALS.map(({ key, url, Icon }) => (
            <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-violet-400 transition-colors"><Icon size={17} /></a>
          ))}
        </div>
      </header>

      <main className="flex-1 pb-24 max-w-2xl w-full mx-auto">
        {tab === "market" && <MarketTab games={games} gameCovers={gameCovers} progressMap={progressMap} onOpenStory={setStorySlot} onOpenPlay={setPlaySlot} showToast={showToast} />}
        {tab === "chat" && <ChatTab messages={messages} currentUser={currentUser} onSend={onSendMessage} showToast={showToast} />}
        {tab === "profile" && <ProfileTab currentUser={currentUser} onUpdateUser={onUpdateUser} onSetAvatarImage={onSetAvatarImage} onSetCoverImage={onSetCoverImage} onLogout={onLogout} onDeleteAccount={onDeleteAccount} showToast={showToast} />}
        {tab === "admin" && currentUser.isAdmin && <AdminTab users={users} games={games} onAddGame={onAddGame} onSetStory={onSetStory} showToast={showToast} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-30 px-4 pb-3 pt-2" style={{ background: "#0B0B14EE", backdropFilter: "blur(8px)", borderTop: "1px solid #1c1c2c" }}>
        <div className="max-w-2xl mx-auto flex items-center justify-around">
          {tabs.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button key={key} onClick={() => setTab(key)} className="flex flex-col items-center gap-1 px-3 py-1 relative">
                {active && <span className="absolute -top-2 w-8 h-1 rounded-full" style={{ background: "linear-gradient(90deg,#7C5CFC,#00E5C9)", boxShadow: "0 0 12px #7C5CFCaa" }} />}
                <Icon size={20} className={active ? "text-white" : "text-gray-600"} />
                <span className={`text-[11px] font-medium ${active ? "text-white" : "text-gray-600"}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {storySlot && <StoryViewer game={storySlot} onClose={() => setStorySlot(null)} />}
      {playSlot && <PlayModal game={playSlot} progress={progressMap[playSlot.id] || { level: 1, score: 0 }} onClose={() => setPlaySlot(null)} onBump={(d) => onBumpProgress(playSlot.id, d)} />}
    </div>
  );
}

function MarketTab({ games, gameCovers, progressMap, onOpenStory, onOpenPlay, showToast }) {
  if (games.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center px-8 py-24 text-gray-500">
        <Gamepad2 size={40} className="mb-3 opacity-40" />
        <p className="text-sm">Hozircha o'yinlar yo'q. Admin tez orada qo'shadi.</p>
      </div>
    );
  }
  return (
    <div className="p-4 grid grid-cols-2 gap-3">
      {games.map((g) => {
        const prog = progressMap[g.id];
        const cover = gameCovers[g.id];
        return (
          <div key={g.id} className="rounded-xl overflow-hidden flex flex-col" style={{ background: SURFACE, border: "1px solid #24243a" }}>
            <button onClick={() => g.hasStory && onOpenStory(g)} className="relative aspect-square w-full block">
              {cover ? <img src={cover} alt={g.title} className="w-full h-full object-cover" /> : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#7C5CFC33,#00E5C933)" }}><Gamepad2 className="text-gray-500" size={28} /></div>
              )}
              {g.hasStory && <span className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}><Film size={12} className="text-black" /></span>}
            </button>
            <div className="p-2.5 flex flex-col gap-2 flex-1">
              <div>
                <p className="text-white text-sm font-semibold display-font leading-tight">{g.title}</p>
                <p className="text-gray-500 text-xs line-clamp-2 mt-0.5">{g.desc}</p>
              </div>
              {prog && <p className="text-[11px] text-teal-300">Daraja {prog.level} · {prog.score} ball</p>}
              <div className="mt-auto flex gap-1.5">
                <button onClick={() => onOpenPlay(g)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold text-black" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}>
                  <Play size={12} /> {prog ? "Davom etish" : "O'ynash"}
                </button>
                <a href={g.downloadUrl || "#"} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => { if (!g.downloadUrl) { e.preventDefault(); showToast("Yuklab olish havolasi yo'q", "err"); } }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#0B0B14", border: "1px solid #24243a" }}>
                  <Download size={13} className="text-gray-400" />
                </a>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StoryViewer({ game, onClose }) {
  const src = game.storyUrl || null;
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [game, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-4">
      <div className="absolute top-4 left-4 right-4 h-1 rounded-full bg-white/20 overflow-hidden"><div style={{ animation: "story-grow 8s linear forwards" }} className="h-full bg-white" /></div>
      <style>{`@keyframes story-grow{from{width:0%}to{width:100%}}`}</style>
      <button onClick={onClose} className="absolute top-8 right-4 text-white/80"><X size={22} /></button>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: SURFACE }}>
        {!src ? (
          <div className="w-full aspect-[9/16] flex items-center justify-center"><Loader2 className="animate-spin text-violet-400" size={24} /></div>
        ) : game.storyType === "video" ? (
          <video src={src} className="w-full max-h-[70vh] object-cover" autoPlay muted loop playsInline controls />
        ) : (
          <img src={src} alt="treyler" className="w-full max-h-[70vh] object-cover" />
        )}
        <div className="p-4">
          <p className="text-white font-semibold display-font">{game.title}</p>
          <p className="text-gray-400 text-xs mt-1">{game.desc}</p>
        </div>
      </div>
    </div>
  );
}

function PlayModal({ game, progress, onClose, onBump }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
      <div className="w-full max-w-sm rounded-2xl p-6 text-center relative" style={{ background: SURFACE, border: "1px solid #24243a" }}>
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-400"><X size={20} /></button>
        <p className="display-font text-white text-xl font-bold">{game.title}</p>
        <p className="text-gray-500 text-xs mt-1 mb-6">Demo rejim — progress avtomatik saqlanadi</p>
        <div className="w-32 h-32 mx-auto rounded-full flex items-center justify-center mb-4" style={{ background: "conic-gradient(#7C5CFC, #00E5C9)" }}>
          <div className="w-28 h-28 rounded-full flex flex-col items-center justify-center" style={{ background: SURFACE }}>
            <span className="text-2xl font-bold text-white display-font">{progress.level}</span>
            <span className="text-[10px] text-gray-500">DARAJA</span>
          </div>
        </div>
        <p className="text-teal-300 text-sm mb-5">{progress.score} ball to'plandi</p>
        <button onClick={() => onBump(10)} className="w-full py-3 rounded-xl font-semibold text-black active:scale-[0.97] transition-transform" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}>Bosib o'ynash (+10 ball)</button>
        <p className="text-gray-600 text-[11px] mt-3">Chiqib, keyinroq qaytsangiz — aynan shu daraja va balldan davom etadi.</p>
      </div>
    </div>
  );
}

// ---------- Chat: public room + a private Claude helper thread ----------
function ChatTab({ messages, currentUser, onSend, showToast }) {
  const [mode, setMode] = useState("public");
  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      <div className="px-4 pt-3 pb-1 flex gap-2">
        <button onClick={() => setMode("public")} className="flex-1 py-2 rounded-lg text-sm font-semibold" style={mode === "public" ? { background: "linear-gradient(135deg,#7C5CFC,#00E5C9)", color: "#000" } : { background: SURFACE, color: "#8A8AA3", border: "1px solid #24243a" }}>Umumiy chat</button>
        <button onClick={() => setMode("claude")} className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5" style={mode === "claude" ? { background: "linear-gradient(135deg,#7C5CFC,#00E5C9)", color: "#000" } : { background: SURFACE, color: "#8A8AA3", border: "1px solid #24243a" }}>
          <Sparkles size={13} /> Claude
        </button>
      </div>
      {mode === "public" ? <PublicChat messages={messages} currentUser={currentUser} onSend={onSend} /> : <ClaudeChat currentUser={currentUser} showToast={showToast} />}
    </div>
  );
}

function PublicChat({ messages, currentUser, onSend }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && <p className="text-center text-gray-600 text-xs mt-10">Hali xabar yo'q. Birinchi bo'lib yozing!</p>}
        {messages.map((m) => {
          const mine = m.email === currentUser.email;
          return (
            <div key={m.id} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
              <Avatar name={m.name} size={26} />
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${mine ? "rounded-br-sm" : "rounded-bl-sm"}`} style={{ background: mine ? "linear-gradient(135deg,#7C5CFC,#00E5C9)" : SURFACE, border: mine ? "none" : "1px solid #24243a" }}>
                {!mine && <p className="text-[11px] font-semibold text-teal-300 mb-0.5">{m.name}</p>}
                <p className={`text-sm ${mine ? "text-black" : "text-white"}`}>{m.text}</p>
                <p className={`text-[10px] mt-0.5 ${mine ? "text-black/60" : "text-gray-600"}`}>{timeAgo(m.time)}</p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; onSend(text); setText(""); }} className="flex items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid #1c1c2c" }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Xabar yozing..." className="flex-1 rounded-full px-4 py-2.5 text-sm text-white outline-none placeholder:text-gray-600" style={{ background: SURFACE, border: "1px solid #24243a" }} />
        <button type="submit" className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}><Send size={16} className="text-black" /></button>
      </form>
    </>
  );
}

function ClaudeChat({ currentUser, showToast }) {
  const [thread, setThread] = useState(null); // null = loading
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const storeKey = `claudechat:${currentUser.email}`;

  useEffect(() => {
    let alive = true;
    safeGet(storeKey, true).then((v) => alive && setThread(v || []));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.email]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [thread?.length, sending]);

  async function persist(next) { setThread(next); await safeSet(storeKey, next.slice(-40), true); }

  async function send() {
    const q = text.trim();
    if (!q || sending || thread === null) return;
    setText("");
    const next = [...thread, { role: "user", content: q }];
    persist(next);
    setSending(true);
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          system: "Siz UzGrems ilovasining yordamchisisiz. Har doim o'zbek tilida javob bering.",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Claude serveri javob bermadi");
      const answer = (data.text || "").trim() || "Kechirasiz, javob bera olmadim. Qayta urinib ko'ring.";
      persist([...next, { role: "assistant", content: answer }]);
    } catch (e) {
      showToast("Claude bilan bog'lanib bo'lmadi", "err");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {thread === null ? (
          <div className="flex justify-center pt-10"><Loader2 className="animate-spin text-violet-400" size={22} /></div>
        ) : thread.length === 0 ? (
          <div className="text-center text-gray-500 text-xs mt-10 px-6">
            <Sparkles size={22} className="mx-auto mb-2 opacity-50" />
            Biror narsani tushunmay qolsangiz shu yerga yozing — masalan "o'yinni qanday yuklab olaman?"
          </div>
        ) : (
          thread.map((m, i) => (
            <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              {m.role === "assistant" ? (
                <div className="w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}><Sparkles size={13} className="text-black" /></div>
              ) : (
                <Avatar name={currentUser.name} src={currentUser.avatar} size={26} />
              )}
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`} style={{ background: m.role === "user" ? "linear-gradient(135deg,#7C5CFC,#00E5C9)" : SURFACE, border: m.role === "user" ? "none" : "1px solid #24243a" }}>
                <p className={`text-sm whitespace-pre-wrap ${m.role === "user" ? "text-black" : "text-white"}`}>{m.content}</p>
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex items-end gap-2">
            <div className="w-[26px] h-[26px] rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}><Sparkles size={13} className="text-black" /></div>
            <div className="rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-gray-500" style={{ background: SURFACE, border: "1px solid #24243a" }}>Claude yozmoqda...</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid #1c1c2c" }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Claude'dan so'rang..." className="flex-1 rounded-full px-4 py-2.5 text-sm text-white outline-none placeholder:text-gray-600" style={{ background: SURFACE, border: "1px solid #24243a" }} />
        <button type="submit" disabled={sending} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}><Send size={16} className="text-black" /></button>
      </form>
    </>
  );
}

function ProfileTab({ currentUser, onUpdateUser, onSetAvatarImage, onSetCoverImage, onLogout, onDeleteAccount, showToast }) {
  const [name, setName] = useState(currentUser.name);
  const [bio, setBio] = useState(currentUser.bio || "");
  const [editing, setEditing] = useState(false);
  const [showPwForm, setShowPwForm] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const avatarInput = useRef(null);
  const coverInput = useRef(null);

  async function handleAvatarFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    await onSetAvatarImage(f);
    setBusy(false);
    e.target.value = "";
  }

  async function handleCoverFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    await onSetCoverImage(f);
    setBusy(false);
    e.target.value = "";
  }

  function saveDetails() { onUpdateUser({ name: name.trim() || currentUser.name, bio }); setEditing(false); }
  async function changePassword() {
    if (newPw.length < 4) { showToast("Yangi parol kamida 4 belgi", "err"); return; }
    try {
      const token = localStorage.getItem("uzgrems_token");
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Parol yangilanmadi");
      setCurPw(""); setNewPw(""); setShowPwForm(false);
      showToast("Parol yangilandi");
    } catch (e) { showToast(e.message || "Parol yangilanmadi", "err"); }
  }

  return (
    <div className="pb-6">
      <div className="relative h-36 w-full" style={{ background: currentUser.cover ? undefined : "linear-gradient(135deg,#7C5CFC55,#00E5C955)" }}>
        {currentUser.cover && <img src={currentUser.cover} className="w-full h-full object-cover" alt="fon" />}
        <button onClick={() => coverInput.current?.click()} disabled={busy} className="absolute bottom-2 right-2 w-8 h-8 rounded-full flex items-center justify-center bg-black/50">
          {busy ? <Loader2 size={14} className="text-white animate-spin" /> : <ImageIcon size={14} className="text-white" />}
        </button>
        <input ref={coverInput} type="file" accept="image/*" className="hidden" onChange={handleCoverFile} />
      </div>
      <div className="px-5 -mt-10 flex items-end gap-3">
        <div className="relative">
          <Avatar src={currentUser.avatar} name={currentUser.name} size={80} ring />
          <button onClick={() => avatarInput.current?.click()} disabled={busy} className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}>
            {busy ? <Loader2 size={12} className="text-black animate-spin" /> : <Camera size={12} className="text-black" />}
          </button>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
        </div>
        {currentUser.isAdmin && <span className="mb-2 px-2 py-1 rounded-full text-[10px] font-bold" style={{ background: "#7C5CFC33", color: "#B8A6FF" }}>ADMIN</span>}
      </div>
      <div className="px-5 mt-3">
        {editing ? (
          <div className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm text-white" style={{ background: SURFACE, border: "1px solid #24243a" }} />
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="O'zingiz haqingizda..." rows={2} className="w-full rounded-lg px-3 py-2 text-sm text-white resize-none" style={{ background: SURFACE, border: "1px solid #24243a" }} />
            <div className="flex gap-2">
              <button onClick={saveDetails} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-black" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}>Saqlash</button>
              <button onClick={() => setEditing(false)} className="px-4 py-1.5 rounded-lg text-xs text-gray-400" style={{ background: SURFACE }}>Bekor qilish</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white font-bold text-lg display-font">{currentUser.name}</p>
              <p className="text-gray-500 text-xs">{currentUser.email}</p>
              {currentUser.bio && <p className="text-gray-400 text-sm mt-1.5">{currentUser.bio}</p>}
            </div>
            <button onClick={() => setEditing(true)} className="text-gray-500"><Pencil size={16} /></button>
          </div>
        )}
      </div>
      <div className="px-5 mt-6 space-y-2">
        {!showPwForm ? (
          <button onClick={() => setShowPwForm(true)} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm text-white" style={{ background: SURFACE, border: "1px solid #24243a" }}>
            <span className="flex items-center gap-2"><Lock size={15} className="text-gray-500" /> Parolni almashtirish</span>
            <ChevronRight size={15} className="text-gray-600" />
          </button>
        ) : (
          <div className="p-4 rounded-xl space-y-2" style={{ background: SURFACE, border: "1px solid #24243a" }}>
            <input value={curPw} onChange={(e) => setCurPw(e.target.value)} type="password" placeholder="Joriy parol" className="w-full rounded-lg px-3 py-2 text-sm text-white" style={{ background: "#0B0B14", border: "1px solid #24243a" }} />
            <input value={newPw} onChange={(e) => setNewPw(e.target.value)} type="password" placeholder="Yangi parol" className="w-full rounded-lg px-3 py-2 text-sm text-white" style={{ background: "#0B0B14", border: "1px solid #24243a" }} />
            <div className="flex gap-2">
              <button onClick={changePassword} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-black" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}>Yangilash</button>
              <button onClick={() => setShowPwForm(false)} className="px-4 py-1.5 rounded-lg text-xs text-gray-400" style={{ background: "#0B0B14" }}>Bekor qilish</button>
            </div>
          </div>
        )}
        <button onClick={onLogout} className="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-white" style={{ background: SURFACE, border: "1px solid #24243a" }}><LogOut size={15} className="text-gray-500" /> Akkauntdan chiqish</button>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-sm" style={{ background: "#2a1420", border: "1px solid #4a1f2e", color: "#FF9DB1" }}><Trash2 size={15} /> Akkauntni butunlay o'chirish</button>
        ) : (
          <div className="p-4 rounded-xl" style={{ background: "#2a1420", border: "1px solid #4a1f2e" }}>
            <p className="text-[#FF9DB1] text-xs mb-3">Bu amalni orqaga qaytarib bo'lmaydi. Ishonchingiz komilmi?</p>
            <div className="flex gap-2">
              <button onClick={onDeleteAccount} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: "#FF5C7A" }}>Ha, o'chirish</button>
              <button onClick={() => setConfirmDelete(false)} className="px-4 py-1.5 rounded-lg text-xs text-gray-300" style={{ background: "#1c1c2c" }}>Bekor qilish</button>
            </div>
          </div>
        )}
      </div>
      <div className="px-5 mt-6 grid grid-cols-3 gap-2">
        {SOCIALS.map(({ key, url, label, Icon }) => (
          <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex flex-col items-center gap-1 py-2.5 rounded-xl text-gray-400" style={{ background: SURFACE, border: "1px solid #24243a" }}>
            <Icon size={16} />
            <span className="text-[10px] truncate w-full text-center px-1">{label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function AdminTab({ users, games, onAddGame, onSetStory, showToast }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [storyGameId, setStoryGameId] = useState("");
  const [storyPreview, setStoryPreview] = useState("");
  const [storyUrl, setStoryUrl] = useState("");
  const [storyType, setStoryType] = useState("image");
  const [busy, setBusy] = useState(false);
  const coverFileInput = useRef(null);
  const gameFileInput = useRef(null);
  const storyFileInput = useRef(null);

  async function handleCoverFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      checkFileSize(f, MAX_IMAGE_BYTES, "Muqova");
      const url = await apiUpload(f, "game-cover");
      setCoverUrl(url);
      showToast("Muqova yuklandi");
    } catch (err) {
      showToast(err.message || "Muqova yuklanmadi", "err");
    }
    setBusy(false);
    e.target.value = "";
  }

  async function handleGameFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      checkFileSize(f, MAX_GAME_BYTES, "O'yin fayli");
      const url = await apiUpload(f, "game");
      setDownloadUrl(url);
      showToast("O'yin fayli serverga yuklandi");
    } catch (err) {
      showToast(err.message || "O'yin fayli yuklanmadi", "err");
    }
    setBusy(false);
    e.target.value = "";
  }

  async function handleStoryFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const isVideo = f.type.startsWith("video");
    setBusy(true);
    try {
      checkFileSize(f, isVideo ? MAX_STORY_VIDEO_BYTES : MAX_IMAGE_BYTES, isVideo ? "Treyler videosi" : "Story rasmi");
      const url = await apiUpload(f, isVideo ? "story-video" : "story-image");
      setStoryUrl(url);
      setStoryPreview(URL.createObjectURL(f));
      setStoryType(isVideo ? "video" : "image");
      showToast("Treyler serverga yuklandi");
    } catch (err) {
      showToast(err.message || "Treyler yuklanmadi", "err");
    }
    setBusy(false);
    e.target.value = "";
  }

  function submitGame() {
    if (!title.trim()) { showToast("Nomini kiriting", "err"); return; }
    if (!downloadUrl) { showToast("O'yin faylini yuklang yoki URL kiriting", "err"); return; }
    onAddGame({ title: title.trim(), desc: desc.trim(), downloadUrl: downloadUrl.trim(), coverUrl });
    setTitle(""); setDesc(""); setCoverUrl(""); setDownloadUrl("");
  }

  function submitStory() {
    if (!storyGameId || !storyUrl) { showToast("O'yin va rasm/video tanlang", "err"); return; }
    onSetStory(storyGameId, storyUrl, storyType);
    setStoryPreview(""); setStoryUrl(""); setStoryGameId("");
  }

  return (
    <div className="p-4 space-y-6">
      <div className="rounded-xl p-4" style={{ background: SURFACE, border: "1px solid #24243a" }}>
        <p className="text-white font-semibold display-font text-lg mb-3 flex items-center gap-2"><PlusCircle size={16} /> O'yin qo'shish</p>
        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O'yin nomi" className="w-full rounded-lg px-3 py-2 text-sm text-white" style={{ background: "#0B0B14", border: "1px solid #24243a" }} />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Tavsif" rows={2} className="w-full rounded-lg px-3 py-2 text-sm text-white resize-none" style={{ background: "#0B0B14", border: "1px solid #24243a" }} />

          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "#0B0B14", border: "1px solid #24243a" }}>
            <LinkIcon size={14} className="text-gray-500 shrink-0" />
            <input value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)} placeholder="Yuklab olish havolasi (URL)" className="bg-transparent outline-none text-sm text-white w-full placeholder:text-gray-600" />
          </div>
          <button onClick={() => gameFileInput.current?.click()} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-gray-400" style={{ background: "#0B0B14", border: "1px dashed #24243a" }}>
            <Upload size={13} /> {downloadUrl ? "O'yin fayli yuklandi ✓" : "Telefondan o'yin faylini yuklash"}
          </button>
          <input ref={gameFileInput} type="file" className="hidden" onChange={handleGameFile} />

          <button onClick={() => coverFileInput.current?.click()} disabled={busy} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-gray-400" style={{ background: "#0B0B14", border: "1px dashed #24243a" }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {coverUrl ? "Muqova yuklandi ✓" : "Muqova rasm yuklash"}
          </button>
          <input ref={coverFileInput} type="file" accept="image/*" className="hidden" onChange={handleCoverFile} />
          <button onClick={submitGame} className="w-full py-2.5 rounded-lg font-semibold text-black text-sm" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}>Qo'shish</button>
        </div>
      </div>

      <div className="rounded-xl p-4" style={{ background: SURFACE, border: "1px solid #24243a" }}>
        <p className="text-white font-semibold display-font text-lg mb-3 flex items-center gap-2"><Film size={16} /> Treyler/Story joylash</p>
        <div className="space-y-2">
          <select value={storyGameId} onChange={(e) => setStoryGameId(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm text-white" style={{ background: "#0B0B14", border: "1px solid #24243a" }}>
            <option value="">O'yinni tanlang</option>
            {games.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
          <button onClick={() => storyFileInput.current?.click()} disabled={busy} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs text-gray-400" style={{ background: "#0B0B14", border: "1px dashed #24243a" }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {storyUrl ? "Treyler yuklandi ✓" : "Telefondan rasm yoki video yuklash"}
          </button>
          <input ref={storyFileInput} type="file" accept="image/*,video/*" className="hidden" onChange={handleStoryFile} />
          <button onClick={submitStory} className="w-full py-2.5 rounded-lg font-semibold text-black text-sm" style={{ background: "linear-gradient(135deg,#7C5CFC,#00E5C9)" }}>Joylash</button>
        </div>
      </div>

      <div className="rounded-xl p-4" style={{ background: SURFACE, border: "1px solid #24243a" }}>
        <p className="text-white font-semibold display-font text-lg mb-3 flex items-center gap-2"><UsersIcon size={16} /> Ro'yxatdan o'tganlar ({users.length})</p>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {users.map((u) => (
            <div key={u.email} className="flex items-center gap-2.5 py-1.5">
              <Avatar name={u.name} size={30} />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{u.name} {u.isAdmin && <span className="text-[10px] text-violet-400 ml-1">ADMIN</span>}</p>
                <p className="text-gray-600 text-xs truncate">{u.email}</p>
              </div>
              <span className="text-gray-600 text-[10px] shrink-0">{timeAgo(u.registeredAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
