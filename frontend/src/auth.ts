import { ref } from 'vue'

export const dashboardPassword = ref(localStorage.getItem('dashboard_password') || '')

export const setPassword = (pwd: string) => {
  const cleanPwd = pwd.trim()
  dashboardPassword.value = cleanPwd
  localStorage.setItem('dashboard_password', cleanPwd)
}

export const getAuthHeaders = () => ({
  Authorization: `Bearer ${dashboardPassword.value}`
})
