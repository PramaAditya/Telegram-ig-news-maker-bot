import axios from 'axios';
import { getSettings } from './db/settings.js';

export interface BufferMediaItem {
  type: 'image' | 'video';
  url: string;
}

export async function fetchBufferChannelNetwork(bufferToken: string, channelId: string): Promise<string> {
  const query = `
    query GetChannel($channelId: String!) {
      channel(id: $channelId) {
        service
      }
    }
  `;

  const payload = {
    query,
    variables: { channelId }
  };

  const url = 'https://api.buffer.com/1/graphql';

  try {
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

    const service = data.data?.channel?.service;
    if (!service) {
      throw new Error('Could not find channel service');
    }

    return service;
  } catch (error: any) {
    console.error('Buffer API error fetching channel network:', error.response?.data || error.message);
    throw new Error(error.response?.data?.errors?.[0]?.message || error.message || 'Failed to fetch Buffer channel network');
  }
}

export async function publishToBuffer(media: BufferMediaItem[], text: string, publishMetadata: any = {}) {
  const settings = await getSettings();
  const bufferToken = settings.bufferApiKey;
  const channelId = settings.bufferChannelId;
  const channelNetwork = settings.bufferChannelNetwork || 'instagram';

  if (!bufferToken || !channelId) {
    throw new Error('Buffer API credentials missing.');
  }

  // Because Buffer's GraphQL schema has very specific enum types for schedulingType and mode
  // that are hard to pass as string variables, and $assets type might be tricky,
  // we will construct the query dynamically using JSON.stringify for the complex objects.
  
  // Merge the queue item's specific publish metadata, with fallback for instagram
  let metadata = publishMetadata || {};
  if (Object.keys(metadata).length === 0 && channelNetwork === 'instagram') {
    metadata = {
      instagram: {
        type: "post",
        shouldShareToFeed: true
      }
    };
  }

  // Determine the correct asset mapping based on network
  const assets = media.map(m => {
    if (m.type === 'image') return { image: { url: m.url } };
    if (m.type === 'video') return { video: { url: m.url } };
    return { image: { url: m.url } };
  });

  // Convert metadata to GraphQL format (unquoted keys)
  const metadataString = Object.keys(metadata).length > 0 
    ? `metadata: ${JSON.stringify(metadata).replace(/"([^"]+)":/g, '$1:')}`
    : '';

  const assetsString = `assets: [${assets.map(a => 
    `{ ${Object.keys(a)[0]}: { url: "${Object.values(a)[0].url}" } }`
  ).join(',\n')}]`;

  const query = `
    mutation CreatePost {
      createPost(
        input: {
          text: ${JSON.stringify(text)}
          channelId: "${channelId}"
          schedulingType: automatic
          mode: shareNow
          ${metadataString}
          ${assetsString}
        }
      ) {
        ... on PostActionSuccess {
          post {
            id
            text
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
