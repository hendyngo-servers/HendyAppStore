import { detectAdminDevice } from "./hooks/useDeviceDetect.js";
import { normalizeProjectPath } from "./hooks/useVirtualFileTree.js";
import { codePasteZone } from "./components/CodePasteZone.js";
import { fileUploadZone } from "./components/FileUploadZone.js";
import { fileTreeVisualizer } from "./components/FileTreeVisualizer.js";
import { mobilePocketLayout } from "./layouts/MobileCMSPocketLayout.js";
import { fullDevStudioLayout } from "./layouts/FullDevStudioLayout.js";
import { AuthProvider } from "./providers/AuthProvider.js";
import { buildStatusMonitor, renderBuildRows } from "./components/BuildStatusMonitor.js";
import { storeMetadataForm } from "./components/StoreMetadataForm.js";
import { artifactDraftForm } from "./components/ArtifactDraftForm.js";

const MAX_FILE_BYTES = 1024 * 1024;
const blockedFileName = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?|secrets?\.json|.*\.(?:pem|key|p12|pfx|keystore|jks|mobileprovision))$/i;
const state = { files: new Map(), lastReport: null };
let monacoEditor = null;
let monacoLoading = false;
const authProvider = new AuthProvider();
let aiProposal = null;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $ = (selector) => document.querySelector(selector);

function dashboardContent() {
  return `<div class="workspace-grid">
    <div class="workspace-column">
      <div id="source" class="section-anchor">${codePasteZone()}</div>
      <div id="upload" class="section-anchor">${fileUploadZone()}</div>
      <section id="release" class="panel repair-panel"><div class="panel-heading"><div><p class="eyebrow">03 / SELF-HEALING ENGINE</p><h2>Kiểm tra & sửa cấu hình</h2></div><span class="tag mint">SAFE REPAIR</span></div><p class="panel-hint">Chuẩn hóa JSON, bổ sung ignore an toàn và cảnh báo lockfile/xung đột cấu trúc. Không tự nâng cấp thư viện hoặc chạy mã nguồn được tải lên.</p><div class="button-row"><button id="analyze-btn" class="button secondary">Phân tích mã nguồn</button><button id="repair-btn" class="button primary">Tự sửa cấu hình an toàn</button><button id="ai-repair-btn" class="button secondary">AI đề xuất bản vá</button></div><label class="check-line ai-confirm-line"><input type="checkbox" id="accept-ai-patch"> Tôi đã xem xét bản vá AI và cho phép áp dụng vào danh sách tệp cục bộ.</label><button id="apply-ai-patch" class="button secondary" type="button" disabled>Áp dụng bản vá đã xem xét</button><pre id="diagnostic-output" class="diagnostic-output">Chưa có kết quả phân tích.</pre></section>
      <section class="panel sync-panel"><div class="panel-heading"><div><p class="eyebrow">04 / GITHUB SYNC</p><h2>Đồng bộ mã nguồn</h2></div><span class="tag">COMMIT + CI</span></div><p class="panel-hint">Gửi tệp đã chọn tới GitHub qua Backend API. Token chỉ nằm ở Worker Secret. Push lên nhánh cấu hình sẽ kích hoạt GitHub Actions matrix build.</p><label class="check-line"><input type="checkbox" id="confirm-sync"> Tôi xác nhận các tệp trong cây là nội dung muốn commit lên GitHub.</label><button id="sync-btn" class="button primary wide" disabled>Đồng bộ lên GitHub & chạy CI</button><div id="sync-output" class="sync-output" aria-live="polite">Chưa thực hiện commit.</div></section>
    <div id="build-monitor-anchor">${buildStatusMonitor()}</div>
      ${storeMetadataForm()}
      ${artifactDraftForm()}
    </div>
    <aside class="workspace-sidebar">
      <section id="tree" class="panel tree-panel"><div class="panel-heading"><div><p class="eyebrow">VIRTUAL FILE SYSTEM</p><h2>Cây thư mục</h2></div><span id="file-count" class="count-badge">0</span></div><div id="tree-summary" class="tree-summary">Chưa có tệp</div><div id="file-tree" class="file-tree"><div class="tree-empty">Thêm mã nguồn để dựng cấu trúc thư mục.</div></div><div class="tree-footer"><button id="clear-files" class="text-button">Xóa danh sách cục bộ</button></div></section>
      <section class="panel audit-panel"><p class="eyebrow">RUNTIME STATUS</p><div id="access-status" class="access-status"><i></i><span>Đang kiểm tra quyền truy cập…</span></div><p class="panel-hint">Admin API yêu cầu JWT do Cloudflare Access ký và email nằm trong allow-list.</p><div class="metric-row"><span>Tổng dung lượng</span><strong id="total-size">0 B</strong></div><div class="metric-row"><span>Tệp được nạp</span><strong id="metric-files">0</strong></div><div class="metric-row"><span>Build matrix</span><strong>Win · Android · iOS</strong></div></section>
    </aside>
  </div>`;
}
function setNotice(selector, message, ok = true) {
  const el = $(selector);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", !ok);
  el.classList.toggle("is-success", ok);
}
function bytes(n) { return n < 1024 ? `${n} B` : n < 1024*1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1024/1024).toFixed(2)} MB`; }
function renderTree() {
  const files = [...state.files.entries()].map(([path, content]) => ({path, content}));
  const view = fileTreeVisualizer(files);
  $("#file-tree").innerHTML = view.html || '<div class="tree-empty">Chưa có tệp. Dán mã hoặc tải thư mục.</div>';
  $("#tree-summary").textContent = view.summary;
  $("#file-count").textContent = String(files.length);
  $("#metric-files").textContent = String(files.length);
  $("#total-size").textContent = bytes(files.reduce((sum, f) => sum + new Blob([f.content]).size, 0));
  $("#sync-btn").disabled = !$("#confirm-sync").checked || files.length === 0;
  return files;
}
function addFile(path, content) {
  const normalized = normalizeProjectPath(path);
  if (blockedFileName.test(normalized)) throw new Error("Tệp có vẻ chứa secret hoặc khóa riêng: " + normalized);
  if (typeof content !== "string") throw new Error("Chỉ chấp nhận tệp văn bản.");
  if (new Blob([content]).size > MAX_FILE_BYTES) throw new Error(`Tệp ${normalized} vượt quá 1 MB.`);
  state.files.set(normalized, content);
}
async function loadFiles(fileList) {
  let added = 0, skipped = 0;
  for (const file of fileList) {
    const path = file.webkitRelativePath || file.name;
    try {
      let normalized = normalizeProjectPath(path);
      const allowedRoots = ["apps/","workers/","packages/","scripts/","tests/","android/","windows/","ios/","macos/","automation/"];
      const rootFiles = new Set(["README.md","package.json",".gitignore","wrangler.toml","tsconfig.json"]);
      const parts = normalized.split("/");
      if (parts.length > 1 && !allowedRoots.some((root) => normalized.startsWith(root)) && !rootFiles.has(parts[0]) && (allowedRoots.some((root) => root.startsWith(parts[1] + "/")) || rootFiles.has(parts[1]))) normalized = parts.slice(1).join("/");
      if (blockedFileName.test(normalized) || file.size > MAX_FILE_BYTES) { skipped++; continue; }
      const text = await file.text();
      if (text.includes("\u0000")) { skipped++; continue; }
      const underRoot = allowedRoots.some((root) => normalized.startsWith(root));
      addFile(underRoot || rootFiles.has(normalized) ? normalized : `apps/web-user/uploads/${normalized}`, text);
      added++;
    } catch (error) { skipped++; }
  }
  renderTree();
  $("#upload-result").textContent = `Đã nạp ${added} tệp; bỏ qua ${skipped} tệp không hợp lệ / vượt giới hạn.`;
}
function walkEntry(entry) {
  if (entry.isFile) return new Promise((resolve) => entry.file((file) => resolve([file]), () => resolve([])));
  if (!entry.isDirectory) return Promise.resolve([]);
  const reader = entry.createReader();
  const readAll = async () => {
    const all = [];
    while (true) {
      const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (!batch.length) break;
      all.push(...await Promise.all(batch.map(walkEntry)));
    }
    return all.flat();
  };
  return readAll();
}
function currentSourceCode() {
  return monacoEditor ? monacoEditor.getValue() : $("#source-code").value;
}
function enableMonacoEditor() {
  if (monacoEditor) return;
  if (monacoLoading) return;
  monacoLoading = true;
  const status = $("#editor-status");
  const button = $("#enable-monaco");
  status.textContent = "Đang tải Monaco Editor từ CDN…";
  button.disabled = true;
  const loaderUrl = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js";
  const start = () => {
    if (!window.require?.config) throw new Error("AMD loader của Monaco không sẵn sàng.");
    window.require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" } });
    window.require(["vs/editor/editor.main"], () => {
      const host = $("#monaco-host");
      const textarea = $("#source-code");
      monacoEditor = window.monaco.editor.create(host, {
        value: textarea.value,
        language: "javascript",
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12,
        tabSize: 2,
        wordWrap: "on",
        scrollBeyondLastLine: false,
        accessibilitySupport: "auto"
      });
      textarea.hidden = true;
      host.hidden = false;
      monacoEditor.onDidChangeModelContent(() => {
        const value = monacoEditor.getValue();
        $("#editor-count").textContent = `${value.length.toLocaleString()} ký tự`;
        // Keep textarea synchronized so there's always a plain-text fallback value.
        textarea.value = value;
      });
      status.textContent = "Monaco Editor sẵn sàng · nếu CDN không khả dụng, dùng editor văn bản.";
      button.textContent = "Monaco đã bật";
      button.disabled = true;
      monacoLoading = false;
    }, () => {
      throw new Error("Không tải được module Monaco Editor.");
    });
  };
  if (window.require?.config) {
    try { start(); } catch (error) { monacoLoading = false; button.disabled = false; status.textContent = "Monaco không khả dụng: " + error.message + ". Vẫn có thể dùng editor văn bản."; }
    return;
  }
  let script = document.querySelector('script[data-hendy-monaco-loader="true"]');
  if (!script) {
    script = document.createElement("script");
    script.src = loaderUrl;
    script.async = true;
    script.dataset.hendyMonacoLoader = "true";
    document.head.appendChild(script);
  }
  const timer = setTimeout(() => {
    if (!window.require?.config) {
      monacoLoading = false;
      button.disabled = false;
      status.textContent = "Không kết nối được CDN Monaco. Editor văn bản vẫn dùng được.";
    }
  }, 12000);
  script.addEventListener("load", () => {
    clearTimeout(timer);
    try { start(); } catch (error) {
      monacoLoading = false;
      button.disabled = false;
      status.textContent = "Monaco không khởi tạo được: " + error.message + ". Vẫn có thể dùng editor văn bản.";
    }
  }, { once: true });
  script.addEventListener("error", () => {
    clearTimeout(timer);
    monacoLoading = false;
    button.disabled = false;
    status.textContent = "Không tải được CDN Monaco. Editor văn bản vẫn dùng được.";
  }, { once: true });
}
function bindFileInputs() {
  $("#source-code").addEventListener("input", (e) => { $("#editor-count").textContent = `${e.target.value.length.toLocaleString()} ký tự`; });
  $("#enable-monaco").addEventListener("click", enableMonacoEditor);
  $("#add-source").addEventListener("click", () => {
    try {
      addFile($("#source-path").value, currentSourceCode());
      renderTree(); setNotice("#upload-result", "Đã thêm tệp vào cây thư mục.");
    } catch (error) { setNotice("#upload-result", error.message, false); }
  });
  $("#file-picker").addEventListener("change", (e) => loadFiles([...e.target.files]));
  $("#folder-picker").addEventListener("change", (e) => loadFiles([...e.target.files]));
  const drop = $("#drop-zone");
  for (const name of ["dragenter","dragover"]) drop.addEventListener(name, (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  for (const name of ["dragleave","drop"]) drop.addEventListener(name, (e) => { e.preventDefault(); drop.classList.remove("dragover"); });
  drop.addEventListener("drop", async (e) => {
    const entries = [...(e.dataTransfer?.items || [])].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
    const files = entries.length ? (await Promise.all(entries.map(walkEntry))).flat() : [...(e.dataTransfer?.files || [])];
    await loadFiles(files);
  });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("#file-picker").click(); });
  $("#confirm-sync").addEventListener("change", renderTree);
  $("#clear-files").addEventListener("click", () => { state.files.clear(); $("#source-code").value = ""; if (monacoEditor) monacoEditor.setValue(""); renderTree(); setNotice("#upload-result", "Đã xóa danh sách tệp cục bộ."); });
  $("#analyze-btn").addEventListener("click", () => analyze(false));
  $("#repair-btn").addEventListener("click", () => analyze(true));
  $("#ai-repair-btn").addEventListener("click", requestAiPatch);
  $("#accept-ai-patch").addEventListener("change", () => { $("#apply-ai-patch").disabled = !$("#accept-ai-patch").checked || !aiProposal?.patches?.length; });
  $("#apply-ai-patch").addEventListener("click", applyAiPatch);
  $("#sync-btn").addEventListener("click", syncToGitHub);
  $("#refresh-builds").addEventListener("click", refreshBuilds);
  $("#request-build").addEventListener("click", enqueueBuild);
  $("#metadata-form").addEventListener("submit", saveMetadata);
  $("#artifact-upload-form").addEventListener("submit", uploadArtifactDraft);
  $("#refresh-drafts").addEventListener("click", refreshReleaseDrafts);
}
async function apiRequest(path, options = {}) {
  const response = await fetch(path, { credentials: "include", ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
async function checkAccess() {
  const result = await authProvider.refresh();
  if (result.authenticated) {
    $("#access-status").innerHTML = `<i class="good"></i><span>${esc(result.email || "Admin được xác thực")}</span>`;
  } else {
    $("#access-status").innerHTML = `<i class="bad"></i><span>${esc(result.error.includes("403") ? "Truy cập bị từ chối" : "Cần Cloudflare Access / cấu hình Worker")}</span>`;
  }
}
async function refreshBuilds() {
  const root = $("#build-status-list");
  root.innerHTML = '<div class="tree-empty">Đang đọc GitHub Actions…</div>';
  try {
    const result = await apiRequest("/api/admin/builds");
    root.innerHTML = renderBuildRows(result.builds || []);
  } catch (error) {
    root.innerHTML = `<div class="tree-empty">Không thể đọc trạng thái build: ${esc(error.message)}. Kiểm tra GITHUB_SYNC_TOKEN.</div>`;
  }
}
async function requestAiPatch() {
  const files = renderTree();
  if (!files.length) return setNotice("#diagnostic-output", "Hãy nạp mã nguồn trước khi gọi AI.", false);
  const button = $("#ai-repair-btn"); button.disabled = true;
  setNotice("#diagnostic-output", "AI đang phân tích các chẩn đoán và đề xuất bản vá tối thiểu…");
  try {
    const result = await apiRequest("/api/self-heal/llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files, diagnostics: state.lastReport?.diagnostics || [] }) });
    aiProposal = result;
    $("#apply-ai-patch").disabled = !$("#accept-ai-patch").checked || !result.patches?.length;
    $("#diagnostic-output").textContent = JSON.stringify({ summary: result.summary, patches: (result.patches || []).map(p => ({ path: p.path, rationale: p.rationale, newCharacters: p.content.length, preview: p.content.slice(0, 500) })), note: "Bản vá chưa được áp dụng. Xem xét từng tệp trước khi xác nhận." }, null, 2);
    setNotice("#diagnostic-output", `AI đề xuất ${result.patches?.length || 0} bản vá. Bản vá vẫn cần được kiểm tra trước khi áp dụng.`);
  } catch (error) {
    aiProposal = null;
    setNotice("#diagnostic-output", `AI repair không khả dụng: ${error.message}. Kiểm tra secret LLM_API_KEY và giới hạn tệp.`, false);
  } finally { button.disabled = false; }
}
function applyAiPatch() {
  if (!$("#accept-ai-patch").checked || !aiProposal?.patches?.length) return;
  for (const patch of aiProposal.patches) {
    if (state.files.has(patch.path) && typeof patch.content === "string") state.files.set(patch.path, patch.content);
  }
  renderTree();
  $("#source-code").value = "";
  if (monacoEditor) monacoEditor.setValue("");
  setNotice("#diagnostic-output", "Đã áp dụng các bản vá được xác nhận vào danh sách cục bộ. Hãy rà soát mã, chạy phân tích/test rồi mới đồng bộ GitHub.");
  aiProposal = null;
  $("#apply-ai-patch").disabled = true;
  $("#accept-ai-patch").checked = false;
}
async function enqueueBuild() {
  const button = $("#request-build");
  button.disabled = true;
  setNotice("#build-request-output", "Đang gửi yêu cầu vào Cloudflare Queues…");
  try {
    const result = await apiRequest("/api/build/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: "matrix", sourceRef: "main" }) });
    setNotice("#build-request-output", `Đã tạo yêu cầu Build ${result.build?.id || ""}. Worker sẽ dispatch GitHub Actions.`);
    await refreshBuilds();
  } catch (error) {
    setNotice("#build-request-output", `Không tạo được Build: ${error.message}. Kiểm tra D1, Queues và quyền Actions của GitHub token.`, false);
  } finally { button.disabled = false; }
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}
async function refreshReleaseDrafts() {
  const root = $("#artifact-draft-list");
  if (!root) return;
  root.innerHTML = '<div class="tree-empty">Đang tải bản nháp từ R2…</div>';
  try {
    const result = await apiRequest("/api/admin/releases");
    const releases = Array.isArray(result.releases) ? result.releases : [];
    root.innerHTML = releases.length ? releases.map((item) => {
      const published = item.public === true;
      return `<article class="artifact-draft-row"><div><strong>${esc(item.appName || "Hendy App")} · ${esc(item.version || "—")}</strong><span>${esc(item.platform || "unknown")} · ${esc(item.filename || "")} · ${bytes(Number(item.size || 0))}</span><small>SHA-256: ${esc(item.sha256 || "—")}</small><small>${esc(item.objectKey || "")}</small></div><span class="hendy-pill hendy-pill--${published ? "success" : "warning"}">${published ? "PUBLIC" : "DRAFT"}</span></article>`;
    }).join("") : '<div class="tree-empty">R2 chưa có bản nháp hoặc bản phát hành.</div>';
  } catch (error) {
    root.innerHTML = `<div class="tree-empty">Không đọc được danh sách R2: ${esc(error.message)}.</div>`;
  }
}
async function uploadArtifactDraft(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = $("#artifact-file").files?.[0];
  const button = $("#artifact-upload-button");
  if (!file) return setNotice("#artifact-upload-result", "Hãy chọn tệp binary trước khi tải lên.", false);
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) return setNotice("#artifact-upload-result", "Tệp phải lớn hơn 0 byte và không vượt quá 8 MiB. Tệp lớn hơn hãy dùng matrix build/R2 CLI.", false);
  const ext = "." + file.name.split(".").pop().toLowerCase();
  const platform = String(form.elements.platform.value);
  const extensionMap = { android: [".apk", ".aab"], ios: [".ipa"], windows: [".exe", ".msi", ".msix", ".zip"], macos: [".dmg", ".pkg", ".zip"], web: [".zip"] };
  if (!(extensionMap[platform] || []).includes(ext)) return setNotice("#artifact-upload-result", `Định dạng ${ext} không phù hợp nền tảng ${platform}.`, false);
  button.disabled = true;
  setNotice("#artifact-upload-result", "Đang đọc tệp và tải lên R2 dưới dạng nháp…");
  try {
    const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
    const payload = {
      appName: String(form.elements.appName.value || "").trim(),
      version: String(form.elements.version.value || "").trim(),
      platform,
      description: String(form.elements.description.value || "").trim(),
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      contentBase64,
      publish: false
    };
    const result = await apiRequest("/api/releases/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const release = result.release || {};
    setNotice("#artifact-upload-result", `Đã tải ${release.filename || file.name} lên R2 dưới dạng DRAFT. SHA-256: ${release.sha256 || "không có"}; tệp chưa công khai.`);
    form.reset();
    form.elements.version.value = "1.0.0";
    await refreshReleaseDrafts();
  } catch (error) {
    setNotice("#artifact-upload-result", `Tải lên thất bại: ${error.message}. Kiểm tra Access, R2 binding và giới hạn request.`, false);
  } finally { button.disabled = false; }
}
async function saveMetadata(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  setNotice("#metadata-result", "Đang lưu metadata vào D1…");
  try {
    const result = await apiRequest("/api/admin/apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setNotice("#metadata-result", `Đã lưu ứng dụng ${result.app?.name || payload.name} vào D1.`);
  } catch (error) {
    setNotice("#metadata-result", `Không lưu được metadata: ${error.message}. Kiểm tra D1 binding/schema.`, false);
  } finally { button.disabled = false; }
}

async function analyze(repair) {
  const files = renderTree();
  if (!files.length) return setNotice("#diagnostic-output", "Hãy thêm ít nhất một tệp trước khi phân tích.", false);
  setNotice("#diagnostic-output", repair ? "Đang kiểm tra và áp dụng sửa cấu hình an toàn…" : "Đang phân tích…");
  try {
    const result = await apiRequest("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files, repair }) });
    if (repair && Array.isArray(result.files)) {
      for (const file of result.files) if (file.path && typeof file.content === "string") state.files.set(file.path, file.content);
      renderTree();
    }
    state.lastReport = result;
    $("#diagnostic-output").textContent = JSON.stringify({ summary: result.summary, diagnostics: result.diagnostics, repairs: result.repairs || [] }, null, 2);
    setNotice("#diagnostic-output", repair ? "Hoàn tất sửa cấu hình trong danh sách cục bộ. Hãy rà soát rồi mới commit." : "Phân tích hoàn tất.");
  } catch (error) { setNotice("#diagnostic-output", `Không thể phân tích: ${error.message}`, false); }
}
async function syncToGitHub() {
  const files = renderTree();
  if (!files.length || !$("#confirm-sync").checked) return;
  const button = $("#sync-btn"); button.disabled = true; button.textContent = "Đang đồng bộ…";
  setNotice("#sync-output", "Đang kiểm tra tệp, tạo Git commit và kích hoạt CI…");
  try {
    const result = await apiRequest("/api/github/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
    setNotice("#sync-output", `Đã commit ${result.fileCount} tệp · ${result.commitSha}. GitHub Actions đã được kích hoạt qua push.`);
    if (result.commitUrl) $("#sync-output").innerHTML = `Đã commit <strong>${result.fileCount}</strong> tệp · <code>${esc(result.commitSha)}</code><br><a href="${esc(result.commitUrl)}" rel="noopener noreferrer">Mở commit GitHub ↗</a>`;
  } catch (error) { setNotice("#sync-output", `Đồng bộ thất bại: ${error.message}. Kiểm tra Access, GITHUB_SYNC_TOKEN và quyền Contents: write.`, false); }
  finally { button.textContent = "Đồng bộ lên GitHub & chạy CI"; button.disabled = !$("#confirm-sync").checked || state.files.size === 0; }
}
export function mountAdminStudio(root) {
  const content = dashboardContent();
  const layout = detectAdminDevice().mobile ? mobilePocketLayout(content) : fullDevStudioLayout(content);
  root.innerHTML = layout;
  bindFileInputs();
  renderTree();
  checkAccess();
  refreshBuilds();
  refreshReleaseDrafts();
  window.setInterval(() => { refreshBuilds(); refreshReleaseDrafts(); }, 15000);
  window.addEventListener("resize", () => {
    const next = detectAdminDevice().mobile ? mobilePocketLayout(dashboardContent()) : fullDevStudioLayout(dashboardContent());
    // Avoid discarding active source data when viewport changes; only refresh the mode badge.
    const mode = $("#device-mode"); if (mode) mode.textContent = detectAdminDevice().mode.toUpperCase();
  });
}
