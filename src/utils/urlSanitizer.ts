/**
 * URL Sanitizer for clean QR Code encoding and domain extraction
 */

const TRACKING_PARAMS: Record<string, true> = {
  utm_source: true,
  utm_medium: true,
  utm_campaign: true,
  utm_term: true,
  utm_content: true,
  utm_id: true,
  fbclid: true,
  gclid: true,
  gclsrc: true,
  dclid: true,
  zanpid: true,
  msclkid: true,
  mc_cid: true,
  mc_eid: true,
  ref: true,
  ref_src: true,
  session_id: true,
  sessionid: true,
  spm: true,
  scm: true,
  _hsenc: true,
  _hsmi: true,
  yclid: true,
  igshid: true,
};

/**
 * Sanitizes a URL by removing marketing tracking query parameters.
 * Keeps paths and functional query parameters intact.
 */
export function sanitizeSourceUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    const searchParams = new URLSearchParams(parsed.search);
    const keysToDelete: string[] = [];

    // Filter out tracking parameters
    for (const key of searchParams.keys()) {
      const lowerKey = key.toLowerCase();
      if (TRACKING_PARAMS[lowerKey] || lowerKey.startsWith('utm_')) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      searchParams.delete(key);
    }

    parsed.search = searchParams.toString();
    parsed.hash = ''; // Remove hash fragments

    let clean = parsed.toString();
    // If search is empty and ended with a trailing question mark, remove it
    if (clean.endsWith('?')) {
      clean = clean.slice(0, -1);
    }
    return clean;
  } catch {
    return '';
  }
}

/**
 * Extracts a clean domain name without www., m., or amp. prefixes.
 */
export function getCleanDomain(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    let host = parsed.hostname.toLowerCase();
    // Strip common subdomains
    if (host.startsWith('www.')) host = host.slice(4);
    if (host.startsWith('m.')) host = host.slice(2);
    if (host.startsWith('amp.')) host = host.slice(4);
    return host;
  } catch {
    return '';
  }
}

/**
 * Extracts all HTTP/HTTPS URLs present in arbitrary text.
 */
export function extractUrlsFromText(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const urlRegex = /https?:\/\/[^\s<>"'{}|\\^`]+[^\s<>"'{}|\\^`.,;:?!]/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)];
}
