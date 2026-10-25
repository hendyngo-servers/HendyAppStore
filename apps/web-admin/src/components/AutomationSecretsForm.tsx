import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CertUploadSecure, type EncodedCertificate } from "./CertUploadSecure";

type FieldKind = "secret" | "variable";
type FieldGroup = "Security & network" | "Automation & webhooks" | "Android signing" | "iOS signing" | "macOS signing" | "Apple account" | "Windows signing";
type Field = { name: string; label: string; kind: FieldKind; group: FieldGroup; hint: string; multiline?: boolean };
type SecretStatus = { name: string; kind: FieldKind; configured: boolean };
type StatusResponse = { success: boolean; statuses?: SecretStatus[]; callbackUrlConfigured?: boolean; requiresToken?: boolean; error?: string };
type Values = Record<string, string>;

export const AUTOMATION_FIELDS: Field[] = [
  { name:"CF_ACCESS_TEAM_DOMAIN", label:"Cloudflare Access team domain", kind:"variable", group:"Security & network", hint:"Tên miền team Cloudflare Access, ví dụ team-name.cloudflareaccess.com." },
  { name:"CF_ACCESS_AUD", label:"Cloudflare Access AUD", kind:"variable", group:"Security & network", hint:"AUD tag bảo vệ Admin/API." },
  { name:"CF_ACCESS_ADMIN_EMAILS", label:"Email quản trị được phép", kind:"variable", group:"Security & network", hint:"Danh sách email phân tách bằng dấu phẩy.", multiline:true },
  { name:"ALLOWED_ORIGINS", label:"CORS allowed origins", kind:"variable", group:"Security & network", hint:"Chỉ dùng origin HTTPS đáng tin cậy; phân tách bằng dấu phẩy.", multiline:true },
  { name:"GITHUB_SYNC_TOKEN", label:"GitHub token dùng cho đồng bộ", kind:"secret", group:"Automation & webhooks", hint:"Fine-grained PAT với Actions read/write, Secrets/Variables write và Contents write theo nhu cầu." },
  { name:"LLM_API_KEY", label:"LLM API key", kind:"secret", group:"Automation & webhooks", hint:"Tùy chọn; không bật AI healing nếu chưa cấu hình." },
  { name:"AUTO_HEAL_ENABLED", label:"Bật tự sửa", kind:"variable", group:"Automation & webhooks", hint:"Chỉ bật sau khi đã cấu hình và rà soát quy tắc self-healing." },
  { name:"SELF_HEAL_WEBHOOK_SECRET", label:"Self-heal webhook HMAC", kind:"secret", group:"Automation & webhooks", hint:"Dùng cùng một secret ở các Worker có liên quan." },
  { name:"DISCORD_WEBHOOK_URL", label:"Discord notification webhook", kind:"secret", group:"Automation & webhooks", hint:"Webhook URL được xử lý như secret để tránh lộ token." },
  { name:"ANDROID_PACKAGE_NAME", label:"Android application ID", kind:"variable", group:"Android signing", hint:"Ví dụ: com.company.product." },
  { name:"ANDROID_KEYSTORE_BASE64", label:"Android keystore Base64", kind:"secret", group:"Android signing", hint:"Dùng CertUploadSecure để mã hóa Base64 trong bộ nhớ trình duyệt." },
  { name:"ANDROID_KEYSTORE_PASSWORD", label:"Android keystore password", kind:"secret", group:"Android signing", hint:"Không commit mật khẩu vào repository." },
  { name:"ANDROID_KEY_ALIAS", label:"Android key alias", kind:"variable", group:"Android signing", hint:"Alias được khai báo trong keystore." },
  { name:"ANDROID_KEY_PASSWORD", label:"Android key password", kind:"secret", group:"Android signing", hint:"Mật khẩu riêng của key alias." },
  { name:"IOS_APP_IDENTIFIER", label:"iOS bundle identifier", kind:"variable", group:"iOS signing", hint:"Phải khớp App ID và provisioning profile." },
  { name:"IOS_CERTIFICATE_P12_BASE64", label:"Apple Distribution P12 Base64", kind:"secret", group:"iOS signing", hint:"Tệp .p12, được giới hạn để phù hợp giới hạn GitHub Actions secret." },
  { name:"IOS_CERTIFICATE_PASSWORD", label:"P12 certificate password", kind:"secret", group:"iOS signing", hint:"Mật khẩu giải mã tệp P12." },
  { name:"IOS_PROVISION_PROFILE_BASE64", label:"iOS provisioning profile Base64", kind:"secret", group:"iOS signing", hint:"Tệp .mobileprovision được mã hóa Base64." },
  { name:"IOS_SIGNING_IDENTITY", label:"iOS signing identity", kind:"variable", group:"iOS signing", hint:"Tên identity có trong keychain sau khi import certificate." },
  { name:"MACOS_CERTIFICATE_P12_BASE64", label:"macOS Developer ID P12 Base64", kind:"secret", group:"macOS signing", hint:"Chứng chỉ ký ứng dụng macOS." },
  { name:"MACOS_CERTIFICATE_PASSWORD", label:"macOS P12 password", kind:"secret", group:"macOS signing", hint:"Mật khẩu giải mã P12." },
  { name:"MACOS_SIGNING_IDENTITY", label:"macOS signing identity", kind:"variable", group:"macOS signing", hint:"Developer ID Application identity." },
  { name:"APPLE_ID", label:"Apple Developer account", kind:"variable", group:"Apple account", hint:"Email dùng cho notarytool khi cần." },
  { name:"APPLE_TEAM_ID", label:"Apple Team ID", kind:"variable", group:"Apple account", hint:"Team ID của Apple Developer Program." },
  { name:"WINDOWS_CERT_PFX_BASE64", label:"Windows code-signing PFX Base64", kind:"secret", group:"Windows signing", hint:"Tệp .pfx được mã hóa Base64." },
  { name:"WINDOWS_CERT_PASSWORD", label:"Windows PFX password", kind:"secret", group:"Windows signing", hint:"Mật khẩu private-key container." }
];
const GROUPS: FieldGroup[] = ["Security & network","Automation & webhooks","Android signing","iOS signing","macOS signing","Apple account","Windows signing"];
const EMPTY_VALUES: Values = { AUTO_HEAL_ENABLED: "false" };

export function AutomationSecretsForm() {
  const [values, setValues] = useState<Values>({ ...EMPTY_VALUES });
  const [statuses, setStatuses] = useState<SecretStatus[]>([]);
  const [callbackUrlConfigured, setCallbackUrlConfigured] = useState(false);
  const [statusAvailable, setStatusAvailable] = useState(false);
  const [message, setMessage] = useState("Secrets được che trên giao diện và không được lưu trong localStorage.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const [certificateResetKey, setCertificateResetKey] = useState(0);

  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.name, s])), [statuses]);
  const refreshStatuses = useCallback(async (token = values.GITHUB_SYNC_TOKEN || "") => {
    setBusy(true);
    setError("");
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (token) headers["x-hendy-github-token"] = token;
      const response = await fetch("/api/admin/github/automation-secrets", { credentials: "include", headers });
      const data = await response.json().catch(() => ({})) as StatusResponse;
      if (!response.ok) throw new Error(data.error || `Status API returned HTTP ${response.status}`);
      setStatuses(data.statuses || []);
      setStatusAvailable(data.statusAvailable !== false);
      setCallbackUrlConfigured(Boolean(data.callbackUrlConfigured));
      setMessage(data.requiresToken
        ? "Nhập GITHUB_SYNC_TOKEN rồi bấm Làm mới trạng thái để đọc metadata GitHub."
        : "Chỉ metadata tên/hiện diện được đọc lại. GitHub không trả về giá trị secrets đã lưu.");
    } catch (e) {
      setStatusAvailable(false);
      setError(e instanceof Error ? e.message : "Không đọc được trạng thái.");
      setMessage("Bạn vẫn có thể nhập values và lưu nếu Access/API đã được cấu hình.");
    } finally { setBusy(false); }
  }, [values.GITHUB_SYNC_TOKEN]);

  useEffect(() => { void refreshStatuses(""); }, []);

  const setField = (name: string, value: string) => setValues((current) => ({ ...current, [name]: value }));
  const acceptCertificate = (cert: EncodedCertificate) => {
    setField(cert.targetName, cert.base64);
    setMessage(`Đã gắn Base64 cho ${cert.targetName} trong bộ nhớ trang. Chưa gửi đi cho tới khi bạn bấm Đồng bộ.`);
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: Values = {};
    for (const field of AUTOMATION_FIELDS) {
      const value = String(values[field.name] ?? "");
      if (value.trim() !== "") payload[field.name] = value;
    }
    if (Object.keys(payload).length === 0) {
      setError("Nhập ít nhất một giá trị; trường trống được hiểu là giữ nguyên cấu hình hiện có.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("Đang mã hóa secrets bằng public key của GitHub và đồng bộ metadata…");
    try {
      const response = await fetch("/api/admin/github/automation-secrets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ values: payload })
      });
      const data = await response.json().catch(() => ({})) as StatusResponse & { updated?: string[]; skipped?: string[] };
      if (!response.ok) throw new Error(data.error || `Sync API returned HTTP ${response.status}`);
      setStatuses(data.statuses || []);
      setCallbackUrlConfigured(Boolean(data.callbackUrlConfigured));
      setStatusAvailable(true);
      setLastSync(new Date().toLocaleString());
      setValues({ ...EMPTY_VALUES });
      setCertificateResetKey((key) => key + 1);
      setMessage(`Đồng bộ xong: ${(data.updated || []).length} mục cập nhật; ${(data.skipped || []).length} mục trống được giữ nguyên. Giá trị secrets không được trả về trình duyệt.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đồng bộ được cấu hình.");
      setMessage("Không có giá trị nào được hiển thị trong log của giao diện. Kiểm tra quyền Actions của token và cấu hình Cloudflare Access.");
    } finally { setBusy(false); }
  }

  return <section className="panel automation-secrets-panel">
    <div className="panel-heading"><div><p className="eyebrow">08 / AUTOMATION ENVIRONMENT</p><h2>26 Secrets & Variables</h2></div><span className="tag">GITHUB API · ENCRYPTED</span></div>
    <p className="panel-hint">Quản lý 26 mục cấu hình. Tên và trạng thái được theo dõi, giá trị secret đã lưu không bao giờ được đọc lại. Trường trống sẽ không ghi đè secret/variable hiện có.</p>
    <div className="automation-summary">
      <span><strong>{AUTOMATION_FIELDS.length}</strong> cấu hình</span>
      <span><strong>{statuses.filter((s) => s.configured).length}</strong> đã tìm thấy</span>
      <button className="button secondary" type="button" onClick={() => void refreshStatuses()} disabled={busy}>Làm mới trạng thái</button>
    </div>
    <div className="automation-notice" role="status">{message}</div>
    {error && <div className="automation-error" role="alert">{error}</div>}
    <div className="callback-status"><span>BUILD_STATUS_WEBHOOK_URL</span><span className={callbackUrlConfigured ? "state-ok" : "state-missing"}>{callbackUrlConfigured ? "Đã cấu hình riêng trong Actions Variables" : "URL callback được tạo sau deploy; cấu hình riêng trong Actions Variables"}</span></div>
    <form onSubmit={submit}>
      {GROUPS.map((group) => <fieldset className="automation-group" key={group}>
        <legend>{group}</legend>
        <div className="automation-fields">
          {AUTOMATION_FIELDS.filter((field) => field.group === group).map((field) => {
            const configured = statusMap.get(field.name)?.configured;
            return <label className="automation-field" key={field.name}>
              <span className="automation-field-heading"><strong>{field.label}</strong><span className={configured ? "state-ok" : statusAvailable ? "state-missing" : "state-unknown"}>{configured ? "Configured" : statusAvailable ? "Missing" : "Unknown"}</span></span>
              <small><code>{field.name}</code> · {field.kind === "secret" ? "GitHub Secret" : "GitHub Variable"}</small>
              {field.name === "AUTO_HEAL_ENABLED" ? <select value={values[field.name] ?? "false"} onChange={(e) => setField(field.name, e.target.value)}><option value="false">false — tắt</option><option value="true">true — bật</option></select>
                : field.multiline ? <textarea rows={2} autoComplete="off" spellCheck={false} value={values[field.name] || ""} onChange={(e) => setField(field.name, e.target.value)} placeholder={field.kind === "secret" ? "Để trống để giữ nguyên" : "Nhập giá trị; để trống để giữ nguyên"} />
                : <input type={field.kind === "secret" ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[field.name] || ""} onChange={(e) => setField(field.name, e.target.value)} placeholder={field.kind === "secret" ? "•••••••• · nhập giá trị mới" : "Nhập giá trị; để trống để giữ nguyên"} />}
              <small className="automation-hint">{field.hint}</small>
            </label>;
          })}
        </div>
      </fieldset>)}
      <div className="automation-actions"><button className="button primary" type="submit" disabled={busy}>{busy ? "Đang đồng bộ…" : "Mã hóa & đồng bộ lên GitHub"}</button><button className="button secondary" type="button" disabled={busy} onClick={() => { setValues({ ...EMPTY_VALUES }); setCertificateResetKey((key) => key + 1); }}>Xóa dữ liệu đang nhập</button><span>{lastSync ? `Lần đồng bộ gần nhất: ${lastSync}` : "Không lưu dữ liệu biểu mẫu vào browser storage."}</span></div>
    </form>
    <CertUploadSecure onEncoded={acceptCertificate} onClear={(name) => setField(name, "")} resetKey={certificateResetKey} disabled={busy} />
  </section>;
}
