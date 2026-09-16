import { createApp } from 'vue'
import './style.css'
import '@fancyapps/ui/dist/fancybox/fancybox.css'
import { createRouter, createWebHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'
import { createPinia } from 'pinia'

import Dashboard from './views/Dashboard.vue'
import Settings from './views/Settings.vue'
import GlobalSettings from './views/GlobalSettings.vue'
import PostDetail from './views/PostDetail.vue'
import CreatePost from './views/CreatePost.vue'
import Jobs from './views/Jobs.vue'
import Ideas from './views/Ideas.vue'
import App from './App.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/settings', component: Settings },
    { path: '/global-settings', component: GlobalSettings },
    { path: '/post/:id', component: PostDetail },
    { path: '/create', component: CreatePost },
    { path: '/jobs', component: Jobs },
    { path: '/ideas', component: Ideas },
  ]
})

const pinia = createPinia()

createApp(App).use(router).use(pinia).use(ui).mount('#app')

// Prevent pinch-to-zoom and double-tap zoom on mobile devices (iOS Safari, Android Chrome)
if (typeof document !== 'undefined') {
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());

  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}
