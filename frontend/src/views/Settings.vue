<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Save, Settings2, Loader2, Info } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'
import ImageUploader from '../components/ImageUploader.vue'
import PasswordInput from '../components/PasswordInput.vue'

const settings = ref<any>({
  logoImageUrl: '',
  ctaImageUrl: '',
  bufferApiKey: '',
  bufferInstagramChannelId: '',
  telegramBotToken: '',
  cronIntervalMinutes: 30,
  cronStartHour: 6,
  cronEndHour: 23
})

const loading = ref(true)
const saving = ref(false)
const error = ref('')

const fetchSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/settings', { headers: getAuthHeaders() })
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to load settings')
    const data = await res.json()
    // Default values fallback handled by API, merge here
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
    
    alert('Settings saved successfully! Interval and publishing changes take effect immediately. Telegram Bot Token changes require a container restart.')
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
    <div class="bg-white shadow rounded-lg p-6">
      <h1 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
        <Settings2 class="w-6 h-6 mr-3 text-blue-600" />
        Global Settings
      </h1>
      
      <p class="text-sm text-gray-500 mb-6">
        Settings defined here will override the <code class="bg-gray-100 px-1 rounded">.env</code> configurations.
      </p>

      <div v-if="loading" class="flex justify-center py-10">
        <Loader2 class="w-8 h-8 text-blue-500 animate-spin" />
      </div>

      <div v-else-if="error" class="bg-red-50 text-red-600 p-4 rounded-md text-sm mb-6">
        {{ error }}
      </div>

      <div v-else class="space-y-8">
        
        <!-- Media Assets -->
        <div>
          <h2 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Media Assets</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Watermark Logo URL</label>
              <ImageUploader v-model="settings.logoImageUrl" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">CTA Slide URL (Final Slide)</label>
              <ImageUploader v-model="settings.ctaImageUrl" />
            </div>
          </div>
        </div>

        <!-- Automation & Publishing -->
        <div>
          <h2 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Automation Limits</h2>
          <div class="bg-blue-50 border border-blue-100 rounded-md p-4 mb-4 flex items-start">
            <Info class="w-5 h-5 text-blue-500 mr-3 flex-shrink-0 mt-0.5" />
            <div class="text-sm text-blue-800">
              The worker checks the queue every minute. It will auto-publish the top pending queue item if the current time in Jakarta is between your Start and End hours, AND the configured Interval has passed since the last publish.
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Interval (Minutes)</label>
              <input 
                v-model.number="settings.cronIntervalMinutes" 
                type="number" min="1"
                class="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Start Hour (0-23)</label>
              <input 
                v-model.number="settings.cronStartHour" 
                type="number" min="0" max="23"
                class="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">End Hour (0-23)</label>
              <input 
                v-model.number="settings.cronEndHour" 
                type="number" min="0" max="23"
                class="w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-base"
              />
            </div>
          </div>
        </div>

        <!-- API Keys -->
        <div>
          <h2 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2">API Keys & Tokens</h2>
          
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Telegram Bot Token</label>
              <PasswordInput v-model="settings.telegramBotToken" placeholder="123456789:ABCDefgh..." />
              <p class="text-xs text-gray-500 mt-1">Changes to this require a full container restart to reconnect Telegraf.</p>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Buffer API Key (Bearer)</label>
              <PasswordInput v-model="settings.bufferApiKey" placeholder="1/abcdef..." />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Buffer Instagram Channel ID</label>
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