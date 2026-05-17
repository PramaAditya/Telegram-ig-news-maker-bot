import axios from 'axios';

export interface SlideParams {
  text: string;
}

export interface ImageSequenceParams {
  logo: string;
  cover_image: string;
  title: string;
  slides: SlideParams[];
}

export async function generateImageSequence(params: ImageSequenceParams): Promise<string[]> {
  const url = process.env.IMAGE_API_URL || 'http://tools-htm2imageapi-pnoxac-b46226-103-197-189-173.traefik.me/render-template-multiple';
  
  try {
    const response = await axios.post(url, params);
    
    if (response.data && response.data.urls) {
      return response.data.urls;
    } else {
      throw new Error('Invalid response format from image API');
    }
  } catch (error) {
    console.error('Failed to generate image sequence:', error);
    throw new Error('Image sequence generation failed');
  }
}
