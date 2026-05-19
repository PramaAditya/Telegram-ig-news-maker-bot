import axios from 'axios';
import { getSettings } from './db/settings.js';

export interface BufferMediaItem {
  type: 'image' | 'video';
  url: string;
}

export async function publishToBuffer(media: BufferMediaItem[], text: string) {
  const settings = await getSettings();
  const bufferToken = settings.bufferApiKey;
  const channelId = settings.bufferInstagramChannelId;

  if (!bufferToken || !channelId) {
    throw new Error('Buffer API credentials missing.');
  }

  const query = `
    mutation CreatePost {
      createPost(
        input: {
          text: ${JSON.stringify(text)}
          channelId: "${channelId}"
          schedulingType: automatic
          mode: shareNow
          metadata: {
            instagram: {
              type: post
              shouldShareToFeed: true
            }
          }
          assets: [
            ${media.map(m => `{ ${m.type}: { url: "${m.url}" } }`).join(',\n            ')}
          ]
        }
      ) {
        ... on PostActionSuccess {
          post {
            id
            text
            assets {
              id
              mimeType
            }
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const payload = { query };

  const url = 'https://api.buffer.com/1/graphql';

  try {
    // Note: Bearer token is standard, but sometimes buffer expects basic auth with token or just the token in header
    // The docs say: 'Authorization': 'Bearer YOUR_API_KEY'
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bufferToken}`
      }
    });

    const data = response.data;
    if (data.errors) {
      throw new Error(data.errors[0].message);
    }

    const mutationResult = data.data?.createPost;
    if (mutationResult?.message) {
      // MutationError
      throw new Error(mutationResult.message);
    }

    return mutationResult?.post;
  } catch (error: any) {
    console.error('Buffer API error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.errors?.[0]?.message || error.message || 'Failed to publish to Buffer');
  }
}
