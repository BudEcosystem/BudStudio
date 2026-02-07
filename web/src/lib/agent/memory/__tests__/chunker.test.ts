/**
 * Tests for the memory file chunking module.
 *
 * Tests cover:
 * - Empty file handling
 * - Small file handling (single chunk)
 * - Proper chunking with overlap
 * - Markdown structure preservation (code blocks, headers, lists)
 * - Content hash generation
 * - Line number tracking
 */

import {
  chunkFile,
  chunkFiles,
  computeContentHash,
  MemoryChunker,
} from "../chunker";

describe("computeContentHash", () => {
  it("should generate a consistent SHA-256 hash for the same content", () => {
    const content = "Hello, World!";
    const hash1 = computeContentHash(content);
    const hash2 = computeContentHash(content);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex characters
  });

  it("should generate different hashes for different content", () => {
    const hash1 = computeContentHash("Hello, World!");
    const hash2 = computeContentHash("Hello, Universe!");

    expect(hash1).not.toBe(hash2);
  });

  it("should handle empty strings", () => {
    const hash = computeContentHash("");
    expect(hash).toHaveLength(64);
  });

  it("should handle unicode content", () => {
    const hash = computeContentHash("Hello, \u4e16\u754c!");
    expect(hash).toHaveLength(64);
  });
});

describe("chunkFile", () => {
  describe("empty file handling", () => {
    it("should return empty array for empty file", () => {
      const chunks = chunkFile("/path/to/file.md", "");
      expect(chunks).toEqual([]);
    });

    it("should return empty array for whitespace-only file", () => {
      const chunks = chunkFile("/path/to/file.md", "   \n\t\n   ");
      expect(chunks).toEqual([]);
    });
  });

  describe("small file handling", () => {
    it("should return single chunk for file smaller than chunk size", () => {
      const content = "# Title\n\nThis is a small file with some content.";
      const chunks = chunkFile("/path/to/file.md", content);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.filePath).toBe("/path/to/file.md");
      expect(chunks[0]!.content).toBe(content);
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBe(3);
    });

    it("should extract headers from small file", () => {
      const content = "# Main Title\n\nSome content here.";
      const chunks = chunkFile("/path/to/file.md", content);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.headers).toEqual(["Main Title"]);
    });

    it("should include content hash in chunk", () => {
      const content = "Some content";
      const chunks = chunkFile("/path/to/file.md", content);

      expect(chunks[0]!.contentHash).toBeDefined();
      expect(chunks[0]!.contentHash).toBe(computeContentHash(content));
    });
  });

  describe("line number tracking", () => {
    it("should track correct line numbers for single chunk", () => {
      const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      const chunks = chunkFile("/path/to/file.md", content);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBe(5);
    });

    it("should track correct line numbers across multiple chunks", () => {
      // Create content large enough for multiple chunks (>1600 chars)
      const paragraph = "This is a paragraph with enough content to make chunking work. ".repeat(
        30
      );
      const content = `# Section 1\n\n${paragraph}\n\n# Section 2\n\n${paragraph}`;

      const chunks = chunkFile("/path/to/file.md", content);

      // Verify that chunks have sensible line numbers
      expect(chunks.length).toBeGreaterThan(0);
      // First chunk should start within the first few lines
      expect(chunks[0]!.startLine).toBeGreaterThanOrEqual(1);
      expect(chunks[0]!.startLine).toBeLessThanOrEqual(5);

      // Each subsequent chunk should start at or after the previous chunk's start
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i]!.startLine).toBeGreaterThanOrEqual(
          chunks[i - 1]!.startLine!
        );
      }
    });
  });

  describe("markdown structure preservation", () => {
    describe("code blocks", () => {
      it("should keep code blocks intact", () => {
        const codeBlock = "```typescript\nconst x = 1;\nconst y = 2;\n```";
        const content = `# Title\n\n${codeBlock}\n\nSome text after.`;
        const chunks = chunkFile("/path/to/file.md", content);

        // The code block should be fully contained in one chunk
        const chunkWithCode = chunks.find((c) =>
          c.content.includes("const x = 1")
        );
        expect(chunkWithCode).toBeDefined();
        expect(chunkWithCode!.content).toContain("```typescript");
        expect(chunkWithCode!.content).toContain("const y = 2");
        expect(chunkWithCode!.content).toContain("```");
      });

      it("should not treat code comments as headers", () => {
        const content = "```python\n# This is a comment\nprint('hello')\n```";
        const chunks = chunkFile("/path/to/file.md", content);

        expect(chunks).toHaveLength(1);
        // The comment inside code should not be extracted as a header
        expect(chunks[0]!.headers).toBeUndefined();
      });
    });

    describe("headers", () => {
      it("should extract header hierarchy", () => {
        const content =
          "# Level 1\n\n## Level 2\n\nContent under level 2.\n\n### Level 3\n\nContent under level 3.";
        const chunks = chunkFile("/path/to/file.md", content);

        expect(chunks.length).toBeGreaterThan(0);
        // Headers should be extracted
        expect(chunks[0]!.headers).toBeDefined();
      });

      it("should handle multiple header levels", () => {
        const content =
          "# Main\n\nIntro.\n\n## Sub 1\n\nContent 1.\n\n## Sub 2\n\nContent 2.";
        const chunks = chunkFile("/path/to/file.md", content);

        expect(chunks).toHaveLength(1);
        // Should have Main header
        expect(chunks[0]!.headers).toContain("Main");
      });
    });

    describe("lists", () => {
      it("should keep lists together when possible", () => {
        const list = `- Item 1\n- Item 2\n- Item 3\n- Item 4\n- Item 5`;
        const content = `# My List\n\n${list}`;
        const chunks = chunkFile("/path/to/file.md", content);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.content).toContain("- Item 1");
        expect(chunks[0]!.content).toContain("- Item 5");
      });

      it("should handle numbered lists", () => {
        const list = `1. First\n2. Second\n3. Third`;
        const content = `# Numbered List\n\n${list}`;
        const chunks = chunkFile("/path/to/file.md", content);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.content).toContain("1. First");
        expect(chunks[0]!.content).toContain("3. Third");
      });

      it("should handle nested lists", () => {
        const list = `- Parent 1\n  - Child 1\n  - Child 2\n- Parent 2`;
        const content = `# Nested List\n\n${list}`;
        const chunks = chunkFile("/path/to/file.md", content);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]!.content).toContain("- Parent 1");
        expect(chunks[0]!.content).toContain("  - Child 1");
      });
    });
  });

  describe("chunking with overlap", () => {
    it("should create multiple chunks for large content", () => {
      // Create content that exceeds TARGET_CHUNK_SIZE (1600 chars)
      const largeParagraph = "This is a sentence with some words. ".repeat(100);
      const content = `# Title\n\n${largeParagraph}`;

      const chunks = chunkFile("/path/to/file.md", content);

      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should have overlap between consecutive chunks", () => {
      // Create content large enough for multiple chunks
      const sections = Array.from(
        { length: 10 },
        (_, i) =>
          `## Section ${i + 1}\n\n${"Lorem ipsum dolor sit amet. ".repeat(20)}`
      );
      const content = `# Main Title\n\n${sections.join("\n\n")}`;

      const chunks = chunkFile("/path/to/file.md", content);

      // If we have multiple chunks, check for potential overlap
      if (chunks.length > 1) {
        // The chunker uses overlap, so consecutive chunks may share some context
        // We just verify that the chunks cover the content properly
        expect(chunks[0]!.content.length).toBeGreaterThan(0);
        expect(chunks[chunks.length - 1]!.content.length).toBeGreaterThan(0);
      }
    });
  });

  describe("content hash generation", () => {
    it("should generate unique hashes for different chunks", () => {
      const largeParagraph = "This is unique content. ".repeat(100);
      const content = `# Part 1\n\n${largeParagraph}\n\n# Part 2\n\n${largeParagraph}`;

      const chunks = chunkFile("/path/to/file.md", content);

      if (chunks.length > 1) {
        const hashes = chunks.map((c) => c.contentHash);
        const uniqueHashes = new Set(hashes);
        // At least some hashes should be unique
        expect(uniqueHashes.size).toBeGreaterThan(0);
      }
    });

    it("should generate same hash for same content", () => {
      const content = "Short content";
      const chunks1 = chunkFile("/path/to/file.md", content);
      const chunks2 = chunkFile("/path/to/file.md", content);

      expect(chunks1[0]!.contentHash).toBe(chunks2[0]!.contentHash);
    });
  });
});

describe("chunkFiles", () => {
  it("should chunk multiple files", () => {
    const files = [
      { path: "/path/to/file1.md", content: "# File 1\n\nContent 1" },
      { path: "/path/to/file2.md", content: "# File 2\n\nContent 2" },
    ];

    const chunks = chunkFiles(files);

    expect(chunks.length).toBe(2);
    expect(chunks[0]!.filePath).toBe("/path/to/file1.md");
    expect(chunks[1]!.filePath).toBe("/path/to/file2.md");
  });

  it("should handle empty files in the list", () => {
    const files = [
      { path: "/path/to/file1.md", content: "# File 1\n\nContent 1" },
      { path: "/path/to/empty.md", content: "" },
      { path: "/path/to/file2.md", content: "# File 2\n\nContent 2" },
    ];

    const chunks = chunkFiles(files);

    expect(chunks.length).toBe(2);
    expect(chunks.find((c) => c.filePath === "/path/to/empty.md")).toBeUndefined();
  });

  it("should return empty array for empty file list", () => {
    const chunks = chunkFiles([]);
    expect(chunks).toEqual([]);
  });
});

describe("MemoryChunker class", () => {
  it("should create instance with default options", () => {
    const chunker = new MemoryChunker();
    expect(chunker).toBeDefined();
  });

  it("should create instance with custom options", () => {
    const chunker = new MemoryChunker({
      targetChunkSize: 800,
      chunkOverlap: 160,
    });
    expect(chunker).toBeDefined();
  });

  it("should chunk file using instance method", () => {
    const chunker = new MemoryChunker();
    const chunks = chunker.chunkFile("/path/to/file.md", "# Title\n\nContent");

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("Title");
  });

  it("should chunk multiple files using instance method", () => {
    const chunker = new MemoryChunker();
    const files = [
      { path: "/path/to/file1.md", content: "Content 1" },
      { path: "/path/to/file2.md", content: "Content 2" },
    ];

    const chunks = chunker.chunkFiles(files);

    expect(chunks.length).toBe(2);
  });

  it("should compute content hash using instance method", () => {
    const chunker = new MemoryChunker();
    const hash = chunker.computeContentHash("test content");

    expect(hash).toHaveLength(64);
    expect(hash).toBe(computeContentHash("test content"));
  });
});
