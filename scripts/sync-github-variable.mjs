const token = String(process.env.GITHUB_SYNC_TOKEN || "").trim();
const owner = String(process.env.GITHUB_OWNER || "").trim();
const repo = String(process.env.GITHUB_REPO || "").trim();
const value = String(process.env.BUILD_STATUS_WEBHOOK_URL || "").trim();

if (!token) {
  console.log("::notice::GITHUB_SYNC_TOKEN is not set; derived callback variable was not synced.");
  process.exit(0);
}
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Invalid target repository configuration.");
const endpoint = `https://api.github.com/repos/${owner}/${repo}/actions/variables/BUILD_STATUS_WEBHOOK_URL`;
const headers = {
  Authorization: "Bearer " + token,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json"
};
async function request(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!response.ok) throw new Error("Could not sync derived GitHub Actions variable (HTTP " + response.status + "). Verify Actions:write permission.");
  return response;
}
if (!/^https:\/\//i.test(value)) throw new Error("A valid HTTPS callback URL is required.");
const existing = await fetch(endpoint, { headers });
if (existing.status === 404) {
  await request(`https://api.github.com/repos/${owner}/${repo}/actions/variables`, {
    method: "POST",
    body: JSON.stringify({ name: "BUILD_STATUS_WEBHOOK_URL", value })
  });
} else if (existing.ok) {
  await request(endpoint, { method: "PATCH", body: JSON.stringify({ name: "BUILD_STATUS_WEBHOOK_URL", value }) });
} else {
  throw new Error("Could not inspect existing GitHub Actions variable (HTTP " + existing.status + ").");
}
console.log("Synced the derived build-status callback URL to GitHub Actions Variables.");
