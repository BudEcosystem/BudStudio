/**
 * Memory file chunking module for splitting markdown files into indexable chunks.
 *
 * This module provides functionality to split markdown files into chunks suitable
 * for indexing in the memory database. It preserves markdown structure and tracks
 * metadata for each chunk.
 */

import * as crypto from "crypto";
import { MemoryChunk } from "./types";

/** Target chunk size in characters (~400 tokens at 4 chars/token) */
const TARGET_CHUNK_SIZE = 1600;

/** Overlap between chunks in characters (~80 tokens at 4 chars/token) */
const CHUNK_OVERLAP = 320;

/** Minimum chunk size to avoid very small chunks */
const MIN_CHUNK_SIZE = 200;

/**
 * Computes a SHA-256 hash of the content for change detection and deduplication.
 *
 * @param content - The content to hash
 * @returns Hexadecimal string representation of the SHA-256 hash
 */
export function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Represents a parsed markdown section with its header hierarchy.
 */
interface MarkdownSection {
  /** The header line (e.g., "## My Header") */
  headerLine: string;
  /** The header text without the markdown prefix */
  headerText: string;
  /** The header level (1-6) */
  level: number;
  /** The content under this header (excluding sub-headers) */
  content: string;
  /** Starting line number of this section (1-indexed) */
  startLine: number;
  /** Ending line number of this section (1-indexed) */
  endLine: number;
}

/**
 * Represents a logical block that should not be split.
 */
interface ContentBlock {
  /** The content of the block */
  content: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** Whether this is a code block */
  isCodeBlock: boolean;
  /** Whether this is a list block */
  isListBlock: boolean;
}

/**
 * Parses content into blocks that should not be split (code blocks, lists, paragraphs).
 *
 * @param content - The markdown content to parse
 * @param baseLineNumber - The starting line number for this content
 * @returns Array of content blocks
 */
function parseContentBlocks(
  content: string,
  baseLineNumber: number
): ContentBlock[] {
  const lines = content.split("\n");
  const blocks: ContentBlock[] = [];
  let currentBlock: string[] = [];
  let blockStartLine = baseLineNumber;
  let inCodeBlock = false;
  let inListBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = baseLineNumber + i;

    // Check for code block start/end
    if (line.trimStart().startsWith("```")) {
      if (!inCodeBlock) {
        // Starting a code block - save any previous content
        if (currentBlock.length > 0) {
          blocks.push({
            content: currentBlock.join("\n"),
            startLine: blockStartLine,
            endLine: lineNumber - 1,
            isCodeBlock: false,
            isListBlock: inListBlock,
          });
        }
        currentBlock = [line];
        blockStartLine = lineNumber;
        inCodeBlock = true;
        inListBlock = false;
      } else {
        // Ending a code block
        currentBlock.push(line);
        blocks.push({
          content: currentBlock.join("\n"),
          startLine: blockStartLine,
          endLine: lineNumber,
          isCodeBlock: true,
          isListBlock: false,
        });
        currentBlock = [];
        blockStartLine = lineNumber + 1;
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      currentBlock.push(line);
      continue;
    }

    // Check for list items (-, *, +, or numbered lists)
    const isListItem = /^(\s*[-*+]|\s*\d+\.)\s/.test(line);

    if (isListItem && !inListBlock) {
      // Starting a list - save any previous content
      if (currentBlock.length > 0) {
        blocks.push({
          content: currentBlock.join("\n"),
          startLine: blockStartLine,
          endLine: lineNumber - 1,
          isCodeBlock: false,
          isListBlock: false,
        });
      }
      currentBlock = [line];
      blockStartLine = lineNumber;
      inListBlock = true;
    } else if (inListBlock) {
      // Check if we're continuing the list (list item or indented continuation)
      const isContinuation = isListItem || /^\s+/.test(line);
      const isEmpty = line.trim() === "";

      if (isContinuation || isEmpty) {
        currentBlock.push(line);
      } else {
        // End of list
        blocks.push({
          content: currentBlock.join("\n"),
          startLine: blockStartLine,
          endLine: lineNumber - 1,
          isCodeBlock: false,
          isListBlock: true,
        });
        currentBlock = [line];
        blockStartLine = lineNumber;
        inListBlock = false;
      }
    } else {
      // Regular paragraph content
      if (line.trim() === "" && currentBlock.length > 0) {
        // End of paragraph on empty line
        blocks.push({
          content: currentBlock.join("\n"),
          startLine: blockStartLine,
          endLine: lineNumber - 1,
          isCodeBlock: false,
          isListBlock: false,
        });
        currentBlock = [];
        blockStartLine = lineNumber + 1;
      } else if (line.trim() !== "") {
        if (currentBlock.length === 0) {
          blockStartLine = lineNumber;
        }
        currentBlock.push(line);
      }
    }
  }

  // Don't forget the last block
  if (currentBlock.length > 0) {
    blocks.push({
      content: currentBlock.join("\n"),
      startLine: blockStartLine,
      endLine: baseLineNumber + lines.length - 1,
      isCodeBlock: inCodeBlock,
      isListBlock: inListBlock,
    });
  }

  return blocks;
}

/**
 * Extracts header hierarchy from markdown content.
 *
 * @param content - The full markdown content
 * @returns Array of header texts in order of appearance with their levels
 */
function extractHeaders(
  content: string
): Array<{ text: string; level: number; lineNumber: number }> {
  const lines = content.split("\n");
  const headers: Array<{ text: string; level: number; lineNumber: number }> =
    [];

  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code blocks to avoid treating code comments as headers
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    // Match markdown headers (# Header)
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      headers.push({
        level: headerMatch[1].length,
        text: headerMatch[2].trim(),
        lineNumber: i + 1,
      });
    }
  }

  return headers;
}

/**
 * Gets the parent headers for a given line number.
 *
 * @param lineNumber - The line number to get headers for
 * @param allHeaders - All headers in the document
 * @returns Array of parent header texts, from highest to lowest level
 */
function getParentHeaders(
  lineNumber: number,
  allHeaders: Array<{ text: string; level: number; lineNumber: number }>
): string[] {
  // Find all headers that appear before this line
  const precedingHeaders = allHeaders.filter(
    (h) => h.lineNumber <= lineNumber
  );

  // Build the header hierarchy
  const hierarchy: string[] = [];
  let currentLevel = 0;

  for (let i = precedingHeaders.length - 1; i >= 0; i--) {
    const header = precedingHeaders[i];
    if (header.level < currentLevel || currentLevel === 0) {
      hierarchy.unshift(header.text);
      currentLevel = header.level;
      if (currentLevel === 1) break;
    }
  }

  return hierarchy;
}

/**
 * Chunks a single file into memory chunks.
 *
 * The chunker:
 * - Targets ~400 tokens (~1600 chars) per chunk
 * - Maintains ~80 tokens (~320 chars) overlap between chunks
 * - Preserves markdown structure (code blocks, lists, headers)
 * - Tracks line numbers and header hierarchy for context
 *
 * @param filePath - Absolute path to the file
 * @param content - The file content
 * @returns Array of memory chunks
 */
export function chunkFile(filePath: string, content: string): MemoryChunk[] {
  // Handle empty files
  if (!content || content.trim() === "") {
    return [];
  }

  // Handle small files - return as single chunk
  if (content.length <= TARGET_CHUNK_SIZE) {
    const lines = content.split("\n");
    const headers = extractHeaders(content);
    const headerTexts = headers.map((h) => h.text);

    return [
      {
        filePath,
        startLine: 1,
        endLine: lines.length,
        content: content,
        contentHash: computeContentHash(content),
        headers: headerTexts.length > 0 ? headerTexts : undefined,
      },
    ];
  }

  // Parse the content into blocks
  const blocks = parseContentBlocks(content, 1);
  const allHeaders = extractHeaders(content);
  const chunks: MemoryChunk[] = [];

  let currentChunkContent: string[] = [];
  let currentChunkStartLine = 1;
  let currentChunkEndLine = 1;
  let currentSize = 0;

  const finalizeChunk = () => {
    if (currentChunkContent.length === 0) return;

    const chunkContent = currentChunkContent.join("\n\n");
    if (chunkContent.trim().length < MIN_CHUNK_SIZE) {
      // Too small, will be merged with next chunk
      return;
    }

    const headers = getParentHeaders(currentChunkStartLine, allHeaders);

    chunks.push({
      filePath,
      startLine: currentChunkStartLine,
      endLine: currentChunkEndLine,
      content: chunkContent,
      contentHash: computeContentHash(chunkContent),
      headers: headers.length > 0 ? headers : undefined,
    });
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockSize = block.content.length;

    // If this single block is larger than target size, we may need to handle it specially
    if (blockSize > TARGET_CHUNK_SIZE && !block.isCodeBlock) {
      // Finalize current chunk first
      if (currentChunkContent.length > 0) {
        finalizeChunk();
        currentChunkContent = [];
        currentSize = 0;
      }

      // Split large non-code blocks at sentence boundaries
      const sentences = block.content.split(/(?<=[.!?])\s+/);
      let sentenceChunk: string[] = [];
      let sentenceSize = 0;
      let sentenceStartLine = block.startLine;

      for (const sentence of sentences) {
        if (
          sentenceSize + sentence.length > TARGET_CHUNK_SIZE &&
          sentenceChunk.length > 0
        ) {
          // Estimate end line based on content proportion
          const proportion = sentenceSize / blockSize;
          const lineRange = block.endLine - block.startLine;
          const estimatedEndLine =
            sentenceStartLine + Math.floor(lineRange * proportion);

          const chunkContent = sentenceChunk.join(" ");
          const headers = getParentHeaders(sentenceStartLine, allHeaders);

          chunks.push({
            filePath,
            startLine: sentenceStartLine,
            endLine: estimatedEndLine,
            content: chunkContent,
            contentHash: computeContentHash(chunkContent),
            headers: headers.length > 0 ? headers : undefined,
          });

          // Start new chunk with overlap
          const overlapStart = Math.max(
            0,
            sentenceChunk.length - Math.ceil(sentenceChunk.length * 0.2)
          );
          sentenceChunk = sentenceChunk.slice(overlapStart);
          sentenceSize = sentenceChunk.join(" ").length;
          sentenceStartLine = estimatedEndLine;
        }

        sentenceChunk.push(sentence);
        sentenceSize += sentence.length + 1;
      }

      // Handle remaining sentences
      if (sentenceChunk.length > 0) {
        currentChunkContent = [sentenceChunk.join(" ")];
        currentChunkStartLine = sentenceStartLine;
        currentChunkEndLine = block.endLine;
        currentSize = sentenceChunk.join(" ").length;
      }
    } else if (currentSize + blockSize > TARGET_CHUNK_SIZE && currentSize > 0) {
      // Current chunk is full, finalize it
      finalizeChunk();

      // Start new chunk with overlap from previous content
      const overlapContent = getOverlapContent(
        currentChunkContent,
        CHUNK_OVERLAP
      );
      if (overlapContent) {
        currentChunkContent = [overlapContent, block.content];
        currentSize = overlapContent.length + blockSize;
      } else {
        currentChunkContent = [block.content];
        currentSize = blockSize;
      }
      currentChunkStartLine = block.startLine;
      currentChunkEndLine = block.endLine;
    } else {
      // Add block to current chunk
      if (currentChunkContent.length === 0) {
        currentChunkStartLine = block.startLine;
      }
      currentChunkContent.push(block.content);
      currentChunkEndLine = block.endLine;
      currentSize += blockSize;
    }
  }

  // Don't forget the last chunk
  if (currentChunkContent.length > 0) {
    const chunkContent = currentChunkContent.join("\n\n");
    const headers = getParentHeaders(currentChunkStartLine, allHeaders);

    chunks.push({
      filePath,
      startLine: currentChunkStartLine,
      endLine: currentChunkEndLine,
      content: chunkContent,
      contentHash: computeContentHash(chunkContent),
      headers: headers.length > 0 ? headers : undefined,
    });
  }

  return chunks;
}

/**
 * Gets overlap content from the end of the previous chunk.
 *
 * @param content - Array of content blocks
 * @param targetOverlap - Target overlap size in characters
 * @returns The overlap content or null if not enough content
 */
function getOverlapContent(
  content: string[],
  targetOverlap: number
): string | null {
  if (content.length === 0) return null;

  const fullContent = content.join("\n\n");
  if (fullContent.length <= targetOverlap) {
    return fullContent;
  }

  // Take content from the end
  let overlap = "";
  for (let i = content.length - 1; i >= 0 && overlap.length < targetOverlap; i--) {
    if (overlap.length > 0) {
      overlap = content[i] + "\n\n" + overlap;
    } else {
      overlap = content[i];
    }
  }

  // Trim to target size if necessary, trying to break at word boundary
  if (overlap.length > targetOverlap) {
    const trimPoint = overlap.indexOf(" ", overlap.length - targetOverlap);
    if (trimPoint > 0) {
      overlap = overlap.slice(trimPoint + 1);
    } else {
      overlap = overlap.slice(-targetOverlap);
    }
  }

  return overlap;
}

/**
 * Chunks multiple files into memory chunks.
 *
 * @param files - Array of file objects with path and content
 * @returns Array of memory chunks from all files
 */
export function chunkFiles(
  files: Array<{ path: string; content: string }>
): MemoryChunk[] {
  const allChunks: MemoryChunk[] = [];

  for (const file of files) {
    const fileChunks = chunkFile(file.path, file.content);
    allChunks.push(...fileChunks);
  }

  return allChunks;
}

/**
 * MemoryChunker class provides an object-oriented interface for chunking files.
 *
 * @example
 * ```typescript
 * const chunker = new MemoryChunker();
 *
 * // Chunk a single file
 * const chunks = chunker.chunkFile('/path/to/file.md', fileContent);
 *
 * // Chunk multiple files
 * const allChunks = chunker.chunkFiles([
 *   { path: '/path/to/file1.md', content: content1 },
 *   { path: '/path/to/file2.md', content: content2 },
 * ]);
 * ```
 */
export class MemoryChunker {
  private readonly targetChunkSize: number;
  private readonly chunkOverlap: number;

  /**
   * Creates a new MemoryChunker instance.
   *
   * @param options - Optional configuration
   * @param options.targetChunkSize - Target chunk size in characters (default: 1600)
   * @param options.chunkOverlap - Overlap between chunks in characters (default: 320)
   */
  constructor(options?: { targetChunkSize?: number; chunkOverlap?: number }) {
    this.targetChunkSize = options?.targetChunkSize ?? TARGET_CHUNK_SIZE;
    this.chunkOverlap = options?.chunkOverlap ?? CHUNK_OVERLAP;
  }

  /**
   * Chunks a single file into memory chunks.
   *
   * @param filePath - Absolute path to the file
   * @param content - The file content
   * @returns Array of memory chunks
   */
  chunkFile(filePath: string, content: string): MemoryChunk[] {
    return chunkFile(filePath, content);
  }

  /**
   * Chunks multiple files into memory chunks.
   *
   * @param files - Array of file objects with path and content
   * @returns Array of memory chunks from all files
   */
  chunkFiles(files: Array<{ path: string; content: string }>): MemoryChunk[] {
    return chunkFiles(files);
  }

  /**
   * Computes a SHA-256 hash of the content.
   *
   * @param content - The content to hash
   * @returns Hexadecimal string representation of the SHA-256 hash
   */
  computeContentHash(content: string): string {
    return computeContentHash(content);
  }
}
