const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
let DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
let DATA_FILE = path.join(DATA_DIR, "store.json");
let UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_TTL = 1000 * 60 * 60 * 24 * 14;
const INVITE_CODE = process.env.INVITE_CODE || "SIDE-TOGETHER";

const sessions = new Map();

function defaultStore() {
  return {
    users: [],
    posts: [],
    comments: [],
    activities: []
  };
}

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (error) {
    if (!process.env.DATA_DIR) throw error;

    const fallbackDir = path.join(__dirname, "data");
    console.warn(`Could not use DATA_DIR=${DATA_DIR}. Falling back to ${fallbackDir}.`);
    console.warn("If this is a production deploy, attach a persistent disk or update DATA_DIR to a writable path.");
    DATA_DIR = fallbackDir;
    DATA_FILE = path.join(DATA_DIR, "store.json");
    UPLOAD_DIR = path.join(DATA_DIR, "uploads");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function readStore() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    const initial = defaultStore();
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    return { ...defaultStore(), ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
  } catch (error) {
    console.error("Could not read data store:", error);
    return defaultStore();
  }
}

let store = readStore();

function saveStore() {
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(store, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const result = {};
  const cookie = req.headers.cookie || "";
  cookie.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index > -1) {
      result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1));
    }
  });
  return result;
}

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.lastSeen = Date.now();
  return store.users.find((user) => user.id === session.userId) || null;
}

function sessionCookie(token, maxAge = Math.floor(SESSION_TTL / 1000)) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL, lastSeen: Date.now() });
  return token;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function passwordMatches(password, user) {
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password, user.passwordSalt).hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    color: user.color,
    createdAt: user.createdAt
  };
}

function addActivity(type, user, detail, targetId = null) {
  store.activities.unshift({
    id: crypto.randomUUID(),
    type,
    userId: user.id,
    userName: user.name,
    detail,
    targetId,
    createdAt: new Date().toISOString()
  });
  store.activities = store.activities.slice(0, 80);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8_000_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { error: "로그인이 필요합니다." });
    return null;
  }
  return user;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function getWorkspacePayload(user) {
  const onlineThreshold = Date.now() - 60_000;
  const onlineUserIds = new Set(
    [...sessions.values()]
      .filter((session) => session.expiresAt >= Date.now() && session.lastSeen >= onlineThreshold)
      .map((session) => session.userId)
  );
  const members = store.users.map((item) => ({ ...safeUser(item), online: onlineUserIds.has(item.id) }));
  const usersById = Object.fromEntries(members.map((item) => [item.id, item]));
  const commentsByPost = {};

  for (const comment of store.comments) {
    const item = { ...comment, author: usersById[comment.userId] };
    (commentsByPost[comment.postId] ||= []).push(item);
  }

  return {
    me: safeUser(user),
    members,
    posts: store.posts
      .map((post) => ({
        ...post,
        author: usersById[post.userId],
        comments: commentsByPost[post.id] || []
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    activities: store.activities.slice(0, 20)
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "POST" && pathname === "/api/auth/register") {
    const body = await readBody(req);
    const name = cleanText(body.name, 30);
    const email = cleanText(body.email, 120).toLowerCase();
    const password = String(body.password || "");
    const inviteCode = cleanText(body.inviteCode, 80);

    if (!name || !email.includes("@") || password.length < 8) {
      return json(res, 400, { error: "이름, 이메일, 8자 이상의 비밀번호를 확인해 주세요." });
    }
    if (inviteCode !== INVITE_CODE) {
      return json(res, 403, { error: "초대 코드가 올바르지 않습니다." });
    }
    if (store.users.some((user) => user.email === email)) {
      return json(res, 409, { error: "이미 가입된 이메일입니다." });
    }

    const passwordData = hashPassword(password);
    const colors = ["#6C63FF", "#13A88A", "#E56B6F", "#D99028", "#5271C4", "#B15DA6"];
    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      color: colors[store.users.length % colors.length],
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    addActivity("join", user, "팀 공간에 합류했습니다.");
    saveStore();
    const token = createSession(user.id);
    return json(res, 201, { user: safeUser(user) }, { "Set-Cookie": sessionCookie(token) });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    const email = cleanText(body.email, 120).toLowerCase();
    const user = store.users.find((item) => item.email === email);
    if (!user || !passwordMatches(String(body.password || ""), user)) {
      return json(res, 401, { error: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }
    const token = createSession(user.id);
    return json(res, 200, { user: safeUser(user) }, { "Set-Cookie": sessionCookie(token) });
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(req).sid;
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
  }

  if (req.method === "GET" && pathname === "/api/workspace") {
    const user = requireAuth(req, res);
    if (!user) return;
    return json(res, 200, getWorkspacePayload(user));
  }

  if (req.method === "POST" && pathname === "/api/uploads") {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readBody(req);
    const match = String(body.data || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(res, 400, { error: "지원하지 않는 이미지 형식입니다." });
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
      return json(res, 400, { error: "이미지는 5MB 이하만 첨부할 수 있습니다." });
    }
    const extensions = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif"
    };
    const filename = `${crypto.randomUUID()}.${extensions[match[1]]}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
    return json(res, 201, { url: `/uploads/${filename}` });
  }

  if (req.method === "POST" && pathname === "/api/posts") {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readBody(req);
    const title = cleanText(body.title, 100);
    const content = cleanText(body.content, 5000);
    const contentBlocks = Array.isArray(body.contentBlocks)
      ? body.contentBlocks
          .slice(0, 60)
          .map((block) => {
            if (block?.type === "text") {
              const text = cleanText(block.text, 5000);
              return text ? { type: "text", text } : null;
            }
            if (block?.type === "image") {
              const url = cleanText(block.url, 200);
              return url.startsWith("/uploads/") ? { type: "image", url } : null;
            }
            return null;
          })
          .filter(Boolean)
      : [];
    const category = ["idea", "question", "decision", "notice"].includes(body.category)
      ? body.category
      : "idea";
    const parentId = cleanText(body.parentId, 80) || null;
    const imageUrl = cleanText(body.imageUrl, 200);
    let parentPost = null;
    if (!title || (!content && !contentBlocks.length)) {
      return json(res, 400, { error: "제목과 내용을 입력해 주세요." });
    }
    if (["question", "decision"].includes(category)) {
      parentPost = store.posts.find((item) => item.id === parentId && item.category === "idea");
      if (!parentPost) return json(res, 400, { error: "질문과 결정은 아이디어에 연결해야 합니다." });
    }

    const now = new Date().toISOString();
    const post = {
      id: crypto.randomUUID(),
      userId: user.id,
      title,
      content,
      contentBlocks,
      category,
      parentId: ["question", "decision"].includes(category) ? parentId : null,
      imageUrl: imageUrl.startsWith("/uploads/") ? imageUrl : null,
      status: "open",
      reactions: [],
      createdAt: now,
      updatedAt: now
    };
    store.posts.unshift(post);
    if (parentPost) parentPost.updatedAt = now;
    const activityLabel =
      category === "question" ? "질문을 연결했습니다." : category === "decision" ? "결정을 기록했습니다." : "글을 작성했습니다.";
    addActivity("post", user, `"${title}" ${activityLabel}`, post.id);
    saveStore();
    return json(res, 201, { post });
  }

  const statusMatch = pathname.match(/^\/api\/posts\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    const post = store.posts.find((item) => item.id === statusMatch[1]);
    if (!post) return json(res, 404, { error: "글을 찾을 수 없습니다." });
    const body = await readBody(req);
    if (!["open", "reviewing", "done"].includes(body.status)) {
      return json(res, 400, { error: "올바르지 않은 상태입니다." });
    }
    post.status = body.status;
    post.updatedAt = new Date().toISOString();
    addActivity("status", user, `"${post.title}" 상태를 변경했습니다.`, post.id);
    saveStore();
    return json(res, 200, { post });
  }

  const updatePostMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (req.method === "PATCH" && updatePostMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    const post = store.posts.find((item) => item.id === updatePostMatch[1]);
    if (!post) return json(res, 404, { error: "글을 찾을 수 없습니다." });
    if (post.userId !== user.id) return json(res, 403, { error: "본인이 작성한 글만 수정할 수 있습니다." });

    const body = await readBody(req);
    const title = cleanText(body.title, 100);
    const content = cleanText(body.content, 5000);
    const contentBlocks = Array.isArray(body.contentBlocks)
      ? body.contentBlocks
          .slice(0, 60)
          .map((block) => {
            if (block?.type === "text") {
              const text = cleanText(block.text, 5000);
              return text ? { type: "text", text } : null;
            }
            if (block?.type === "image") {
              const url = cleanText(block.url, 200);
              return url.startsWith("/uploads/") ? { type: "image", url } : null;
            }
            return null;
          })
          .filter(Boolean)
      : [];
    const parentId = cleanText(body.parentId, 80) || null;
    if (!title || (!content && !contentBlocks.length)) {
      return json(res, 400, { error: "제목과 내용을 입력해 주세요." });
    }
    if (["question", "decision"].includes(post.category)) {
      const parent = store.posts.find((item) => item.id === parentId && item.category === "idea");
      if (!parent) return json(res, 400, { error: "연결할 아이디어를 선택해 주세요." });
      post.parentId = parentId;
      parent.updatedAt = new Date().toISOString();
    }
    post.title = title;
    post.content = content;
    post.contentBlocks = contentBlocks;
    post.updatedAt = new Date().toISOString();
    addActivity("edit", user, `"${title}" 기록을 수정했습니다.`, post.id);
    saveStore();
    return json(res, 200, { post });
  }

  const reactionMatch = pathname.match(/^\/api\/posts\/([^/]+)\/reaction$/);
  if (req.method === "POST" && reactionMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    const post = store.posts.find((item) => item.id === reactionMatch[1]);
    if (!post) return json(res, 404, { error: "글을 찾을 수 없습니다." });
    const index = post.reactions.indexOf(user.id);
    if (index >= 0) post.reactions.splice(index, 1);
    else post.reactions.push(user.id);
    post.updatedAt = new Date().toISOString();
    saveStore();
    return json(res, 200, { reactions: post.reactions });
  }

  const deletePostMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (req.method === "DELETE" && deletePostMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    const post = store.posts.find((item) => item.id === deletePostMatch[1]);
    if (!post) return json(res, 404, { error: "글을 찾을 수 없습니다." });
    if (post.userId !== user.id) return json(res, 403, { error: "본인이 작성한 글만 삭제할 수 있습니다." });

    const deletedIds = new Set([post.id]);
    if (post.category === "idea") {
      store.posts
        .filter((item) => item.parentId === post.id)
        .forEach((item) => deletedIds.add(item.id));
    }
    store.posts = store.posts.filter((item) => !deletedIds.has(item.id));
    store.comments = store.comments.filter((comment) => !deletedIds.has(comment.postId));
    store.activities = store.activities.filter((activity) => !deletedIds.has(activity.targetId));
    addActivity("delete", user, `"${post.title}" 기록을 삭제했습니다.`);
    saveStore();
    return json(res, 200, { ok: true, deletedCount: deletedIds.size });
  }

  const commentMatch = pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
  if (req.method === "POST" && commentMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    const post = store.posts.find((item) => item.id === commentMatch[1]);
    if (!post) return json(res, 404, { error: "글을 찾을 수 없습니다." });
    const body = await readBody(req);
    const content = cleanText(body.content, 2000);
    if (!content) return json(res, 400, { error: "댓글 내용을 입력해 주세요." });
    const comment = {
      id: crypto.randomUUID(),
      postId: post.id,
      userId: user.id,
      content,
      createdAt: new Date().toISOString()
    };
    store.comments.push(comment);
    post.updatedAt = comment.createdAt;
    addActivity("comment", user, `"${post.title}" 글에 의견을 남겼습니다.`, post.id);
    saveStore();
    return json(res, 201, { comment: { ...comment, author: safeUser(user) } });
  }

  const deleteCommentMatch = pathname.match(/^\/api\/comments\/([^/]+)$/);
  if (req.method === "DELETE" && deleteCommentMatch) {
    const user = requireAuth(req, res);
    if (!user) return;
    const comment = store.comments.find((item) => item.id === deleteCommentMatch[1]);
    if (!comment) return json(res, 404, { error: "의견을 찾을 수 없습니다." });
    if (comment.userId !== user.id) {
      return json(res, 403, { error: "본인이 작성한 의견만 삭제할 수 있습니다." });
    }
    store.comments = store.comments.filter((item) => item.id !== comment.id);
    const post = store.posts.find((item) => item.id === comment.postId);
    if (post) post.updatedAt = new Date().toISOString();
    saveStore();
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: "요청한 기능을 찾을 수 없습니다." });
}

function serveStatic(res, pathname) {
  const isUpload = pathname.startsWith("/uploads/");
  const root = isUpload ? UPLOAD_DIR : PUBLIC_DIR;
  const requested = pathname === "/" ? "index.html" : isUpload ? pathname.slice("/uploads/".length) : pathname.slice(1);
  const filePath = path.resolve(root, requested);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const extensions = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif"
    };
    res.writeHead(200, {
      "Content-Type": extensions[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      serveStatic(res, url.pathname);
    }
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "서버에서 문제가 발생했습니다." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ger is running at http://${HOST}:${PORT}`);
  console.log(`Invite code: ${INVITE_CODE}`);
});
