<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useColorMode } from "@vueuse/core";
import { useConnectionStore } from "./store";
import { getAuthHeaders } from "./auth";
import type { NavigationMenuItem } from '@nuxt/ui';

const colorMode = useColorMode();
const toggleColorMode = () => {
  colorMode.value = colorMode.value === "dark" ? "light" : "dark";
};

const connectionStore = useConnectionStore();
const connections = ref<any[]>([]);
const loading = ref(true);
const sidebarOpen = ref(true);

const fetchConnections = async () => {
  loading.value = true;
  try {
    const res = await fetch("/api/connections", { headers: getAuthHeaders() });
    if (res.ok) {
      connections.value = await res.json();
      if (connections.value.length > 0 && !connectionStore.activeConnectionId) {
        connectionStore.setActiveConnection(connections.value[0].id);
      } else if (connections.value.length === 0) {
        connectionStore.setActiveConnection(null);
      } else {
        // ensure active connection still exists
        if (
          !connections.value.find(
            (c) => c.id === connectionStore.activeConnectionId,
          )
        ) {
          connectionStore.setActiveConnection(connections.value[0].id);
        }
      }
    }
  } catch (err) {
    console.error("Failed to fetch connections:", err);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  connectionStore.loadFromStorage();
  fetchConnections();
});

const createNewConnection = async () => {
  try {
    const res = await fetch("/api/connections", {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Connection" }),
    });
    if (res.ok) {
      const data = await res.json();
      await fetchConnections();
      connectionStore.setActiveConnection(data.connection.id);
    }
  } catch (err) {
    console.error(err);
  }
};

const sidebarNavItems = computed<NavigationMenuItem[]>(() => {
  if (loading.value) {
    return [{ label: 'Loading...', disabled: true, icon: 'i-lucide-loader-2' }];
  }
  
  const connItems = connections.value.map(conn => ({
    label: conn.name || 'Unnamed',
    icon: 'i-lucide-link',
    active: connectionStore.activeConnectionId === conn.id,
    onSelect(e: Event) {
      e.preventDefault();
      connectionStore.setActiveConnection(conn.id);
    }
  }));

  return [
    ...connItems,
    {
      label: 'Create connection',
      icon: 'i-lucide-circle-plus',
      onSelect(e: Event) {
        e.preventDefault();
        createNewConnection();
      }
    }
  ];
});

const topNavItems = computed<NavigationMenuItem[]>(() => [
  { label: 'Queue', icon: 'i-lucide-list', to: '/' },
  { label: 'Ideas', icon: 'i-lucide-lightbulb', to: '/ideas' },
  { label: 'Jobs', icon: 'i-lucide-briefcase', to: '/jobs' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]);
</script>

<template>
  <UApp>
    <div class="flex flex-1 h-screen overflow-hidden bg-default text-default">
      <USidebar
        v-model:open="sidebarOpen"
        collapsible="icon"
        rail
        :ui="{
          container: 'h-full',
          inner: 'bg-elevated/25 divide-transparent',
          body: 'py-0'
        }"
      >
        <template #header="{ state }">
          <div class="font-semibold text-sm px-2 py-1 text-muted uppercase tracking-wider" v-if="state === 'expanded'">
            Connections
          </div>
          <div v-else class="flex justify-center py-2">
            <UIcon name="i-lucide-plug" class="text-muted w-5 h-5" />
          </div>
        </template>

        <template #default="{ state }">
          <UNavigationMenu
            :key="state"
            :items="sidebarNavItems"
            orientation="vertical"
            :ui="{ link: 'p-1.5 overflow-hidden' }"
          />
        </template>

        <template #footer>
          <div class="flex flex-col gap-1 w-full">
            <UButton
              label="Global Settings"
              icon="i-lucide-globe"
              color="neutral"
              variant="ghost"
              class="w-full justify-start overflow-hidden"
              to="/global-settings"
            />
            <UButton
              :icon="colorMode === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
              color="neutral"
              variant="ghost"
              class="w-full justify-start overflow-hidden"
              label="Toggle Theme"
              @click="toggleColorMode"
            />
          </div>
        </template>
      </USidebar>

      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div class="h-(--ui-header-height) shrink-0 flex items-center px-4 border-b border-default bg-default z-10 gap-2">
          <UButton
            icon="i-lucide-panel-left"
            color="neutral"
            variant="ghost"
            aria-label="Toggle sidebar"
            @click="sidebarOpen = !sidebarOpen"
          />
          <h1 class="text-lg font-semibold truncate shrink-0 mr-4">IG News Maker</h1>
          
          <UNavigationMenu
            :items="topNavItems"
            orientation="horizontal"
            class="flex-1 min-w-0 overflow-x-auto"
          />
        </div>

        <div class="flex-1 overflow-y-auto p-4 sm:p-8">
          <div class="max-w-5xl mx-auto w-full">
            <router-view></router-view>
          </div>
        </div>
      </div>
    </div>
  </UApp>
</template>