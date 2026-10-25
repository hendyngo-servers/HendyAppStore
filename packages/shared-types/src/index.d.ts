export type Platform = "android" | "ios" | "windows" | "macos" | "web";
export type BuildStatus = "queued" | "running" | "success" | "failed" | "cancelled";
export interface AppScreenshot {\n  url: string;\n  caption?: string;\n  position?: number;\n}\nexport interface AppData {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl?: string;
  category?: string;
  visibility: "public" | "private";
  createdAt: string;
  updatedAt: string;
}
export interface ReleaseData {
  id: string;
  appId?: string;
  appName: string;
  version: string;
  platform: Platform;
  filename: string;
  objectKey: string;
  sha256: string;
  size: number;
  publishedAt: string;
  public: boolean;
  signatureStatus: "verified" | "unverified" | "not-required";
  minimumOs?: string;
  releaseNotes?: string;
}
export interface BuildLog {
  id: string;
  runId?: number;
  workflow: string;
  platform: Platform | "matrix";
  status: BuildStatus;
  commitSha?: string;
  startedAt?: string;
  completedAt?: string;
  logUrl?: string;
  errorMessage?: string;
}
export interface SourceFile { path: string; content: string; }
export interface SourceDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  path?: string;
  message: string;
}
