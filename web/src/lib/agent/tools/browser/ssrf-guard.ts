/**
 * SSRF (Server-Side Request Forgery) guard for browser navigation.
 *
 * Validates URLs before the browser tool navigates to them, blocking
 * requests to private/internal networks, dangerous URI schemes, and
 * optionally restricting navigation to an explicit domain allowlist.
 *
 * DNS resolution is performed before IP checks to prevent DNS rebinding
 * attacks where a hostname initially resolves to a public IP but later
 * resolves to an internal one.
 */

import { resolve4, resolve6 } from "dns";
import { URL } from "url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * URI schemes that are unconditionally blocked.
 * `about:blank` is explicitly allowed as a special case.
 */
const BLOCKED_SCHEMES: string[] = [
  "file:",
  "javascript:",
  "data:",
  "about:", // about:blank handled separately
];

/**
 * Hostnames that are always blocked regardless of DNS resolution.
 */
const BLOCKED_HOSTNAMES: string[] = ["localhost", "0.0.0.0"];

/**
 * IPv4 CIDR ranges considered private / internal.
 * Each entry is [network, prefix-length].
 */
const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ["127.0.0.0", 8], // Loopback
  ["10.0.0.0", 8], // RFC 1918
  ["172.16.0.0", 12], // RFC 1918
  ["192.168.0.0", 16], // RFC 1918
  ["169.254.0.0", 16], // Link-local
];

/**
 * IPv6 addresses / prefixes that are blocked.
 */
const BLOCKED_IPV6_LOOPBACK = "::1";
const BLOCKED_IPV6_LINK_LOCAL_PREFIX = "fe80";

// ---------------------------------------------------------------------------
// Helpers – IP parsing
// ---------------------------------------------------------------------------

/**
 * Converts a dotted-decimal IPv4 string to a 32-bit numeric value.
 *
 * @param ip - IPv4 address string (e.g. "192.168.1.1")
 * @returns The numeric representation, or `null` if the string is not valid IPv4
 */
function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let num = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (isNaN(octet) || octet < 0 || octet > 255) {
      return null;
    }
    num = (num << 8) | octet;
  }

  // Convert to unsigned 32-bit
  return num >>> 0;
}

/**
 * Checks whether an IPv4 address falls within a CIDR range.
 *
 * @param ip - Numeric IPv4 address
 * @param network - Numeric network address
 * @param prefixLen - CIDR prefix length (0-32)
 * @returns `true` if the IP is inside the range
 */
function isInCIDR(ip: number, network: number, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ip & mask) === (network & mask);
}

/**
 * Checks whether an IPv6 address string is a blocked address.
 *
 * @param ip - IPv6 address string
 * @returns `true` if the address is loopback (`::1`) or link-local (`fe80::/10`)
 */
function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  if (normalized === BLOCKED_IPV6_LOOPBACK) {
    return true;
  }

  if (normalized.startsWith(BLOCKED_IPV6_LINK_LOCAL_PREFIX)) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether an IP address (v4 or v6) belongs to a private or
 * otherwise blocked network range.
 *
 * @param ip - An IPv4 or IPv6 address string
 * @returns `true` if the address is private / blocked
 *
 * @example
 * ```typescript
 * isPrivateIP("127.0.0.1");    // true
 * isPrivateIP("10.0.0.5");     // true
 * isPrivateIP("8.8.8.8");      // false
 * isPrivateIP("::1");          // true
 * isPrivateIP("fe80::1");      // true
 * ```
 */
export function isPrivateIP(ip: string): boolean {
  // Try IPv4 first
  const num = ipv4ToNumber(ip);
  if (num !== null) {
    for (const [network, prefixLen] of PRIVATE_IPV4_RANGES) {
      const networkNum = ipv4ToNumber(network);
      if (networkNum !== null && isInCIDR(num, networkNum, prefixLen)) {
        return true;
      }
    }
    return false;
  }

  // Fall back to IPv6 check
  return isBlockedIPv6(ip);
}

// ---------------------------------------------------------------------------
// DNS resolution wrappers
// ---------------------------------------------------------------------------

/**
 * Resolves a hostname to its IPv4 addresses.
 *
 * @param hostname - The hostname to resolve
 * @returns A promise resolving to an array of IPv4 address strings (may be empty)
 */
function resolveIPv4(hostname: string): Promise<string[]> {
  return new Promise((resolve) => {
    resolve4(hostname, (err, addresses) => {
      if (err) {
        resolve([]);
      } else {
        resolve(addresses);
      }
    });
  });
}

/**
 * Resolves a hostname to its IPv6 addresses.
 *
 * @param hostname - The hostname to resolve
 * @returns A promise resolving to an array of IPv6 address strings (may be empty)
 */
function resolveIPv6(hostname: string): Promise<string[]> {
  return new Promise((resolve) => {
    resolve6(hostname, (err, addresses) => {
      if (err) {
        resolve([]);
      } else {
        resolve(addresses);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Domain allowlist
// ---------------------------------------------------------------------------

/**
 * Reads the optional domain allowlist from the `BUD_BROWSER_ALLOWED_DOMAINS`
 * environment variable. When set, only hostnames matching one of the listed
 * domains (or their subdomains) are permitted.
 *
 * @returns An array of lowercase domain strings, or `null` if the env var is unset/empty
 */
function getAllowedDomains(): string[] | null {
  const raw = process.env.BUD_BROWSER_ALLOWED_DOMAINS;
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

/**
 * Checks whether a hostname matches any entry in the allowlist.
 * A match occurs when the hostname equals the domain exactly or is a
 * subdomain of it (e.g. "sub.example.com" matches "example.com").
 *
 * @param hostname - The hostname to check
 * @param allowedDomains - The list of allowed domain patterns
 * @returns `true` if the hostname is allowed
 */
function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  const lower = hostname.toLowerCase();

  for (const domain of allowedDomains) {
    if (lower === domain || lower.endsWith(`.${domain}`)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

/**
 * Validates a URL before browser navigation to prevent SSRF attacks.
 *
 * Performs the following checks in order:
 * 1. Parses the URL and rejects malformed input.
 * 2. Blocks dangerous URI schemes (`file:`, `javascript:`, `data:`, `about:`
 *    except `about:blank`).
 * 3. Blocks known-dangerous hostnames (`localhost`, `0.0.0.0`).
 * 4. If a domain allowlist is configured via `BUD_BROWSER_ALLOWED_DOMAINS`,
 *    rejects hostnames that are not on the list.
 * 5. Resolves the hostname to IP addresses via DNS and rejects any address
 *    that falls within a private/internal network range.
 *
 * @param url - The URL string to validate
 * @throws Error if the URL is blocked for any reason
 *
 * @example
 * ```typescript
 * // These will throw:
 * await validateNavigationUrl("file:///etc/passwd");
 * await validateNavigationUrl("http://localhost:8080/admin");
 * await validateNavigationUrl("http://169.254.169.254/metadata");
 *
 * // These will pass:
 * await validateNavigationUrl("https://example.com/page");
 * await validateNavigationUrl("about:blank");
 * ```
 */
export async function validateNavigationUrl(url: string): Promise<void> {
  // --- Step 1: Parse the URL ------------------------------------------------
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: unable to parse "${url}"`);
  }

  // --- Step 2: Block dangerous schemes --------------------------------------
  const scheme = parsed.protocol; // includes trailing colon

  // Special-case: about:blank is allowed
  if (scheme === "about:" && parsed.pathname === "blank") {
    return;
  }

  if (BLOCKED_SCHEMES.includes(scheme)) {
    throw new Error(
      `Blocked URL scheme "${scheme}" — navigation to ${scheme} URLs is not allowed`
    );
  }

  // Only allow http(s) from here on
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(
      `Unsupported URL scheme "${scheme}" — only http: and https: are allowed`
    );
  }

  // --- Step 3: Block dangerous hostnames ------------------------------------
  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error(
      `Blocked hostname "${hostname}" — navigation to this host is not allowed`
    );
  }

  // --- Step 4: Domain allowlist ---------------------------------------------
  const allowedDomains = getAllowedDomains();

  if (allowedDomains !== null && !isDomainAllowed(hostname, allowedDomains)) {
    throw new Error(
      `Domain "${hostname}" is not in the allowed domains list — ` +
        `allowed: ${allowedDomains.join(", ")}`
    );
  }

  // --- Step 5: DNS resolution & private IP check ----------------------------
  // If the hostname is already an IP literal, check it directly.
  if (isPrivateIP(hostname)) {
    throw new Error(
      `Blocked private/internal IP address "${hostname}" — navigation to internal networks is not allowed`
    );
  }

  // Resolve to actual IPs to prevent DNS rebinding attacks.
  const [ipv4Addresses, ipv6Addresses] = await Promise.all([
    resolveIPv4(hostname),
    resolveIPv6(hostname),
  ]);

  const allAddresses = [...ipv4Addresses, ...ipv6Addresses];

  // If DNS resolution returned nothing, the hostname likely does not exist.
  // We allow it to pass here — the browser will show its own error page.
  for (const addr of allAddresses) {
    if (isPrivateIP(addr)) {
      throw new Error(
        `Hostname "${hostname}" resolves to private/internal IP "${addr}" — ` +
          `navigation to internal networks is not allowed`
      );
    }
  }
}
