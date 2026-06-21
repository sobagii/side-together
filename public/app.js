const state = {
  mode: "login",
  data: null,
  view: "idea",
  status: "all",
  search: "",
  sort: "updated",
  presenceTimer: null,
  selectedIdeaId: null,
  detailFilter: "question",
  editingPostId: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const authView = $("#authView");
const appView = $("#appView");
const authForm = $("#authForm");
const postDialog = $("#postDialog");
const detailDialog = $("#detailDialog");
const postForm = $("#postForm");
const postList = $("#postList");
const inlineAttachments = new Map();
const detailAttachments = new Map();
let editorRange = null;
let detailEditorRange = null;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  return payload;
}

function initials(name) {
  return String(name || "?").trim().slice(0, 2).toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function postText(post) {
  if (Array.isArray(post.contentBlocks) && post.contentBlocks.length) {
    return post.contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  return post.content || "";
}

function postImage(post) {
  return (
    post.contentBlocks?.find((block) => block.type === "image")?.url ||
    post.imageUrl ||
    ""
  );
}

function contentMarkup(post) {
  if (!Array.isArray(post.contentBlocks) || !post.contentBlocks.length) {
    return `<p>${escapeHtml(post.content || "")}</p>`;
  }
  return post.contentBlocks
    .map((block) =>
      block.type === "image"
        ? `<img class="inline-content-image" src="${block.url}" alt="" />`
        : `<p>${escapeHtml(block.text)}</p>`
    )
    .join("");
}

function relativeTime(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return "방금 전";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}일 전`;
  return new Intl.DateTimeFormat("ko", { month: "short", day: "numeric" }).format(new Date(dateString));
}

const categoryLabels = {
  idea: "아이디어",
  question: "질문",
  decision: "결정 기록",
  notice: "공지"
};

const viewTitles = {
  idea: "아이디어",
  question: "질문",
  decision: "결정 기록",
  notice: "공지"
};

function setAuthMode(mode) {
  state.mode = mode;
  const registering = mode === "register";
  $("#registerFields").classList.toggle("hidden", !registering);
  $("#authTitle").textContent = "게르에 입장하기";
  $("#authDescription").textContent = registering
    ? "팀에게 받은 초대 코드로 계정을 만드세요."
    : "";
  $("#authSubmit").textContent = registering ? "가입하고 시작하기" : "로그인";
  $("#authToggle").textContent = registering
    ? "이미 계정이 있나요? 로그인하기"
    : "처음이신가요? 초대 코드로 가입하기";
  authForm.elements.password.autocomplete = registering ? "new-password" : "current-password";
}

async function loadWorkspace({ quiet = false } = {}) {
  state.data = await api("/api/workspace");
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  render();
  if (!quiet && !state.presenceTimer) {
    state.presenceTimer = setInterval(() => loadWorkspace({ quiet: true }).catch(() => {}), 20_000);
  }
}

function renderMembers() {
  $("#memberList").innerHTML = state.data.members
    .map(
      (member) => `
        <div class="member">
          <span class="member-avatar-wrap">
            <span class="avatar" style="background:${member.color}">${escapeHtml(initials(member.name))}</span>
            <span class="presence-dot ${member.online ? "online" : ""}"></span>
          </span>
          <span>${escapeHtml(member.name)}</span>
          <small>${member.online ? "접속 중" : "오프라인"}</small>
        </div>`
    )
    .join("");
  $("#myAvatar").style.background = state.data.me.color;
  $("#myAvatar").textContent = initials(state.data.me.name);
  $("#myName").textContent = state.data.me.name;
}

function childrenFor(parentId, category) {
  return state.data.posts.filter((post) => post.parentId === parentId && (!category || post.category === category));
}

function parentIdea(post) {
  return state.data.posts.find((item) => item.id === post.parentId && item.category === "idea");
}

function matchesSearch(post, related = []) {
  const needle = state.search.trim().toLowerCase();
  if (!needle) return true;
  return [post, ...related].some((item) =>
    `${item.title} ${postText(item)} ${item.author?.name || ""}`.toLowerCase().includes(needle)
  );
}

function sortPosts(posts) {
  return posts.sort((a, b) => {
    if (state.sort === "popular") return b.reactions.length - a.reactions.length;
    if (state.sort === "created") return new Date(b.createdAt) - new Date(a.createdAt);
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}

function getVisiblePosts() {
  const category = state.view;
  return sortPosts(
    state.data.posts.filter((post) => {
      if (post.category !== category) return false;
      const related = post.category === "idea" ? childrenFor(post.id) : [];
      const statusMatch = state.status === "all" || post.status === state.status;
      return statusMatch && matchesSearch(post, related);
    })
  );
}

function authorMarkup(post) {
  return `
    <div class="post-author">
      <span class="avatar" style="background:${post.author?.color || "#789"}">${escapeHtml(
        initials(post.author?.name)
      )}</span>
      <div>
        <strong>${escapeHtml(post.author?.name || "알 수 없음")}</strong>
        <small>${relativeTime(post.createdAt)}</small>
      </div>
    </div>`;
}

function commentMarkup(post) {
  const comments = post.comments
    .map(
      (comment) => `
        <div class="comment">
          <span class="avatar" style="background:${comment.author?.color || "#789"}">${escapeHtml(
            initials(comment.author?.name)
          )}</span>
          <div>
            <strong>${escapeHtml(comment.author?.name || "알 수 없음")}</strong>
            <time>${relativeTime(comment.createdAt)}</time>
            ${
              comment.userId === state.data.me.id
                ? `<button class="corner-delete delete-comment" data-comment-id="${comment.id}" type="button" aria-label="의견 삭제">×</button>`
                : ""
            }
            <p>${escapeHtml(comment.content)}</p>
          </div>
        </div>`
    )
    .join("");
  return `
    <div class="comments ${post.comments.length ? "" : "hidden"}">
      ${comments}
      <form class="comment-form">
        <input name="content" maxlength="2000" placeholder="의견을 남겨주세요" required />
        <button type="submit">등록</button>
      </form>
    </div>`;
}

function statusLabel(status) {
  return { open: "논의 중", reviewing: "검토 중", done: "결정 완료" }[status] || "논의 중";
}

function projectCardMarkup(idea, index) {
  const questions = childrenFor(idea.id, "question");
  const decisions = childrenFor(idea.id, "decision");
  const accents = ["forest", "lime", "sun", "violet", "coral", "blue"];
  const liked = idea.reactions.includes(state.data.me.id);
  const coverImage = postImage(idea);
  return `
    <article class="project-card ${accents[index % accents.length]}" data-post-id="${idea.id}">
      ${
        idea.userId === state.data.me.id
          ? '<div class="card-owner-actions"><button class="corner-edit edit-post" type="button" aria-label="게시글 수정">✎</button><button class="corner-delete delete-post" type="button" aria-label="게시글 삭제">×</button></div>'
          : ""
      }
      <div class="project-cover">
        ${coverImage ? `<img src="${coverImage}" alt="" />` : ""}
        <span class="project-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="project-symbol">✦</span>
        <p>${escapeHtml(idea.title)}</p>
      </div>
      <div class="project-body">
        <div class="project-badges">
          <span class="project-badge status-${idea.status}">${statusLabel(idea.status)}</span>
          <span class="project-badge question">질문 ${questions.length}</span>
          <span class="project-badge decision">결정 ${decisions.length}</span>
        </div>
        <h2>${escapeHtml(idea.title)}</h2>
        <p>${escapeHtml(postText(idea))}</p>
        <div class="project-footer">
          ${authorMarkup(idea)}
          <button class="project-like reaction-button ${liked ? "liked" : ""}" type="button">♡ ${
            idea.reactions.length
          }</button>
        </div>
      </div>
    </article>`;
}

function listCardMarkup(post, index = 0) {
  const liked = post.reactions.includes(state.data.me.id);
  const parent = parentIdea(post);
  const cardImage = postImage(post);
  const selected = state.selectedIdeaId === post.id;
  return `
    <article class="post-card category-card ${selected ? "selected-card" : ""}" data-post-id="${post.id}">
      ${
        post.userId === state.data.me.id
          ? '<div class="card-owner-actions"><button class="corner-edit edit-post" type="button" aria-label="게시글 수정">✎</button><button class="corner-delete delete-post" type="button" aria-label="게시글 삭제">×</button></div>'
          : ""
      }
      ${
        cardImage
          ? `<div class="category-card-image"><img src="${cardImage}" alt="" /></div>`
          : `<div class="category-card-image placeholder ${post.category}"><span>${
              post.category === "idea" ? "✦" : post.category === "question" ? "?" : post.category === "decision" ? "✓" : "!"
            }</span></div>`
      }
      <div class="category-card-body">
      <div class="post-meta">
        ${authorMarkup(post)}
        <div class="category-status-row">
          <span class="category ${post.category}">${categoryLabels[post.category]}</span>
          ${
            post.category === "idea"
              ? `<select class="status-select compact-status" aria-label="진행 상태">
                  <option value="open" ${post.status === "open" ? "selected" : ""}>논의 중</option>
                  <option value="reviewing" ${post.status === "reviewing" ? "selected" : ""}>검토 중</option>
                  <option value="done" ${post.status === "done" ? "selected" : ""}>완료</option>
                </select>`
              : ""
          }
        </div>
      </div>
      ${
        parent
          ? `<div class="linked-project"><span>연결된 아이디어</span><strong>${escapeHtml(parent.title)}</strong></div>`
          : ""
      }
      <h2>${escapeHtml(post.title)}</h2>
      <p class="post-content">${escapeHtml(postText(post))}</p>
      <div class="post-actions">
        <button class="post-action reaction-button ${liked ? "liked" : ""}" type="button">
          <span>♡</span> 공감 ${post.reactions.length}
        </button>
        <button class="post-action comment-toggle" type="button">
          <span>◯</span> 의견 ${post.comments.length}
        </button>
        ${
          post.category === "idea"
            ? `<span class="linked-count">질문 ${childrenFor(post.id, "question").length} · 결정 ${
                childrenFor(post.id, "decision").length
              }</span>`
            : ""
        }
      </div>
      ${commentMarkup(post)}
      </div>
    </article>`;
}

function noticeListMarkup(post) {
  const liked = post.reactions.includes(state.data.me.id);
  return `
    <article class="notice-list-item" data-post-id="${post.id}">
      <div class="notice-list-head">
        <button class="notice-toggle" type="button" aria-expanded="false">
          <span class="notice-mark">!</span>
          <span class="notice-title">${escapeHtml(post.title)}</span>
          <span class="notice-meta">${escapeHtml(post.author?.name || "알 수 없음")} · ${relativeTime(
            post.createdAt
          )}</span>
          <span class="notice-chevron">⌄</span>
        </button>
        ${
          post.userId === state.data.me.id
            ? `<div class="notice-owner-actions">
                <button class="corner-edit edit-post" type="button" aria-label="공지 수정">✎</button>
                <button class="corner-delete delete-post" type="button" aria-label="공지 삭제">×</button>
              </div>`
            : ""
        }
      </div>
      <div class="notice-list-body hidden">
        <div class="rich-content">${contentMarkup(post)}</div>
        <div class="post-actions">
          <button class="post-action reaction-button ${liked ? "liked" : ""}" type="button">
            <span>♡</span> 공감 ${post.reactions.length}
          </button>
          <button class="post-action comment-toggle" type="button">
            <span>◯</span> 의견 ${post.comments.length}
          </button>
        </div>
        ${commentMarkup(post)}
      </div>
    </article>`;
}

function renderPosts() {
  parkDetailShell();
  const posts = getVisiblePosts();
  postList.classList.toggle("category-grid", ["idea", "question", "decision"].includes(state.view));
  postList.classList.toggle("idea-grid", state.view === "idea");
  postList.classList.toggle("notice-list", state.view === "notice");
  if (!posts.length) {
    postList.innerHTML = `
      <div class="empty-state">
        <strong>아직 ${viewTitles[state.view]} 기록이 없어요.</strong>
        새 아이디어를 올리고 질문과 결정을 연결해보세요.
      </div>`;
    return;
  }
  postList.innerHTML =
    state.view === "notice" ? posts.map(noticeListMarkup).join("") : posts.map(listCardMarkup).join("");
  if (state.view === "idea" && posts.some((post) => post.id === state.selectedIdeaId)) {
    renderDetail();
    mountInlineDetail();
  }
}

function renderActivities() {
  $("#activityList").innerHTML =
    state.data.activities
      .slice(0, 7)
      .map(
        (activity) => `
          <div class="activity">
            <p><strong>${escapeHtml(activity.userName)}</strong> ${escapeHtml(activity.detail)}</p>
            <time>${relativeTime(activity.createdAt)}</time>
          </div>`
      )
      .join("") || '<p class="muted">아직 활동이 없습니다.</p>';
}

function renderStats() {
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = state.data.posts.filter((post) => new Date(post.createdAt).getTime() >= weekAgo);
  $("#postStat").textContent = recent.filter((post) => post.category === "idea").length;
  $("#commentStat").textContent = recent.filter((post) => post.category === "question").length;
  $("#doneStat").textContent = recent.filter((post) => post.category === "decision").length;
}

function renderViewHeader() {
  $("#workspaceTitle").textContent = viewTitles[state.view];
  const labels = {
    idea: "+ 새 아이디어",
    question: "+ 새 질문",
    decision: "+ 결정 기록",
    notice: "+ 새 공지"
  };
  $("#newPostButton").textContent = labels[state.view];
  $(".feed-toolbar").classList.toggle("hidden", ["question", "decision", "notice"].includes(state.view));
  $(".workspace-grid").classList.toggle("board-wide", state.view !== "idea");
}

function render() {
  renderMembers();
  renderViewHeader();
  renderPosts();
  renderActivities();
  renderStats();
}

function updateParentField() {
  const category = $("#categorySelect").value;
  const needsParent = ["question", "decision"].includes(category);
  $("#parentIdeaField").classList.toggle("hidden", !needsParent);
  $("#parentIdeaSelect").required = needsParent;
}

function rememberEditorRange() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if ($("#postContentEditor").contains(range.commonAncestorContainer)) editorRange = range.cloneRange();
}

function insertEditorImage(file) {
  if (!file?.type.startsWith("image/")) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast("이미지는 5MB 이하만 첨부할 수 있습니다.");
    return;
  }
  const id = crypto.randomUUID();
  inlineAttachments.set(id, file);
  const block = document.createElement("div");
  block.className = "editor-image-block";
  block.dataset.attachmentId = id;
  block.contentEditable = "false";
  block.innerHTML = `
    <img src="${URL.createObjectURL(file)}" alt="본문 첨부 이미지" />
    <button type="button" aria-label="이미지 삭제">×</button>`;

  const editor = $("#postContentEditor");
  editor.focus();
  const selection = window.getSelection();
  const range = editorRange && editor.contains(editorRange.commonAncestorContainer) ? editorRange : document.createRange();
  if (!editorRange || !editor.contains(editorRange.commonAncestorContainer)) range.selectNodeContents(editor);
  if (!editorRange || !editor.contains(editorRange.commonAncestorContainer)) range.collapse(false);
  range.deleteContents();
  range.insertNode(block);
  const spacer = document.createElement("div");
  spacer.innerHTML = "<br>";
  block.after(spacer);
  range.setStart(spacer, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  editorRange = range.cloneRange();
  showToast("본문에 이미지를 넣었습니다.");
}

function insertExistingEditorImage(url) {
  const block = document.createElement("div");
  block.className = "editor-image-block";
  block.dataset.existingUrl = url;
  block.contentEditable = "false";
  block.innerHTML = `
    <img src="${url}" alt="본문 첨부 이미지" />
    <button type="button" aria-label="이미지 삭제">×</button>`;
  $("#postContentEditor").append(block);
}

function collectEditorBlocks(editor) {
  const blocks = [];
  let text = "";
  const flushText = () => {
    const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
    if (cleaned) blocks.push({ type: "text", text: cleaned });
    text = "";
  };
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList.contains("editor-image-block")) {
      flushText();
      blocks.push(
        node.dataset.existingUrl
          ? { type: "image", url: node.dataset.existingUrl }
          : { type: "pending-image", attachmentId: node.dataset.attachmentId }
      );
      return;
    }
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    [...node.childNodes].forEach(walk);
    if (["DIV", "P"].includes(node.tagName)) text += "\n";
  };
  [...editor.childNodes].forEach(walk);
  flushText();
  return blocks;
}

async function uploadEditorBlocks(editor = $("#postContentEditor"), attachments = inlineAttachments) {
  const blocks = collectEditorBlocks(editor);
  const uploaded = [];
  for (const block of blocks) {
    if (block.type === "text" || block.type === "image") {
      uploaded.push(block);
      continue;
    }
    const file = attachments.get(block.attachmentId);
    if (!file) continue;
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
    const result = await api("/api/uploads", { method: "POST", body: JSON.stringify({ data }) });
    uploaded.push({ type: "image", url: result.url });
  }
  return uploaded;
}

function rememberRangeFor(editor, key) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  if (key === "detail") detailEditorRange = range.cloneRange();
  else editorRange = range.cloneRange();
}

function insertImageIntoEditor(file, editor, attachments, rangeKey) {
  if (!file?.type.startsWith("image/")) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast("이미지는 5MB 이하만 첨부할 수 있습니다.");
    return;
  }
  const id = crypto.randomUUID();
  attachments.set(id, file);
  const block = document.createElement("div");
  block.className = "editor-image-block";
  block.dataset.attachmentId = id;
  block.contentEditable = "false";
  block.innerHTML = `
    <img src="${URL.createObjectURL(file)}" alt="본문 첨부 이미지" />
    <button type="button" aria-label="이미지 삭제">×</button>`;
  editor.focus();
  const selection = window.getSelection();
  const savedRange = rangeKey === "detail" ? detailEditorRange : editorRange;
  const range = savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange : document.createRange();
  if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) range.selectNodeContents(editor);
  if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) range.collapse(false);
  range.deleteContents();
  range.insertNode(block);
  const spacer = document.createElement("div");
  spacer.innerHTML = "<br>";
  block.after(spacer);
  range.setStart(spacer, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  if (rangeKey === "detail") detailEditorRange = range.cloneRange();
  else editorRange = range.cloneRange();
  showToast("본문에 이미지를 넣었습니다.");
}

function openPostDialog(category, parentId = "") {
  const ideas = state.data.posts.filter((post) => post.category === "idea");
  if (["question", "decision"].includes(category) && !ideas.length) {
    showToast("먼저 연결할 아이디어를 작성해 주세요.");
    return;
  }
  postForm.reset();
  state.editingPostId = null;
  $("#categorySelect").disabled = false;
  inlineAttachments.clear();
  editorRange = null;
  $("#postContentEditor").innerHTML = "";
  $("#categorySelect").value = category;
  $("#parentIdeaSelect").innerHTML = ideas
    .map((idea) => `<option value="${idea.id}">${escapeHtml(idea.title)}</option>`)
    .join("");
  if (parentId) $("#parentIdeaSelect").value = parentId;
  updateParentField();
  const config = {
    idea: ["새 아이디어 심기", "아이디어를 한 문장으로 적어주세요", "아이디어 올리기"],
    question: ["새 질문 연결", "확인하거나 검증할 질문을 적어주세요", "질문 올리기"],
    decision: ["결정 기록하기", "결정한 내용을 한 문장으로 적어주세요", "결정 기록하기"],
    notice: ["새 공지 작성", "팀이 알아야 할 내용을 요약해 주세요", "공지 올리기"]
  }[category];
  $("#dialogTitle").textContent = config[0];
  $("#postTitleInput").placeholder = config[1];
  $("#postContentEditor").dataset.placeholder =
    category === "question"
      ? "질문의 배경이나 확인할 내용을 적고, 필요한 위치에 이미지를 붙여넣어 주세요."
      : category === "decision"
        ? "결정 내용과 이유를 기록하고, 필요한 위치에 이미지를 붙여넣어 주세요."
        : "왜 필요한지, 어떻게 시작할지 적고, 필요한 위치에 이미지를 붙여넣어 주세요.";
  $("#postSubmitButton").textContent = config[2];
  postDialog.showModal();
}

function openEditDialog(postId) {
  const post = state.data.posts.find((item) => item.id === postId);
  if (!post || post.userId !== state.data.me.id) return;
  const ideas = state.data.posts.filter((item) => item.category === "idea");
  postForm.reset();
  state.editingPostId = post.id;
  inlineAttachments.clear();
  editorRange = null;
  $("#postContentEditor").innerHTML = "";
  $("#categorySelect").value = post.category;
  $("#categorySelect").disabled = true;
  $("#parentIdeaSelect").innerHTML = ideas
    .map((idea) => `<option value="${idea.id}">${escapeHtml(idea.title)}</option>`)
    .join("");
  if (post.parentId) $("#parentIdeaSelect").value = post.parentId;
  updateParentField();
  $("#postTitleInput").value = post.title;
  const blocks =
    Array.isArray(post.contentBlocks) && post.contentBlocks.length
      ? post.contentBlocks
      : [{ type: "text", text: post.content || "" }];
  blocks.forEach((block) => {
    if (block.type === "image") {
      insertExistingEditorImage(block.url);
      return;
    }
    const paragraph = document.createElement("div");
    paragraph.textContent = block.text;
    $("#postContentEditor").append(paragraph);
  });
  $("#dialogTitle").textContent = `${categoryLabels[post.category]} 수정`;
  $("#postSubmitButton").textContent = "수정 저장";
  postDialog.showModal();
}

function renderDetail() {
  const idea = state.data.posts.find((post) => post.id === state.selectedIdeaId && post.category === "idea");
  if (!idea) return;
  const questions = childrenFor(idea.id, "question");
  const decisions = childrenFor(idea.id, "decision");
  const connections = [...questions, ...decisions]
    .filter((item) => item.category === state.detailFilter)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $("#detailTitle").textContent = idea.title;
  $("#detailStatusBadge").textContent = statusLabel(idea.status);
  $("#detailStatusBadge").className = `project-badge status-${idea.status}`;
  $("#detailQuestionTab").textContent = `질문 ${questions.length}`;
  $("#detailDecisionTab").textContent = `결정 기록 ${decisions.length}`;
  $("#detailEditButton").classList.toggle("hidden", idea.userId !== state.data.me.id);
  $("#detailHero").innerHTML = `
    <div class="detail-hero rich">
      <div>
        <div class="rich-content">${contentMarkup(idea)}</div>
      </div>
    </div>`;
  $("#detailConnections").innerHTML =
    connections
      .map(
        (item) => `
          <article class="detail-connection ${item.category}">
            <div>
              <div class="detail-connection-head">
                <span>${categoryLabels[item.category]}</span>
                ${
                  item.userId === state.data.me.id
                    ? `<div class="connection-owner-actions">
                        <button class="corner-edit edit-post" data-post-id="${item.id}" type="button" aria-label="게시글 수정">✎</button>
                        <button class="corner-delete delete-post" data-post-id="${item.id}" type="button" aria-label="게시글 삭제">×</button>
                      </div>`
                    : ""
                }
              </div>
              <h3>${escapeHtml(item.title)}</h3>
              <div class="rich-content">${contentMarkup(item)}</div>
              <small>${escapeHtml(item.author?.name || "")} · ${relativeTime(item.createdAt)}</small>
            </div>
          </article>`
      )
      .join("") ||
    `<div class="empty-state compact"><strong>아직 ${
      state.detailFilter === "question" ? "질문이" : "결정 기록이"
    } 없어요.</strong>${state.detailFilter === "question" ? "첫 질문을 남겨보세요." : "첫 결정을 기록해보세요."}</div>`;
}

function detailShell() {
  return $(".detail-shell");
}

function parkDetailShell() {
  const shell = detailShell();
  if (!shell) return;
  shell.classList.remove("inline-detail-panel");
  if (shell.parentElement !== detailDialog) detailDialog.append(shell);
}

function mountInlineDetail() {
  const shell = detailShell();
  const card = state.selectedIdeaId
    ? postList.querySelector(`[data-post-id="${CSS.escape(state.selectedIdeaId)}"]`)
    : null;
  if (!shell || !card) return;
  const cardTop = card.offsetTop;
  const rowCards = [...postList.querySelectorAll(".post-card.category-card")].filter(
    (item) => Math.abs(item.offsetTop - cardTop) < 8
  );
  const rowEndCard = rowCards[rowCards.length - 1] || card;
  shell.classList.add("inline-detail-panel");
  shell.classList.remove("hidden");
  rowEndCard.insertAdjacentElement("afterend", shell);
}

function closeDetail() {
  closeInlineQuestionForm();
  state.selectedIdeaId = null;
  parkDetailShell();
}

function openDetail(ideaId) {
  state.selectedIdeaId = ideaId;
  state.detailFilter = "question";
  $$(".category-card").forEach((card) => card.classList.toggle("selected-card", card.dataset.postId === ideaId));
  const selectedCard = postList.querySelector(`[data-post-id="${CSS.escape(ideaId)}"]`);
  selectedCard?.classList.remove("card-pulse");
  selectedCard?.offsetWidth;
  selectedCard?.classList.add("card-pulse");
  $$(".detail-tab").forEach((button) =>
    button.classList.toggle("active", button.dataset.detailFilter === "question")
  );
  renderDetail();
  $("#inlineQuestionForm").classList.add("hidden");
  mountInlineDetail();
  detailShell()?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openInlineQuestionForm(category = "question") {
  const form = $("#inlineQuestionForm");
  form.reset();
  detailAttachments.clear();
  detailEditorRange = null;
  $("#inlineContentEditor").innerHTML = "";
  $("#inlineQuestionCategory").value = category;
  updateInlineQuestionCopy();
  form.classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  form.elements.title.focus();
}

function closeInlineQuestionForm() {
  $("#inlineQuestionForm").classList.add("hidden");
  detailAttachments.clear();
  detailEditorRange = null;
  $("#inlineContentEditor").innerHTML = "";
}

function updateInlineQuestionCopy() {
  const decision = $("#inlineQuestionCategory").value === "decision";
  $("#inlineQuestionForm").elements.title.placeholder = decision
    ? "결정한 내용을 한 문장으로 적어주세요"
    : "확인하거나 검증할 질문을 적어주세요";
  $("#inlineContentEditor").dataset.placeholder = decision
    ? "결정 내용과 이유를 기록하고 필요한 위치에 이미지를 넣어주세요."
    : "질문의 배경이나 확인할 내용을 적고 필요한 위치에 이미지를 넣어주세요.";
  $("#inlineQuestionSubmit").textContent = decision ? "결정 기록" : "질문 등록";
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api(`/api/auth/${state.mode}`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(authForm)))
    });
    authForm.reset();
    await loadWorkspace();
    showToast(state.mode === "register" ? "팀 공간에 합류했습니다." : "다시 만나 반가워요.");
  } catch (error) {
    showToast(error.message);
  }
});

$("#authToggle").addEventListener("click", () => setAuthMode(state.mode === "login" ? "register" : "login"));

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  clearInterval(state.presenceTimer);
  state.presenceTimer = null;
  state.data = null;
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
  setAuthMode("login");
});

$("#newPostButton").addEventListener("click", () => openPostDialog(state.view));
$("#categorySelect").addEventListener("change", updateParentField);

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    postDialog.close();
    return;
  }
  const formData = new FormData(postForm);
  const editingPost = state.editingPostId
    ? state.data.posts.find((item) => item.id === state.editingPostId)
    : null;
  const body = {
    category: editingPost?.category || formData.get("category"),
    parentId: formData.get("parentId"),
    title: formData.get("title"),
    content: ""
  };
  try {
    body.contentBlocks = await uploadEditorBlocks();
    body.content = body.contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (!body.contentBlocks.length) throw new Error("내용을 입력해 주세요.");
    await api(editingPost ? `/api/posts/${editingPost.id}` : "/api/posts", {
      method: editingPost ? "PATCH" : "POST",
      body: JSON.stringify(body)
    });
    postDialog.close();
    await loadWorkspace({ quiet: true });
    showToast(editingPost ? "기록을 수정했습니다." : `${categoryLabels[body.category]} 기록을 올렸습니다.`);
  } catch (error) {
    showToast(error.message);
  }
});

postList.addEventListener("click", async (event) => {
  const card = event.target.closest("[data-post-id]");
  if (!card) return;
  const noticeToggle = event.target.closest(".notice-toggle");
  if (noticeToggle) {
    const body = $(".notice-list-body", card);
    const expanded = noticeToggle.getAttribute("aria-expanded") === "true";
    noticeToggle.setAttribute("aria-expanded", String(!expanded));
    body.classList.toggle("hidden", expanded);
    card.classList.toggle("expanded", !expanded);
    return;
  }
  if (event.target.closest(".edit-post")) {
    openEditDialog(card.dataset.postId);
    return;
  }
  if (event.target.closest(".delete-post")) {
    await deletePost(card.dataset.postId);
    return;
  }
  const deleteCommentButton = event.target.closest(".delete-comment");
  if (deleteCommentButton) {
    await deleteComment(deleteCommentButton.dataset.commentId);
    return;
  }
  if (
    !event.target.closest("button, select, input, form") &&
    state.view === "idea"
  ) {
    openDetail(card.dataset.postId);
    return;
  }
  if (event.target.closest(".comment-toggle")) $(".comments", card).classList.toggle("hidden");
  if (event.target.closest(".reaction-button")) {
    try {
      await api(`/api/posts/${card.dataset.postId}/reaction`, { method: "POST" });
      await loadWorkspace({ quiet: true });
    } catch (error) {
      showToast(error.message);
    }
  }
});

async function deletePost(postId) {
  const post = state.data.posts.find((item) => item.id === postId);
  if (!post) return;
  const linkedCount = post.category === "idea" ? childrenFor(post.id).length : 0;
  const message =
    linkedCount > 0
      ? `"${post.title}"과 연결된 질문·결정 ${linkedCount}개도 함께 삭제됩니다. 계속할까요?`
      : `"${post.title}" 기록을 삭제할까요?`;
  if (!window.confirm(message)) return;
  try {
    await api(`/api/posts/${postId}`, { method: "DELETE" });
    if (state.selectedIdeaId === postId) closeDetail();
    await loadWorkspace({ quiet: true });
    showToast("기록을 삭제했습니다.");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteComment(commentId) {
  if (!window.confirm("이 의견을 삭제할까요?")) return;
  try {
    await api(`/api/comments/${commentId}`, { method: "DELETE" });
    await loadWorkspace({ quiet: true });
    showToast("의견을 삭제했습니다.");
  } catch (error) {
    showToast(error.message);
  }
}

$("#imageInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) insertEditorImage(file);
  event.target.value = "";
});

$("#insertImageButton").addEventListener("mousedown", rememberEditorRange);
$("#insertImageButton").addEventListener("click", () => $("#imageInput").click());

$("#postContentEditor").addEventListener("keyup", rememberEditorRange);
$("#postContentEditor").addEventListener("mouseup", rememberEditorRange);
$("#postContentEditor").addEventListener("focus", rememberEditorRange);
$("#postContentEditor").addEventListener("click", (event) => {
  const removeButton = event.target.closest(".editor-image-block button");
  if (!removeButton) return;
  const block = removeButton.closest(".editor-image-block");
  inlineAttachments.delete(block.dataset.attachmentId);
  block.remove();
});

$("#postContentEditor").addEventListener("paste", (event) => {
  const imageItem = [...event.clipboardData.items].find(
    (item) => item.kind === "file" && item.type.startsWith("image/")
  );
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  event.preventDefault();
  rememberEditorRange();
  insertEditorImage(new File([file], `screenshot-${Date.now()}.${file.type.split("/")[1] || "png"}`, {
    type: file.type
  }));
});

$("#detailCloseButton").addEventListener("click", closeDetail);
$("#detailEditButton").addEventListener("click", () => {
  const ideaId = state.selectedIdeaId;
  closeDetail();
  openEditDialog(ideaId);
});
$("#detailQuestionButton").addEventListener("click", () => {
  openInlineQuestionForm("question");
});
$("#detailDecisionButton").addEventListener("click", () => {
  openInlineQuestionForm("decision");
});

$("#inlineQuestionClose").addEventListener("click", closeInlineQuestionForm);
$("#inlineQuestionCancel").addEventListener("click", closeInlineQuestionForm);
$("#inlineQuestionCategory").addEventListener("change", updateInlineQuestionCopy);

$("#inlineQuestionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const body = {
    category: formData.get("category"),
    parentId: state.selectedIdeaId,
    title: formData.get("title"),
    content: ""
  };
  try {
    body.contentBlocks = await uploadEditorBlocks($("#inlineContentEditor"), detailAttachments);
    body.content = body.contentBlocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (!body.contentBlocks.length) throw new Error("내용을 입력해 주세요.");
    await api("/api/posts", { method: "POST", body: JSON.stringify(body) });
    await loadWorkspace({ quiet: true });
    state.detailFilter = body.category;
    $$(".detail-tab").forEach((button) =>
      button.classList.toggle("active", button.dataset.detailFilter === body.category)
    );
    closeInlineQuestionForm();
    renderDetail();
    showToast(`${categoryLabels[body.category]} 기록을 올렸습니다.`);
  } catch (error) {
    showToast(error.message);
  }
});

$("#inlineInsertImageButton").addEventListener("mousedown", () =>
  rememberRangeFor($("#inlineContentEditor"), "detail")
);
$("#inlineInsertImageButton").addEventListener("click", () => $("#inlineImageInput").click());
$("#inlineImageInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) insertImageIntoEditor(file, $("#inlineContentEditor"), detailAttachments, "detail");
  event.target.value = "";
});

["keyup", "mouseup", "focus"].forEach((eventName) => {
  $("#inlineContentEditor").addEventListener(eventName, () =>
    rememberRangeFor($("#inlineContentEditor"), "detail")
  );
});

$("#inlineContentEditor").addEventListener("click", (event) => {
  const removeButton = event.target.closest(".editor-image-block button");
  if (!removeButton) return;
  const block = removeButton.closest(".editor-image-block");
  detailAttachments.delete(block.dataset.attachmentId);
  block.remove();
});

$("#inlineContentEditor").addEventListener("paste", (event) => {
  const imageItem = [...event.clipboardData.items].find(
    (item) => item.kind === "file" && item.type.startsWith("image/")
  );
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  event.preventDefault();
  rememberRangeFor($("#inlineContentEditor"), "detail");
  insertImageIntoEditor(
    new File([file], `screenshot-${Date.now()}.${file.type.split("/")[1] || "png"}`, { type: file.type }),
    $("#inlineContentEditor"),
    detailAttachments,
    "detail"
  );
});

$$(".detail-tab").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".detail-tab").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.detailFilter = button.dataset.detailFilter;
    renderDetail();
  });
});

$("#detailConnections").addEventListener("click", async (event) => {
  event.stopPropagation();
  const editButton = event.target.closest(".edit-post");
  if (editButton) {
    closeDetail();
    openEditDialog(editButton.dataset.postId);
    return;
  }
  const button = event.target.closest(".delete-post");
  if (!button) return;
  await deletePost(button.dataset.postId);
  if (state.selectedIdeaId) renderDetail();
});

postList.addEventListener("change", async (event) => {
  if (!event.target.matches(".status-select")) return;
  const card = event.target.closest("[data-post-id]");
  try {
    await api(`/api/posts/${card.dataset.postId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: event.target.value })
    });
    await loadWorkspace({ quiet: true });
    showToast("아이디어 상태를 변경했습니다.");
  } catch (error) {
    showToast(error.message);
  }
});

postList.addEventListener("submit", async (event) => {
  if (!event.target.matches(".comment-form")) return;
  event.preventDefault();
  const card = event.target.closest("[data-post-id]");
  try {
    await api(`/api/posts/${card.dataset.postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: new FormData(event.target).get("content") })
    });
    await loadWorkspace({ quiet: true });
    $(".comments", $(`[data-post-id="${card.dataset.postId}"]`))?.classList.remove("hidden");
  } catch (error) {
    showToast(error.message);
  }
});

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".nav-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.view = button.dataset.view;
    state.status = "all";
    $$(".chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.status === "all"));
    renderViewHeader();
    renderPosts();
  });
});

$$(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".chip").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.status = button.dataset.status;
    renderPosts();
  });
});

$("#searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderPosts();
});

$("#sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderPosts();
});

loadWorkspace().catch(() => {
  authView.classList.remove("hidden");
  appView.classList.add("hidden");
});
