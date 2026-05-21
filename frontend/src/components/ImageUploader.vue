<script setup lang="ts">
import { ref } from 'vue'
import { UploadCloud, Loader2, X } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'

const props = defineProps<{
  modelValue: string[]
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
      throw new Error(data.error || 'Failed to upload media')
    }

    const { url } = await res.json()
    emit('update:modelValue', [...(props.modelValue || []), url])
  } catch (err: any) {
    error.value = err.message
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const handleFileUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files) return
  for (let i = 0; i < files.length; i++) {
    await uploadFile(files[i])
  }
}

defineExpose({
  uploadFile
})

const triggerUpload = () => {
  fileInput.value?.click()
}

const removeMedia = (index: number) => {
  const newUrls = [...(props.modelValue || [])]
  newUrls.splice(index, 1)
  emit('update:modelValue', newUrls)
}

const isVideo = (url: string) => {
  return url.match(/\.(mp4|mov|webm)$/i)
}
</script>

<template>
  <div class="border-2 border-dashed border-default rounded-lg p-4 text-center relative overflow-hidden transition hover:border-muted bg-muted">
    <input 
      type="file" 
      ref="fileInput" 
      class="hidden" 
      accept="image/*,video/*" 
      multiple
      @change="handleFileUpload" 
    />
    
    <div v-if="props.modelValue && props.modelValue.length > 0" class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
      <div v-for="(url, index) in props.modelValue" :key="index" class="relative group aspect-square rounded overflow-hidden shadow-sm bg-default">
        <video v-if="isVideo(url)" :src="url" class="w-full h-full object-cover" muted autoplay loop></video>
        <img v-else :src="url" class="w-full h-full object-cover" />
        <div class="absolute inset-0 bg-inverted bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button @click.stop="removeMedia(index)" class="p-2 bg-error text-inverted rounded-full hover:bg-error">
            <X class="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="uploading" class="flex flex-col items-center justify-center space-y-2 py-4">
      <Loader2 class="w-8 h-8 text-primary animate-spin" />
      <span class="text-sm text-muted">Uploading to S3...</span>
    </div>

    <div v-else class="py-6 cursor-pointer" @click="triggerUpload">
      <UploadCloud class="w-10 h-10 text-muted mx-auto mb-2" />
      <p class="text-sm text-muted">Click to upload media</p>
      <p class="text-xs text-muted mt-1">Accepts multiple images & videos (JPG, PNG, MP4)</p>
    </div>

    <div v-if="error" class="mt-2 text-sm text-error">
      {{ error }}
    </div>
  </div>
</template>