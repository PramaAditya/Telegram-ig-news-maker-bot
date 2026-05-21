import { GoogleGenAI, Type } from '@google/genai';
import { Chunk } from './chunker';

const getGenAIClient = (apiKey: string) => {
  return new GoogleGenAI({ apiKey });
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

export async function uploadMediaToGemini(mediaPath: string, mimeType: string, apiKey: string) {
  const ai = getGenAIClient(apiKey);
  
  const uploadResponse = await ai.files.upload({
    file: mediaPath,
    config: {
      mimeType: mimeType,
      displayName: "Subtitle Maker Source Media",
    }
  });
  
  const uploadedFileId = uploadResponse.name || '';
  console.log(`[gemini] Uploaded file to Gemini: ${uploadedFileId}`);
  
  let fileState = uploadResponse.state;
  while (fileState === 'PROCESSING') {
    console.log('[gemini] Processing file on Gemini, waiting 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const getResponse = await ai.files.get({ name: uploadedFileId });
    fileState = getResponse.state;
  }
  
  if (fileState === 'FAILED') {
    throw new Error("Gemini failed to process the media file.");
  }

  return uploadResponse;
}

export async function deleteMediaFromGemini(uploadedFileId: string, apiKey: string) {
  if (!uploadedFileId) return;
  const ai = getGenAIClient(apiKey);
  try {
    await ai.files.delete({ name: uploadedFileId });
    console.log(`[gemini] Deleted file from Gemini: ${uploadedFileId}`);
  } catch (cleanupError) {
    console.error(`[gemini] Failed to delete file ${uploadedFileId} from Gemini:`, cleanupError);
  }
}

export async function translateChunks(chunks: Chunk[], apiKey: string, context?: string, uploadedMedia?: any): Promise<Record<number, string>> {
  const ai = getGenAIClient(apiKey);
  
  const payload = chunks.map(c => ({
    id: c.id,
    text: c.originalText
  }));

  const contextAddon = context && context.trim() !== '' 
    ? `\nAdditional context from user:\n"${context.trim()}"\n` 
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
4. You are allowed to shift words between adjacent chunks to make the subtitle readable and grammatically correct, as long as you output the exact same number of IDs.
5. STRONGLY ENCOURAGED: Use parentheses "(...)" to insert short, implicit context (based on the user context provided below or the provided media) that clarifies ambiguous terms or sentences.${contextAddon}

Input chunks:
${JSON.stringify(payload, null, 2)}`;

  try {
    const contents: any[] = [];
    if (uploadedMedia) {
      contents.push({
        fileData: {
          fileUri: uploadedMedia.uri,
          mimeType: uploadedMedia.mimeType
        }
      });
    }
    contents.push(prompt);

    const modelName = process.env.SUBTITLE_GENERATOR_MODEL || 'gemini-2.5-flash';

    const result = await ai.models.generateContent({
      model: modelName,
      contents: contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              text: { type: Type.STRING }
            },
            required: ["id", "text"]
          }
        },
        temperature: 0.3
      }
    });

    const responseText = result.text || "[]";
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
