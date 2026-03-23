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
  ["0.0.0.0", 8], // "This" network (RFC 1122)
  ["127.0.0.0", 8], // Loopback
  ["10.0.0.0", 8], // RFC 1918
  ["172.16.0.0", 12], // RFC 1918
  ["192.168.0.0", 16], // RFC 1918
  ["169.254.0.0", 16], // Link-local
  ["100.64.0.0", 10], // Shared address space (RFC 6598 / CGNAT)
  ["192.0.0.0", 24], // IETF Protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1 (RFC 5737)
  ["198.51.100.0", 24], // TEST-NET-2 (RFC 5737)
  ["203.0.113.0", 24], // TEST-NET-3 (RFC 5737)
  ["198.18.0.0", 15], // Benchmarking (RFC 2544)
  ["224.0.0.0", 4], // Multicast
  ["240.0.0.0", 4], // Reserved
];

// ---------------------------------------------------------------------------
// Helpers – IPv4 parsing
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
    if (isNaN(octet) || octet < 0 || octet > 255 || part !== String(octet)) {
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
 * Checks whether an IPv4 address is in a private/reserved range.
 */
function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToNumber(ip);
  if (num === null) return false;

  for (const [network, prefixLen] of PRIVATE_IPV4_RANGES) {
    const networkNum = ipv4ToNumber(network);
    if (networkNum !== null && isInCIDR(num, networkNum, prefixLen)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Helpers – IPv6 parsing
// ---------------------------------------------------------------------------

/**
 * Expands a compressed IPv6 address to its full 8-group hex representation.
 * Returns null if the input is not a valid IPv6 address.
 */
function expandIPv6(ip: string): string | null {
  // Strip bracket notation [::1] -> ::1
  let addr = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  // Strip zone id (%eth0 etc.)
  const zoneIdx = addr.indexOf("%");
  if (zoneIdx !== -1) addr = addr.slice(0, zoneIdx);

  addr = addr.toLowerCase();

  // Handle IPv4-mapped/compatible addresses (::ffff:1.2.3.4, ::1.2.3.4)
  const lastColon = addr.lastIndexOf(":");
  if (lastColon !== -1) {
    const suffix = addr.slice(lastColon + 1);
    if (suffix.includes(".")) {
      // This is an IPv4-mapped or IPv4-compatible IPv6 address
      const v4num = ipv4ToNumber(suffix);
      if (v4num === null) return null;
      const hi = (v4num >>> 16) & 0xffff;
      const lo = v4num & 0xffff;
      addr = addr.slice(0, lastColon + 1) + hi.toString(16) + ":" + lo.toString(16);
    }
  }

  const parts = addr.split("::");
  if (parts.length > 2) return null; // At most one ::

  let groups: string[];
  if (parts.length === 2) {
    const left = parts[0] === "" ? [] : parts[0]!.split(":");
    const right = parts[1] === "" ? [] : parts[1]!.split(":");
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = addr.split(":");
  }

  if (groups.length !== 8) return null;

  // Validate each group is a valid hex value 0-ffff
  for (const g of groups) {
    if (g.length === 0 || g.length > 4 || !/^[0-9a-f]+$/.test(g)) return null;
  }

  return groups.map((g) => g.padStart(4, "0")).join(":");
}

/**
 * Extracts an embedded IPv4 address from an IPv4-mapped/compatible IPv6 address.
 * Returns null if the address doesn't embed an IPv4.
 *
 * Handles:
 * - ::ffff:1.2.3.4 (IPv4-mapped)
 * - ::1.2.3.4 (IPv4-compatible, deprecated)
 * - ::ffff:0a00:0001 (hex-encoded IPv4-mapped)
 * - 64:ff9b::1.2.3.4 (NAT64 well-known prefix, RFC 6052)
 */
function extractEmbeddedIPv4(ip: string): string | null {
  const expanded = expandIPv6(ip);
  if (!expanded) return null;

  const groups = expanded.split(":").map((g) => parseInt(g, 16));

  // ::ffff:x:x (IPv4-mapped — groups 0-4 are 0, group 5 is 0xffff)
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    const hi = groups[6]!;
    const lo = groups[7]!;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  // ::x:x (IPv4-compatible — all zeros except last two groups)
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    const combined = ((groups[6]! << 16) | groups[7]!) >>> 0;
    // Skip ::0 and ::1 — these are IPv6-native, not embedded IPv4
    if (combined > 1) {
      return `${(combined >> 24) & 0xff}.${(combined >> 16) & 0xff}.${(combined >> 8) & 0xff}.${combined & 0xff}`;
    }
  }

  // 64:ff9b::x:x (NAT64 well-known prefix RFC 6052)
  if (
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    const hi = groups[6]!;
    const lo = groups[7]!;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  return null;
}

/**
 * Checks whether an IPv6 address is a blocked address.
 *
 * Blocks:
 * - ::1 (loopback)
 * - fe80::/10 (link-local)
 * - fc00::/7 (Unique Local Addresses, RFC 4193)
 * - :: (unspecified)
 * - ff00::/8 (multicast)
 * - IPv4-mapped/compatible addresses that embed a private IPv4
 * - NAT64 (64:ff9b::/96) addresses that embed a private IPv4
 */
function isBlockedIPv6(ip: string): boolean {
  const expanded = expandIPv6(ip);
  if (!expanded) return false;

  const firstGroup = expanded.slice(0, 4);
  const firstByte = parseInt(firstGroup, 16) >> 8;

  // ::1 loopback
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return true;

  // :: unspecified
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return true;

  // fe80::/10 link-local (first 10 bits = 1111 1110 10)
  const first16 = parseInt(firstGroup, 16);
  if ((first16 & 0xffc0) === 0xfe80) return true;

  // fc00::/7 Unique Local Addresses (first 7 bits = 1111 110)
  if ((firstByte & 0xfe) === 0xfc) return true;

  // ff00::/8 multicast
  if (firstByte === 0xff) return true;

  // Check for embedded private IPv4 (IPv4-mapped, IPv4-compatible, NAT64)
  const embeddedV4 = extractEmbeddedIPv4(ip);
  if (embeddedV4 !== null && isPrivateIPv4(embeddedV4)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether an IP address (v4 or v6) belongs to a private or
 * otherwise blocked network range.
 *
 * Handles:
 * - Standard IPv4 dotted-decimal
 * - IPv6 full and compressed notation
 * - IPv4-mapped IPv6 (::ffff:127.0.0.1 and ::ffff:7f00:0001)
 * - IPv4-compatible IPv6 (::127.0.0.1)
 * - NAT64 prefix (64:ff9b::127.0.0.1)
 * - IPv6 ULA (fc00::/7)
 * - IPv6 link-local (fe80::/10)
 * - IPv6 multicast (ff00::/8)
 *
 * @param ip - An IPv4 or IPv6 address string
 * @returns `true` if the address is private / blocked
 */
export function isPrivateIP(ip: string): boolean {
  // Try IPv4 first
  if (isPrivateIPv4(ip)) return true;

  // IPv6 checks (including embedded IPv4)
  return isBlockedIPv6(ip);
}

// ---------------------------------------------------------------------------
// DNS resolution wrappers
// ---------------------------------------------------------------------------

/**
 * Resolves a hostname to its IPv4 addresses.
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
 * environment variable.
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
