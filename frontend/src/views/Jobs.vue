<script setup lang="ts">
import { ref, onMounted } from "vue";
import { RotateCcw, AlertCircle } from "lucide-vue-next";
import { getAuthHeaders, setPassword } from "../auth";

const toast = useToast();

const jobs = ref<any[]>([]);
const loading = ref(true);
const error = ref("");
const retryingId = ref<number | null>(null);

const fetchJobs = async () => {
  loading.value = true;
  try {
    const res = await fetch("/api/jobs", { headers: getAuthHeaders() });
    if (res.status === 401) {
      const pwd = prompt("Enter Dashboard Password:");
      if (pwd !== null) {
        setPassword(pwd);
        return fetchJobs();
      }
      throw new Error("Unauthorized");
    }
    if (!res.ok) throw new Error("Failed to fetch jobs");
    jobs.value = await res.json();
    error.value = "";
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

const retryJob = async (id: number) => {
  retryingId.value = id;
  try {
    const res = await fetch(`/api/jobs/${id}/retry`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    if (res.status === 401) {
      toast.add({ title: "Unauthorized", color: "error" });
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to retry job");
    
    // Refresh the list
    await fetchJobs();
  } catch (err: any) {
    toast.add({ title: err.message, color: "error" });
  } finally {
    retryingId.value = null;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'success';
    case 'error': return 'error';
    case 'processing': return 'warning';
    default: return 'gray';
  }
};

onMounted(fetchJobs);
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold text-default">Background Jobs</h1>
      <button
        @click="fetchJobs"
        class="px-4 py-2 bg-default border border-default rounded-md text-sm font-medium text-default hover:bg-muted"
      >
        Refresh
      </button>
    </div>

    <div v-if="loading" class="text-center py-10 text-muted">
      Loading jobs...
    </div>
    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      :description="error"
      class="mb-4"
    />
    <div
      v-else-if="jobs.length === 0"
      class="text-center py-10 bg-default border border-default rounded-lg text-muted"
    >
      No jobs found.
    </div>

    <div v-else class="bg-default shadow rounded-lg overflow-hidden">
      <ul class="divide-y divide-default">
        <li v-for="job in jobs" :key="job.id" class="p-4 hover:bg-muted transition-colors">
          <div class="flex items-start space-x-4">
            
            <div class="flex-shrink-0 pt-1">
              <UBadge :color="getStatusColor(job.status)" class="w-24 justify-center uppercase text-[10px]">
                {{ job.status }}
              </UBadge>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center space-x-2">
                <span class="text-sm font-medium text-default">Job #{{ job.id }}</span>
                <span class="text-xs text-muted">&bull; {{ new Date(job.createdAt).toLocaleString() }}</span>
                <span class="text-xs text-muted">&bull; Source: {{ job.chatId }}</span>
              </div>
              
              <p class="mt-1 text-sm text-default line-clamp-2 italic">
                "{{ job.text }}"
              </p>

              <div v-if="job.errorLog" class="mt-2 text-xs text-error bg-red-50/10 p-2 rounded border border-red-200/20 flex items-start space-x-2">
                <AlertCircle class="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span class="font-mono break-all">{{ job.errorLog }}</span>
              </div>
            </div>

            <div class="flex-shrink-0 flex items-center justify-end" style="min-width: 40px">
              <button
                v-if="job.status === 'error'"
                @click="retryJob(job.id)"
                :disabled="retryingId === job.id"
                class="p-2 text-muted hover:text-primary rounded-md hover:bg-blue-50 disabled:opacity-50"
                title="Retry this job"
              >
                <RotateCcw class="w-5 h-5" :class="{'animate-spin': retryingId === job.id}" />
              </button>
            </div>

          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
