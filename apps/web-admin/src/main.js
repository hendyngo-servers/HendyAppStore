import { mountAdminStudio } from "./App.js";
import { mountAutomationComponents } from "../automation.bundle.js";

const root = document.querySelector("#admin-root");
if (!root) throw new Error("Admin root element was not found.");
mountAdminStudio(root);
mountAutomationComponents();
