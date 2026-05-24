<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Moon, Plus, Globe, Loader2, Link } from 'lucide-vue-next'
import { useColorMode } from '@vueuse/core'
import { useConnectionStore } from './store'
import { getAuthHeaders } from './auth'

const colorMode = useColorMode()
const toggleColorMode = () => {
  colorMode.value = colorMode.value === 'dark' ? 'light' : 'dark'
}

const connectionStore = useConnectionStore()
const connections = ref<any[]>([])
const loading = ref(true)

const fetchConnections = async () => {
  loading.value = true
  try {
    const res = await fetch('/api/connections', { headers: getAuthHeaders() })
    if (res.ok) {
      connections.value = await res.json()
      if (connections.value.length > 0 && !connectionStore.activeConnectionId) {
        connectionStore.setActiveConnection(connections.value[0].id)
      } else if (connections.value.length === 0) {
         connectionStore.setActiveConnection(null)
      } else {
         // ensure active connection still exists
         if (!connections.value.find(c => c.id === connectionStore.activeConnectionId)) {
             connectionStore.setActiveConnection(connections.value[0].id)
         }
      }
    }
  } catch (err) {
    console.error('Failed to fetch connections:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  connectionStore.loadFromStorage()
  fetchConnections()
})

const createNewConnection = async () => {
  try {
    const res = await fetch('/api/connections', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Connection' })
    })
    if (res.ok) {
      const data = await res.json()
      await fetchConnections()
      connectionStore.setActiveConnection(data.connection.id)
    }
  } catch (err) {
     console.error(err)
  }
}

</script>

<template>
  <UApp>
    <div class="min-h-screen bg-muted text-default flex flex-col sm:flex-row">
      <!-- Sidebar -->
      <aside class="w-full sm:w-64 bg-default border-r border-default flex flex-col">
        <div class="p-4 border-b border-default flex items-center justify-between">
          <router-link to="/" class="text-xl font-bold text-default">IG News Maker</router-link>
          <UButton :icon="Moon" color="neutral" variant="ghost" @click="toggleColorMode" />
        </div>

        <div class="p-4 flex-1 overflow-y-auto">
          <div class="mb-2 text-xs font-semibold text-muted uppercase tracking-wider flex justify-between items-center">
            <span>Connections</span>
            <button @click="createNewConnection" class="text-primary hover:text-primary-600 transition" title="Add Connection">
              <Plus class="w-4 h-4" />
            </button>
          </div>
          
          <div v-if="loading" class="flex justify-center py-4">
             <Loader2 class="w-5 h-5 animate-spin text-muted" />
          </div>
          <div v-else-if="connections.length === 0" class="text-sm text-muted py-2 italic">
            No connections found.
          </div>
          <div v-else class="space-y-1">
            <button 
              v-for="conn in connections" 
              :key="conn.id"
              @click="connectionStore.setActiveConnection(conn.id)"
              :class="[
                'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left truncate',
                connectionStore.activeConnectionId === conn.id 
                  ? 'bg-primary text-inverted font-medium' 
                  : 'text-default hover:bg-elevated'
              ]"
            >
              <Link class="w-4 h-4 flex-shrink-0" />
              <span class="truncate">{{ conn.name || 'Unnamed' }}</span>
            </button>
          </div>
        </div>

        <div class="p-4 border-t border-default space-y-1">
          <router-link to="/global-settings" class="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-default hover:bg-elevated transition-colors" active-class="bg-elevated font-medium">
             <Globe class="w-4 h-4" />
             Global Settings
          </router-link>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="flex-1 flex flex-col min-w-0">
         <nav class="bg-default border-b border-default px-4 py-3 sticky top-0 z-10 hidden sm:block">
           <div class="max-w-5xl mx-auto">
            <div class="flex space-x-4">
              <router-link to="/ideas" class="text-sm font-medium text-muted hover:text-default px-2 py-1 rounded-md" active-class="bg-elevated text-default">Ideas</router-link>
              <router-link to="/" class="text-sm font-medium text-muted hover:text-default px-2 py-1 rounded-md" active-class="bg-elevated text-default">Queue</router-link>
              <router-link to="/jobs" class="text-sm font-medium text-muted hover:text-default px-2 py-1 rounded-md" active-class="bg-elevated text-default">Jobs</router-link>
              <router-link to="/settings" class="text-sm font-medium text-muted hover:text-default px-2 py-1 rounded-md" active-class="bg-elevated text-default">Settings</router-link>
            </div>
           </div>
         </nav>
        <div class="p-4 sm:p-8 max-w-5xl mx-auto w-full">
           <router-view></router-view>
        </div>
      </main>
    </div>
  </UApp>
</template>

