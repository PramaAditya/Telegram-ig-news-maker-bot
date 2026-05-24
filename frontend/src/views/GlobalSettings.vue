<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Save, Globe, Loader2 } from 'lucide-vue-next'
import { getAuthHeaders } from '../auth'
import PasswordInput from '../components/PasswordInput.vue'

const toast = useToast()

const settings = ref<any>({
  telegramBotToken: '',
})

const loading = ref(true)
const saving = ref(false)
const error = ref('')

const fetchSettings = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/global-settings', { headers: getAuthHeaders() })
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to load global settings')
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
    const res = await fetch('/api/global-settings', {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(settings.value)
    })
    
    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error('Failed to save global settings')
    
    toast.add({ title: 'Global settings saved successfully!', color: 'success' })
  } catch (err: any) {
    error.value = err.message
    toast.add({ title: err.message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="container mx-auto space-y-6">
    <div class="bg-default shadow rounded-lg p-6">
      <h1 class="text-2xl font-bold text-default mb-6 flex items-center">
        <Globe class="w-6 h-6 mr-3 text-primary" />
        Global Settings
      </h1>
      
      <p class="text-sm text-muted mb-6">
        Settings defined here affect the entire system across all connections.
      </p>

      <div v-if="loading" class="flex justify-center py-10">
        <Loader2 class="w-8 h-8 text-primary animate-spin" />
      </div>

      <UAlert 
        v-else-if="error" 
        color="error" 
        variant="soft" 
        :description="error" 
        class="mb-6" 
      />

      <div v-else class="space-y-6">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-default mb-2">Telegram Bot Token</label>
            <PasswordInput v-model="settings.telegramBotToken" placeholder="123456789:ABCDefgh..." />
            <p class="text-xs text-muted mt-1">Changes to this require a full container restart to reconnect Telegraf.</p>
          </div>
        </div>

        <div class="pt-6 border-t border-default mt-8">
          <button 
            @click="saveSettings" 
            :disabled="saving"
            class="w-full flex justify-center items-center px-4 py-3 border border-transparent shadow-sm text-base font-medium rounded-md text-inverted bg-primary hover:bg-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
          >
            <Loader2 v-if="saving" class="w-5 h-5 mr-2 animate-spin" />
            <Save v-else class="w-5 h-5 mr-2" />
            {{ saving ? 'Saving...' : 'Save Global Settings' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>