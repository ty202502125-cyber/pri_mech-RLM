import axios from 'axios'

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '')
const apiBaseUrl = configuredBaseUrl || '/api'

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
  withCredentials: true,
  withXSRFToken: true,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
})

const csrfBaseUrl = configuredBaseUrl?.replace(/\/api\/?$/, '') || ''
const csrfClient = axios.create({
  baseURL: csrfBaseUrl,
  withCredentials: true,
  withXSRFToken: true,
  headers: { Accept: 'application/json' },
})

export const getCsrfCookie = () => csrfClient.get('/sanctum/csrf-cookie')

export default api
