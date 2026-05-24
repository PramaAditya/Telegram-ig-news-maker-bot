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

export const apiFetch = async (url: string, options: RequestInit = {}): Promise<any> => {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...getAuthHeaders()
    }
  });

  if (res.status === 401) {
    const pwd = prompt("Enter Dashboard Password:");
    if (pwd !== null) {
      setPassword(pwd);
      return apiFetch(url, options); // Retry
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }

  return res.json();
}
