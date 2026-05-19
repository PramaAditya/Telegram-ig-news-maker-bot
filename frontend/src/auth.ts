import { ref } from 'vue'

export const dashboardPassword = ref(localStorage.getItem('dashboard_password') || '')

export const setPassword = (pwd: string) => {
  dashboardPassword.value = pwd
  localStorage.setItem('dashboard_password', pwd)
}

export const getAuthHeaders = () => ({
  Authorization: "Bearer "
})
