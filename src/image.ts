import axios from 'axios';

export async function generateMedia(endpoint: string, payload: any): Promise<string[]> {
  const baseUrl = process.env.IMAGE_API_URL || 'http://tools-htm2imageapi-pnoxac-b46226-103-197-189-173.traefik.me';
  
  // Clean trailing slashes from baseUrl and leading slashes from endpoint
  const url = `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;

  try {
    const response = await axios.post(url, payload);
    
    if (response.data && response.data.urls) {
      return response.data.urls;
    } else {
      throw new Error('Invalid response format from rendering API');
    }
  } catch (error) {
    console.error('Failed to generate media sequence:', error);
    throw new Error('Media sequence generation failed');
  }
}
