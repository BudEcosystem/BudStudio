/**
 * Tests for the SSRF (Server-Side Request Forgery) guard module.
 *
 * Tests cover:
 * - isPrivateIP detection for IPv4 private ranges (loopback, RFC 1918, link-local, CGNAT, etc.)
 * - isPrivateIP detection for IPv6 loopback, link-local, and ULA (fc00::/7)
 * - isPrivateIP detection for IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1)
 * - isPrivateIP detection for IPv4-compatible IPv6 (::10.0.0.1)
 * - isPrivateIP detection for NAT64 (64:ff9b::10.0.0.1)
 * - isPrivateIP detection for IPv6 multicast (ff00::/8)
 * - isPrivateIP returning false for public IPs
 * - validateNavigationUrl blocking dangerous URI schemes
 * - validateNavigationUrl allowing about:blank
 * - validateNavigationUrl blocking dangerous hostnames (localhost, 0.0.0.0)
 * - validateNavigationUrl blocking private IPs used as hostnames
 * - validateNavigationUrl allowing public URLs
 * - validateNavigationUrl throwing on malformed URLs
 * - Domain allowlist enforcement via BUD_BROWSER_ALLOWED_DOMAINS
 * - DNS resolution checks for private IPs (mocked)
 */

import { isPrivateIP, validateNavigationUrl } from "../ssrf-guard";
import * as dns from "dns";

// Mock the dns module so DNS resolution calls do not hit the network.
jest.mock("dns", () => ({
  resolve4: jest.fn(
    (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
      callback(null, []);
    }
  ),
  resolve6: jest.fn(
    (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
      callback(null, []);
    }
  ),
}));

// ---------------------------------------------------------------------------
// isPrivateIP
// ---------------------------------------------------------------------------

describe("isPrivateIP", () => {
  describe("IPv4 loopback range (127.0.0.0/8)", () => {
    it("should return true for 127.0.0.1", () => {
      expect(isPrivateIP("127.0.0.1")).toBe(true);
    });

    it("should return true for 127.255.255.255", () => {
      expect(isPrivateIP("127.255.255.255")).toBe(true);
    });
  });

  describe("IPv4 10.0.0.0/8 range", () => {
    it("should return true for 10.0.0.1", () => {
      expect(isPrivateIP("10.0.0.1")).toBe(true);
    });

    it("should return true for 10.255.255.255", () => {
      expect(isPrivateIP("10.255.255.255")).toBe(true);
    });
  });

  describe("IPv4 172.16.0.0/12 range", () => {
    it("should return true for 172.16.0.1", () => {
      expect(isPrivateIP("172.16.0.1")).toBe(true);
    });

    it("should return true for 172.31.255.255", () => {
      expect(isPrivateIP("172.31.255.255")).toBe(true);
    });

    it("should return false for 172.32.0.0 (outside /12 range)", () => {
      expect(isPrivateIP("172.32.0.0")).toBe(false);
    });
  });

  describe("IPv4 192.168.0.0/16 range", () => {
    it("should return true for 192.168.0.1", () => {
      expect(isPrivateIP("192.168.0.1")).toBe(true);
    });

    it("should return true for 192.168.255.255", () => {
      expect(isPrivateIP("192.168.255.255")).toBe(true);
    });
  });

  describe("IPv4 link-local (169.254.0.0/16)", () => {
    it("should return true for 169.254.0.1", () => {
      expect(isPrivateIP("169.254.0.1")).toBe(true);
    });
  });

  describe("IPv4 CGNAT (100.64.0.0/10)", () => {
    it("should return true for 100.64.0.1", () => {
      expect(isPrivateIP("100.64.0.1")).toBe(true);
    });

    it("should return true for 100.127.255.255", () => {
      expect(isPrivateIP("100.127.255.255")).toBe(true);
    });

    it("should return false for 100.128.0.0 (outside /10 range)", () => {
      expect(isPrivateIP("100.128.0.0")).toBe(false);
    });
  });

  describe("IPv4 0.0.0.0/8 ('this' network)", () => {
    it("should return true for 0.0.0.0", () => {
      expect(isPrivateIP("0.0.0.0")).toBe(true);
    });

    it("should return true for 0.255.255.255", () => {
      expect(isPrivateIP("0.255.255.255")).toBe(true);
    });
  });

  describe("IPv6 loopback", () => {
    it("should return true for ::1", () => {
      expect(isPrivateIP("::1")).toBe(true);
    });

    it("should return true for 0:0:0:0:0:0:0:1", () => {
      expect(isPrivateIP("0:0:0:0:0:0:0:1")).toBe(true);
    });
  });

  describe("IPv6 unspecified", () => {
    it("should return true for ::", () => {
      expect(isPrivateIP("::")).toBe(true);
    });
  });

  describe("IPv6 link-local (fe80::/10)", () => {
    it("should return true for fe80::1", () => {
      expect(isPrivateIP("fe80::1")).toBe(true);
    });

    it("should return true for febf::1 (still within /10)", () => {
      expect(isPrivateIP("febf::1")).toBe(true);
    });
  });

  describe("IPv6 ULA (fc00::/7)", () => {
    it("should return true for fc00::1", () => {
      expect(isPrivateIP("fc00::1")).toBe(true);
    });

    it("should return true for fd00::1", () => {
      expect(isPrivateIP("fd00::1")).toBe(true);
    });

    it("should return true for fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", () => {
      expect(isPrivateIP("fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    });
  });

  describe("IPv6 multicast (ff00::/8)", () => {
    it("should return true for ff02::1", () => {
      expect(isPrivateIP("ff02::1")).toBe(true);
    });
  });

  describe("IPv4-mapped IPv6 (::ffff:x.x.x.x)", () => {
    it("should return true for ::ffff:127.0.0.1", () => {
      expect(isPrivateIP("::ffff:127.0.0.1")).toBe(true);
    });

    it("should return true for ::ffff:10.0.0.1", () => {
      expect(isPrivateIP("::ffff:10.0.0.1")).toBe(true);
    });

    it("should return true for ::ffff:192.168.1.1", () => {
      expect(isPrivateIP("::ffff:192.168.1.1")).toBe(true);
    });

    it("should return false for ::ffff:8.8.8.8 (public)", () => {
      expect(isPrivateIP("::ffff:8.8.8.8")).toBe(false);
    });
  });

  describe("IPv4-mapped IPv6 hex form (::ffff:7f00:1)", () => {
    it("should return true for ::ffff:7f00:1 (127.0.0.1)", () => {
      expect(isPrivateIP("::ffff:7f00:1")).toBe(true);
    });

    it("should return true for ::ffff:0a00:1 (10.0.0.1)", () => {
      expect(isPrivateIP("::ffff:0a00:1")).toBe(true);
    });

    it("should return true for ::ffff:c0a8:101 (192.168.1.1)", () => {
      expect(isPrivateIP("::ffff:c0a8:101")).toBe(true);
    });

    it("should return false for ::ffff:0808:0808 (8.8.8.8)", () => {
      expect(isPrivateIP("::ffff:0808:0808")).toBe(false);
    });
  });

  describe("NAT64 (64:ff9b::x.x.x.x)", () => {
    it("should return true for 64:ff9b::10.0.0.1", () => {
      expect(isPrivateIP("64:ff9b::10.0.0.1")).toBe(true);
    });

    it("should return true for 64:ff9b::127.0.0.1", () => {
      expect(isPrivateIP("64:ff9b::127.0.0.1")).toBe(true);
    });

    it("should return false for 64:ff9b::8.8.8.8 (public)", () => {
      expect(isPrivateIP("64:ff9b::8.8.8.8")).toBe(false);
    });
  });

  describe("public IPv4 addresses", () => {
    it("should return false for 8.8.8.8", () => {
      expect(isPrivateIP("8.8.8.8")).toBe(false);
    });

    it("should return false for 1.1.1.1", () => {
      expect(isPrivateIP("1.1.1.1")).toBe(false);
    });

    it("should return false for 93.184.216.34", () => {
      expect(isPrivateIP("93.184.216.34")).toBe(false);
    });
  });

  describe("public IPv6 addresses", () => {
    it("should return false for 2001:4860:4860::8888 (Google DNS)", () => {
      expect(isPrivateIP("2001:4860:4860::8888")).toBe(false);
    });

    it("should return false for 2606:4700:4700::1111 (Cloudflare)", () => {
      expect(isPrivateIP("2606:4700:4700::1111")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// validateNavigationUrl
// ---------------------------------------------------------------------------

describe("validateNavigationUrl", () => {
  beforeEach(() => {
    // Reset DNS mocks to default (return empty arrays) before each test.
    (dns.resolve4 as unknown as jest.Mock).mockImplementation(
      (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
        callback(null, []);
      }
    );
    (dns.resolve6 as unknown as jest.Mock).mockImplementation(
      (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
        callback(null, []);
      }
    );

    // Clean up domain allowlist env var
    delete process.env.BUD_BROWSER_ALLOWED_DOMAINS;
  });

  afterEach(() => {
    delete process.env.BUD_BROWSER_ALLOWED_DOMAINS;
  });

  // ---- Blocked URI schemes ------------------------------------------------

  describe("blocked URI schemes", () => {
    it("should block file:///etc/passwd", async () => {
      await expect(validateNavigationUrl("file:///etc/passwd")).rejects.toThrow(
        /Blocked URL scheme "file:"/
      );
    });

    it("should block javascript:alert(1)", async () => {
      await expect(
        validateNavigationUrl("javascript:alert(1)")
      ).rejects.toThrow(/Blocked URL scheme "javascript:"/);
    });

    it("should block data:text/html,<h1>hi</h1>", async () => {
      await expect(
        validateNavigationUrl("data:text/html,<h1>hi</h1>")
      ).rejects.toThrow(/Blocked URL scheme "data:"/);
    });

    it("should block about:config", async () => {
      await expect(validateNavigationUrl("about:config")).rejects.toThrow(
        /Blocked URL scheme "about:"/
      );
    });
  });

  // ---- about:blank special case -------------------------------------------

  describe("about:blank exception", () => {
    it("should allow about:blank", async () => {
      await expect(
        validateNavigationUrl("about:blank")
      ).resolves.toBeUndefined();
    });
  });

  // ---- Blocked hostnames --------------------------------------------------

  describe("blocked hostnames", () => {
    it("should block http://localhost/secret", async () => {
      await expect(
        validateNavigationUrl("http://localhost/secret")
      ).rejects.toThrow(/Blocked hostname "localhost"/);
    });

    it("should block http://0.0.0.0/secret", async () => {
      await expect(
        validateNavigationUrl("http://0.0.0.0/secret")
      ).rejects.toThrow(/Blocked hostname "0.0.0.0"/);
    });
  });

  // ---- Private IPs as hostnames -------------------------------------------

  describe("private IPs as hostnames", () => {
    it("should block http://127.0.0.1:8080", async () => {
      await expect(
        validateNavigationUrl("http://127.0.0.1:8080")
      ).rejects.toThrow(/Blocked private\/internal IP address "127.0.0.1"/);
    });

    it("should block http://10.0.0.1", async () => {
      await expect(
        validateNavigationUrl("http://10.0.0.1")
      ).rejects.toThrow(/Blocked private\/internal IP address "10.0.0.1"/);
    });

    it("should block http://192.168.1.1", async () => {
      await expect(
        validateNavigationUrl("http://192.168.1.1")
      ).rejects.toThrow(/Blocked private\/internal IP address "192.168.1.1"/);
    });

    it("should block http://[::1]", async () => {
      await expect(
        validateNavigationUrl("http://[::1]")
      ).rejects.toThrow(/Blocked private\/internal IP/);
    });

    it("should block http://[::ffff:127.0.0.1]", async () => {
      await expect(
        validateNavigationUrl("http://[::ffff:127.0.0.1]")
      ).rejects.toThrow(/Blocked private\/internal IP/);
    });
  });

  // ---- Public URLs --------------------------------------------------------

  describe("public URLs", () => {
    it("should allow https://example.com", async () => {
      await expect(
        validateNavigationUrl("https://example.com")
      ).resolves.toBeUndefined();
    });

    it("should allow https://google.com", async () => {
      await expect(
        validateNavigationUrl("https://google.com")
      ).resolves.toBeUndefined();
    });
  });

  // ---- Malformed URLs -----------------------------------------------------

  describe("malformed URLs", () => {
    it("should throw for a string that is not a valid URL", async () => {
      await expect(validateNavigationUrl("not-a-url")).rejects.toThrow(
        /Invalid URL/
      );
    });
  });

  // ---- DNS resolution returning private IPs --------------------------------

  describe("DNS resolution to private IPs", () => {
    it("should block a hostname that resolves to a private IPv4 address", async () => {
      (dns.resolve4 as unknown as jest.Mock).mockImplementation(
        (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
          callback(null, ["10.0.0.5"]);
        }
      );

      await expect(
        validateNavigationUrl("https://evil.example.com")
      ).rejects.toThrow(
        /resolves to private\/internal IP "10.0.0.5"/
      );
    });

    it("should block a hostname that resolves to a private IPv6 address", async () => {
      (dns.resolve6 as unknown as jest.Mock).mockImplementation(
        (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
          callback(null, ["::1"]);
        }
      );

      await expect(
        validateNavigationUrl("https://evil.example.com")
      ).rejects.toThrow(
        /resolves to private\/internal IP "::1"/
      );
    });

    it("should block a hostname that resolves to an IPv4-mapped IPv6 private address", async () => {
      (dns.resolve6 as unknown as jest.Mock).mockImplementation(
        (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
          callback(null, ["::ffff:127.0.0.1"]);
        }
      );

      await expect(
        validateNavigationUrl("https://evil.example.com")
      ).rejects.toThrow(
        /resolves to private\/internal IP/
      );
    });

    it("should block a hostname that resolves to a ULA IPv6 address", async () => {
      (dns.resolve6 as unknown as jest.Mock).mockImplementation(
        (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
          callback(null, ["fd00::1"]);
        }
      );

      await expect(
        validateNavigationUrl("https://evil.example.com")
      ).rejects.toThrow(
        /resolves to private\/internal IP/
      );
    });

    it("should allow a hostname that resolves to a public IP", async () => {
      (dns.resolve4 as unknown as jest.Mock).mockImplementation(
        (_hostname: string, callback: (err: Error | null, addresses: string[]) => void) => {
          callback(null, ["93.184.216.34"]);
        }
      );

      await expect(
        validateNavigationUrl("https://example.com")
      ).resolves.toBeUndefined();
    });
  });

  // ---- Domain allowlist ---------------------------------------------------

  describe("domain allowlist (BUD_BROWSER_ALLOWED_DOMAINS)", () => {
    beforeEach(() => {
      process.env.BUD_BROWSER_ALLOWED_DOMAINS = "example.com,test.org";
    });

    afterEach(() => {
      delete process.env.BUD_BROWSER_ALLOWED_DOMAINS;
    });

    it("should allow https://example.com when it is in the allowlist", async () => {
      await expect(
        validateNavigationUrl("https://example.com")
      ).resolves.toBeUndefined();
    });

    it("should allow https://sub.example.com (subdomain match)", async () => {
      await expect(
        validateNavigationUrl("https://sub.example.com")
      ).resolves.toBeUndefined();
    });

    it("should allow https://test.org when it is in the allowlist", async () => {
      await expect(
        validateNavigationUrl("https://test.org")
      ).resolves.toBeUndefined();
    });

    it("should block https://google.com when it is not in the allowlist", async () => {
      await expect(
        validateNavigationUrl("https://google.com")
      ).rejects.toThrow(/Domain "google.com" is not in the allowed domains list/);
    });

    it("should block https://notexample.com (not a subdomain of example.com)", async () => {
      await expect(
        validateNavigationUrl("https://notexample.com")
      ).rejects.toThrow(/is not in the allowed domains list/);
    });
  });
});
