export function detectDevice(userAgent = globalThis.navigator?.userAgent ?? "", width = globalThis.innerWidth ?? 1280) {
  const ua = String(userAgent).toLowerCase();
  const mobileUA = /android|iphone|ipad|ipod|mobile|windows phone/.test(ua);
  const isTablet = /ipad|tablet/.test(ua) || (ua.includes("android") && !ua.includes("mobile"));
  const isMobile = !isTablet && (mobileUA || width < 720);
  return { isMobile, isTablet, isDesktop: !isMobile && !isTablet, breakpoint: width < 480 ? "xs" : width < 720 ? "sm" : width < 1024 ? "md" : "lg" };
}
