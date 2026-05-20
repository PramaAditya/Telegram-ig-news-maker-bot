<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Save, RefreshCw } from 'lucide-vue-next'
import { getAuthHeaders, setPassword } from '../auth'
import { Fancybox } from '@fancyapps/ui'
import ImageUploader from '../components/ImageUploader.vue'

const toast = useToast()

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
    
    // Ensure templateData exists
    if (!post.value.templateData) post.value.templateData = {}

    // Specific logic for interval template
    if (post.value.templateId === 'image-multiple:interval') {
      if (!post.value.templateData.slides) post.value.templateData.slides = ['', '']
    }
    
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
        templateData: post.value.templateData
      })
    })
    if (res.status === 401) {
      toast.add({ title: 'Unauthorized', color: 'error' })
      return
    }
    if (!res.ok) throw new Error('Failed to save')
    toast.add({ title: 'Changes saved!', color: 'success' })
  } catch (err: any) {
    toast.add({ title: err.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const removeSlide = (index: number) => {
  if (post.value.templateData.slides.length > 1) {
    post.value.templateData.slides.splice(index, 1)
  }
}

const addSlide = () => {
  if (!post.value.templateData.slides) {
    post.value.templateData.slides = []
  }
  post.value.templateData.slides.push('')
}

const regenerateMedia = async () => {
  // Hardcoded validation for interval template
  if (post.value.templateId === 'image-multiple:interval') {
    if (!post.value.templateData.title || !post.value.templateData.coverImageUrl || !post.value.templateData.slides || post.value.templateData.slides.length === 0) {
      toast.add({ title: 'Title, Cover Image URL, and at least 1 Slide cannot be empty to regenerate.', color: 'error' })
      return
    }
  }
  
  // First save the current draft so backend uses the latest text
  await saveChanges()

  generating.value = true
  try {
    const res = await fetch(`/api/queue/${postId}/regenerate-media`, {
      method: 'POST',
      headers: getAuthHeaders()
    })
    if (res.status === 401) {
      toast.add({ title: 'Unauthorized', color: 'error' })
      return
    }
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to regenerate media')
    
    // Update local media state with newly generated ones
    post.value.media = data.media
    toast.add({ title: 'Media regenerated successfully!', color: 'success' })
  } catch (err: any) {
    toast.add({ title: err.message, color: 'error' })
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <router-link to="/" class="p-2 bg-default rounded-full border border-default text-muted hover:text-default hover:bg-muted">
          <ArrowLeft class="w-5 h-5" />
        </router-link>
        <h1 class="text-2xl font-bold text-default">Edit Post #{{ postId }}</h1>
      </div>
      <button 
        @click="saveChanges" 
        :disabled="saving"
        class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-inverted bg-primary hover:bg-primary disabled:opacity-50"
      >
        <Save class="w-4 h-4 mr-2" />
        {{ saving ? 'Saving...' : 'Save Draft' }}
      </button>
    </div>

    <div v-if="loading" class="text-center py-10 text-muted">Loading...</div>
    <UAlert v-else-if="error" color="error" variant="soft" :description="error" class="mb-4" />
    
    <div v-else-if="post" class="space-y-6 max-w-4xl mx-auto">
      
      <!-- Research Result Reference -->
      <div v-if="post.researchResult" class="bg-default shadow rounded-lg p-6">
        <h2 class="text-lg font-bold mb-4 text-default">AI Research Notes</h2>
        <div class="bg-muted border border-default rounded-md p-4 max-h-64 overflow-y-auto">
          <p class="text-sm text-default whitespace-pre-wrap font-mono">{{ post.researchResult }}</p>
        </div>
      </div>

      <!-- Media Data Editor -->
      <div class="bg-default shadow rounded-lg p-6">
        <h2 class="text-lg font-bold mb-4 text-default">Media Data (Template: {{ post.templateId }})</h2>
        
        <div v-if="post.templateId === 'image-multiple:interval'">
          <div class="mb-6">
            <label class="block text-sm font-medium text-default mb-2">Title (supports **bold**)</label>
            <textarea 
              v-model="post.templateData.title" 
              rows="3"
              class="w-full px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-base bg-default text-default"
            ></textarea>
          </div>

          <div class="mb-6">
            <label class="block text-sm font-medium text-default mb-2">Cover Image</label>
            <ImageUploader v-model="post.templateData.coverImageUrl" />
          </div>

          <div v-for="(_, i) in post.templateData.slides" :key="i" class="mb-6 relative bg-muted p-4 border border-default rounded-md">
            <div class="flex justify-between items-center mb-2">
              <label class="block text-sm font-medium text-default">Slide {{ Number(i) + 1 }} Text (supports **bold**)</label>
              <button 
                @click="removeSlide(Number(i))" 
                class="text-error hover:text-error text-xs font-medium"
                v-if="post.templateData.slides.length > 1"
              >
                Remove Slide
              </button>
            </div>
            <textarea 
              v-model="post.templateData.slides[i]" 
              rows="4" 
              class="w-full px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-base bg-default text-default"
            ></textarea>
          </div>

          <button 
            @click="addSlide" 
            class="w-full mb-6 flex justify-center items-center px-4 py-2 border border-dashed border-default shadow-sm text-sm font-medium rounded-md text-muted bg-default hover:bg-muted focus:outline-none"
          >
            + Add Slide
          </button>
        </div>

        <div v-else class="mb-6">
          <p class="text-sm text-muted italic mb-2">Advanced Template Editor (JSON)</p>
          <textarea 
            :value="JSON.stringify(post.templateData, null, 2)"
            @input="(e) => { try { post.templateData = JSON.parse((e.target as HTMLTextAreaElement).value) } catch (err) {} }"
            rows="10" 
            class="w-full font-mono px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-muted text-default"
          ></textarea>
        </div>

        <button 
          @click="regenerateMedia" 
          :disabled="generating"
          class="w-full mt-4 inline-flex justify-center items-center px-4 py-3 border border-default shadow-sm text-base font-medium rounded-md text-default bg-default hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw class="w-5 h-5 mr-2" :class="{ 'animate-spin': generating }" />
          {{ generating ? 'Generating Images from API...' : 'Regenerate Media Grid' }}
        </button>
      </div>

      <!-- Media Preview -->
      <div class="bg-default shadow rounded-lg p-6">
        <h2 class="text-lg font-bold mb-4 text-default">Media Grid Preview</h2>
        <p class="text-sm text-muted mb-6">This is the exact sequence that will be published. Note: The CTA Image is dynamically injected at publish time and is not shown here.</p>
        
        <div class="grid grid-cols-3 gap-4">
          <div v-for="(m, i) in post.media" :key="i" @click="openLightbox(post.media, Number(i))" class="relative aspect-square rounded-lg overflow-hidden bg-elevated border border-default cursor-pointer hover:opacity-80 transition">
            <img v-if="m.type === 'image'" :src="m.url" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex flex-col items-center justify-center text-muted p-4 text-center">
              <span class="font-medium">Video</span>
              <span class="text-xs truncate w-full mt-1">{{ m.url }}</span>
            </div>
            <div class="absolute top-2 left-2 bg-inverted bg-opacity-60 text-inverted text-xs px-2 py-1 rounded shadow">
              {{ i === 0 ? 'Cover' : 'Slide ' + i }}
            </div>
          </div>
        </div>
      </div>

      <!-- Final Caption Editor -->
      <div class="bg-default shadow rounded-lg p-6">
        <h2 class="text-lg font-bold mb-4 text-default">Final Caption (Instagram Text)</h2>
        <textarea 
          v-model="post.text" 
          rows="12" 
          class="w-full px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-base bg-default text-default"
        ></textarea>
      </div>

    </div>
  </div>
</template>