<script setup lang="ts">
import { ref } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  id?: string
}>()

const emit = defineEmits(['update:modelValue'])

const showPassword = ref(false)

const toggleVisibility = () => {
  showPassword.value = !showPassword.value
}

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}
</script>

<template>
  <div class="relative w-full">
    <input
      :type="showPassword ? 'text' : 'password'"
      :id="id"
      :value="modelValue"
      @input="onInput"
      :placeholder="placeholder"
      class="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
    />
    <button
      type="button"
      @click="toggleVisibility"
      class="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none"
    >
      <Eye v-if="!showPassword" class="w-5 h-5" />
      <EyeOff v-else class="w-5 h-5" />
    </button>
  </div>
</template>