import { createApp } from 'vue'
import './style.css'
import '@fancyapps/ui/dist/fancybox/fancybox.css'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from './views/Dashboard.vue'
import PostDetail from './views/PostDetail.vue'
import CreatePost from './views/CreatePost.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/create', component: CreatePost },
    { path: '/post/:id', component: PostDetail }
  ]
})

createApp(App).use(router).mount('#app')
