<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Save, Settings2, Loader2, Info, Sparkles, X } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'
import ImageUploader from '../components/ImageUploader.vue'
import PasswordInput from '../components/PasswordInput.vue'

const settings = ref<any>({
  logoImageUrl: '',
  ctaImageUrl: '',
  bufferApiKey: '',
  bufferInstagramChannelId: '',
  telegramBotToken: '',
  postingSlots: []
})

const loading = ref(true)
const saving = ref(false)
const error = ref('')

const aiPrompt = ref('')
const aiGenerating = ref(false)

const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const slotsByDay = computed(() => {
  const result: Record<string, any[]> = {}
  daysOfWeek.forEach(d => result[d] = [])
  
  if (settings.value.postingSlots) {
    settings.value.postingSlots.forEach((slot: any) => {
      // Find proper capitalization
      const targetDay = daysOfWeek.find(d => d.toLowerCase() === slot.day.toLowerCase())
      if (targetDay) {
        result[targetDay].push(slot)
      }
    })
  }

  // Sort times chronologically
  daysOfWeek.forEach(d => {
    result[d].sort((a, b) => a.time.localeCompare(b.time))
  })

  return result
})

// Format "HH:mm" to 12-hour AM/PM
const formatTime = (time24: string) => {
  if (!time24) return ''
  const [h, m] = time24.split(':')
  let hours = parseInt(h, 10)
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  return `${hours.toString().padStart(2, '0')}:${m} ${ampm}`
}

const removeSlot = (slotToRemove: any) => {
  settings.value.postingSlots = settings.value.postingSlots.filter(
    (s: any) => !(s.day.toLowerCase() === slotToRemove.day.toLowerCase() && s.time === slotToRemove.time)
  )
}

const clearAllSlots = () => {
  if (confirm('Are you sure you want to delete all posting slots?')) {
    settings.value.postingSlots = []
  }
}

const generateSlots = async () => {
  if (!aiPrompt.value.trim()) return
  
  aiGenerating.value = true
  try {
    const res = await fetch('/api/settings/slots/generate', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: aiPrompt.value })
    })
    
    if (res.status === 401) throw new Error('Unauthorized')
    
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to generate slots')
    
    settings.value.postingSlots = data.slots
    aiPrompt.value = ''
  } catch (err: any) {
    alert(err.message)
  } finally {
    aiGenerating.value = false
  }
}

const fetchSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/settings', { headers: getAuthHeaders() })
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to load settings')
    const data = await res.json()
    settings.value = { ...settings.value, ...data }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

onMounted(fetchSettings)

const saveSettings = async () => {
  saving.value = true
  error.value = ''
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(settings.value)
    })
    
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to save settings')
    
    alert('Settings saved successfully! Publishing changes take effect immediately.')
  } catch (err: any) {
    error.value = err.message
    alert(err.message)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div class="bg-white dark:bg-gray-900 shadow rounded-lg p-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6 flex items-center">
        <Settings2 class="w-6 h-6 mr-3 text-blue-600 dark:text-blue-400" />
        Global Settings
      </h1>
      
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Settings defined here will override the <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded text-gray-800 dark:text-gray-200">.env</code> configurations.
      </p>

      <div v-if="loading" class="flex justify-center py-10">
        <Loader2 class="w-8 h-8 text-blue-500 animate-spin" />
      </div>

      <div v-else-if="error" class="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-4 rounded-md text-sm mb-6">
        {{ error }}
      </div>

      <div v-else class="space-y-8">
        
        <!-- Media Assets -->
        <div>
          <h2 class="text-lg font-bold text-gray-800 dark:text-gray-200 mb-4 border-b border-gray-200 dark:border-gray-800 pb-2">Media Assets</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Watermark Logo URL</label>
              <ImageUploader v-model="settings.logoImageUrl" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">CTA Slide URL (Final Slide)</label>
              <ImageUploader v-model="settings.ctaImageUrl" />
            </div>
          </div>
        </div>

        <!-- Automation & Publishing -->
        <div>
          <h2 class="text-lg font-bold text-gray-800 dark:text-gray-200 mb-4 border-b border-gray-200 dark:border-gray-800 pb-2">Posting Slots</h2>
          <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/50 rounded-md p-4 mb-4 flex items-start">
            <Info class="w-5 h-5 text-blue-500 dark:text-blue-400 mr-3 flex-shrink-0 mt-0.5" />
            <div class="text-sm text-blue-800 dark:text-blue-300">
              Your posting slots determine exactly when the worker will publish the next item in the Pending Queue. Add slots below using Natural Language AI!
            </div>
          </div>

          <!-- Slots Grid -->
          <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 mb-6 flex flex-col md:flex-row">
            <div v-for="day in daysOfWeek" :key="day" class="flex-1 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 last:border-0 min-w-0">
              <div class="bg-gray-50 dark:bg-gray-700/50 py-3 text-center border-b border-gray-200 dark:border-gray-700">
                <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">{{ day }}</span>
              </div>
              <div class="p-2 space-y-2 min-h-[100px] flex flex-col items-center">
                <div v-if="slotsByDay[day].length === 0" class="text-xs text-gray-400 dark:text-gray-500 py-4 italic">
                  No slots
                </div>
                <div v-for="(slot, i) in slotsByDay[day]" :key="i" class="group relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-sm px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 transition flex items-center justify-center w-full">
                  {{ formatTime(slot.time) }}
                  <button @click="removeSlot(slot)" class="absolute -right-1 -top-1 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition shadow-sm hover:bg-red-200 dark:hover:bg-red-800/50">
                    <X class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Add slots with AI -->
          <div class="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="flex-1 w-full">
              <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Add slots using AI</label>
              <input 
                v-model="aiPrompt" 
                @keyup.enter="generateSlots"
                type="text" 
                placeholder="e.g. Everyday 3 times between 9am to 9pm"
                class="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
            <div class="flex items-center gap-3 w-full sm:w-auto mt-2 sm:mt-5">
              <button 
                @click="generateSlots" 
                :disabled="aiGenerating || !aiPrompt.trim()"
                class="flex-1 sm:flex-none inline-flex items-center justify-center px-4 py-2.5 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <Loader2 v-if="aiGenerating" class="w-4 h-4 mr-2 animate-spin" />
                <Sparkles v-else class="w-4 h-4 mr-2" />
                Generate
              </button>
              <button @click="clearAllSlots" class="text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 py-2.5 px-2">
                Clear All
              </button>
            </div>
          </div>
        </div>

        <!-- API Keys -->
        <div>
          <h2 class="text-lg font-bold text-gray-800 dark:text-gray-200 mb-4 border-b border-gray-200 dark:border-gray-800 pb-2">API Keys & Tokens</h2>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Telegram Bot Token</label>
              <PasswordInput v-model="settings.telegramBotToken" placeholder="123456789:ABCDefgh..." />
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Changes to this require a full container restart to reconnect Telegraf.</p>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Buffer API Key (Bearer)</label>
              <PasswordInput v-model="settings.bufferApiKey" placeholder="1/abcdef..." />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Buffer Instagram Channel ID</label>
              <PasswordInput v-model="settings.bufferInstagramChannelId" placeholder="60abc123..." />
            </div>
          </div>
        </div>

        <button 
          @click="saveSettings" 
          :disabled="saving"
          class="w-full flex justify-center items-center px-4 py-3 border border-transparent shadow-sm text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <Loader2 v-if="saving" class="w-5 h-5 mr-2 animate-spin" />
          <Save v-else class="w-5 h-5 mr-2" />
          {{ saving ? 'Saving...' : 'Save Settings' }}
        </button>
      </div>
    </div>
  </div>
</template>