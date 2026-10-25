export class AuthProvider {
  constructor(fetchImpl = fetch) { this.fetchImpl = fetchImpl; this.state = { loading: true, authenticated: false, email: "", error: "" }; this.listeners = new Set(); }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  async refresh() {
    this.state = { ...this.state, loading: true, error: "" }; this.emit();
    try {
      const response = await this.fetchImpl("/api/admin/status", { credentials: "include", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.authenticated !== true) throw new Error(payload.error || "Cloudflare Access authentication is required.");
      this.state = { loading: false, authenticated: true, email: String(payload.email || ""), error: "" };
    } catch (error) {
      this.state = { loading: false, authenticated: false, email: "", error: error instanceof Error ? error.message : "Authentication failed." };
    }
    this.emit(); return this.state;
  }
  emit() { for (const listener of this.listeners) listener(this.state); }
}
