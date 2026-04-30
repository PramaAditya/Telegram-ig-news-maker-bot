export const dictionary: Record<string, string> = {
  "israel": "1srαǝl",
  "hamas": "Hαmαs",
  "zionis": "Zıønıs",
  "hizbullah": "Hızbullαh",
  "hezbollah": "Hǝzbøllαh",
  "houthi": "Høuthı",
  "genosida": "Gǝnøsıdα",
  "bunuh": "bvnvh",
  "bantai": "bαntα1",
  "teroris": "tǝrørıs",
  "bom": "bøm",
  "syahid": "syαhıd",
  "gaza": "Gαzα",
  "palestina": "Pαlǝstınα",
  "penjajah": "pǝnjαjαh",
  "perang": "pǝrαng",
  "mati": "mαtı",
  "meledak": "mǝlǝdαk",
  "hancur": "hαncvr",
  "tewas": "tǝwαs"
};

export function censorText(text: string): string {
  if (typeof text !== 'string') return text;

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
  for (const [word, replacement] of Object.entries(dictionary)) {
    const regex = new RegExp(word, 'gi');
    
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
