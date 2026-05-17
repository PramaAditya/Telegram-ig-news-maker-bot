import axios from 'axios';
export async function generateNewsImage(params) {
    const url = process.env.IMAGE_API_URL || 'http://tools-htm2imageapi-pnoxac-b46226-103-197-189-173.traefik.me/render-template';
    const payload = {
        template: 'carousel_news_2_cover',
        params
    };
    try {
        const response = await axios.post(url, payload, {
            responseType: 'arraybuffer'
        });
        return Buffer.from(response.data, 'binary');
    }
    catch (error) {
        console.error('Failed to generate image:', error);
        throw new Error('Image generation failed');
    }
}
