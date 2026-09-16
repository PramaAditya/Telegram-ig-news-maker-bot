import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { getBufferPostStatus } from '../../src/buffer.js';

vi.mock('axios');

describe('Buffer Post Status API (getBufferPostStatus)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return sent status and externalLink when post is successfully published to Instagram', async () => {
    const mockResponse = {
      data: {
        data: {
          post: {
            id: 'buffer_post_123',
            status: 'sent',
            externalLink: 'https://www.instagram.com/p/C_abc123/',
            sentAt: '2026-09-16T09:00:00.000Z',
          }
        }
      }
    };

    vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

    const result = await getBufferPostStatus('mock-token-123', 'buffer_post_123');

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.buffer.com',
      expect.objectContaining({
        query: expect.stringContaining('buffer_post_123')
      }),
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock-token-123'
        }
      })
    );

    expect(result).toEqual({
      id: 'buffer_post_123',
      status: 'sent',
      externalLink: 'https://www.instagram.com/p/C_abc123/',
      sentAt: '2026-09-16T09:00:00.000Z',
    });
  });

  it('should return sending status with null externalLink when post is still being published', async () => {
    const mockResponse = {
      data: {
        data: {
          post: {
            id: 'buffer_post_456',
            status: 'sending',
            externalLink: null,
            sentAt: null,
          }
        }
      }
    };

    vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

    const result = await getBufferPostStatus('mock-token-123', 'buffer_post_456');

    expect(result.status).toBe('sending');
    expect(result.externalLink).toBeNull();
  });

  it('should return error status and message when post failed on Buffer / Instagram', async () => {
    const mockResponse = {
      data: {
        data: {
          post: {
            id: 'buffer_post_789',
            status: 'error',
            externalLink: null,
            sentAt: null,
          }
        }
      }
    };

    vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

    const result = await getBufferPostStatus('mock-token-123', 'buffer_post_789');

    expect(result.status).toBe('error');
    expect(result.externalLink).toBeNull();
  });

  it('should throw an error if Buffer GraphQL returns top-level errors', async () => {
    const mockResponse = {
      data: {
        errors: [{ message: 'Post not found or unauthorized' }]
      }
    };

    vi.mocked(axios.post).mockResolvedValueOnce(mockResponse);

    await expect(getBufferPostStatus('mock-token-123', 'invalid_id'))
      .rejects
      .toThrow('Post not found or unauthorized');
  });
});
