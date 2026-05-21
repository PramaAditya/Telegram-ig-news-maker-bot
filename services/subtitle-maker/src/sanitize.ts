export interface BannedWord {
  word: string;
  replacement: string;
  type: 'exact' | 'partial';
}

export const defaultDictionary: BannedWord[] = [
  { word: "israel", replacement: "1srI?l", type: "partial" },
  { word: "hamas", replacement: "HImIs", type: "partial" },
  { word: "zionis", replacement: "ZA,ns", type: "partial" },
  { word: "hizbullah", replacement: "HzbullIh", type: "partial" },
  { word: "hezbollah", replacement: "H?zbA,llIh", type: "partial" },
  { word: "houthi", replacement: "HA,uth", type: "partial" },
  { word: "genosida", replacement: "G?nA,sdI", type: "partial" },
  { word: "bunuh", replacement: "bvnvh", type: "partial" },
  { word: "bantai", replacement: "bIntI1", type: "partial" },
  { word: "teroris", replacement: "t?rA,rs", type: "partial" },
  { word: "bom", replacement: "bA,m", type: "partial" },
  { word: "syahid", replacement: "syIhd", type: "partial" },
  { word: "gaza", replacement: "GIzI", type: "partial" },
  { word: "palestina", replacement: "PIl?stnI", type: "partial" },
  { word: "penjajah", replacement: "p?njIjIh", type: "partial" },
  { word: "perang", replacement: "p?rIng", type: "partial" },
  { word: "mati", replacement: "mIt", type: "partial" },
  { word: "meledak", replacement: "m?l?dIk", type: "partial" },
  { word: "hancur", replacement: "hIncvr", type: "partial" },
  { word: "tewas", replacement: "t?wIs", type: "partial" }
];

export function censorText(text: string, customDictionary?: BannedWord[]): string {
  if (typeof text !== 'string') return text;

  // Use custom dictionary if provided and not empty, otherwise fallback to default
  const activeDictionary = (customDictionary && customDictionary.length > 0) ? customDictionary : defaultDictionary;

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
  for (const { word, replacement, type } of activeDictionary) {
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
