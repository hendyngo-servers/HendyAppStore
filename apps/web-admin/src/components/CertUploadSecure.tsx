import React, { useState } from "react";

export type CertificateTarget =
  | "ANDROID_KEYSTORE_BASE64"
  | "IOS_CERTIFICATE_P12_BASE64"
  | "IOS_PROVISION_PROFILE_BASE64"
  | "MACOS_CERTIFICATE_P12_BASE64"
  | "WINDOWS_CERT_PFX_BASE64";
export type EncodedCertificate = { targetName: CertificateTarget; filename: string; size: number; sha256: string; base64: string };
type Props = { onEncoded: (certificate: EncodedCertificate) => void; onClear: (targetName: CertificateTarget) => void; disabled?: boolean };
const TARGETS: { value: CertificateTarget; label: string; extensions: string[] }[] = [
  { value: "ANDROID_KEYSTORE_BASE64", label: "Android Keystore", extensions: [".jks", ".keystore"] },
  { value: "IOS_CERTIFICATE_P12_BASE64", label: "iOS Distribution Certificate", extensions: [".p12"] },
  { value: "IOS_PROVISION_PROFILE_BASE64", label: "iOS Provisioning Profile", extensions: [".mobileprovision"] },
  { value: "MACOS_CERTIFICATE_P12_BASE64", label: "macOS Developer ID Certificate", extensions: [".p12"] },
  { value: "WINDOWS_CERT_PFX_BASE64", label: "Windows Code Signing PFX", extensions: [".pfx"] }
];
const MAX_FILE_BYTES = 35 * 1024;

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x6000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x6000)));
  }
  return btoa(binary);
}
async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable; use HTTPS and a modern browser.");
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function CertUploadSecure({ onEncoded, onClear, disabled = false }: Props) {
  const [targetName, setTargetName] = useState<CertificateTarget>("ANDROID_KEYSTORE_BASE64");
  const [file, setFile] = useState<File | null>(null);
  const [certificate, setCertificate] = useState<EncodedCertificate | null>(null);
  const [error, setError] = useState("");
  const target = TARGETS.find((item) => item.value === targetName)!;

  async function prepare() {
    setError("");
    setCertificate(null);
    if (!file) { setError("Chọn tệp chứng chỉ trước."); return; }
    const extension = "." + file.name.split(".").pop()!.toLowerCase();
    if (!target.extensions.includes(extension)) { setError(`Tệp không đúng định dạng cho ${target.label}.`); return; }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      setError("Tệp chứng chỉ phải từ 1 byte đến 35 KiB để phù hợp giới hạn 48 KiB của GitHub Actions Secret.");
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const base64 = bytesToBase64(buffer);
      if (base64.length > 48000) throw new Error("Chuỗi Base64 vượt giới hạn an toàn 48.000 ký tự.");
      const fingerprint = await sha256(buffer);
      setCertificate({ targetName, filename: file.name, size: file.size, sha256: fingerprint, base64 });
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể đọc chứng chỉ."); }
  }

  return <section className="cert-upload-secure">
    <div className="panel-heading"><div><p className="eyebrow">CERTIFICATE ENCODER</p><h3>Chứng chỉ → Base64</h3></div><span className="tag">IN-MEMORY ONLY</span></div>
    <p className="panel-hint">Base64 chỉ là mã hóa biểu diễn, không phải mã hóa mật mã. Tệp được đọc trong bộ nhớ trình duyệt; giá trị chỉ gửi tới Worker sau khi bấm Đồng bộ và được Worker mã hóa theo public key GitHub trước khi lưu Secret.</p>
    <div className="certificate-fields">
      <label>Đích lưu GitHub Secret<select value={targetName} disabled={disabled} onChange={(e) => { if (certificate) onClear(certificate.targetName); setTargetName(e.target.value as CertificateTarget); setCertificate(null); setFile(null); setError(""); }}><option value="ANDROID_KEYSTORE_BASE64">ANDROID_KEYSTORE_BASE64 · .jks/.keystore</option><option value="IOS_CERTIFICATE_P12_BASE64">IOS_CERTIFICATE_P12_BASE64 · .p12</option><option value="IOS_PROVISION_PROFILE_BASE64">IOS_PROVISION_PROFILE_BASE64 · .mobileprovision</option><option value="MACOS_CERTIFICATE_P12_BASE64">MACOS_CERTIFICATE_P12_BASE64 · .p12</option><option value="WINDOWS_CERT_PFX_BASE64">WINDOWS_CERT_PFX_BASE64 · .pfx</option></select></label>
      <label className="cert-file-input">Chọn tệp chứng chỉ<input type="file" disabled={disabled} accept={target.extensions.join(",")} onChange={(e) => { setFile(e.target.files?.[0] || null); setCertificate(null); setError(""); }} /></label>
    </div>
    <button type="button" className="button secondary" disabled={disabled || !file} onClick={() => void prepare()}>Kiểm tra & tạo Base64</button>
    {error && <p className="automation-error" role="alert">{error}</p>}
    {certificate && <div className="certificate-result">
      <strong>{certificate.filename} · {(certificate.size / 1024).toFixed(1)} KiB</strong>
      <small>SHA-256: <code>{certificate.sha256}</code></small>
      <small>Base64: {certificate.base64.length.toLocaleString()} ký tự · không hiển thị nội dung chứng chỉ</small>
      <button type="button" className="button primary" disabled={disabled} onClick={() => onEncoded(certificate)}>Gắn Base64 vào {certificate.targetName}</button>
      <button type="button" className="text-button" onClick={() => { onClear(certificate.targetName); setCertificate(null); setFile(null); setError(""); }}>Xóa Base64 khỏi form và bộ nhớ</button>
    </div>}
  </section>;
}
