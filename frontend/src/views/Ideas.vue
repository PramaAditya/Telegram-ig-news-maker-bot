<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiFetch } from '../auth';

const ideas = ref<any[]>([]);
const templates = ref<any[]>([]);
const selectedTemplates = ref<Record<number, string>>({});
const currentTab = ref('pending');
const loading = ref(false);

const fetchTemplates = async () => {
  try {
    const data = await apiFetch('/api/templates');
    templates.value = data || [];
  } catch (error) {
    console.error('Failed to fetch templates:', error);
  }
};

const fetchIdeas = async () => {
  loading.value = true;
  try {
    const data = await apiFetch(`/api/ideas?status=${currentTab.value}`);
    ideas.value = data || [];
    
    // Initialize selected templates for new ideas
    ideas.value.forEach(idea => {
      if (!selectedTemplates.value[idea.id] && templates.value.length > 0) {
        selectedTemplates.value[idea.id] = templates.value[0].id;
      }
    });
  } catch (error) {
    console.error('Failed to fetch ideas:', error);
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await fetchTemplates();
  await fetchIdeas();
});

const convertIdea = async (ideaId: number) => {
  const templateId = selectedTemplates.value[ideaId] || 'image:kabar.perjuangan:carousel_dark';
  try {
    await apiFetch(`/api/ideas/${ideaId}/convert`, {
      method: 'POST',
      body: JSON.stringify({ templateId })
    });
    fetchIdeas();
  } catch (error) {
    console.error('Failed to convert idea:', error);
    alert('Failed to convert idea');
  }
};

const updateStatus = async (ideaId: number, status: string) => {
  try {
    await apiFetch(`/api/ideas/${ideaId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
    fetchIdeas();
  } catch (error) {
    console.error(`Failed to mark idea as ${status}:`, error);
    alert(`Failed to update status`);
  }
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};
</script>

<template>
  <div>
    <div class="sm:flex sm:items-center sm:justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Ideas</h1>
        <p class="mt-2 text-sm text-gray-700">Manage ideas submitted via Telegram.</p>
      </div>
    </div>

    <!-- Tabs -->
    <div class="border-b border-gray-200 mb-6">
      <nav class="-mb-px flex space-x-8" aria-label="Tabs">
        <button 
          @click="currentTab = 'pending'; fetchIdeas()"
          :class="[
            currentTab === 'pending' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm'
          ]"
        >
          Pending
        </button>
        <button 
          @click="currentTab = 'converted'; fetchIdeas()"
          :class="[
            currentTab === 'converted' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm'
          ]"
        >
          Converted
        </button>
        <button 
          @click="currentTab = 'rejected'; fetchIdeas()"
          :class="[
            currentTab === 'rejected' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            'whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm'
          ]"
        >
          Rejected
        </button>
      </nav>
    </div>

    <div v-if="loading" class="text-center py-10">
      <p class="text-gray-500">Loading ideas...</p>
    </div>
    <div v-else-if="ideas.length === 0" class="text-center py-10">
      <p class="text-gray-500">No ideas found for this status.</p>
    </div>
    <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="idea in ideas" :key="idea.id" class="bg-white overflow-hidden shadow rounded-lg border border-gray-200 flex flex-col">
        <div class="p-5 flex-1">
          <p class="text-xs text-gray-500 mb-2">{{ formatDate(idea.createdAt) }}</p>
          <p class="text-sm text-gray-900 line-clamp-4">{{ idea.text }}</p>
          
          <div v-if="idea.media && idea.media.length > 0" class="mt-3 flex gap-2 overflow-x-auto">
            <template v-for="(m, i) in idea.media" :key="i">
              <img v-if="m.type === 'image'" :src="m.url" class="h-16 w-16 object-cover rounded" />
              <div v-else class="h-16 w-16 bg-gray-100 flex items-center justify-center rounded text-xs text-gray-500">Video</div>
            </template>
          </div>
        </div>
        
        <div class="bg-gray-50 px-5 py-3 border-t border-gray-200 flex flex-col gap-3">
          <div v-if="idea.status === 'pending' || idea.status === 'rejected'" class="flex flex-col gap-2">
            <label class="block text-xs font-medium text-gray-700">Template</label>
            <select v-model="selectedTemplates[idea.id]" class="mt-1 block w-full pl-3 pr-10 py-2 text-sm border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
              <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </div>
          <div class="flex gap-2">
            <button 
              v-if="idea.status === 'pending' || idea.status === 'rejected'" 
              @click="convertIdea(idea.id)" 
              class="flex-1 inline-flex justify-center items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Convert to Post
            </button>
            
            <button 
              v-if="idea.status === 'pending'" 
              @click="updateStatus(idea.id, 'rejected')" 
              class="flex-1 inline-flex justify-center items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Reject
            </button>
            
             <button 
              v-if="idea.status === 'rejected'" 
              @click="updateStatus(idea.id, 'pending')" 
              class="flex-1 inline-flex justify-center items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Move to Pending
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>