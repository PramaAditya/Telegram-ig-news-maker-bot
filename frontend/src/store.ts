import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getAuthHeaders } from './auth';
import type { BannedWord } from './sanitize';

export interface ConnectionRecord {
  id: number;
  name: string;
  bannedWords?: BannedWord[];
  [key: string]: unknown;
}

export const useConnectionStore = defineStore('connection', () => {
  const activeConnectionId = ref<number | null>(null);
  const connections = ref<ConnectionRecord[]>([]);
  const loadingConnections = ref(false);
  const setActiveConnection = (id: number | null) => {
    activeConnectionId.value = id;
    if (id !== null) {
      localStorage.setItem('activeConnectionId', id.toString());
    } else {
      localStorage.removeItem('activeConnectionId');
    }
  };

  const loadFromStorage = () => {
    const stored = localStorage.getItem('activeConnectionId');
    if (stored) {
      activeConnectionId.value = parseInt(stored, 10);
    }
  };

  const fetchConnections = async () => {
    loadingConnections.value = true;
    try {
      const res = await fetch('/api/connections', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        connections.value = data;
        if (data.length > 0 && !activeConnectionId.value) {
          setActiveConnection(data[0].id);
        } else if (data.length === 0) {
          setActiveConnection(null);
        } else if (!data.find((c: ConnectionRecord) => c.id === activeConnectionId.value)) {
          setActiveConnection(data[0].id);
        }
        return data as ConnectionRecord[];
      }
    } catch (err) {
      console.error('Failed to fetch connections:', err);
    } finally {
      loadingConnections.value = false;
    }
    return [];
  };

  const ensureConnectionsLoaded = async () => {
    if (connections.value.length === 0) {
      return await fetchConnections();
    }
    return connections.value;
  };

  const getBannedWords = (connectionId?: number | null): BannedWord[] => {
    const targetId = connectionId ?? activeConnectionId.value;
    if (targetId) {
      const match = connections.value.find((c) => c.id === targetId);
      if (match?.bannedWords && match.bannedWords.length > 0) {
        return match.bannedWords;
      }
    }
    // If no specific match or no banned words in that connection, check first connection with banned words
    const withWords = connections.value.find((c) => c.bannedWords && c.bannedWords.length > 0);
    return withWords?.bannedWords || [];
  };

  return {
    activeConnectionId,
    connections,
    loadingConnections,
    setActiveConnection,
    loadFromStorage,
    fetchConnections,
    ensureConnectionsLoaded,
    getBannedWords
  };
});
