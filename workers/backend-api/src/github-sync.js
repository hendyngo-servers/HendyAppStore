const API = "https://api.github.com";
const SECRETISH = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?|secrets?\.json|.*\.(?:pem|key|p12|pfx|keystore|jks|mobileprovision))$/i;
const ALLOWED_ROOTS = ["apps/", "workers/", "scripts/", "tests/"];
const ALLOWED_ROOT_FILES = new Set(["README.md", "package.json", "wrangler.toml", ".gitignore"]);

export function validateSyncPath(raw) {
  const path = String(raw || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.length > 240 || path.split("/").some((p) => !p || p === "." || p === "..")) throw new Error("Unsafe project path.");
  if (path.split("/").some((p) => p === ".git" || p === "node_modules" || p === "dist" || p === "coverage")) throw new Error("Generated or internal paths are not allowed.");
  if (path.startsWith(".github/") || path === ".github") throw new Error("Workflow and GitHub control files cannot be changed through the web source uploader.");
  if (SECRETISH.test(path)) throw new Error("Credentials and private-key files cannot be synchronized.");
  if (!ALLOWED_ROOTS.some((root) => path.startsWith(root)) && !ALLOWED_ROOT_FILES.has(path)) throw new Error("Path is outside the allowed source roots.");
  return path;
}
async function githubRequest(path, token, init = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || "GitHub API error";
    const error = new Error(`${message} (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
export async function syncFilesToGitHub(files, env) {
  const owner = String(env.GITHUB_OWNER || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const branch = String(env.GITHUB_BRANCH || "main").trim();
  const token = env.GITHUB_SYNC_TOKEN;
  if (!owner || !repo || !token) throw new Error("GitHub sync is not configured. Set GITHUB_OWNER, GITHUB_REPO and GITHUB_SYNC_TOKEN in Worker settings.");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) throw new Error("Invalid GitHub repository configuration.");
  if (!Array.isArray(files) || files.length === 0 || files.length > 60) throw new Error("Provide between 1 and 60 source files.");
  const normalized = new Map();
  let totalBytes = 0;
  for (const item of files) {
    const path = validateSyncPath(item?.path);
    if (typeof item?.content !== "string") throw new Error(`Missing text content for ${path}.`);
    const size = new TextEncoder().encode(item.content).byteLength;
    if (size > 1024 * 1024) throw new Error(`${path} exceeds 1 MiB.`);
    totalBytes += size;
    normalized.set(path, item.content);
  }
  if (totalBytes > 4 * 1024 * 1024) throw new Error("Combined source payload exceeds 4 MiB.");
  const prefix = `/repos/${owner}/${repo}`;
  const ref = await githubRequest(`${prefix}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`, token);
  const parentSha = ref.object.sha;
  const parentCommit = await githubRequest(`${prefix}/git/commits/${parentSha}`, token);
  const treeEntries = [];
  for (const [path, content] of normalized.entries()) {
    const blob = await githubRequest(`${prefix}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) });
    treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await githubRequest(`${prefix}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: treeEntries })
  });
  const commit = await githubRequest(`${prefix}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({ message: `chore(source-sync): sync ${treeEntries.length} file(s) from Hendy Admin Studio`, tree: tree.sha, parents: [parentSha] })
  });
  await githubRequest(`${prefix}/git/refs/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`, token, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return { commitSha: commit.sha, commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`, fileCount: treeEntries.length, branch };
}
