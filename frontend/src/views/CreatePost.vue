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
    <div class="bg-default shadow rounded-lg p-6">
      <h1 class="text-2xl font-bold text-default mb-6 flex items-center">
        <PenTool class="w-6 h-6 mr-3 text-primary" />
        Create Content with AI
      </h1>
      
      <p class="text-sm text-muted mb-6">
        Enter a topic, URL, or raw text below. Our AI worker will automatically research, write the caption, and render the Instagram carousel images just like it does via Telegram.
      </p>

      <div class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-default mb-2">Template</label>
          <select 
            v-model="templateId"
            class="w-full px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-base bg-default text-default"
          >
            <option value="image-multiple:interval">Interval News (Carousel)</option>
            <!-- Add more templates here in the future -->
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-default mb-2">Topic or Reference URL *</label>
          <textarea 
            v-model="textInput" 
            rows="4" 
            placeholder="e.g. Breaking: Israel strikes Iran facility, or paste a news URL"
            class="w-full px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-base bg-default text-default placeholder-muted"
          ></textarea>
        </div>

        <div>
          <label class="block text-sm font-medium text-default mb-2">Optional Reference Image</label>
          <p class="text-xs text-muted mb-2">Upload an image to be used as a reference for the cover image generation, or as the actual cover. You can also paste an image directly anywhere on this page.</p>
          <ImageUploader ref="uploaderRef" v-model="mediaUrl" />
        </div>

        <UAlert v-if="error" color="error" variant="soft" :description="error" />

        <button 
          @click="generateContent" 
          :disabled="submitting || !textInput.trim()"
          class="w-full flex justify-center items-center px-4 py-3 border border-transparent shadow-sm text-base font-medium rounded-md text-inverted bg-primary hover:bg-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
        >
          <Loader2 v-if="submitting" class="w-5 h-5 mr-2 animate-spin" />
          {{ submitting ? 'Submitting to Worker...' : 'Generate Carousel' }}
        </button>
      </div>
    </div>

    <!-- Active Jobs Monitor -->
    <div v-if="activeJobs.length > 0" class="bg-default shadow rounded-lg p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-default">Processing Jobs</h2>
        <button @click="fetchActiveJobs" class="text-muted hover:text-primary">
          <RefreshCw class="w-5 h-5" />
        </button>
      </div>
      
      <div class="space-y-4">
        <div v-for="job in activeJobs" :key="job.id">
          <UAlert
            :title="job.text"
            :description="job.status === 'error' ? job.errorLog : undefined"
            :color="job.status === 'pending' ? 'warning' : job.status === 'processing' ? 'primary' : 'error'"
            variant="soft"
            :icon="job.status === 'pending' ? 'i-lucide-clock' : job.status === 'processing' ? 'i-lucide-loader-2' : 'i-lucide-alert-circle'"
            :class="{ 'animate-pulse': job.status === 'processing' }"
          >
            <template #title="{ title }">
              <div class="flex items-center gap-2">
                <UBadge :color="job.status === 'pending' ? 'warning' : job.status === 'processing' ? 'primary' : 'error'" variant="subtle" size="xs" class="uppercase">
                  {{ job.status }}
                </UBadge>
                <span class="text-sm font-medium line-clamp-1">{{ title }}</span>
              </div>
            </template>
          </UAlert>
        </div>
        <p class="text-xs text-muted mt-2 text-center">
          Jobs that successfully finish will move to the Pending Queue on the Home dashboard.
        </p>
      </div>
    </div>
  </div>
</template>