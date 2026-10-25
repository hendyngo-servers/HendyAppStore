export function detectAdminDevice(width = globalThis.innerWidth ?? 1280, userAgent = globalThis.navigator?.userAgent ?? "") {
  const ua = userAgent.toLowerCase();
  const tablet = /ipad|tablet/.test(ua) || (ua.includes("android") && !ua.includes("mobile"));
  const mobile = !tablet && (/android|iphone|ipod|mobile/.test(ua) || width < 740);
  return { mobile, tablet, desktop: !mobile && !tablet, mode: mobile ? "pocket" : "studio" };
}
