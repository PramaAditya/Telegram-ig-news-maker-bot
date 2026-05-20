import { createApp } from 'vue'
import './style.css'
import '@fancyapps/ui/dist/fancybox/fancybox.css'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'

import Dashboard from './views/Dashboard.vue'
import PostDetail from './views/PostDetail.vue'
import CreatePost from './views/CreatePost.vue'
import Settings from './views/Settings.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/create', component: CreatePost },
    { path: '/settings', component: Settings },
    { path: '/post/:id', component: PostDetail }
  ]
})

createApp(App).use(router).use(ui).mount('#app')
