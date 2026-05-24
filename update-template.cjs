const fs = require('fs');
const path = require('path');

const filePath = path.resolve('frontend/src/views/Settings.vue');
let content = fs.readFileSync(filePath, 'utf-8');

const oldTemplate = `<div v-else class="space-y-8">
        
        <!-- Media Assets -->
        <div>
          <h2 class="text-lg font-bold text-default mb-4 border-b border-default pb-2">Media Assets</h2>`;

// I'll use regex to replace everything from `<div v-else class="space-y-8">` to the end of the template.
const templateStartRegex = /<div v-else class="space-y-8">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/template>/;

const newTemplate = `<div v-else class="space-y-6">
        <UTabs :items="tabItems" class="w-full" :ui="{ list: { rounded: 'rounded-full' } }">
          <template #media>
            <div class="mt-6 space-y-6">
              <h2 class="text-lg font-bold text-default border-b border-default pb-2">Media Assets</h2>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label class="block text-sm font-medium text-default mb-2">Watermark Logo URL</label>
                  <ImageUploader v-model="settings.logoImageUrl" />
                </div>
                <div>
                  <label class="block text-sm font-medium text-default mb-2">CTA Slide URL (Final Slide)</label>
                  <ImageUploader v-model="settings.ctaImageUrl" />
                </div>
              </div>
            </div>
          </template>

          <template #publishing>
            <div class="mt-6 space-y-6">
              <h2 class="text-lg font-bold text-default border-b border-default pb-2">Posting Slots</h2>
              <UAlert
                :icon="Info"
                color="neutral"
                variant="subtle"
                description="Your posting slots determine exactly when the worker will publish the next item in the Posts Queue. Add slots below using Natural Language AI!"
              />

              <!-- Slots Grid -->
              <div class="border border-default rounded-lg overflow-hidden bg-default flex flex-col md:flex-row">
                <div v-for="day in daysOfWeek" :key="day" class="flex-1 border-b md:border-b-0 md:border-r border-default last:border-0 min-w-0">
                  <div class="bg-muted py-3 text-center border-b border-default">
                    <span class="text-sm font-semibold text-default">{{ day }}</span>
                  </div>
                  <div class="p-2 space-y-2 min-h-[100px] flex flex-col items-center">
                    <div v-if="slotsByDay[day].length === 0" class="text-xs text-muted py-4 italic">
                      No slots
                    </div>
                    <div v-for="(slot, i) in slotsByDay[day]" :key="i" class="group relative bg-default border border-default rounded shadow-sm px-3 py-2 text-sm font-medium text-default hover:border-default transition flex items-center justify-center w-full">
                      {{ formatTime(slot.time) }}
                      <button @click="removeSlot(slot)" class="absolute -right-1 -top-1 bg-error text-error rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition shadow-sm hover:bg-error">
                        <X class="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Add slots with AI -->
              <div class="bg-muted rounded-lg p-4 border border-default flex flex-col sm:flex-row items-center justify-between gap-4">
                <div class="flex-1 w-full">
                  <label class="block text-xs font-medium text-muted mb-1 uppercase tracking-wider">Add slots using AI</label>
                  <input 
                    v-model="aiPrompt" 
                    @keyup.enter="generateSlots"
                    type="text" 
                    placeholder="e.g. Everyday 3 times between 9am to 9pm"
                    class="w-full px-4 py-2.5 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-default text-default placeholder-muted"
                  />
                </div>
                <div class="flex items-center gap-3 w-full sm:w-auto mt-2 sm:mt-5">
                  <button 
                    @click="generateSlots" 
                    :disabled="aiGenerating || !aiPrompt.trim()"
                    class="flex-1 sm:flex-none inline-flex items-center justify-center px-4 py-2.5 border border-transparent shadow-sm text-sm font-medium rounded-md text-inverted bg-primary hover:bg-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
                  >
                    <Loader2 v-if="aiGenerating" class="w-4 h-4 mr-2 animate-spin" />
                    <Sparkles v-else class="w-4 h-4 mr-2" />
                    Generate
                  </button>
                  <button @click="clearAllSlots" class="text-sm font-medium text-error hover:text-error py-2.5 px-2">
                    Clear All
                  </button>
                </div>
              </div>
            </div>
          </template>

          <template #editorial>
            <div class="mt-6 space-y-6">
              <h2 class="text-lg font-bold text-default border-b border-default pb-2">Editorial Guidelines</h2>
              <UAlert
                :icon="Info"
                color="neutral"
                variant="subtle"
                description="Provide explicit instructions to the Content Writer AI on how to frame the news, tone of voice, perspective, and general editorial stance (e.g., highlighting specific geopolitical perspectives). Note: The Research AI will always remain strictly neutral and objective to gather unbiased facts first. This overwrites the default \`.env\` fallback."
              />
              <AiTextarea 
                v-model="settings.editorialGuidelines" 
                :rows="6" 
                placeholder="e.g. Your reporting should maintain a professional and highly informative journalistic tone. Focus on delivering factual news while highlighting perspectives from the Global South..."
                guidancePlaceholder="e.g., make it more aggressive and punchy"
                aiContext="This text represents the global editorial guidelines and framing instructions for a news AI agent. It dictates how the AI should write its content, including its tone, perspective, and biases."
              />
            </div>
          </template>

          <template #moderation>
            <div class="mt-6 space-y-6">
              <h2 class="text-lg font-bold text-default border-b border-default pb-2">Content Moderation</h2>
              <UAlert
                :icon="Info"
                color="neutral"
                variant="subtle"
                description="The AI Writer will be explicitly instructed to avoid these words and use the replacements instead. As a final fallback, the text will be hard-censored just before rendering/publishing."
              />

              <div class="bg-muted rounded-lg p-4 border border-default flex flex-col md:flex-row gap-4 items-end">
                <div class="flex-1 w-full">
                  <label class="block text-xs font-medium text-muted mb-1">Banned Word</label>
                  <input 
                    v-model="newBannedWord.word" 
                    type="text" 
                    placeholder="e.g. bunuh"
                    @keyup.enter="addBannedWord"
                    class="w-full px-3 py-2 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-default text-default"
                  />
                </div>
                <div class="flex-1 w-full">
                  <label class="block text-xs font-medium text-muted mb-1">Replacement</label>
                  <input 
                    v-model="newBannedWord.replacement" 
                    type="text" 
                    placeholder="e.g. b*nuh"
                    @keyup.enter="addBannedWord"
                    class="w-full px-3 py-2 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-default text-default"
                  />
                </div>
                <div class="w-full md:w-auto">
                  <label class="block text-xs font-medium text-muted mb-1">Match Type</label>
                  <select 
                    v-model="newBannedWord.type"
                    class="w-full px-3 py-2 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-default text-default"
                  >
                    <option value="partial">Partial (Matches inside words)</option>
                    <option value="exact">Exact (Whole word only)</option>
                  </select>
                </div>
                <div class="w-full md:w-auto flex gap-2">
                  <button 
                    @click="addBannedWord" 
                    class="flex-1 inline-flex items-center justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-inverted bg-primary hover:bg-primary focus:outline-none"
                  >
                    Add Rule
                  </button>
                </div>
              </div>

              <!-- Dictionary List -->
              <div v-if="settings.bannedWords && settings.bannedWords.length > 0" class="border border-default rounded-lg overflow-hidden bg-default">
                <ul class="divide-y divide-default max-h-96 overflow-y-auto">
                  <li v-for="(item, index) in settings.bannedWords" :key="index" class="p-3 sm:px-4 hover:bg-muted transition-colors" :class="{'bg-muted': editingWordIndex === index}">
                    <!-- Inline Edit Form -->
                    <div v-if="editingWordIndex === index" class="flex flex-col md:flex-row gap-3 items-center w-full">
                      <div class="flex-1 w-full">
                        <input 
                          v-model="editingWordState.word" 
                          type="text" 
                          placeholder="Banned Word"
                          @keyup.enter="saveEditedWord"
                          class="w-full px-3 py-1.5 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-default text-default"
                        />
                      </div>
                      <div class="text-muted hidden md:block">→</div>
                      <div class="flex-1 w-full">
                        <input 
                          v-model="editingWordState.replacement" 
                          type="text" 
                          placeholder="Replacement"
                          @keyup.enter="saveEditedWord"
                          class="w-full px-3 py-1.5 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-default text-default"
                        />
                      </div>
                      <div class="w-full md:w-auto">
                        <select 
                          v-model="editingWordState.type"
                          class="w-full px-3 py-1.5 border border-default rounded-md shadow-sm focus:ring-primary focus:border-primary text-sm bg-default text-default"
                        >
                          <option value="partial">Partial</option>
                          <option value="exact">Exact</option>
                        </select>
                      </div>
                      <div class="flex gap-2 w-full md:w-auto mt-2 md:mt-0 justify-end">
                        <button @click="saveEditedWord" class="px-3 py-1.5 text-xs font-medium text-inverted bg-primary rounded-md hover:bg-primary/90 transition-colors">Save</button>
                        <button @click="cancelEditBannedWord" class="px-3 py-1.5 text-xs font-medium text-default bg-default border border-default rounded-md hover:bg-muted transition-colors">Cancel</button>
                      </div>
                    </div>

                    <!-- Display Mode -->
                    <div v-else class="flex items-center justify-between w-full cursor-pointer" @click="editBannedWord(Number(index))">
                      <div class="flex items-center gap-2 sm:gap-4 overflow-hidden">
                        <span class="font-medium text-error truncate">{{ item.word }}</span>
                        <span class="text-muted text-xs">→</span>
                        <span class="font-mono text-sm text-success truncate">{{ item.replacement }}</span>
                        <span class="text-xs px-2 py-0.5 rounded-full bg-elevated text-muted hidden sm:inline-block">
                          {{ item.type }}
                        </span>
                      </div>
                      <button @click.stop="removeBannedWord(Number(index))" class="text-muted hover:text-error flex-shrink-0 ml-4 p-1 rounded-md hover:bg-default transition-colors">
                        <X class="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                </ul>
              </div>
              <div v-else class="text-center py-6 border border-dashed border-default rounded-lg text-muted text-sm">
                No moderation rules configured.
              </div>
            </div>
          </template>

          <template #keys>
            <div class="mt-6 space-y-6">
              <h2 class="text-lg font-bold text-default border-b border-default pb-2">API Keys & Tokens</h2>
              
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-default mb-2">Telegram Bot Token</label>
                  <PasswordInput v-model="settings.telegramBotToken" placeholder="123456789:ABCDefgh..." />
                  <p class="text-xs text-muted mt-1">Changes to this require a full container restart to reconnect Telegraf.</p>
                </div>
                
                <div>
                  <label class="block text-sm font-medium text-default mb-2">Buffer API Key (Bearer)</label>
                  <PasswordInput v-model="settings.bufferApiKey" placeholder="1/abcdef..." />
                </div>

                <div>
                  <label class="block text-sm font-medium text-default mb-2">Buffer Instagram Channel ID</label>
                  <PasswordInput v-model="settings.bufferInstagramChannelId" placeholder="60abc123..." />
                </div>
              </div>
            </div>
          </template>
        </UTabs>

        <div class="pt-6 border-t border-default mt-8">
          <button 
            @click="saveSettings" 
            :disabled="saving"
            class="w-full flex justify-center items-center px-4 py-3 border border-transparent shadow-sm text-base font-medium rounded-md text-inverted bg-primary hover:bg-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
          >
            <Loader2 v-if="saving" class="w-5 h-5 mr-2 animate-spin" />
            <Save v-else class="w-5 h-5 mr-2" />
            {{ saving ? 'Saving...' : 'Save Settings' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>`;

content = content.replace(templateStartRegex, newTemplate);
fs.writeFileSync(filePath, content);
console.log('Template successfully updated.');