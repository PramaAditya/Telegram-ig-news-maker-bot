import axios from 'axios';

export async function publishToBuffer(imageUrl: string, text: string) {
  const bufferToken = process.env.BUFFER_API_KEY;
  const channelId = process.env.BUFFER_INSTAGRAM_CHANNEL_ID;

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
          mode: addToQueue
          metadata: {
            instagram: {
              type: post
              shouldShareToFeed: true
            }
          }
          assets: {
            images: [
              {
                url: "${imageUrl}"
              }
            ]
          }
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
