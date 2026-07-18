import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import DashboardView from './views/DashboardView.vue';
import TodayView from './views/TodayView.vue';

const router = createRouter({
  history: createWebHistory('/app/'),
  routes: [
    { path: '/', name: 'today', component: TodayView },
    { path: '/dashboard', name: 'dashboard', component: DashboardView },
  ],
});

createApp(App).use(router).mount('#app');
