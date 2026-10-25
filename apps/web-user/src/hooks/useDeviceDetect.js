export function detectOperatingSystem(userAgent = "", platform = "", maxTouchPoints = 0) {
  const ua = String(userAgent).toLowerCase();
  const navPlatform = String(platform).toLowerCase();
  if (/iphone|ipad|ipod/.test(ua) || (navPlatform === "macintel" && Number(maxTouchPoints) > 1)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/windows phone|windows nt|win32|win64/.test(ua) || navPlatform.startsWith("win")) return "windows";
  if (/cros/.test(ua)) return "chromeos";
  if (/macintosh|mac os x/.test(ua) || navPlatform.startsWith("mac")) return "macos";
  if (/linux|x11/.test(ua) || navPlatform.includes("linux")) return "linux";
  return "unknown";
}

export function detectDevice(
  userAgent = globalThis.navigator?.userAgent ?? "",
  width = globalThis.innerWidth ?? 1280,
  platform = globalThis.navigator?.platform ?? "",
  maxTouchPoints = globalThis.navigator?.maxTouchPoints ?? 0
) {
  const ua = String(userAgent).toLowerCase();
  const os = detectOperatingSystem(ua, platform, maxTouchPoints);
  const tabletUA = /ipad|tablet/.test(ua) || (ua.includes("android") && !ua.includes("mobile"));
  const mobileUA = /android|iphone|ipod|mobile|windows phone/.test(ua) && !tabletUA;
  const safeWidth = Number.isFinite(Number(width)) ? Number(width) : 1280;
  const isMobile = safeWidth < 720 || mobileUA;
  const isTablet = tabletUA || (!isMobile && safeWidth < 1024);
  const preferredPlatform = ["ios", "android", "windows", "macos"].includes(os) ? os : "web";
  return {
    os,
    preferredPlatform,
    isMobile,
    isTablet,
    isDesktop: !isMobile && !isTablet,
    breakpoint: safeWidth < 480 ? "xs" : safeWidth < 720 ? "sm" : safeWidth < 1024 ? "md" : "lg"
  };
}
