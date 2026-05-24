const fs = require('fs');
const path = require('path');

const filePath = path.resolve('frontend/src/views/Ideas.vue');
let content = fs.readFileSync(filePath, 'utf-8');

const newScript = `const tabItems = [
  { label: 'Pending', icon: 'i-lucide-clock', slot: 'content', key: 'pending' },
  { label: 'Converted', icon: 'i-lucide-check-circle', slot: 'content', key: 'converted' },
  { label: 'Rejected', icon: 'i-lucide-x-circle', slot: 'content', key: 'rejected' }
];

const selectedTab = ref(0);
const onTabChange = (index) => {
  currentTab.value = tabItems[index].key;
  fetchIdeas();
};

const currentTab = ref('pending');`;

content = content.replace(/const currentTab = ref\('pending'\);/, newScript);

const newTabsTemplate = `<!-- Tabs -->
    <UTabs 
      v-model="selectedTab"
      :items="tabItems" 
      class="w-full mb-6"
      @update:modelValue="onTabChange"
    >
      <template #content="{ item }">
        <div v-if="loading" class="text-center py-10">
          <p class="text-muted">Loading ideas...</p>
        </div>
        <div v-else-if="ideas.length === 0" class="text-center py-10">
          <p class="text-muted">No ideas found for this status.</p>
        </div>
        <div v-else class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="idea in ideas" :key="idea.id" class="bg-default overflow-hidden shadow rounded-lg border border-default flex flex-col">
            <div class="p-5 flex-1">
              <p class="text-xs text-muted mb-2">{{ formatDate(idea.createdAt) }}</p>
              <p class="text-sm text-default line-clamp-4">{{ idea.text }}</p>
              
              <div v-if="idea.media && idea.media.length > 0" class="mt-3 flex gap-2 overflow-x-auto">
                <template v-for="(m, i) in idea.media" :key="i">
                  <img v-if="m.type === 'image'" :src="m.url" class="h-16 w-16 object-cover rounded" />
                  <div v-else class="h-16 w-16 bg-muted flex items-center justify-center rounded text-xs text-muted">Video</div>
                </template>
              </div>
            </div>
            
            <div class="bg-elevated px-5 py-3 border-t border-default flex flex-col gap-3">
              <div v-if="idea.status === 'pending' || idea.status === 'rejected'" class="flex flex-col gap-2">
                <label class="block text-xs font-medium text-default">Template</label>
                <select v-model="selectedTemplates[idea.id]" class="mt-1 block w-full pl-3 pr-10 py-2 text-sm border-default bg-default text-default focus:outline-none focus:ring-primary focus:border-primary sm:text-sm rounded-md">
                  <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
              </div>
              <div class="flex gap-2">
                <button 
                  v-if="idea.status === 'pending' || idea.status === 'rejected'" 
                  @click="convertIdea(idea.id)" 
                  class="flex-1 inline-flex justify-center items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                >
                  Convert to Post
                </button>
                
                <button 
                  v-if="idea.status === 'pending'" 
                  @click="updateStatus(idea.id, 'rejected')" 
                  class="flex-1 inline-flex justify-center items-center px-3 py-1.5 border border-default shadow-sm text-xs font-medium rounded text-default bg-default hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                >
                  Reject
                </button>
                
                 <button 
                  v-if="idea.status === 'rejected'" 
                  @click="updateStatus(idea.id, 'pending')" 
                  class="flex-1 inline-flex justify-center items-center px-3 py-1.5 border border-default shadow-sm text-xs font-medium rounded text-default bg-default hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                >
                  Move to Pending
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UTabs>`;

content = content.replace(/<!-- Tabs -->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/template>/, newTabsTemplate + '\n</template>');

fs.writeFileSync(filePath, content);
console.log('Successfully updated Ideas.vue');
