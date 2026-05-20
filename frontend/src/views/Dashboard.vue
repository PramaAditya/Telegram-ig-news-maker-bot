<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Trash2, Edit, ArrowUp, ArrowDown, Send } from 'lucide-vue-next'
import { getAuthHeaders, setPassword } from '../auth'
import { Fancybox } from '@fancyapps/ui'

const queue = ref<any[]>([])
const loading = ref(true)
const error = ref('')

const openLightbox = (mediaArray: any[], index: number) => {
  const items = mediaArray.map(m => ({
    src: m.url,
    type: m.type === 'video' ? 'video' : 'image'
  }))
  Fancybox.show(items, { startIndex: index })
}

const fetchQueue = async () => {
  loading.value = true
  try {
    const res = await fetch('/api/queue', { headers: getAuthHeaders() })
    if (res.status === 401) {
      const pwd = prompt('Enter Dashboard Password:')
      if (pwd !== null) {
        setPassword(pwd)
        return fetchQueue()
      }
      throw new Error('Unauthorized')
    }
    if (!res.ok) throw new Error('Failed to fetch')
    queue.value = await res.json()
    error.value = ''
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(fetchQueue)

const moveItem = async (id: number, direction: 'up' | 'down' | 'top') => {
  try {
    const res = await fetch(`/api/queue/${id}/move`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction })
    })
    if (res.status === 401) {
      alert('Unauthorized. Please refresh and re-enter password.')
      return
    }
    fetchQueue()
  } catch (err) {
    alert('Failed to move')
  }
}

const deleteItem = async (id: number) => {
  if (!confirm('Are you sure you want to delete this post?')) return
  try {
    const res = await fetch(`/api/queue/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    if (res.status === 401) return alert('Unauthorized')
    fetchQueue()
  } catch (err) {
    alert('Failed to delete')
  }
}

const publishNow = async (id: number) => {
  if (!confirm('Are you sure you want to publish this post IMMEDIATELY to Buffer?')) return
  try {
    const res = await fetch(`/api/queue/${id}/publish`, {
      method: 'POST',
      headers: getAuthHeaders()
    })
    if (res.status === 401) return alert('Unauthorized')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to publish')
    alert('Published successfully!')
    fetchQueue()
  } catch (err: any) {
    alert(err.message)
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">Pending Queue</h1>
      <button @click="fetchQueue" class="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
        Refresh
      </button>
    </div>

    <div v-if="loading" class="text-center py-10 text-gray-500 dark:text-gray-400">Loading queue...</div>
    <div v-else-if="error" class="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-4 rounded-md mb-4">{{ error }}</div>
    <div v-else-if="queue.length === 0" class="text-center py-10 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-gray-500 dark:text-gray-400">
      The queue is empty.
    </div>
    
    <div v-else class="bg-white dark:bg-gray-900 shadow rounded-lg overflow-hidden">
      <ul class="divide-y divide-gray-200 dark:divide-gray-800">
        <li v-for="(item, index) in queue" :key="item.id" class="p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <div class="flex items-start space-x-4">
            <div class="flex-shrink-0 flex flex-col space-y-1 mt-1">
              <button @click="moveItem(item.id, 'up')" :disabled="index === 0" class="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-30 disabled:hover:text-gray-400 dark:disabled:hover:text-gray-500">
                <ArrowUp class="w-5 h-5" />
              </button>
              <button @click="moveItem(item.id, 'down')" :disabled="index === queue.length - 1" class="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-30 disabled:hover:text-gray-400 dark:disabled:hover:text-gray-500">
                <ArrowDown class="w-5 h-5" />
              </button>
            </div>
            
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">{{ item.text }}</p>
              <div class="mt-2 flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                  {{ item.media.length }} media item(s)
                </span>
                <span>•</span>
                <span>Added {{ new Date(item.createdAt).toLocaleString() }}</span>
              </div>
              
              <div class="mt-3 flex space-x-2" v-if="item.media.length > 0">
                <div v-for="(m, i) in item.media.slice(0, 3)" :key="i" @click="openLightbox(item.media, Number(i))" class="cursor-pointer hover:opacity-80 transition w-16 h-16 rounded overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <img v-if="m.type === 'image'" :src="m.url" class="w-full h-full object-cover" />
                  <div v-else class="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-xs">Video</div>
                </div>
                <div v-if="item.media.length > 3" @click="openLightbox(item.media, 3)" class="cursor-pointer hover:opacity-80 transition w-16 h-16 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-sm font-medium text-gray-500 dark:text-gray-400">
                  +{{ item.media.length - 3 }}
                </div>
              </div>
            </div>
            
            <div class="flex-shrink-0 flex space-x-2">
              <router-link :to="'/post/' + item.id" class="p-2 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Edit details">
                <Edit class="w-5 h-5" />
              </router-link>
              <button @click="publishNow(item.id)" class="p-2 text-gray-400 dark:text-gray-500 hover:text-green-600 dark:hover:text-green-400 rounded-md hover:bg-green-50 dark:hover:bg-green-900/20" title="Publish immediately">
                <Send class="w-5 h-5" />
              </button>
              <button @click="deleteItem(item.id)" class="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete post">
                <Trash2 class="w-5 h-5" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>