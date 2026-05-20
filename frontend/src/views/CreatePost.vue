<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { PenTool, Loader2, RefreshCw } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'
import ImageUploader from '../components/ImageUploader.vue'

const textInput = ref('')
const mediaUrl = ref('')
const templateId = ref('image-multiple:interval')
const submitting = ref(false)
const error = ref('')
const activeJobs = ref<any[]>([])
const uploaderRef = ref<InstanceType<typeof ImageUploader> | null>(null)

const handlePaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile()
      if (file && uploaderRef.value) {
        uploaderRef.value.uploadFile(file)
        break // Only handle first image
      }
    }
  }
}

const fetchActiveJobs = async () => {
  try {
    const res = await fetch('/api/jobs/dashboard', { headers: getAuthHeaders() })
    if (res.ok) {
      activeJobs.value = await res.json()
    }
  } catch (e) {}
}

onMounted(() => {
  fetchActiveJobs()
  // Refresh active jobs every 5 seconds
  setInterval(fetchActiveJobs, 5000)
  window.addEventListener('paste', handlePaste)
})

onUnmounted(() => {
  window.removeEventListener('paste', handlePaste)
})

const generateContent = async () => {
  if (!textInput.value.trim()) return alert('Topic or text input is required.')
  
  submitting.value = true
  error.value = ''
  
  try {
    const res = await fetch('/api/generate-content', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: textInput.value,
        mediaUrl: mediaUrl.value,
        templateId: templateId.value
      })
    })
    
    if (res.status === 401) return alert('Unauthorized')
    
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to trigger generation')
    
    alert('Generation triggered! The worker is processing it.')
    textInput.value = ''
    mediaUrl.value = ''
    fetchActiveJobs()
    
    // Optionally redirect to dashboard or let them wait here
    // router.push('/')
  } catch (err: any) {
    error.value = err.message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div class="bg-white dark:bg-gray-900 shadow rounded-lg p-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
        <PenTool class="w-6 h-6 mr-3 text-blue-600 dark:text-blue-400" />
        Create Content with AI
      </h1>
      
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Enter a topic, URL, or raw text below. Our AI worker will automatically research, write the caption, and render the Instagram carousel images just like it does via Telegram.
      </p>

      <div class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Template</label>
          <select 
            v-model="templateId"
            class="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="image-multiple:interval">Interval News (Carousel)</option>
            <!-- Add more templates here in the future -->
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Topic or Reference URL *</label>
          <textarea 
            v-model="textInput" 
            rows="4" 
            placeholder="e.g. Breaking: Israel strikes Iran facility, or paste a news URL"
            class="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          ></textarea>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Optional Reference Image</label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Upload an image to be used as a reference for the cover image generation, or as the actual cover. You can also paste an image directly anywhere on this page.</p>
          <ImageUploader ref="uploaderRef" v-model="mediaUrl" />
        </div>

        <div v-if="error" class="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-4 rounded-md text-sm">
          {{ error }}
        </div>

        <button 
          @click="generateContent" 
          :disabled="submitting || !textInput.trim()"
          class="w-full flex justify-center items-center px-4 py-3 border border-transparent shadow-sm text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <Loader2 v-if="submitting" class="w-5 h-5 mr-2 animate-spin" />
          {{ submitting ? 'Submitting to Worker...' : 'Generate Carousel' }}
        </button>
      </div>
    </div>

    <!-- Active Jobs Monitor -->
    <div v-if="activeJobs.length > 0" class="bg-white dark:bg-gray-900 shadow rounded-lg p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-gray-800 dark:text-gray-200">Processing Jobs</h2>
        <button @click="fetchActiveJobs" class="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400">
          <RefreshCw class="w-5 h-5" />
        </button>
      </div>
      
      <div class="space-y-4">
        <div v-for="job in activeJobs" :key="job.id" class="p-4 rounded-md border border-gray-200 dark:border-gray-800" :class="{
          'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-900/50': job.status === 'pending',
          'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-900/50': job.status === 'processing',
          'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900/50': job.status === 'error'
        }">
          <div class="flex justify-between items-start">
            <div class="flex-1">
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase mb-2" :class="{
                'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-400': job.status === 'pending',
                'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-400': job.status === 'processing',
                'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-400': job.status === 'error'
              }">
                {{ job.status }}
              </span>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">{{ job.text }}</p>
              
              <div v-if="job.status === 'error'" class="mt-2 text-xs text-red-600 dark:text-red-400 font-mono bg-red-100 dark:bg-red-900/50 p-2 rounded">
                {{ job.errorLog }}
              </div>
            </div>
          </div>
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
          Jobs that successfully finish will move to the Pending Queue on the Home dashboard.
        </p>
      </div>
    </div>
  </div>
</template>