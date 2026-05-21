import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { transcribeAudio } from './elevenlabs';
import { chunkWords, buildSRT } from './chunker';
import { translateChunks, generateCaption, getLanguageName } from './gemini';
import { censorText, BannedWord } from './sanitize';

const app = express();
app.use(express.json());

const uploadDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Ensure api keys exist in env or pass from headers
app.post('/process', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path || req.body.filePath; // Allow internal path if shared volume
  
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File is required (upload or valid internal filePath)' });
  }

  const targetLanguage = req.body.targetLanguage || req.query.targetLanguage || req.body.targetLang || process.env.TARGET_LANG || 'ind';

  const {
    context = '',
    outputFormat = 'srt', // 'srt' or 'json'
    elevenLabsKey = process.env.ELEVENLABS_API_KEY,
    geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    censorDictionary // Expected to be of type BannedWord[]
  } = req.body;

  if (!elevenLabsKey || !geminiKey) {
    return res.status(400).json({ error: 'API Keys missing in environment or request body' });
  }

  try {
    console.log(`[subtitle-maker] Transcribing file: ${filePath}`);
    const transcription = await transcribeAudio(filePath, elevenLabsKey);
    const audioLang = transcription.language_code || 'en';

    if (!transcription.words || transcription.words.length === 0) {
      return res.status(400).json({ error: 'No words transcribed' });
    }

    console.log(`[subtitle-maker] Chunking words...`);
    const chunks = chunkWords(transcription.words);
    let finalChunks = chunks;

    const targetLangCode = targetLanguage.toLowerCase();
    const sourceLangCodeMatch = audioLang.toLowerCase().substring(0, 2);
    const targetLangCodeMatch = targetLangCode.substring(0, 2);

    if (sourceLangCodeMatch !== targetLangCodeMatch) {
      console.log(`[subtitle-maker] Translating from ${audioLang} to ${targetLanguage}...`);
      const translatedMap = await translateChunks(chunks, geminiKey, context);
      
      for (const chunk of finalChunks) {
        if (translatedMap[chunk.id]) {
          chunk.translatedText = translatedMap[chunk.id];
        }
      }
    }

    console.log(`[subtitle-maker] Censoring and building SRT...`);
    for (const chunk of finalChunks) {
      chunk.censoredText = censorText(chunk.translatedText || chunk.originalText, censorDictionary as BannedWord[]);
    }

    const srtContent = buildSRT(finalChunks, 'censoredText');
    const fullText = finalChunks.map(c => c.censoredText).join(' ');

    console.log(`[subtitle-maker] Generating caption...`);
    const caption = await generateCaption(fullText, geminiKey);

    if (outputFormat === 'json') {
      return res.json({
        srt: srtContent,
        chunks: finalChunks,
        caption,
        fullText
      });
    }

    // Default outputFormat 'srt'
    res.json({ srt: srtContent, caption, fullText });
  } catch (error: any) {
    console.error('[subtitle-maker] Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup uploaded file if it was uploaded via multer
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch(e) {}
    }
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Subtitle Maker API running on port ${PORT}`);
});