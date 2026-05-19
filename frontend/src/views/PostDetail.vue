<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Save } from 'lucide-vue-next'
import { getAuthHeaders, setPassword } from '../auth'

const route = useRoute()
const router = useRouter()
const postId = route.params.id

const post = ref<any>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref('')

const fetchPost = async () => {
  loading.value = true
  try {
    const res = await fetch('/api/queue', { headers: getAuthHeaders() })
    if (res.status === 401) {
      const pwd = prompt('Enter Dashboard Password:')
      if (pwd !== null) {
        setPassword(pwd)
        return fetchPost()
      }
      throw new Error('Unauthorized')
    }
    if (!res.ok) throw new Error('Failed to fetch queue')
    const queue = await res.json()
    post.value = queue.find((p: any) => p.id === parseInt(postId as string))
    if (!post.value) throw new Error('Post not found in pending queue')
    error.value = ''
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(fetchPost)

const saveChanges = async () => {
  saving.value = true
  try {
    const res = await fetch(`/api/queue/${postId}`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: post.value.text })
    })
    if (res.status === 401) return alert('Unauthorized')
    if (!res.ok) throw new Error('Failed to save')
    router.push('/')
  } catch (err: any) {
    alert(err.message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-center space-x-4">
      <router-link to="/" class="p-2 bg-white rounded-full border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50">
        <ArrowLeft class="w-5 h-5" />
      </router-link>
      <h1 class="text-2xl font-bold text-gray-900">Edit Post #{{ postId }}</h1>
    </div>

    <div v-if="loading" class="text-center py-10 text-gray-500">Loading...</div>
    <div v-else-if="error" class="bg-red-50 text-red-600 p-4 rounded-md">{{ error }}</div>
    
    <div v-else-if="post" class="bg-white shadow rounded-lg p-6">
      <div class="mb-6">
        <label class="block text-sm font-medium text-gray-700 mb-2">Caption Text</label>
        <textarea 
          v-model="post.text" 
          rows="10" 
          class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
        ></textarea>
      </div>

      <div class="mb-6">
        <label class="block text-sm font-medium text-gray-700 mb-2">Media Preview ({{ post.media.length }} items)</label>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div v-for="(m, i) in post.media" :key="i" class="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
            <img v-if="m.type === 'image'" :src="m.url" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
              <span class="font-medium">Video</span>
              <span class="text-xs truncate w-full mt-1">{{ m.url }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-end space-x-3 border-t border-gray-200 pt-6">
        <router-link to="/" class="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
          Cancel
        </router-link>
        <button 
          @click="saveChanges" 
          :disabled="saving"
          class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <Save class="w-4 h-4 mr-2" />
          {{ saving ? 'Saving...' : 'Save Changes' }}
        </button>
      </div>
    </div>
  </div>
</template>