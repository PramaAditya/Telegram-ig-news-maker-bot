<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useColorMode } from "@vueuse/core";
import { useConnectionStore } from "./store";
import { getAuthHeaders } from "./auth";
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui';

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

const connectionItems = computed<DropdownMenuItem[][]>(() => {
  if (loading.value) {
    return [[{ label: 'Loading...', disabled: true }]];
  }
  
  const connItems = connections.value.map(conn => ({
    label: conn.name || 'Unnamed',
    icon: 'i-lucide-link',
    onSelect(e: Event) {
      e.preventDefault();
      connectionStore.setActiveConnection(conn.id);
    }
  }));

  return [
    connItems,
    [{
      label: 'Create connection',
      icon: 'i-lucide-circle-plus',
      onSelect(e: Event) {
        e.preventDefault();
        createNewConnection();
      }
    }]
  ];
});

const activeConnectionLabel = computed(() => {
  if (loading.value) return 'Loading...';
  const active = connections.value.find(c => c.id === connectionStore.activeConnectionId);
  return active ? (active.name || 'Unnamed') : 'Select Connection';
});

const navItems = computed<NavigationMenuItem[]>(() => [
  { label: 'Queue', icon: 'i-lucide-list', to: '/' },
  { label: 'Ideas', icon: 'i-lucide-lightbulb', to: '/ideas' },
  { label: 'Jobs', icon: 'i-lucide-briefcase', to: '/jobs' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
  { label: 'Global Settings', icon: 'i-lucide-globe', to: '/global-settings' },
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
        <template #header>
          <UDropdownMenu
            :items="connectionItems"
            :content="{ align: 'start', collisionPadding: 12 }"
            :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width) min-w-48' }"
          >
            <UButton
              :label="activeConnectionLabel"
              icon="i-lucide-link"
              trailing-icon="i-lucide-chevrons-up-down"
              color="neutral"
              variant="ghost"
              square
              class="w-full data-[state=open]:bg-elevated overflow-hidden"
              :ui="{
                trailingIcon: 'text-dimmed ms-auto'
              }"
            />
          </UDropdownMenu>
        </template>

        <template #default="{ state }">
          <UNavigationMenu
            :key="state"
            :items="navItems"
            orientation="vertical"
            :ui="{ link: 'p-1.5 overflow-hidden' }"
          />
        </template>

        <template #footer>
          <UButton
            :icon="colorMode === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
            color="neutral"
            variant="ghost"
            class="w-full justify-start overflow-hidden"
            :label="'Toggle Theme'"
            @click="toggleColorMode"
          />
        </template>
      </USidebar>

      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div class="h-(--ui-header-height) shrink-0 flex items-center px-4 border-b border-default bg-default z-10">
          <UButton
            icon="i-lucide-panel-left"
            color="neutral"
            variant="ghost"
            aria-label="Toggle sidebar"
            @click="sidebarOpen = !sidebarOpen"
          />
          <h1 class="ml-4 text-lg font-semibold truncate">IG News Maker</h1>
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
