<script setup lang="ts">
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <nav class="bg-white border-b border-gray-200 px-4 py-3">
      <div class="max-w-5xl mx-auto flex justify-between items-center">
        <div class="flex items-center space-x-6">
          <router-link to="/" class="text-xl font-bold text-gray-900">IG News Maker Bot</router-link>
          <div class="flex space-x-4">
            <router-link to="/" class="text-sm font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md" active-class="bg-gray-100 text-gray-900">Queue</router-link>
            <router-link to="/create" class="text-sm font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md" active-class="bg-gray-100 text-gray-900">Create New</router-link>
          </div>
        </div>
        <div class="text-sm text-gray-500">Admin Dashboard</div>
      </div>
    </nav>
    <main class="max-w-5xl mx-auto p-4 py-8">
      <router-view></router-view>
    </main>
  </div>
</template>
