export interface BannedWord {
  word: string;
  replacement: string;
  type: 'exact' | 'partial';
}

export interface CensorResult {
  censoredText: string;
  replacedCount: number;
  replacedWords: string[];
}

export function censorTextWithReport(text: string, bannedWords: BannedWord[]): CensorResult {
  if (typeof text !== 'string' || !text || !bannedWords || bannedWords.length === 0) {
    return { censoredText: text, replacedCount: 0, replacedWords: [] };
  }

  // Step A: Extract and Protect URLs
  const urlRegex = /(https?:\/\/[^\s"'<>]+)/g;
  const extractedUrls: string[] = [];
  let protectedText = text.replace(urlRegex, (match) => {
    extractedUrls.push(match);
    return `__URL_PLACEHOLDER_${extractedUrls.length - 1}__`;
  });

  // Step B: Extract and Protect HTML Tags (e.g. <strong>, </strong>, <br/>, etc.)
  const htmlTagRegex = /(<[^>]+>)/g;
  const extractedHtml: string[] = [];
  protectedText = protectedText.replace(htmlTagRegex, (match) => {
    extractedHtml.push(match);
    return `__HTML_PLACEHOLDER_${extractedHtml.length - 1}__`;
  });

  let result = protectedText;
  let totalReplaced = 0;
  const matchedBannedWords: Set<string> = new Set();

  // Step C: Apply Censor Dictionary with accurate case matching
  for (const { word, replacement, type } of bannedWords) {
    if (!word || !replacement) continue;

    // Escape regex characters to prevent SyntaxError
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Build regex based on match type
    const pattern = type === 'exact' ? `\\b${escapedWord}\\b` : escapedWord;
    const regex = new RegExp(pattern, 'gi');

    result = result.replace(regex, (match) => {
      totalReplaced++;
      matchedBannedWords.add(word);

      const firstCharMatched = match.charAt(0);
      const firstCharRep = replacement.charAt(0);
      const restRep = replacement.slice(1);

      const hasCase = firstCharRep.toLowerCase() !== firstCharRep.toUpperCase();

      if (hasCase) {
        if (firstCharMatched === firstCharMatched.toUpperCase()) {
          return firstCharRep.toUpperCase() + restRep;
        } else {
          return firstCharRep.toLowerCase() + restRep;
        }
      } else {
        return replacement;
      }
    });
  }

  // Step D: Restore HTML Tags
  for (let i = 0; i < extractedHtml.length; i++) {
    result = result.replace(`__HTML_PLACEHOLDER_${i}__`, extractedHtml[i]);
  }

  // Step E: Restore URLs
  for (let i = 0; i < extractedUrls.length; i++) {
    result = result.replace(`__URL_PLACEHOLDER_${i}__`, extractedUrls[i]);
  }

  return {
    censoredText: result,
    replacedCount: totalReplaced,
    replacedWords: Array.from(matchedBannedWords)
  };
}
