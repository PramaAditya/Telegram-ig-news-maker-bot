<script setup lang="ts">
import { ref } from 'vue'
import { UploadCloud, Loader2, X } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'

const props = withDefaults(defineProps<{
  modelValue: string | string[] | null | undefined
  multiple?: boolean
  isActivePasteTarget?: boolean
}>(), {
  multiple: false,
  isActivePasteTarget: false
})
const isDragging = ref(false)

const handlePaste = async (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      const file = items[i].getAsFile()
      if (file) {
        e.preventDefault()
        await uploadFile(file)
        break
      }
    }
  }
}

const handleDrop = async (e: DragEvent) => {
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith('image/') || files[i].type.startsWith('video/')) {
      await uploadFile(files[i])
      if (!props.multiple) break
    }
  }
}

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
    if (props.multiple) {
      emit('update:modelValue', [...(Array.isArray(props.modelValue) ? props.modelValue : []), url])
    } else {
      emit('update:modelValue', url)
    }
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
  if (props.multiple) {
    const newUrls = [...(Array.isArray(props.modelValue) ? props.modelValue : [])]
    newUrls.splice(index, 1)
    emit('update:modelValue', newUrls)
  } else {
    emit('update:modelValue', '')
  }
}

const isVideo = (url: string) => {
  return url.match(/\.(mp4|mov|webm)$/i)
}
</script>

<template>
  <div 
    tabindex="0"
    @paste="handlePaste"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="handleDrop"
    class="border-2 border-dashed rounded-lg p-4 text-center relative overflow-hidden transition bg-muted outline-none"
    :class="[
      isDragging ? 'border-primary ring-2 ring-primary/40 bg-primary/5' : 
      props.isActivePasteTarget ? 'border-primary ring-2 ring-primary/50 shadow-md bg-primary/5' : 
      'border-default hover:border-muted'
    ]"
  >
    <!-- Active Target Badge -->
    <div v-if="props.isActivePasteTarget" class="absolute top-2 right-2 z-10 flex items-center gap-1 bg-primary/20 text-primary border border-primary/40 text-[11px] font-medium px-2.5 py-0.5 rounded-full animate-pulse pointer-events-none">
      <span>📋 Active for Ctrl+V</span>
    </div>
    <input 
      type="file" 
      ref="fileInput" 
      class="hidden" 
      accept="image/*,video/*" 
      :multiple="props.multiple"
      @change="handleFileUpload" 
    />
    
    <div v-if="props.modelValue && (Array.isArray(props.modelValue) ? props.modelValue.length > 0 : true)" class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
      <div v-for="(url, index) in (Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue])" :key="index" class="relative group aspect-square rounded overflow-hidden shadow-sm bg-default">
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
      <p class="text-sm text-muted">Click to upload media or press <kbd class="px-1.5 py-0.5 text-xs bg-default border border-default rounded shadow-xs font-mono">Ctrl+V</kbd> to paste</p>
      <p class="text-xs text-muted mt-1">Accepts {{ props.multiple ? 'multiple' : 'single' }} image(s) & video(s) (JPG, PNG, MP4)</p>
    </div>

    <div v-if="error" class="mt-2 text-sm text-error">
      {{ error }}
    </div>
  </div>
</template>