import { createApp } from 'vue'
import './style.css'
import '@fancyapps/ui/dist/fancybox/fancybox.css'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'
import ui from '@nuxt/ui/vue-plugin'

import Dashboard from './views/Dashboard.vue'
import Settings from './views/Settings.vue'
import PostDetail from './views/PostDetail.vue'
import CreatePost from './views/CreatePost.vue'
import Jobs from './views/Jobs.vue'
import Ideas from './views/Ideas.vue'
import App from './App.vue'

const routes = [
  { path: '/', component: Dashboard },
  { path: '/settings', component: Settings },
  { path: '/post/:id', component: PostDetail },
  { path: '/create', component: CreatePost },
  { path: '/jobs', component: Jobs },
  { path: '/ideas', component: Ideas },
]
})

createApp(App).use(router).use(ui).mount('#app')
