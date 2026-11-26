const DEFAULT_STORE_URL = "https://hendy-app-store.pages.dev";
const API_ORIGIN = "https://hendy-app-store-api.internal";
const MAX_UPDATE_BYTES = 256 * 1024;
const APP_LIMIT = 10;
const RELEASE_LIMIT = 10;

const PLATFORM_LABELS = {
  android: "Android",
  windows: "Windows",
  macos: "macOS",
  ios: "iPhone/iPad",
  linux: "Linux",
  web: "Web"
};

const MENU_BUTTONS = [
  ["🛍 Kho ứng dụng", "🔎 Tìm ứng dụng"],
  ["📦 Bản phát hành", "📲 Tải theo nền tảng"],
  ["🌐 Mở Hendy Store", "❔ Trợ giúp"]
];

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

export function buildMainKeyboard() {
  return {
    keyboard: MENU_BUTTONS.map((row) => row.map((text) => ({ text }))),
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "Tìm ứng dụng hoặc chọn chức năng…",
    one_time_keyboard: false
  };
}

export function filterApps(apps, query) {
  const term = String(query || "").trim().toLocaleLowerCase();
  if (!term) return Array.isArray(apps) ? apps : [];
  return (Array.isArray(apps) ? apps : []).filter((app) =>
    [app.name, app.slug, app.description, app.category]
      .map((item) => String(item || "").toLocaleLowerCase())
      .join(" ")
      .includes(term)
  );
}

export function filterReleases(releases, platform = "", query = "") {
  const normalizedPlatform = String(platform || "").toLowerCase();
  const term = String(query || "").trim().toLocaleLowerCase();
  return (Array.isArray(releases) ? releases : []).filter((release) => {
    const itemPlatform = String(release.platform || "").toLowerCase();
    const matchesPlatform = !normalizedPlatform || itemPlatform === normalizedPlatform;
    const searchable = [release.appName, release.name, release.version, release.platform, release.filename, release.releaseNotes]
      .map((item) => String(item || "").toLocaleLowerCase()).join(" ");
    return matchesPlatform && (!term || searchable.includes(term));
  });
}

function storeUrl(env) {
  return safeHttpsUrl(env.PUBLIC_STORE_URL) || DEFAULT_STORE_URL;
}

function inlineUrlButton(text, url) {
  const safe = safeHttpsUrl(url);
  return safe ? { text, url: safe } : null;
}

function mainReplyMarkup(env) {
  return buildMainKeyboard();
}

async function backendJson(env, path) {
  if (!env.BACKEND_API || typeof env.BACKEND_API.fetch !== "function") {
    throw new Error("Backend App Store chưa được kết nối.");
  }
  const response = await env.BACKEND_API.fetch(new Request(API_ORIGIN + path, {
    method: "GET",
    headers: { Accept: "application/json" }
  }));
  if (!response.ok) throw new Error("Backend App Store hiện không sẵn sàng (HTTP " + response.status + ").");
  const payload = await response.json();
  if (!payload || payload.success !== true) throw new Error("Backend App Store trả dữ liệu không hợp lệ.");
  return payload;
}

async function getApps(env) {
  const payload = await backendJson(env, "/api/apps");
  return Array.isArray(payload.apps) ? payload.apps : [];
}

async function getReleases(env) {
  const payload = await backendJson(env, "/api/releases");
  return Array.isArray(payload.releases) ? payload.releases : [];
}

async function telegramApi(env, method, payload) {
  const token = String(env.BOT_TOKEN || "");
  if (!token) throw new Error("Telegram Bot chưa được cấu hình BOT_TOKEN.");
  const endpoint = "https://api.telegram.org/bot" + token + "/" + method;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) {
    throw new Error("Telegram API request failed (" + response.status + ").");
  }
  return result.result;
}

async function sendMessage(env, chatId, text, options = {}) {
  const payload = {
    chat_id: chatId,
    text: String(text || "").slice(0, 4096),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...options
  };
  return telegramApi(env, "sendMessage", payload);
}

async function answerCallback(env, callbackId, text = "") {
  return telegramApi(env, "answerCallbackQuery", {
    callback_query_id: callbackId,
    text: String(text).slice(0, 190),
    show_alert: false
  });
}

function appRows(apps) {
  return apps.slice(0, APP_LIMIT).map((app) => {
    const slug = String(app.slug || "");
    if (!slug || slug.length > 55 || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return null;
    return [{ text: "📱 " + String(app.name || slug).slice(0, 55), callback_data: "app:" + slug }];
  }).filter(Boolean);
}

function releaseRows(releases, limit = RELEASE_LIMIT) {
  return releases.slice(0, limit).map((release) => {
    const url = safeHttpsUrl(release.downloadUrl);
    if (!url) return null;
    const title = [release.appName || release.name || "Ứng dụng", release.version, release.platform]
      .filter(Boolean).join(" · ").slice(0, 60);
    return [{ text: "⬇️ " + title, url }];
  }).filter(Boolean);
}

function appSummary(app) {
  return [
    "<b>" + escapeHtml(app.name || "Ứng dụng") + "</b>",
    app.category ? "Danh mục: " + escapeHtml(app.category) : "",
    app.description ? escapeHtml(app.description).slice(0, 900) : "Chưa có mô tả.",
  ].filter(Boolean).join("\n");
}

function releaseSummary(release) {
  const download = safeHttpsUrl(release.downloadUrl);
  const lines = [
    "<b>" + escapeHtml(release.appName || release.name || "Bản phát hành") + "</b>",
    "Phiên bản: " + escapeHtml(release.version || "—"),
    "Nền tảng: " + escapeHtml(PLATFORM_LABELS[String(release.platform || "").toLowerCase()] || release.platform || "—"),
    release.filename ? "Tệp: <code>" + escapeHtml(release.filename) + "</code>" : "",
    release.sha256 ? "SHA-256: <code>" + escapeHtml(release.sha256) + "</code>" : ""
  ].filter(Boolean);
  if (download) lines.push('<a href="' + escapeHtml(download) + '">Tải bản phát hành</a>');
  return lines.join("\n");
}

async function showMenu(env, chatId, firstName = "") {
  const greeting = firstName ? "Xin chào <b>" + escapeHtml(firstName) + "</b>!\n\n" : "";
  await sendMessage(env, chatId,
    greeting + "<b>HENDY APP STORE</b>\nKho ứng dụng và bản phát hành chính thức.\n\nChọn chức năng bên dưới. Bạn cũng có thể gửi tên ứng dụng để tìm kiếm.",
    { reply_markup: mainReplyMarkup(env) }
  );
}

async function showApps(env, chatId, query = "") {
  const apps = filterApps(await getApps(env), query);
  if (!apps.length) {
    await sendMessage(env, chatId, query
      ? "Không tìm thấy ứng dụng phù hợp với <b>" + escapeHtml(query) + "</b>."
      : "Kho ứng dụng hiện chưa có ứng dụng công khai.");
    return;
  }
  const rows = appRows(apps);
  await sendMessage(env, chatId,
    "<b>" + (query ? "KẾT QUẢ TÌM KIẾM" : "KHO ỨNG DỤNG HENDY") + "</b>\n" +
    "Hiển thị " + Math.min(apps.length, APP_LIMIT) + " trong " + apps.length + " ứng dụng phù hợp. Chọn một ứng dụng để xem thông tin:",
    { reply_markup: { inline_keyboard: [...rows, [inlineUrlButton("🌐 Mở toàn bộ kho ứng dụng", storeUrl(env))].filter(Boolean)] } }
  );
}

async function showReleases(env, chatId, platform = "") {
  const releases = filterReleases(await getReleases(env), platform);
  if (!releases.length) {
    await sendMessage(env, chatId, platform
      ? "Chưa có bản phát hành công khai cho " + escapeHtml(PLATFORM_LABELS[platform] || platform) + "."
      : "Chưa có bản phát hành công khai.");
    return;
  }
  const label = platform ? " · " + (PLATFORM_LABELS[platform] || platform) : "";
  await sendMessage(env, chatId,
    "<b>BẢN PHÁT HÀNH MỚI" + escapeHtml(label.toUpperCase()) + "</b>\n" +
    "Hiển thị " + Math.min(releases.length, RELEASE_LIMIT) + " trong " + releases.length + " bản phát hành. Chọn nút tải tương ứng:",
    { reply_markup: { inline_keyboard: releaseRows(releases), ...{} } }
  );
}

async function showPlatforms(env, chatId) {
  const platforms = ["android", "windows", "macos", "ios", "linux", "web"];
  const rows = [];
  for (let i = 0; i < platforms.length; i += 2) {
    rows.push(platforms.slice(i, i + 2).map((platform) => ({
      text: PLATFORM_LABELS[platform],
      callback_data: "platform:" + platform
    })));
  }
  await sendMessage(env, chatId, "<b>CHỌN NỀN TẢNG</b>\nChọn thiết bị để xem đúng bản phát hành tương thích:", {
    reply_markup: { inline_keyboard: rows }
  });
}

async function showHelp(env, chatId) {
  await sendMessage(env, chatId,
    "<b>HƯỚNG DẪN HENDY APP STORE</b>\n" +
    "• Chọn <b>Kho ứng dụng</b> để duyệt ứng dụng công khai.\n" +
    "• Chọn <b>Tìm ứng dụng</b> hoặc gửi trực tiếp tên ứng dụng.\n" +
    "• Chọn <b>Bản phát hành</b> để xem các gói đã được xuất bản.\n" +
    "• Chọn <b>Tải theo nền tảng</b> để lọc Android, Windows, macOS, iOS, Linux hoặc Web.\n" +
    "• Chỉ các bản phát hành công khai có URL HTTPS hợp lệ mới được hiển thị nút tải.\n\n" +
    "Hỗ trợ: mở Hendy Store để xem thông tin liên hệ được cập nhật."
  );
}

async function showStore(env, chatId) {
  await sendMessage(env, chatId, "<b>HENDY APP STORE</b>\nMở cửa hàng để xem toàn bộ ứng dụng và thông tin phát hành.", {
    reply_markup: { inline_keyboard: [[inlineUrlButton("🌐 Mở Hendy App Store", storeUrl(env))].filter(Boolean)] }
  });
}

async function showStatus(env, chatId) {
  try {
    const [apps, releases] = await Promise.all([getApps(env), getReleases(env)]);
    await sendMessage(env, chatId,
      "<b>TRẠNG THÁI APP STORE</b>\n" +
      "Backend API: <b>Đang hoạt động</b>\n" +
      "Ứng dụng công khai: <b>" + apps.length + "</b>\n" +
      "Bản phát hành công khai: <b>" + releases.length + "</b>"
    );
  } catch {
    await sendMessage(env, chatId, "Backend App Store hiện không phản hồi. Vui lòng thử lại sau.");
  }
}

async function handleCallback(env, callback) {
  const chatId = callback.message?.chat?.id;
  if (!chatId) return;
  const data = String(callback.data || "");
  try {
    if (data.startsWith("app:")) {
      const slug = data.slice(4);
      const apps = await getApps(env);
      const app = apps.find((item) => String(item.slug || "") === slug);
      if (!app) {
        await answerCallback(env, callback.id, "Ứng dụng không còn công khai.");
        return;
      }
      await answerCallback(env, callback.id);
      const keyboard = [[inlineUrlButton("🌐 Mở Hendy Store", storeUrl(env))].filter(Boolean)];
      await sendMessage(env, chatId, appSummary(app), { reply_markup: { inline_keyboard: keyboard } });
      return;
    }
    if (data.startsWith("platform:")) {
      const platform = data.slice(9).toLowerCase();
      if (!Object.hasOwn(PLATFORM_LABELS, platform)) {
        await answerCallback(env, callback.id, "Nền tảng không hợp lệ.");
        return;
      }
      await answerCallback(env, callback.id);
      await showReleases(env, chatId, platform);
      return;
    }
    await answerCallback(env, callback.id, "Lựa chọn không được hỗ trợ.");
  } catch {
    await answerCallback(env, callback.id, "Không tải được dữ liệu. Vui lòng thử lại.");
  }
}

async function handleText(env, message) {
  const chatId = message.chat?.id;
  if (!chatId || typeof message.text !== "string") return;
  const text = message.text.trim();
  const command = text.split(/\s+/, 1)[0].toLowerCase().split("@")[0];
  if (command === "/start" || command === "/menu") {
    await showMenu(env, chatId, message.from?.first_name || "");
    return;
  }
  if (command === "/help" || text === "❔ Trợ giúp") return showHelp(env, chatId);
  if (command === "/apps" || text === "🛍 Kho ứng dụng") return showApps(env, chatId);
  if (command === "/releases" || text === "📦 Bản phát hành") return showReleases(env, chatId);
  if (command === "/platforms" || text === "📲 Tải theo nền tảng") return showPlatforms(env, chatId);
  if (command === "/store" || text === "🌐 Mở Hendy Store") return showStore(env, chatId);
  if (command === "/status" || text === "📡 Trạng thái") return showStatus(env, chatId);
  if (text === "🔎 Tìm ứng dụng") {
    await sendMessage(env, chatId, "Gửi tên ứng dụng, từ khóa hoặc danh mục bạn muốn tìm.");
    return;
  }
  if (text.startsWith("/")) {
    await sendMessage(env, chatId, "Lệnh chưa được hỗ trợ. Gõ /menu để mở menu chính.");
    return;
  }
  if (text.length < 2 || text.length > 100) {
    await sendMessage(env, chatId, "Từ khóa tìm kiếm cần có từ 2 đến 100 ký tự.");
    return;
  }
  await showApps(env, chatId, text);
  const releases = filterReleases(await getReleases(env), "", text);
  if (releases.length) {
    await sendMessage(env, chatId, "<b>BẢN PHÁT HÀNH PHÙ HỢP</b>", {
      reply_markup: { inline_keyboard: releaseRows(releases.slice(0, RELEASE_LIMIT)) }
    });
  }
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ""));
  const b = new TextEncoder().encode(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function handleWebhook(request, env) {
  const secret = String(env.TELEGRAM_WEBHOOK_SECRET || "");
  const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!secret || !constantTimeEqual(supplied, secret)) return json({ success: false, error: "unauthorized" }, 401);
  if (!env.BOT_TOKEN) return json({ success: false, error: "telegram_bot_not_configured" }, 503);

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_UPDATE_BYTES) return json({ success: false, error: "payload_too_large" }, 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_UPDATE_BYTES) return json({ success: false, error: "payload_too_large" }, 413);

  let update;
  try { update = JSON.parse(raw); }
  catch { return json({ success: false, error: "invalid_json" }, 400); }

  try {
    if (update.callback_query) await handleCallback(env, update.callback_query);
    else if (update.message) await handleText(env, update.message);
  } catch (error) {
    // Do not log update contents, chat IDs, bot token or Telegram API URLs.
    console.error("telegram_update_failed", error instanceof Error ? error.message.slice(0, 180) : "unknown_error");
  }
  return json({ success: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/")) {
      return json({
        success: true,
        service: "hendy-app-store-telegram-bot",
        status: env.BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET ? "configured" : "not_configured",
        backendBinding: Boolean(env.BACKEND_API),
        menu: ["Kho ứng dụng", "Tìm ứng dụng", "Bản phát hành", "Tải theo nền tảng", "Mở Hendy Store", "Trợ giúp"]
      });
    }
    if (request.method === "POST" && url.pathname === "/webhook") return handleWebhook(request, env);
    return json({ success: false, error: "not_found" }, 404);
  }
};

function _unusedStoreUrlReference() {
  // Keep safe URL validation exercised as a pure helper in unit tests.
  return safeHttpsUrl(DEFAULT_STORE_URL);
}
