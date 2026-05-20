<script setup lang="ts">
import { ref } from 'vue'
import { UploadCloud, Loader2, X } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'

const props = defineProps<{
  modelValue: string | null
}>()

const emit = defineEmits(['update:modelValue'])

const uploading = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const uploadFile = async (file: File) => {
  uploading.value = true
  error.value = ''

  const formData = new FormData()
  formData.append('image', file)

  try {
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
    emit('update:modelValue', url)
  } catch (err: any) {
    error.value = err.message
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const handleFileUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  await uploadFile(file)
}

defineExpose({
  uploadFile
})

const triggerUpload = () => {
  fileInput.value?.click()
}

const clearImage = () => {
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="border-2 border-dashed border-default rounded-lg p-4 text-center relative overflow-hidden transition hover:border-muted bg-muted">
    <input 
      type="file" 
      ref="fileInput" 
      class="hidden" 
      accept="image/*" 
      @change="handleFileUpload" 
    />
    
    <div v-if="uploading" class="flex flex-col items-center justify-center space-y-2 py-4">
      <Loader2 class="w-8 h-8 text-primary animate-spin" />
      <span class="text-sm text-muted">Uploading to S3...</span>
    </div>

    <div v-else-if="modelValue" class="relative group">
      <img :src="modelValue" class="max-h-48 mx-auto rounded object-cover shadow-sm" />
      <div class="absolute inset-0 bg-inverted bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
        <button @click="clearImage" class="p-2 bg-error text-inverted rounded-full hover:bg-error mx-2">
          <X class="w-5 h-5" />
        </button>
      </div>
    </div>

    <div v-else class="py-6 cursor-pointer" @click="triggerUpload">
      <UploadCloud class="w-10 h-10 text-muted mx-auto mb-2" />
      <p class="text-sm text-muted">Click to upload an image</p>
      <p class="text-xs text-muted mt-1">JPG, PNG up to 10MB</p>
    </div>

    <div v-if="error" class="mt-2 text-sm text-error">
      {{ error }}
    </div>
  </div>
</template>