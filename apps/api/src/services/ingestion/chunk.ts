import type { ParsedPage } from "./parse.js";
export type { ParsedPage };

export const TARGET_CHUNK_TOKENS = 600;
export const OVERLAP_TOKENS = 80;

// Character approximations based on ~4 chars per token
export const TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * 4; // ~2400 chars
export const OVERLAP_CHARS = OVERLAP_TOKENS * 4; // ~320 chars

export interface Chunk {
  chunkIndex: number;
  page: number;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

interface TextBlock {
  text: string;
  page: number;
  isHeading: boolean;
}

/**
 * Cheap token estimate: chars / 4 (plan.md 14.4).
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Check if a line is a heading marker.
 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  // Markdown headings: # Heading
  if (/^#{1,6}\s+\S+/.test(trimmed)) return true;
  // Underlined headings: === or ---
  if (/^[=-]{3,}\s*$/.test(trimmed)) return true;
  // Formal headings: Chapter 1, Section 2, Part I, Appendix A
  if (/^(chapter|section|part|appendix)\s+([0-9]+|[ivxlcdm]+|[a-z])/i.test(trimmed)) return true;
  // Numbered sections: 1. Introduction, 1.1 Background
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(trimmed) && trimmed.length < 100) return true;
  return false;
}

/**
 * Split text into blocks by blank lines and heading markers.
 */
function splitIntoBlocks(text: string, page: number): TextBlock[] {
  const rawParagraphs = text.split(/\r?\n\s*\r?\n+/);
  const blocks: TextBlock[] = [];

  for (const para of rawParagraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    // Check if the paragraph contains internal headings
    const lines = trimmedPara.split(/\r?\n/);
    let currentLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check for setext/underlined heading marker (=== or ---)
      if (/^[=-]{3,}\s*$/.test(trimmedLine)) {
        if (currentLines.length > 0) {
          const headingText = currentLines.pop()!.trim();
          if (currentLines.length > 0) {
            blocks.push({
              text: currentLines.join("\n").trim(),
              page,
              isHeading: false,
            });
            currentLines = [];
          }
          if (headingText) {
            blocks.push({
              text: headingText,
              page,
              isHeading: true,
            });
          }
        }
        continue;
      }

      if (isHeadingLine(line)) {
        if (currentLines.length > 0) {
          blocks.push({
            text: currentLines.join("\n").trim(),
            page,
            isHeading: false,
          });
          currentLines = [];
        }
        blocks.push({
          text: line.trim(),
          page,
          isHeading: true,
        });
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      blocks.push({
        text: currentLines.join("\n").trim(),
        page,
        isHeading: false,
      });
    }
  }

  return blocks;
}

/**
 * Split an oversized block into smaller pieces along sentence or word boundaries.
 */
function splitOversizedBlock(block: TextBlock, maxTokens: number): TextBlock[] {
  const maxChars = maxTokens * 4;
  if (block.text.length <= maxChars) {
    return [block];
  }

  // Split on sentence boundaries: (. ! ?) followed by space
  const sentences = block.text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [block.text];
  const subBlocks: TextBlock[] = [];
  let currentText = "";

  for (const sentence of sentences) {
    if ((currentText + sentence).length <= maxChars) {
      currentText += sentence;
    } else {
      if (currentText.trim()) {
        subBlocks.push({
          text: currentText.trim(),
          page: block.page,
          isHeading: block.isHeading && subBlocks.length === 0,
        });
        currentText = "";
      }

      if (sentence.length <= maxChars) {
        currentText = sentence;
      } else {
        // Sentence itself is oversized, split on words
        const words = sentence.split(/\s+/);
        let wordChunk = "";
        for (const word of words) {
          if (word.length > maxChars) {
            if (wordChunk.trim()) {
              subBlocks.push({
                text: wordChunk.trim(),
                page: block.page,
                isHeading: false,
              });
              wordChunk = "";
            }
            // Word itself exceeds maxChars (e.g. continuous unspaced sequence)
            for (let wIdx = 0; wIdx < word.length; wIdx += maxChars) {
              const slice = word.slice(wIdx, wIdx + maxChars);
              subBlocks.push({
                text: slice,
                page: block.page,
                isHeading: false,
              });
            }
            continue;
          }

          if ((wordChunk + " " + word).length <= maxChars) {
            wordChunk += (wordChunk ? " " : "") + word;
          } else {
            if (wordChunk.trim()) {
              subBlocks.push({
                text: wordChunk.trim(),
                page: block.page,
                isHeading: false,
              });
            }
            wordChunk = word;
          }
        }
        if (wordChunk.trim()) {
          currentText = wordChunk + " ";
        }
      }
    }
  }

  if (currentText.trim()) {
    subBlocks.push({
      text: currentText.trim(),
      page: block.page,
      isHeading: false,
    });
  }

  return subBlocks;
}

/**
 * Extract the trailing overlap text (approx overlapTokens).
 * Cuts at sentence or word boundary.
 */
function extractOverlapText(content: string, overlapTokens: number): string {
  const targetChars = overlapTokens * 4;
  if (content.length <= targetChars) {
    return content;
  }

  const slice = content.slice(content.length - targetChars);
  // Try to find the start of the first complete sentence within the slice
  const firstSentenceIdx = slice.search(/[.!?]\s+[A-Z0-9]/);
  if (firstSentenceIdx !== -1 && firstSentenceIdx < slice.length - 20) {
    return slice.slice(firstSentenceIdx + 2).trim();
  }

  // Fallback: find first word boundary
  const firstSpaceIdx = slice.indexOf(" ");
  if (firstSpaceIdx !== -1) {
    return slice.slice(firstSpaceIdx + 1).trim();
  }

  return slice.trim();
}

/**
 * Heading/paragraph-aware chunking pipeline.
 *
 * Chunks documents to ~600 tokens with ~80 token overlap.
 * Preserves page information where available.
 */
export function chunkDocument(
  pages: ParsedPage[],
  options: ChunkOptions = {},
): Chunk[] {
  const targetTokens = options.targetTokens ?? TARGET_CHUNK_TOKENS;
  const overlapTokens = options.overlapTokens ?? OVERLAP_TOKENS;
  const targetChars = targetTokens * 4;

  // 1. Gather all blocks from each page
  const allBlocks: TextBlock[] = [];
  for (const page of pages) {
    const pageBlocks = splitIntoBlocks(page.text, page.pageNumber);
    for (const b of pageBlocks) {
      if (estimateTokens(b.text) > targetTokens) {
        allBlocks.push(...splitOversizedBlock(b, targetTokens));
      } else {
        allBlocks.push(b);
      }
    }
  }

  if (allBlocks.length === 0) {
    return [];
  }

  const chunks: Chunk[] = [];
  let currentBlocks: TextBlock[] = [];
  let currentChars = 0;
  let overlapPrefix = "";
  let chunkIndex = 0;

  function flushChunk() {
    if (currentBlocks.length === 0) return;

    // The primary page is the page of the first new block in this chunk
    const page = currentBlocks[0].page;
    const bodyText = currentBlocks.map((b) => b.text).join("\n\n");
    const fullContent = overlapPrefix
      ? `${overlapPrefix}\n\n${bodyText}`
      : bodyText;

    const trimmedContent = fullContent.trim();
    if (trimmedContent) {
      chunks.push({
        chunkIndex,
        page,
        content: trimmedContent,
        tokenCount: estimateTokens(trimmedContent),
      });
      chunkIndex++;
      overlapPrefix = extractOverlapText(trimmedContent, overlapTokens);
    }

    currentBlocks = [];
    currentChars = overlapPrefix ? overlapPrefix.length : 0;
  }

  for (const block of allBlocks) {
    const blockChars = block.text.length;

    // If block is from a different page, flush previous page's chunk to preserve page boundary
    if (currentBlocks.length > 0 && block.page !== currentBlocks[0].page) {
      flushChunk();
    }

    // If block is a heading and we already have substantive content, flush before heading
    if (block.isHeading && currentChars > targetChars * 0.4) {
      flushChunk();
    }

    // Check if adding this block would exceed target
    if (currentChars + blockChars > targetChars && currentBlocks.length > 0) {
      flushChunk();
    }

    currentBlocks.push(block);
    currentChars += blockChars;
  }

  flushChunk();

  return chunks;
}
