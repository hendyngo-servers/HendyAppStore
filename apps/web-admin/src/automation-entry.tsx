import React from "react";
import { createRoot } from "react-dom/client";
import { AutomationSecretsForm } from "./components/AutomationSecretsForm";

export function mountAutomationComponents() {
  const target = document.querySelector("#automation-secrets-root");
  if (!target) return;
  createRoot(target).render(<React.StrictMode><AutomationSecretsForm /></React.StrictMode>);
}
