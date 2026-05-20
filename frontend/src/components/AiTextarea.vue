<script setup lang="ts">
import { ref, watch } from 'vue'
import { Sparkles, Undo2, RefreshCw } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  rows?: number
  guidancePlaceholder?: string
  guidanceDescription?: string
}>()

const emit = defineEmits(['update:modelValue'])

const text = ref(props.modelValue)
watch(() => props.modelValue, (val) => { text.value = val })

const isPopoverOpen = ref(false)
const instruction = ref('')
const isRefining = ref(false)
const previousText = ref('')
const canUndo = ref(false)

const onInput = (e: Event) => {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
  canUndo.value = false
}

const refine = async () => {
  const textToRefine = text.value || previousText.value;
  if (!textToRefine) return;

  isRefining.value = true
  try {
    const res = await fetch('/api/ai/refine-text', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: textToRefine,
        instruction: instruction.value
      })
    })
    if (!res.ok) throw new Error('Failed to refine')
    const data = await res.json()
    
    // Save previous text for undo
    if (!canUndo.value) {
      previousText.value = text.value
    }
    
    text.value = data.refinedText
    emit('update:modelValue', text.value)
    canUndo.value = true
    isPopoverOpen.value = false
  } catch (e: any) {
    alert(e.message)
  } finally {
    isRefining.value = false
  }
}

const undo = () => {
  text.value = previousText.value
  emit('update:modelValue', text.value)
  canUndo.value = false
}
</script>

<template>
  <div class="relative">
    <textarea
      v-model="text"
      @input="onInput"
      :rows="rows || 6"
      :placeholder="placeholder"
      class="w-full px-4 py-3 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-default text-default placeholder-muted pr-12"
    ></textarea>
    
    <div class="absolute top-2 right-2 flex flex-col gap-1 z-10">
      <UPopover v-model:open="isPopoverOpen" :content="{ side: 'bottom', align: 'end' }">
        <button 
          class="p-1.5 text-muted hover:text-primary hover:bg-primary-50 rounded-md transition-colors"
          title="Enhance with AI"
        >
          <Sparkles class="w-4 h-4" />
        </button>

        <template #content>
          <div class="p-4 w-72 bg-default border border-default rounded-md shadow-lg">
            <label class="block text-sm font-semibold text-default mb-2">Enhance Guidance (Optional)</label>
            <input 
              v-model="instruction"
              type="text"
              @keyup.enter="refine"
              :placeholder="guidancePlaceholder || 'e.g., make it more professional'"
              class="w-full px-3 py-2 border border-default rounded-md text-sm bg-muted text-default mb-2 focus:ring-1 focus:ring-primary focus:outline-none"
            />
            <p class="text-xs text-muted mb-4">
              {{ guidanceDescription || 'Add specific instructions to guide how the AI enhances your text.' }}
            </p>
            <div class="flex justify-end gap-2">
              <UButton color="gray" variant="ghost" size="sm" @click="isPopoverOpen = false">Cancel</UButton>
              <UButton color="primary" variant="solid" size="sm" @click="refine" :loading="isRefining">
                Enhance
              </UButton>
            </div>
          </div>
        </template>
      </UPopover>

      <button 
        v-if="canUndo"
        @click="undo"
        class="p-1.5 text-warning hover:text-warning-600 hover:bg-warning-50 rounded-md transition-colors"
        title="Undo Enhancement"
      >
        <Undo2 class="w-4 h-4" />
      </button>

      <button 
        v-if="canUndo"
        @click="refine"
        class="p-1.5 text-primary hover:text-primary-700 hover:bg-primary-50 rounded-md transition-colors"
        title="Retry Enhancement"
        :disabled="isRefining"
      >
        <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': isRefining }" />
      </button>
    </div>
  </div>
</template>