import { buildVirtualFileTree, flattenVirtualTree } from "../hooks/useVirtualFileTree.js";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function draw(node, depth = 0) {
  if (!node.path) return (node.children || []).map(child => draw(child, depth)).join("");
  const icon = node.type === "directory" ? "▸" : "·";
  const size = node.type === "file" ? `<small>${node.size.toLocaleString()} B</small>` : "";
  return `<div class="tree-node ${node.type}" style="--depth:${Math.min(depth,12)}" data-path="${esc(node.path)}"><span class="tree-icon">${icon}</span><span class="tree-name">${esc(node.name)}</span>${size}</div>${node.type === "directory" ? (node.children || []).map(c => draw(c, depth + 1)).join("") : ""}`;
}
export function fileTreeVisualizer(files) {
  const tree = buildVirtualFileTree(files);
  const flat = flattenVirtualTree(tree);
  const summary = `${flat.filter(x => x.type === "file").length} files · ${flat.filter(x => x.type === "directory").length} directories`;
  return { html: draw(tree), summary };
}
