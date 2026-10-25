const SENSITIVE = /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?|secrets?\.json|.*\.(?:pem|key|p12|pfx|keystore|jks|mobileprovision))$/i;
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"];
const DEFAULT_IGNORE = ["node_modules/", "dist/", "coverage/", ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*.keystore", "*.jks"];

export function analyzeProjectFiles(input = [], { repair = false } = {}) {
  const diagnostics = [];
  const repairs = [];
  const files = new Map();
  if (!Array.isArray(input)) throw new Error("files must be an array");
  if (input.length > 100) throw new Error("A request may include at most 100 files.");

  for (const raw of input) {
    if (!raw || typeof raw.path !== "string" || typeof raw.content !== "string") {
      diagnostics.push({ severity: "error", code: "INVALID_FILE", message: "Every file requires a path and text content." });
      continue;
    }
    const path = raw.path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (!path || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === "." || !p)) {
      diagnostics.push({ severity: "error", code: "UNSAFE_PATH", path: raw.path, message: "Absolute paths and path traversal are blocked." });
      continue;
    }
    if (SENSITIVE.test(path)) {
      diagnostics.push({ severity: "error", code: "SENSITIVE_FILE", path, message: "Credentials, environment files, and private-key material must not be uploaded." });
      continue;
    }
    if (BufferSize(raw.content) > 1024 * 1024) {
      diagnostics.push({ severity: "error", code: "FILE_TOO_LARGE", path, message: "Each text file is limited to 1 MiB." });
      continue;
    }
    if (files.has(path)) {
      diagnostics.push({ severity: "warning", code: "DUPLICATE_PATH", path, message: "A later file replaces an earlier file with this path." });
    }
    files.set(path, repair ? raw.content.replace(/\r\n/g, "\n") : raw.content);
  }

  const packagePath = files.has("package.json") ? "package.json" : [...files.keys()].find((p) => p.endsWith("/package.json"));
  if (packagePath) {
    try {
      const pkg = JSON.parse(files.get(packagePath));
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) throw new Error("package.json must be a JSON object");
      const lockCount = LOCKFILES.filter((name) => files.has(name)).length;
      if (lockCount > 1) diagnostics.push({ severity: "warning", code: "MULTIPLE_LOCKFILES", message: "Multiple JS lockfiles are present. Choose one package manager and regenerate its lockfile in CI." });
      if (!pkg.scripts || typeof pkg.scripts !== "object") diagnostics.push({ severity: "warning", code: "NO_SCRIPTS", path: packagePath, message: "No npm scripts were declared; CI may need explicit build/test commands." });
      if (repair) {
        if (!pkg.engines || typeof pkg.engines !== "object") { pkg.engines = {}; repairs.push({ path: packagePath, action: "Added Node.js engine range >=22." }); }
        if (!pkg.engines.node) { pkg.engines.node = ">=22"; repairs.push({ path: packagePath, action: "Declared Node.js >=22 to align the CI runner." }); }
        files.set(packagePath, JSON.stringify(pkg, null, 2) + "\n");
        if (repairs.length) diagnostics.push({ severity: "info", code: "PACKAGE_NORMALIZED", path: packagePath, message: "Manifest normalized using deterministic safe rules." });
      }
    } catch (error) {
      diagnostics.push({ severity: "error", code: "INVALID_PACKAGE_JSON", path: packagePath, message: error.message });
    }
  } else {
    diagnostics.push({ severity: "info", code: "NO_PACKAGE_JSON", message: "No package.json found; this can be expected for a non-Node source project." });
  }

  const sourceLockfiles = LOCKFILES.filter((name) => files.has(name));
  if (sourceLockfiles.length > 1) diagnostics.push({ severity: "warning", code: "LOCKFILE_CONFLICT", message: "Multiple lockfiles can select different dependency graphs. Keep the lockfile for the selected package manager." });

  const ignorePath = files.has(".gitignore") ? ".gitignore" : [...files.keys()].find((p) => p.endsWith("/.gitignore"));
  if (repair) {
    const target = ignorePath || ".gitignore";
    const current = files.get(target) || "";
    const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const missing = DEFAULT_IGNORE.filter((line) => ![...lines].some((item) => item === line));
    if (missing.length) {
      files.set(target, current.trim() ? current.trimEnd() + "\n" + missing.join("\n") + "\n" : missing.join("\n") + "\n");
      repairs.push({ path: target, action: `Added ${missing.length} safe ignore rules for build output and credentials.` });
    }
  } else if (!ignorePath) {
    diagnostics.push({ severity: "warning", code: "MISSING_GITIGNORE", message: "No .gitignore found. Consider ignoring build output and secret files." });
  }

  for (const path of files.keys()) {
    if (/\.github\/workflows\//i.test(path)) diagnostics.push({ severity: "warning", code: "WORKFLOW_CHANGE", path, message: "Review workflow modifications carefully; source sync API blocks workflow edits." });
    if (/(?:eval\s*\(|new Function\s*\()/i.test(files.get(path)) && /\.(?:js|mjs|cjs|ts|tsx)$/.test(path)) diagnostics.push({ severity: "warning", code: "DYNAMIC_CODE", path, message: "Dynamic code execution pattern detected. Review before building or publishing." });
  }

  const resultFiles = [...files.entries()].map(([path, content]) => ({ path, content }));
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  return { success: errors === 0, summary: { files: resultFiles.length, errors, warnings, repairs: repairs.length }, diagnostics, repairs, files: repair ? resultFiles : undefined };
}
function BufferSize(value) { return new TextEncoder().encode(value).byteLength; }

if (typeof process !== "undefined" && process.argv?.[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const repair = process.argv.includes("--repair");
  const report = analyzeProjectFiles([], { repair });
  console.log(JSON.stringify({ mode: repair ? "repair" : "check", ...report }, null, 2));
  if (!report.success) process.exitCode = 1;
}
