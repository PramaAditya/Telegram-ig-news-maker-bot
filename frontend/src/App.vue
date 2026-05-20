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
    <div class="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <nav class="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <div class="max-w-5xl mx-auto flex justify-between items-center">
          <div class="flex items-center space-x-6">
            <router-link to="/" class="text-xl font-bold text-gray-900 dark:text-white">IG News Maker Bot</router-link>
            <div class="flex space-x-4">
              <router-link to="/" class="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-2 py-1 rounded-md" active-class="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white">Queue</router-link>
              <router-link to="/create" class="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-2 py-1 rounded-md" active-class="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white">Create New</router-link>
              <router-link to="/settings" class="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-2 py-1 rounded-md" active-class="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white">Settings</router-link>
            </div>
          </div>
          <div class="text-sm text-gray-500 flex items-center gap-4">
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
