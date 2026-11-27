(() => {
  "use strict";
  const updateYears = () => {
    const year = String(new Date().getFullYear());
    document.querySelectorAll("[data-current-year]").forEach((node) => { node.textContent = year; });
  };
  const markCurrentNavigation = () => {
    const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
    document.querySelectorAll(".site-header nav a, .site-footer a").forEach((link) => {
      try {
        const linkUrl = new URL(link.href, window.location.origin);
        const linkPath = linkUrl.pathname.replace(/\/$/, "") || "/";
        if (linkUrl.origin === window.location.origin && linkPath === currentPath) link.setAttribute("aria-current", "page");
      } catch { /* Ignore malformed links without interrupting page rendering. */ }
    });
  };
  const enhanceAnchorNavigation = () => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (event) => {
        const targetId = link.getAttribute("href")?.slice(1);
        const target = targetId ? document.getElementById(targetId) : null;
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + encodeURIComponent(targetId));
      });
    });
  };
  updateYears();
  markCurrentNavigation();
  enhanceAnchorNavigation();
})();
