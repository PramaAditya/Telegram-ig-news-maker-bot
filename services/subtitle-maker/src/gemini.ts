import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import { Chunk } from './chunker';

const getGeminiModel = (apiKey: string) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: process.env.SUBTITLE_GENERATOR_MODEL || 'gemini-1.5-flash' }); // Fallback to 1.5-flash if env is empty
};

export const getLanguageName = (code: string): string => {
  const map: Record<string, string> = {
    'id': 'Indonesian (Bahasa Indonesia)',
    'ind': 'Indonesian (Bahasa Indonesia)',
    'en': 'English',
    'eng': 'English',
    'es': 'Spanish',
    'spa': 'Spanish',
    'fr': 'French',
    'fra': 'French',
    'de': 'German',
    'deu': 'German',
    'ja': 'Japanese',
    'jpn': 'Japanese',
    'ko': 'Korean',
    'kor': 'Korean',
    'zh': 'Mandarin Chinese',
    'zho': 'Mandarin Chinese',
    'ar': 'Arabic',
    'ara': 'Arabic',
    'hi': 'Hindi',
    'hin': 'Hindi',
    'pt': 'Portuguese',
    'por': 'Portuguese',
    'tr': 'Turkish',
    'tur': 'Turkish',
    'nl': 'Dutch',
    'nld': 'Dutch',
    'sv': 'Swedish',
    'swe': 'Swedish',
    'pl': 'Polish',
    'pol': 'Polish',
    'da': 'Danish',
    'dan': 'Danish',
    'ru': 'Russian',
    'rus': 'Russian',
    'fi': 'Finnish',
    'fin': 'Finnish'
  };
  return map[code.toLowerCase()] || code;
};

export async function translateChunks(chunks: Chunk[], apiKey: string, context?: string): Promise<Record<number, string>> {
  const model = getGeminiModel(apiKey);
  
  const payload = chunks.map(c => ({
    id: c.id,
    text: c.originalText
  }));

  const contextAddon = context && context.trim() !== '' 
    ? `\nAdditional context from user (use this to help understand names, topics, or nuances):\n"${context.trim()}"\n` 
    : '';

  const targetLangCode = process.env.TARGET_LANG || 'ind';
  const targetLanguage = getLanguageName(targetLangCode);

  const prompt = `You are an expert Translator, Localizer, and Video Editor Assistant specializing in Islamic and Geopolitical content.

OBJECTIVE:
Translate the following subtitle chunks into natural, conversational ${targetLanguage}. 
Maintain the exact IDs provided. Return ONLY a valid JSON array of objects with 'id' and 'text' properties.

RULES:
1. Translate to ${targetLanguage} naturally.
2. Do not use ellipsis ("..."). Use standard punctuation efficiently.
3. Keep the text concise and suitable for subtitles.
4. You are allowed to shift words between adjacent chunks to make the subtitle readable and grammatically correct, as long as you output the exact same number of IDs.${contextAddon}

Input chunks:
${JSON.stringify(payload, null, 2)}`;

  const responseSchema: Schema = {
    type: SchemaType.ARRAY,
    items: {
      type: SchemaType.OBJECT,
      properties: {
        id: { type: SchemaType.INTEGER },
        text: { type: SchemaType.STRING }
      },
      required: ["id", "text"]
    }
  };

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.3
      }
    });

    const responseText = result.response.text();
    const translatedArray: { id: number; text: string }[] = JSON.parse(responseText);
    
    const translatedMap: Record<number, string> = {};
    for (const item of translatedArray) {
      translatedMap[item.id] = item.text;
    }
    
    return translatedMap;
  } catch (error) {
    console.error("Gemini Translation Error:", error);
    throw new Error('Failed to translate chunks with Gemini');
  }
}

export async function generateCaption(translatedText: string, apiKey: string): Promise<string> {
  const model = getGeminiModel(apiKey);
  
  const prompt = `Buatkan caption Instagram yang singkat, natural, dan punchy (seperti ditulis oleh aktivis atau pengguna medsos asli, bukan robot/AI) berdasarkan transkrip video di bawah ini.

Tone/Sudut Pandang:
- Pro Poros Perlawanan (Palestina, Iran, Lebanon, Irak, Yaman)
- Kritis terhadap narasi Barat, Israel, dan negara-negara Teluk (GCC) yang pro-Barat.

Aturan:
- JANGAN gunakan bahasa yang kaku, terlalu formal, atau seperti esai propaganda.
- Buat maksimal 2-3 kalimat saja yang tajam dan langsung ke intinya.
- Sertakan maksimal 3-5 hashtag yang paling relevan.
- Buat dalam format plaintext murni (tanpa bold/italic/asterisk markdown).
- Langsung berikan captionnya, tanpa kata-kata pengantar seperti "Berikut adalah captionnya".

Transkrip Video:
${translatedText}`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Gemini Caption Error:", error);
    return "Caption failed to generate.";
  }
}
