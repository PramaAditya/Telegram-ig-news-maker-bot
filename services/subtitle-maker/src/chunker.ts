import { TranscriptionWord } from './elevenlabs';

export interface Chunk {
  id: number;
  originalText: string;
  start: number;
  end: number;
  translatedText?: string;
  censoredText?: string;
}

export function chunkWords(words: TranscriptionWord[]): Chunk[] {
  const chunks: Chunk[] = [];
  let currentChunk: Chunk | null = null;
  let chunkId = 1;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    
    // Sometimes type might be 'punctuation' or 'spacing', we need to handle it.
    // Assuming text contains the actual characters including space/punctuation, or we just join text.
    // ElevenLabs `characters` and `type` could be useful, but `text` usually contains the word.
    const wordText = word.text.trim();
    if (!wordText) continue;

    if (!currentChunk) {
      currentChunk = {
        id: chunkId++,
        start: word.start,
        end: word.end,
        originalText: word.text
      };
    } else {
      const gap = word.start - currentChunk.end;
      const duration = word.end - currentChunk.start;
      const futureCharCount = currentChunk.originalText.length + word.text.length + 1;

      // Rules for breaking chunks (1 line limit):
      // 1. Silence gap > 1.0 seconds
      // 2. Chunk duration > 3 seconds (shorter for 1 line)
      // 3. Max characters > 40 (approx 1 line)
      // 4. Punctuation (end of sentence: '.', '?', '!')
      const isEndOfSentence = /[.?!]$/.test(currentChunk.originalText.trim());

      if (gap > 1.0 || duration > 3.0 || futureCharCount > 40 || isEndOfSentence) {
        // Push current chunk and start new one
        chunks.push({ ...currentChunk, originalText: currentChunk.originalText.trim() });
        currentChunk = {
          id: chunkId++,
          start: word.start,
          end: word.end,
          originalText: word.text
        };
      } else {
        // Add to current chunk
        currentChunk.end = word.end;
        currentChunk.originalText += (currentChunk.originalText.endsWith(' ') || word.text.startsWith(' ') ? '' : ' ') + word.text;
      }
    }
  }

  if (currentChunk) {
    chunks.push({ ...currentChunk, originalText: currentChunk.originalText.trim() });
  }

  return chunks;
}

export function formatTimeSRT(seconds: number): string {
  const date = new Date(seconds * 1000);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms}`;
}

export function buildSRT(chunks: Chunk[], translatedTexts: Record<number, string>): string {
  interface ProcessedChunk {
    start: number;
    end: number;
    text: string;
  }

  let processed: ProcessedChunk[] = [];

  for (const chunk of chunks) {
    let text = (translatedTexts[chunk.id] || chunk.originalText).trim();
    
    // 1. Remove trailing dot
    text = text.replace(/\.+$/, '').trim();

    // 2. Merge single word line to previous
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount === 1 && processed.length > 0) {
      const prev = processed[processed.length - 1];
      prev.text += ' ' + text;
      prev.end = chunk.end;
    } else {
      processed.push({
        start: chunk.start,
        end: chunk.end,
        text: text
      });
    }
  }

  // 3. Remove gaps by extending end timestamp
  for (let i = 0; i < processed.length - 1; i++) {
    processed[i].end = processed[i + 1].start;
  }

  let srtContent = '';
  let counter = 1;
  for (const p of processed) {
    srtContent += `${counter}\n`;
    srtContent += `${formatTimeSRT(p.start)} --> ${formatTimeSRT(p.end)}\n`;
    srtContent += p.text + '\n\n';
    counter++;
  }
  return srtContent.trim();
}
