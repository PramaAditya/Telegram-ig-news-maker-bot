import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useConnectionStore = defineStore('connection', () => {
  const activeConnectionId = ref<number | null>(null);

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

  return {
    activeConnectionId,
    setActiveConnection,
    loadFromStorage
  };
});
