<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Save, RefreshCw } from 'lucide-vue-next'
import { getAuthHeaders, setPassword } from '../auth'
import { Fancybox } from '@fancyapps/ui'
import ImageUploader from '../components/ImageUploader.vue'
import AiTextarea from '../components/AiTextarea.vue'

const toast = useToast()

const route = useRoute()
const postId = route.params.id

const post = ref<any>(null)
const loading = ref(true)
const saving = ref(false)
const generating = ref(false)
const error = ref('')
const availableTemplates = ref<any[]>([])

const activePasteTarget = ref<{ type: 'top' | 'slide', index?: number } | null>(null)

const uploadImageFile = async (file: File): Promise<string> => {
  const formData = new FormData()
  formData.append('image', file)
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      Authorization: getAuthHeaders().Authorization
    },
    body: formData
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed to upload image')
  }
  const { url } = await res.json()
  return url
}

const handlePasteToTopImage = async (file: File) => {
  try {
    toast.add({ title: 'Uploading pasted image to Cover...', color: 'primary' })
    const url = await uploadImageFile(file)
    const topImageField = currentTemplateConfig.value?.uiSchema?.find((f: any) => f.type === 'image')
    const fieldName = topImageField?.name || 'coverImageUrl'
    post.value.templateData[fieldName] = url
    toast.add({ title: 'Cover image updated from clipboard!', color: 'success' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    toast.add({ title: message, color: 'error' })
  }
}

const handlePasteToSlideImage = async (arrayFieldName: string, slideIndex: number, file: File) => {
  try {
    toast.add({ title: `Uploading pasted image to Slide ${slideIndex + 1}...`, color: 'primary' })
    const url = await uploadImageFile(file)
    const arrayField = currentTemplateConfig.value?.uiSchema?.find((f: any) => f.name === arrayFieldName)
    const imageSubField = arrayField?.itemSchema?.find((sf: any) => sf.type === 'image')
    const subFieldName = imageSubField?.name || 'image'
    
    if (post.value.templateData[arrayFieldName] && post.value.templateData[arrayFieldName][slideIndex]) {
      post.value.templateData[arrayFieldName][slideIndex][subFieldName] = url
      toast.add({ title: `Slide ${slideIndex + 1} image updated from clipboard!`, color: 'success' })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    toast.add({ title: message, color: 'error' })
  }
}

const onGlobalPaste = async (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return
  let imageFile: File | null = null
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      imageFile = items[i].getAsFile()
      break
    }
  }
  if (!imageFile) return

  if (activePasteTarget.value) {
    e.preventDefault()
    if (activePasteTarget.value.type === 'top') {
      await handlePasteToTopImage(imageFile)
    } else if (activePasteTarget.value.type === 'slide' && activePasteTarget.value.index !== undefined) {
      const arrayField = currentTemplateConfig.value?.uiSchema?.find((f: any) => f.type === 'array')
      const fieldName = arrayField?.name || 'slides'
      await handlePasteToSlideImage(fieldName, activePasteTarget.value.index, imageFile)
    }
  }
}


const fetchTemplates = async () => {
  try {
    const res = await fetch('/api/templates', { headers: getAuthHeaders() })
    if (res.ok) {
      availableTemplates.value = await res.json()
    }
  } catch (e) {}
}

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

    const templateConfig = availableTemplates.value.find(t => t.id === post.value.templateId)
    if (templateConfig && templateConfig.uiSchema) {
      // Initialize arrays based on schema if they don't exist
      templateConfig.uiSchema.forEach((field: any) => {
        if (field.type === 'array' && !post.value.templateData[field.name]) {
          post.value.templateData[field.name] = []
        }
      })
    }
    
    error.value = ''
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  window.addEventListener('paste', onGlobalPaste)
  await fetchTemplates()
  await fetchPost()
})

onUnmounted(() => {
  window.removeEventListener('paste', onGlobalPaste)
})

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

const removeSlide = (fieldName: string, index: number) => {
  if (post.value.templateData[fieldName] && post.value.templateData[fieldName].length > 1) {
    post.value.templateData[fieldName].splice(index, 1)
  }
}

const addSlide = (field: any) => {
  if (!post.value.templateData[field.name]) {
    post.value.templateData[field.name] = []
  }
  
  if (field.itemType === 'object' && field.itemSchema) {
    const newItem: any = {}
    field.itemSchema.forEach((schemaField: any) => {
      newItem[schemaField.name] = schemaField.type === 'array' ? [] : ''
    })
    post.value.templateData[field.name].push(newItem)
  } else {
    post.value.templateData[field.name].push('')
  }
}

const currentTemplateConfig = computed(() => {
  return availableTemplates.value.find(t => t.id === post.value?.templateId)
})

const regenerateMedia = async () => {
  // We can skip hardcoded validation for now, or just ensure arrays are not empty
  
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
        
        <div v-if="currentTemplateConfig && currentTemplateConfig.uiSchema">
          <div v-for="field in currentTemplateConfig.uiSchema" :key="field.name" class="mb-6">
            
            <template v-if="field.type === 'string' || field.type === 'input' || field.name === 'source_name' || field.name === 'source_url'">
              <label class="block text-sm font-medium text-default mb-2">{{ field.label }}</label>
              <input 
                v-model="post.templateData[field.name]" 
                type="text"
                class="w-full px-4 py-2.5 border border-default rounded-md shadow-sm focus:ring-1 focus:ring-primary focus:border-primary text-sm bg-default text-default placeholder-muted"
                :placeholder="field.label"
              />
            </template>

            <template v-else-if="field.type === 'text'">
              <label class="block text-sm font-medium text-default mb-2">{{ field.label }}</label>
              <AiTextarea 
                v-model="post.templateData[field.name]" 
                :rows="3"
                guidancePlaceholder="e.g., make it more sensational, fix typo"
                :aiContext="field.aiContext + (post.researchResult ? '\n\nBACKGROUND RESEARCH / FACTS TO USE:\n' + post.researchResult : '')"
                :connectionId="post.connectionId"
                @focus="activePasteTarget = { type: 'top' }"
                @pasteImage="handlePasteToTopImage"
              />
            </template>

            <template v-else-if="field.type === 'image'">
              <label class="block text-sm font-medium text-default mb-2">{{ field.label }}</label>
              <ImageUploader 
                v-model="post.templateData[field.name]" 
                :isActivePasteTarget="activePasteTarget?.type === 'top'"
                @focusin="activePasteTarget = { type: 'top' }"
              />
            </template>
            <template v-else-if="field.type === 'array'">
              <label class="block text-sm font-medium text-default mb-4">{{ field.label }}</label>
              
              <div v-for="(_, i) in post.templateData[field.name]" :key="i" class="mb-6 relative bg-muted p-4 border border-default rounded-md">
                <div class="flex justify-between items-center mb-2">
                  <span class="text-sm font-medium text-default">Item {{ Number(i) + 1 }}</span>
                  <button 
                    @click="removeSlide(field.name, Number(i))" 
                    class="text-error hover:text-error text-xs font-medium"
                    v-if="post.templateData[field.name].length > 1"
                  >
                    Remove Item
                  </button>
                </div>

                <!-- Array Item is a primitive (e.g. string) -->
                <template v-if="field.itemType === 'text'">
                  <label v-if="field.itemSchema && field.itemSchema[0]" class="block text-sm font-medium text-default mb-2">{{ field.itemSchema[0].label }}</label>
                  <AiTextarea 
                    v-model="post.templateData[field.name][i]" 
                    :rows="4" 
                    guidancePlaceholder="e.g., summarize this better, fix typo"
                    :aiContext="(field.itemSchema && field.itemSchema[0] ? field.itemSchema[0].aiContext : '') + (post.researchResult ? '\\n\\nBACKGROUND RESEARCH / FACTS TO USE:\\n' + post.researchResult : '')"
                    :connectionId="post.connectionId"
                  />
                </template>

                <!-- Array Item is an object -->
                <template v-else-if="field.itemType === 'object' && field.itemSchema">
                  <div v-for="subField in field.itemSchema" :key="subField.name" class="mt-4">
                    <template v-if="subField.type === 'string' || subField.type === 'input' || subField.name === 'source_name' || subField.name === 'source_url'">
                      <label class="block text-sm font-medium text-default mb-2">{{ subField.label }}</label>
                      <input 
                        v-model="post.templateData[field.name][i][subField.name]" 
                        type="text"
                        class="w-full px-4 py-2.5 border border-default rounded-md shadow-sm focus:ring-1 focus:ring-primary focus:border-primary text-sm bg-default text-default placeholder-muted"
                        :placeholder="subField.label"
                      />
                    </template>
                    <template v-else-if="subField.type === 'text'">
                      <label class="block text-sm font-medium text-default mb-2">{{ subField.label }}</label>
                      <AiTextarea 
                        v-model="post.templateData[field.name][i][subField.name]" 
                        :rows="4" 
                        guidancePlaceholder="e.g., summarize this better, fix typo"
                        :aiContext="subField.aiContext + (post.researchResult ? '\n\nBACKGROUND RESEARCH / FACTS TO USE:\n' + post.researchResult : '')"
                        :connectionId="post.connectionId"
                        @focus="activePasteTarget = { type: 'slide', index: Number(i) }"
                        @pasteImage="(file) => handlePasteToSlideImage(field.name, Number(i), file)"
                      />
                    </template>
                    <template v-else-if="subField.type === 'image'">
                      <label class="block text-sm font-medium text-default mb-2">{{ subField.label }}</label>
                      <ImageUploader 
                        v-model="post.templateData[field.name][i][subField.name]" 
                        :isActivePasteTarget="activePasteTarget?.type === 'slide' && activePasteTarget?.index === Number(i)"
                        @focusin="activePasteTarget = { type: 'slide', index: Number(i) }"
                      />
                    </template>
                  </div>
                </template>
              </div>

              <button 
                @click="addSlide(field)" 
                class="w-full flex justify-center items-center px-4 py-2 border border-dashed border-default shadow-sm text-sm font-medium rounded-md text-muted bg-default hover:bg-muted focus:outline-none"
              >
                + Add {{ field.label }} Item
              </button>
            </template>
          </div>
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
        <AiTextarea 
          v-model="post.text" 
          :rows="12" 
          guidancePlaceholder="e.g., add relevant hashtags, fix typo"
          :aiContext="'This is the final caption for an Instagram news post. It should be engaging, informative, and include relevant hashtags at the end.' + (post.researchResult ? '\\n\\nBACKGROUND RESEARCH / FACTS TO USE:\\n' + post.researchResult : '')"
          :connectionId="post.connectionId"
        />
      </div>
    </div>
  </div>
</template>