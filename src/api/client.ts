import axios from "axios";

// Configured for a future Laravel API. Base URL and auth header injection are
// wired up now so switching from mock services to real HTTP calls only means
// changing each service function's body, not this client.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("zou_irbm_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
