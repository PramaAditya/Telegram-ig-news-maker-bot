const fs = require('fs');
const path = require('path');

const filePath = path.resolve('frontend/src/views/Dashboard.vue');
let content = fs.readFileSync(filePath, 'utf-8');

const newScript = `const tabItems = [
  { label: 'Pending', icon: 'i-lucide-clock', slot: 'content', key: 'pending' },
  { label: 'Published', icon: 'i-lucide-check-circle', slot: 'content', key: 'published' },
  { label: 'Error', icon: 'i-lucide-alert-circle', slot: 'content', key: 'error' }
];

const selectedTab = ref(0);
const onTabChange = (index) => {
  activeTab.value = tabItems[index].key;
  fetchQueue();
};`;

content = content.replace(/const tabs = \[\s*\{ label: 'Pending', key: 'pending' \},\s*\{ label: 'Published', key: 'published' \},\s*\{ label: 'Error', key: 'error' \}\s*\];/, newScript);

const newTabsTemplate = `<!-- Tabs -->
    <UTabs 
      v-model="selectedTab"
      :items="tabItems" 
      class="w-full mb-6"
      @update:modelValue="onTabChange"
    >
      <template #content="{ item }">
        <div v-if="loading" class="text-center py-10 text-muted">
          Loading queue...
        </div>
        <UAlert
          v-else-if="error"
          color="error"
          variant="soft"
          :description="error"
          class="mb-4"
        />
        <div
          v-else-if="queue.length === 0"
          class="text-center py-10 bg-default border border-default rounded-lg text-muted"
        >
          The queue is empty.
        </div>

        <div v-else class="overflow-hidden">
          <draggable
            v-if="activeTab === 'pending'"
            v-model="queue"
            tag="ul"
            class=""
            handle=".drag-handle"
            ghost-class="opacity-50"
            @end="onDragEnd"
            item-key="id"
          >
            <template #item="{ element: qItem, index }">
              <li class="relative mb-6">
                <!-- Day Group Header -->
                <div v-if="isFirstOfDay(index)" class="pb-3 pt-6 first:pt-0">
                  <h2 class="text-lg font-medium text-default">{{ formatDayHeader(qItem.expectedPostAt) }}</h2>
                </div>

                <div class="flex items-start gap-2 sm:gap-4">
                  <!-- Time Column -->
                  <div class="w-16 sm:w-20 flex-shrink-0 pt-5 text-sm font-medium text-default text-right">
                    {{ formatTimeOnly(qItem.expectedPostAt) }}
                  </div>

                  <!-- Drag Handle & Jump -->
                  <div class="flex-shrink-0 pt-5 flex flex-col items-center gap-2">
                    <button class="drag-handle cursor-move text-muted hover:text-default">
                      <GripVertical class="w-5 h-5" />
                    </button>
                    <div class="flex items-center text-xs text-muted font-medium">
                      <span class="mr-1 text-muted">#</span>
                      <input
                        type="number"
                        :value="index + 1"
                        min="1"
                        :max="queue.length"
                        @change="(e) => jumpToPosition(index, e)"
                        class="w-10 px-1 py-1 text-center border border-default rounded bg-muted text-default focus:outline-none focus:ring-1 focus:ring-primary"
                        title="Jump to position"
                      />
                    </div>
                  </div>

                  <!-- Item Card -->
                  <UCard class="flex-1 min-w-0 shadow-sm hover:shadow-md transition-shadow" :ui="{ body: 'p-4 sm:p-5', footer: 'px-4 py-3 sm:px-5' }">
                    <div class="flex flex-col sm:flex-row justify-between gap-6">
                      
                      <!-- Left: Content -->
                      <div class="flex-1 min-w-0">
                        <p class="text-sm text-default whitespace-pre-wrap line-clamp-6">
                          {{ qItem.text }}
                        </p>
                      </div>
                      
                      <!-- Right: Media Grid -->
                      <div v-if="qItem.media.length > 0" class="flex-shrink-0">
                        <div class="grid grid-cols-2 grid-rows-2 gap-0.5 w-full sm:w-56 h-56 rounded-md overflow-hidden bg-black border border-default">
                          <template v-for="(m, i) in qItem.media.slice(0, 4)" :key="i">
                            <div 
                              @click="openLightbox(qItem.media, Number(i))"
                              class="relative cursor-pointer hover:opacity-90 transition group w-full h-full"
                              :class="{
                                'col-span-2 row-span-2': qItem.media.length === 1,
                                'col-span-1 row-span-2': qItem.media.length === 2,
                                'col-span-1 row-span-1': qItem.media.length >= 3,
                              }"
                            >
                              <img v-if="m.type === 'image'" :src="m.url" class="w-full h-full object-cover" />
                              <div v-else class="w-full h-full flex items-center justify-center bg-gray-800 text-white text-xs">Video</div>
                              
                              <div v-if="i === 3 && qItem.media.length > 4" class="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <span class="text-white font-medium text-xl">+{{ qItem.media.length - 4 }}</span>
                              </div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>

                    <template #footer>
                      <div class="flex items-center justify-between">
                        <div class="text-sm text-muted">
                          You created this {{ timeAgo(qItem.createdAt) }}
                        </div>
                        <div class="flex items-center gap-2">
                          <UButton color="white" variant="solid" @click="publishNow(qItem.id)">
                            <template #leading><Send class="w-4 h-4" /></template>
                            Publish Now
                          </UButton>
                          <UButton color="white" variant="solid" @click="$router.push('/post/' + qItem.id)" :padded="false" class="p-2">
                            <Edit class="w-4 h-4 text-muted" />
                          </UButton>
                          <UDropdownMenu :items="[[{ label: 'Delete', onSelect: () => deleteItem(qItem.id), color: 'error' }]]" :content="{ align: 'end' }">
                            <UButton color="white" variant="solid" :padded="false" class="p-2">
                              <MoreVertical class="w-4 h-4 text-muted" />
                            </UButton>
                          </UDropdownMenu>
                        </div>
                      </div>
                    </template>
                  </UCard>
                </div>
              </li>
            </template>
          </draggable>
          <!-- Published / Error Lists (Non-draggable) -->
          <ul v-else class="">
            <li v-for="qItem in queue" :key="qItem.id" class="relative mb-6">
              <div class="flex items-start gap-2 sm:gap-4">
                
                <!-- Tab specific column -->
                <div class="w-16 sm:w-20 flex-shrink-0 pt-5 flex flex-col items-end gap-2">
                   <UBadge :color="activeTab === 'published' ? 'success' : 'error'" class="justify-center uppercase text-[10px]">
                     {{ activeTab }}
                   </UBadge>
                   <span class="text-xs font-medium text-default text-right">
                     {{ formatTimeOnly(activeTab === 'published' ? qItem.publishedAt : qItem.createdAt) }}
                   </span>
                </div>

                <UCard class="flex-1 min-w-0 shadow-sm" :ui="{ body: 'p-4 sm:p-5', footer: 'px-4 py-3 sm:px-5' }">
                    <div class="flex flex-col sm:flex-row justify-between gap-6">
                      
                      <div class="flex-1 min-w-0">
                        <p class="text-sm text-default whitespace-pre-wrap line-clamp-6">
                          {{ qItem.text }}
                        </p>
                        <div v-if="qItem.errorLog" class="mt-4 text-xs text-error bg-red-50/10 p-3 rounded border border-red-200/20">
                          <span class="font-mono break-all">{{ qItem.errorLog }}</span>
                        </div>
                      </div>
                      
                      <div v-if="qItem.media.length > 0" class="flex-shrink-0">
                        <div class="grid grid-cols-2 grid-rows-2 gap-0.5 w-full sm:w-56 h-56 rounded-md overflow-hidden bg-black border border-default">
                          <template v-for="(m, i) in qItem.media.slice(0, 4)" :key="i">
                            <div 
                              @click="openLightbox(qItem.media, Number(i))"
                              class="relative cursor-pointer hover:opacity-90 transition group w-full h-full"
                              :class="{
                                'col-span-2 row-span-2': qItem.media.length === 1,
                                'col-span-1 row-span-2': qItem.media.length === 2,
                                'col-span-1 row-span-1': qItem.media.length >= 3,
                              }"
                            >
                              <img v-if="m.type === 'image'" :src="m.url" class="w-full h-full object-cover" />
                              <div v-else class="w-full h-full flex items-center justify-center bg-gray-800 text-white text-xs">Video</div>
                              
                              <div v-if="i === 3 && qItem.media.length > 4" class="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <span class="text-white font-medium text-xl">+{{ qItem.media.length - 4 }}</span>
                              </div>
                            </div>
                          </template>
                        </div>
                      </div>
                    </div>

                    <template #footer>
                      <div class="flex items-center justify-between">
                        <div class="text-sm text-muted">
                          Created {{ timeAgo(qItem.createdAt) }}
                        </div>
                        <div class="flex items-center gap-2">
                          <UButton v-if="activeTab === 'error'" color="white" variant="solid" @click="retryError(qItem.id)">
                            <template #leading><RotateCcw class="w-4 h-4" /></template>
                            Retry
                          </UButton>
                          
                          <UDropdownMenu :items="[[{ label: 'Delete', onSelect: () => deleteItem(qItem.id), color: 'error' }]]" :content="{ align: 'end' }">
                            <UButton color="white" variant="solid" :padded="false" class="p-2">
                              <MoreVertical class="w-4 h-4 text-muted" />
                            </UButton>
                          </UDropdownMenu>
                        </div>
                      </div>
                    </template>
                </UCard>
              </div>
            </li>
          </ul>
        </div>
      </template>
    </UTabs>`;

content = content.replace(/<!-- Tabs -->[\s\S]*?<\/ul>\n\s*<\/div>/, newTabsTemplate);

fs.writeFileSync(filePath, content);
console.log('Successfully updated Dashboard.vue');
