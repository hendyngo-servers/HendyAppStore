const BLOCKED = /^(?:\.git|node_modules|\.next|dist|coverage|\.turbo)$/i;
const BAD_PATH = /(^|\\)\.\.(?:\\|$)|^\/|^[a-z]:/i;
export function normalizeProjectPath(input) {
  const path = String(input ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || BAD_PATH.test(path) || path.split("/").some((part) => !part || part === "." || part === ".." || BLOCKED.test(part))) throw new Error("Đường dẫn tệp không hợp lệ hoặc thuộc thư mục bị chặn.");
  if (path.length > 240) throw new Error("Đường dẫn tệp vượt quá 240 ký tự.");
  return path;
}
export function buildVirtualFileTree(files = []) {
  const root = { name: ".", path: "", type: "directory", children: new Map() };
  for (const file of files) {
    let normalized;
    try { normalized = normalizeProjectPath(file.path); } catch { continue; }
    let node = root; const parts = normalized.split("/");
    parts.forEach((part, i) => {
      if (!node.children.has(part)) node.children.set(part, { name: part, path: parts.slice(0, i + 1).join("/"), type: i === parts.length - 1 ? "file" : "directory", children: new Map(), size: i === parts.length - 1 ? (file.content || "").length : 0 });
      node = node.children.get(part);
      if (i === parts.length - 1) { node.type = "file"; node.size = (file.content || "").length; }
    });
  }
  const serialize = (node) => ({ name: node.name, path: node.path, type: node.type, size: node.size || 0, children: [...node.children.values()].sort((a,b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1).map(serialize) });
  return serialize(root);
}
export function flattenVirtualTree(node, out = []) {
  if (node.path) out.push({ path: node.path, type: node.type, size: node.size || 0 });
  for (const child of node.children || []) flattenVirtualTree(child, out);
  return out;
}
