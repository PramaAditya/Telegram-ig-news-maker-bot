<script setup lang="ts">
import { Moon } from 'lucide-vue-next'
import { useColorMode } from '@vueuse/core'

const colorMode = useColorMode()

const toggleColorMode = () => {
  colorMode.value = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-muted text-default">
      <nav class="bg-default border-b border-default px-4 py-3">
        <div class="max-w-5xl mx-auto flex justify-between items-center">
          <div class="flex items-center space-x-6">
            <router-link to="/" class="text-xl font-bold text-default">IG News Maker Bot</router-link>
          </div>
          <div class="hidden sm:block sm:ml-6">
            <div class="flex space-x-4">
              <router-link to="/ideas" class="text-sm font-medium text-muted hover:text-default px-2 py-1 rounded-md" active-class="bg-elevated text-default">Ideas</router-link>
              <router-link to="/" class="text-sm font-medium text-muted hover:text-default px-2 py-1 rounded-md" active-class="bg-elevated text-default">Queue</router-link>
              <router-link to="/jobs" class="text-sm font-medium text-muted hover:text-default px-2 py-1 rounded-md" active-class="bg-elevated text-default">Jobs</router-link>
              <router-link to="/settings" class="text-sm font-medium text-muted hover:text-default px-2 py-1 rounded-md" active-class="bg-elevated text-default">Settings</router-link>
            </div>
          </div>
          <div class="text-sm text-muted flex items-center gap-4">
            <span>Admin Dashboard</span>
            <UButton :icon="Moon" color="neutral" variant="ghost" @click="toggleColorMode" />
          </div>
        </div>
      </nav>
      <main class="max-w-5xl mx-auto p-4 py-8">
        <router-view></router-view>
      </main>
    </div>
  </UApp>
</template>
