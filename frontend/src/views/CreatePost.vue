<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { PenTool, Loader2, RefreshCw } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'
import ImageUploader from '../components/ImageUploader.vue'
import { useConnectionStore } from '../store'

const toast = useToast()
const connectionStore = useConnectionStore()

const tabItems = [
  { label: 'AI Generated', slot: 'ai', icon: 'i-lucide-sparkles' },
  { label: 'Manual Queue', slot: 'manual', icon: 'i-lucide-pen-tool' }
]
const activeTab = ref('ai')

const textInput = ref('')
const mediaUrls = ref<string[]>([])
const templateId = ref('image:kabar.perjuangan:carousel_dark')
const submitting = ref(false)
const error = ref('')
const activeJobs = ref<any[]>([])
const uploaderRef = ref<InstanceType<typeof ImageUploader> | null>(null)
let intervalId: any = null;

// Manual Form State
const manualType = ref('post')
const manualText = ref('')
const manualMediaUrls = ref<string[]>([])
const manualSubmitting = ref(false)
const manualError = ref('')
const manualUploaderRef = ref<InstanceType<typeof ImageUploader> | null>(null)

const handlePaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
      const file = item.getAsFile()
      if (file) {
        if (activeTab.value === 'ai' && uploaderRef.value) {
          uploaderRef.value.uploadFile(file)
        } else if (activeTab.value === 'manual' && manualUploaderRef.value) {
          manualUploaderRef.value.uploadFile(file)
        }
      }
    }
  }
}

const fetchActiveJobs = async () => {
  if (!connectionStore.activeConnectionId) {
    activeJobs.value = []
    return
  }

  try {
    const res = await fetch(`/api/jobs/dashboard?connectionId=${connectionStore.activeConnectionId}`, { headers: getAuthHeaders() })
    if (res.ok) {
      activeJobs.value = await res.json()
    }
  } catch (e) {}
}

watch(() => connectionStore.activeConnectionId, () => {
  fetchActiveJobs();
}, { immediate: true });

onMounted(() => {
  intervalId = setInterval(fetchActiveJobs, 5000)
  window.addEventListener('paste', handlePaste)
})

onUnmounted(() => {
  clearInterval(intervalId)
  window.removeEventListener('paste', handlePaste)
})

const generateContent = async () => {
  if (!textInput.value.trim()) {
    toast.add({ title: 'Topic or text input is required.', color: 'error' })
    return
  }
  if (!connectionStore.activeConnectionId) {
    toast.add({ title: 'Please select a connection first.', color: 'error' })
    return
  }
  
  submitting.value = true
  error.value = ''
  
  try {
    const res = await fetch('/api/generate-content', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        connectionId: connectionStore.activeConnectionId,
        text: textInput.value,
        mediaUrls: mediaUrls.value,
        templateId: templateId.value
      })
    })
    
    if (res.status === 401) {
      toast.add({ title: 'Unauthorized', color: 'error' })
      return
    }
    
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to trigger generation')
    
    toast.add({ title: 'Generation triggered!', description: 'The worker is processing it.', color: 'success' })
    textInput.value = ''
    mediaUrls.value = []
    fetchActiveJobs()
  } catch (err: any) {
    error.value = err.message
  } finally {
    submitting.value = false
  }
}

const isVideo = (url: string) => {
  return url.match(/\.(mp4|mov|webm)$/i) !== null
}

const submitManual = async () => {
  if (!manualText.value.trim()) {
    manualError.value = 'Caption text is required.'
    return
  }
  if (!manualMediaUrls.value || manualMediaUrls.value.length === 0) {
    manualError.value = 'At least one media file is required.'
    return
  }
  if (!connectionStore.activeConnectionId) {
    manualError.value = 'Please select a connection first.'
    return
  }
  
  manualError.value = ''

  if (manualType.value === 'reel') {
    if (manualMediaUrls.value.length > 1) {
      manualError.value = 'Reels can only have one video.'
      return
    }
    if (!isVideo(manualMediaUrls.value[0])) {
      manualError.value = 'Reels must be a video file.'
      return
    }
  } else if (manualType.value === 'post') {
    for (const url of manualMediaUrls.value) {
      if (isVideo(url)) {
        manualError.value = 'Posts must be image only. No video files allowed.'
        return
      }
    }
  }

  manualSubmitting.value = true
  
  try {
    const formattedMedia = manualMediaUrls.value.map(url => ({
      url,
      type: isVideo(url) ? 'video' : 'image'
    }))

    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        connectionId: connectionStore.activeConnectionId,
        text: manualText.value,
        media: formattedMedia,
        type: manualType.value
      })
    })
    
    if (res.status === 401) {
      toast.add({ title: 'Unauthorized', color: 'error' })
      return
    }
    
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to add to queue')
    
    toast.add({ title: 'Added to Queue!', description: 'Your post has been successfully queued.', color: 'success' })
    manualText.value = ''
    manualMediaUrls.value = []
  } catch (err: any) {
    manualError.value = err.message
  } finally {
    manualSubmitting.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div class="bg-default shadow rounded-lg p-6">
      <h1 class="text-2xl font-bold text-default mb-6 flex items-center">
        <PenTool class="w-6 h-6 mr-3 text-primary" />
        Create Content
      </h1>
      
      <div v-if="!connectionStore.activeConnectionId" class="text-center py-10 bg-default border border-default rounded-lg text-muted mb-6">
         Please select or create a connection from the sidebar.
      </div>

      <div v-else>
        <UTabs :items="tabItems" class="w-full" @change="(index: number) => activeTab = tabItems[index].slot">
          <!-- AI Generated Tab -->
          <template #ai>
            <div class="mt-6 space-y-6">
              <p class="text-sm text-muted mb-6">
                Enter a topic, URL, or raw text below. Our AI worker will automatically research, write the caption, and render the Instagram carousel images just like it does via Telegram.
              </p>

              <div>
                <label class="block text-sm font-medium text-default mb-2">Template</label>
                <select 
                  v-model="templateId"
                  class="w-full px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-base bg-default text-default"
                >
                  <option value="image:kabar.perjuangan:carousel_dark">Carousel Dark (kabar.perjuangan)</option>
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
                <label class="block text-sm font-medium text-default mb-2">Optional Reference Media</label>
                <p class="text-xs text-muted mb-2">Upload images or videos to be used as a reference or as the actual media. You can also paste media directly anywhere on this page.</p>
                <ImageUploader ref="uploaderRef" v-model="mediaUrls" :multiple="true" />
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
          </template>

          <!-- Manual Queue Tab -->
          <template #manual>
            <div class="mt-6 space-y-6">
              <p class="text-sm text-muted mb-6">
                Directly add a post or reel to your pending queue without AI generation.
              </p>
              
              <div>
                <label class="block text-sm font-medium text-default mb-2">Post Type</label>
                <div class="flex items-center space-x-4">
                  <label class="inline-flex items-center">
                    <input type="radio" v-model="manualType" value="post" class="form-radio text-primary border-default bg-default" />
                    <span class="ml-2 text-default">Post (Images only)</span>
                  </label>
                  <label class="inline-flex items-center">
                    <input type="radio" v-model="manualType" value="reel" class="form-radio text-primary border-default bg-default" />
                    <span class="ml-2 text-default">Reel (Single video)</span>
                  </label>
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-default mb-2">Caption *</label>
                <textarea 
                  v-model="manualText" 
                  rows="4" 
                  placeholder="Enter your caption here..."
                  class="w-full px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-base bg-default text-default placeholder-muted"
                ></textarea>
              </div>

              <div>
                <label class="block text-sm font-medium text-default mb-2">Media *</label>
                <p class="text-xs text-muted mb-2">Upload or paste media here.</p>
                <ImageUploader ref="manualUploaderRef" v-model="manualMediaUrls" :multiple="manualType === 'post'" />
              </div>

              <UAlert v-if="manualError" color="error" variant="soft" :description="manualError" />

              <button 
                @click="submitManual" 
                :disabled="manualSubmitting || !manualText.trim() || manualMediaUrls.length === 0"
                class="w-full flex justify-center items-center px-4 py-3 border border-transparent shadow-sm text-base font-medium rounded-md text-inverted bg-primary hover:bg-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
              >
                <Loader2 v-if="manualSubmitting" class="w-5 h-5 mr-2 animate-spin" />
                {{ manualSubmitting ? 'Queueing...' : 'Add to Queue' }}
              </button>
            </div>
          </template>
        </UTabs>
      </div>
    </div>

    <!-- Active Jobs Monitor -->
    <div v-if="activeJobs.length > 0 && connectionStore.activeConnectionId && activeTab === 'ai'" class="bg-default shadow rounded-lg p-6">
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
            <template #title>
              <div class="flex items-center gap-2">
                <UBadge :color="job.status === 'pending' ? 'warning' : job.status === 'processing' ? 'primary' : 'error'" variant="subtle" size="xs" class="uppercase">
                  {{ job.status }}
                </UBadge>
                <span class="text-sm font-medium line-clamp-1">{{ job.text }}</span>
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