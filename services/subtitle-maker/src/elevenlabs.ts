import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

export interface TranscriptionWord {
  text: string;
  start: number;
  end: number;
  type: string;
}

export interface TranscriptionResponse {
  text: string;
  words?: TranscriptionWord[];
  language_code: string;
}

export async function transcribeAudio(filePath: string, apiKey: string): Promise<TranscriptionResponse> {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model_id', 'scribe_v1'); // Elevenlabs default or scribe_v1. Let's try scribe_v1 or just omit it if default works. 

  try {
    const response = await axios.post<TranscriptionResponse>('https://api.elevenlabs.io/v1/speech-to-text', form, {
      headers: {
        'xi-api-key': apiKey,
        ...form.getHeaders()
      }
    });
    
    return response.data;
  } catch (error: any) {
    console.error('Error transcribing audio:', error.response?.data || error.message);
    throw new Error('ElevenLabs transcription failed');
  }
}
