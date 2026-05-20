export interface BannedWord {
  word: string;
  replacement: string;
  type: 'exact' | 'partial';
}

export function censorText(text: string, bannedWords: BannedWord[]): string {
  if (typeof text !== 'string') return text;
  if (!bannedWords || bannedWords.length === 0) return text;

  // Step A: Extract and Protect URLs
  const urlRegex = /(https?:\/\/[^\s"'<>]+)/g;
  const extractedUrls: string[] = [];
  
  let protectedText = text.replace(urlRegex, (match) => {
    extractedUrls.push(match);
    return `__URL_PLACEHOLDER_${extractedUrls.length - 1}__`; 
  });

  // Step B: Fix Newline
  let result = protectedText.replace(/\\n/g, '\n').replace(/\/n/g, '\n');

  // Step C: Apply Censor Dictionary with accurate case matching
  for (const { word, replacement, type } of bannedWords) {
    if (!word || !replacement) continue;
    
    // Escape regex characters to prevent SyntaxError
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Build regex based on match type
    const pattern = type === 'exact' ? `\\b${escapedWord}\\b` : escapedWord;
    const regex = new RegExp(pattern, 'gi');
    
    result = result.replace(regex, (match) => {
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

  // Step D: Restore URLs
  for (let i = 0; i < extractedUrls.length; i++) {
    result = result.replace(`__URL_PLACEHOLDER_${i}__`, extractedUrls[i] as string);
  }

  return result;
}
