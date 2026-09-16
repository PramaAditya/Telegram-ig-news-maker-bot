import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pollBufferingPosts } from '../../src/worker/polling.js';

describe('Worker: pollBufferingPosts & Telegram Notification', () => {
  let mockDb: any;
  let mockTelegram: any;
  let mockGetBufferPostStatus: any;
  let mockGetConnections: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 9999 }),
    };

    mockGetBufferPostStatus = vi.fn();

    mockGetConnections = vi.fn().mockResolvedValue([
      { id: 1, bufferApiKey: 'token_conn_1' }
    ]);
  });

  it('should update post to published and send Telegram notification with Instagram link when Buffer status is sent', async () => {
    const bufferingPost = {
      id: 101,
      connectionId: 1,
      chatId: '12345678',
      messageId: 555,
      text: 'Reaktor fusi eksperimental berhasil capai rekor baru.',
      bufferPostId: 'buf_101',
      status: 'buffering',
      retryCount: 0,
    };

    // DB select returns 1 buffering post
    mockDb.where.mockResolvedValueOnce([bufferingPost]);

    // Buffer API returns sent with Instagram externalLink
    mockGetBufferPostStatus.mockResolvedValueOnce({
      id: 'buf_101',
      status: 'sent',
      externalLink: 'https://www.instagram.com/p/C_abc123/',
      sentAt: '2026-09-16T10:00:00.000Z',
    });

    const updateSetMock = vi.fn().mockReturnThis();
    const updateWhereMock = vi.fn().mockResolvedValueOnce([]);
    mockDb.update.mockReturnValue({
      set: updateSetMock.mockReturnValue({
        where: updateWhereMock
      })
    });

    await pollBufferingPosts({
      db: mockDb,
      telegram: mockTelegram,
      getBufferPostStatus: mockGetBufferPostStatus,
      getConnections: mockGetConnections,
    });

    // 1. Buffer status was checked with connection token
    expect(mockGetBufferPostStatus).toHaveBeenCalledWith('token_conn_1', 'buf_101');

    // 2. DB was updated to published with postUrl
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'published',
        postUrl: 'https://www.instagram.com/p/C_abc123/',
      })
    );

    // 3. Telegram notification was sent with inline button link
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
      '12345678',
      expect.stringContaining('Postingan Berhasil Terbit di Instagram'),
      expect.objectContaining({
        reply_to_message_id: 555,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 Buka Postingan Instagram',
                url: 'https://www.instagram.com/p/C_abc123/'
              }
            ]
          ]
        }
      })
    );
  });

  it('should not update DB or notify Telegram if Buffer status is still sending', async () => {
    const bufferingPost = {
      id: 102,
      connectionId: 1,
      chatId: '12345678',
      messageId: 556,
      text: 'Still rendering...',
      bufferPostId: 'buf_102',
      status: 'buffering',
    };

    mockDb.where.mockResolvedValueOnce([bufferingPost]);

    mockGetBufferPostStatus.mockResolvedValueOnce({
      id: 'buf_102',
      status: 'sending',
      externalLink: null,
    });

    await pollBufferingPosts({
      db: mockDb,
      telegram: mockTelegram,
      getBufferPostStatus: mockGetBufferPostStatus,
      getConnections: mockGetConnections,
    });

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
  });

  it('should schedule auto-retry when Buffer status is error and retries are under limit', async () => {
    const bufferingPost = {
      id: 103,
      connectionId: 1,
      chatId: '12345678',
      messageId: 557,
      text: 'Temporary network failure on Instagram',
      bufferPostId: 'buf_103',
      status: 'buffering',
      retryCount: 1,
    };

    mockDb.where.mockResolvedValueOnce([bufferingPost]);

    mockGetBufferPostStatus.mockResolvedValueOnce({
      id: 'buf_103',
      status: 'error',
      externalLink: null,
      message: 'Instagram Graph API rate limited'
    });

    const updateSetMock = vi.fn().mockReturnThis();
    const updateWhereMock = vi.fn().mockResolvedValueOnce([]);
    mockDb.update.mockReturnValue({
      set: updateSetMock.mockReturnValue({
        where: updateWhereMock
      })
    });

    await pollBufferingPosts({
      db: mockDb,
      telegram: mockTelegram,
      getBufferPostStatus: mockGetBufferPostStatus,
      getConnections: mockGetConnections,
      maxRetries: 3
    });

    // Post reset to pending with incremented retry count & next retry timestamp
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        retryCount: 2,
        nextRetryAt: expect.any(Date),
      })
    );
    expect(mockTelegram.sendMessage).not.toHaveBeenCalled();
  });

  it('should mark post as error and notify user when retries are exhausted', async () => {
    const bufferingPost = {
      id: 104,
      connectionId: 1,
      chatId: '12345678',
      messageId: 558,
      text: 'Exhausted retries',
      bufferPostId: 'buf_104',
      status: 'buffering',
      retryCount: 3, // Already at maxRetries
    };

    mockDb.where.mockResolvedValueOnce([bufferingPost]);

    mockGetBufferPostStatus.mockResolvedValueOnce({
      id: 'buf_104',
      status: 'error',
      externalLink: null,
      message: 'Persistent media upload failure'
    });

    const updateSetMock = vi.fn().mockReturnThis();
    const updateWhereMock = vi.fn().mockResolvedValueOnce([]);
    mockDb.update.mockReturnValue({
      set: updateSetMock.mockReturnValue({
        where: updateWhereMock
      })
    });

    await pollBufferingPosts({
      db: mockDb,
      telegram: mockTelegram,
      getBufferPostStatus: mockGetBufferPostStatus,
      getConnections: mockGetConnections,
      maxRetries: 3
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        errorLog: expect.stringContaining('Persistent media upload failure'),
      })
    );

    // Notify failure on Telegram
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
      '12345678',
      expect.stringContaining('Gagal Terbit di Instagram'),
      expect.objectContaining({
        reply_to_message_id: 558,
        parse_mode: 'HTML',
      })
    );
  });
  it('should send Telegram notification to adminChatId when post was triggered from DASHBOARD', async () => {
    const dashboardPost = {
      id: 105,
      connectionId: 1,
      chatId: 'DASHBOARD',
      messageId: Date.now(),
      text: 'Post created and published from Dashboard',
      bufferPostId: 'buf_105',
      status: 'buffering',
    };

    mockDb.where.mockResolvedValueOnce([dashboardPost]);

    mockGetBufferPostStatus.mockResolvedValueOnce({
      id: 'buf_105',
      status: 'sent',
      externalLink: 'https://www.instagram.com/p/C_dashboard/',
      sentAt: '2026-09-16T11:00:00.000Z',
    });

    const updateSetMock = vi.fn().mockReturnThis();
    const updateWhereMock = vi.fn().mockResolvedValueOnce([]);
    mockDb.update.mockReturnValue({
      set: updateSetMock.mockReturnValue({
        where: updateWhereMock
      })
    });

    await pollBufferingPosts({
      db: mockDb,
      telegram: mockTelegram,
      getBufferPostStatus: mockGetBufferPostStatus,
      getConnections: mockGetConnections,
      adminChatId: 'admin_chat_999'
    });

    expect(mockTelegram.sendMessage).toHaveBeenCalledWith(
      'admin_chat_999',
      expect.stringContaining('via Dashboard'),
      expect.objectContaining({
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 Buka Postingan Instagram',
                url: 'https://www.instagram.com/p/C_dashboard/'
              }
            ]
          ]
        }
      })
    );
  });
});
