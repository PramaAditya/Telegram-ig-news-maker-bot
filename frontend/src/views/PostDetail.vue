<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Save, RefreshCw } from 'lucide-vue-next'
import { getAuthHeaders, setPassword } from '../auth'
import { Fancybox } from '@fancyapps/ui'

const route = useRoute()
const postId = route.params.id

const post = ref<any>(null)
const loading = ref(true)
const saving = ref(false)
const generating = ref(false)
const error = ref('')

const openLightbox = (mediaArray: any[], index: number) => {
  const items = mediaArray.map(m => ({
    src: m.url,
    type: m.type === 'video' ? 'video' : 'image'
  }))
  Fancybox.show(items, { startIndex: index })
}

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
    
    // Ensure slides array exists and has at least two elements if empty
    if (!post.value.slides) post.value.slides = ['', '']
    
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
      body: JSON.stringify({ 
        text: post.value.text,
        title: post.value.title,
        coverImageUrl: post.value.coverImageUrl,
        slides: post.value.slides
      })
    })
    if (res.status === 401) return alert('Unauthorized')
    if (!res.ok) throw new Error('Failed to save')
    alert('Changes saved!')
  } catch (err: any) {
    alert(err.message)
  } finally {
    saving.value = false
  }
}

const regenerateMedia = async () => {
  if (!post.value.title || !post.value.coverImageUrl || !post.value.slides) {
    return alert('Title, Cover Image URL, and Slides cannot be empty to regenerate.')
  }
  
  // First save the current draft so backend uses the latest text
  await saveChanges()

  generating.value = true
  try {
    const res = await fetch(`/api/queue/${postId}/regenerate-media`, {
      method: 'POST',
      headers: getAuthHeaders()
    })
    if (res.status === 401) return alert('Unauthorized')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to regenerate media')
    
    // Update local media state with newly generated ones
    post.value.media = data.media
    alert('Media regenerated successfully!')
  } catch (err: any) {
    alert(err.message)
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <router-link to="/" class="p-2 bg-white rounded-full border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50">
          <ArrowLeft class="w-5 h-5" />
        </router-link>
        <h1 class="text-2xl font-bold text-gray-900">Edit Post #{{ postId }}</h1>
      </div>
      <button 
        @click="saveChanges" 
        :disabled="saving"
        class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
      >
        <Save class="w-4 h-4 mr-2" />
        {{ saving ? 'Saving...' : 'Save Draft' }}
      </button>
    </div>

    <div v-if="loading" class="text-center py-10 text-gray-500">Loading...</div>
    <div v-else-if="error" class="bg-red-50 text-red-600 p-4 rounded-md">{{ error }}</div>
    
    <div v-else-if="post" class="space-y-6 max-w-4xl mx-auto">
      
      <!-- Media Data Editor -->
      <div class="bg-white shadow rounded-lg p-6">
        <h2 class="text-lg font-bold mb-4 text-gray-800">Media Data (Render Engine)</h2>
        
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">Title (supports **bold**)</label>
          <textarea 
            v-model="post.title" 
            rows="3"
            class="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base"
          ></textarea>
        </div>

        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">Cover Image S3 URL</label>
          <input 
            v-model="post.coverImageUrl" 
            type="url"
            class="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
          />
          <img v-if="post.coverImageUrl" :src="post.coverImageUrl" class="mt-3 h-32 object-cover rounded-md border border-gray-200" />
        </div>

        <div v-for="(_, i) in post.slides" :key="i" class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">Slide {{ Number(i) + 1 }} Text (supports **bold**)</label>
          <textarea 
            v-model="post.slides[i]" 
            rows="5" 
            class="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base"
          ></textarea>
        </div>

        <button 
          @click="regenerateMedia" 
          :disabled="generating"
          class="w-full mt-4 inline-flex justify-center items-center px-4 py-3 border border-gray-300 shadow-sm text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw class="w-5 h-5 mr-2" :class="{ 'animate-spin': generating }" />
          {{ generating ? 'Generating Images from API...' : 'Regenerate Media Grid' }}
        </button>
      </div>

      <!-- Media Preview -->
      <div class="bg-white shadow rounded-lg p-6">
        <h2 class="text-lg font-bold mb-4 text-gray-800">Media Grid Preview</h2>
        <p class="text-sm text-gray-500 mb-6">This is the exact sequence that will be published. Note: The CTA Image is dynamically injected at publish time and is not shown here.</p>
        
        <div class="grid grid-cols-3 gap-4">
          <div v-for="(m, i) in post.media" :key="i" @click="openLightbox(post.media, Number(i))" class="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200 cursor-pointer hover:opacity-80 transition">
            <img v-if="m.type === 'image'" :src="m.url" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
              <span class="font-medium">Video</span>
              <span class="text-xs truncate w-full mt-1">{{ m.url }}</span>
            </div>
            <div class="absolute top-2 left-2 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded shadow">
              {{ i === 0 ? 'Cover' : 'Slide ' + i }}
            </div>
          </div>
        </div>
      </div>

      <!-- Final Caption Editor -->
      <div class="bg-white shadow rounded-lg p-6">
        <h2 class="text-lg font-bold mb-4 text-gray-800">Final Caption (Instagram Text)</h2>
        <textarea 
          v-model="post.text" 
          rows="12" 
          class="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base"
        ></textarea>
      </div>

    </div>
  </div>
</template>