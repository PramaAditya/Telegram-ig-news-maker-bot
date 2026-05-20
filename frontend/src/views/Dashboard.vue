<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Trash2, Edit, Send, GripVertical } from "lucide-vue-next";
import { getAuthHeaders, setPassword } from "../auth";
import { Fancybox } from "@fancyapps/ui";
import draggable from "vuedraggable";

const queue = ref<any[]>([]);
const loading = ref(true);
const error = ref("");

const openLightbox = (mediaArray: any[], index: number) => {
  const items = mediaArray.map((m) => ({
    src: m.url,
    type: m.type === "video" ? "video" : "image",
  }));
  Fancybox.show(items, { startIndex: index });
};

const syncReorder = async () => {
  try {
    const res = await fetch(`/api/queue/reorder`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: queue.value.map((i) => i.id) }),
    });
    if (res.status === 401) {
      alert("Unauthorized. Please refresh and re-enter password.");
      return;
    }
  } catch (err) {
    alert("Failed to reorder items");
    fetchQueue(); // rollback
  }
};

const onDragEnd = async () => {
  await syncReorder();
};

const fetchQueue = async () => {
  loading.value = true;
  try {
    const res = await fetch("/api/queue", { headers: getAuthHeaders() });
    if (res.status === 401) {
      const pwd = prompt("Enter Dashboard Password:");
      if (pwd !== null) {
        setPassword(pwd);
        return fetchQueue();
      }
      throw new Error("Unauthorized");
    }
    if (!res.ok) throw new Error("Failed to fetch");
    queue.value = await res.json();
    error.value = "";
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

onMounted(fetchQueue);

const jumpToPosition = async (currentIndex: number, event: Event) => {
  const target = event.target as HTMLInputElement;
  const newIndex = parseInt(target.value) - 1; // 1-based to 0-based

  if (
    isNaN(newIndex) ||
    newIndex < 0 ||
    newIndex >= queue.value.length ||
    newIndex === currentIndex
  ) {
    // Reset to current index if invalid
    target.value = (currentIndex + 1).toString();
    return;
  }

  // Perform local array reorder
  const newQueue = [...queue.value];
  const [movedItem] = newQueue.splice(currentIndex, 1);
  newQueue.splice(newIndex, 0, movedItem);
  queue.value = newQueue;

  // Update target value to reflect the new state
  target.value = (newIndex + 1).toString();

  // Sync with server
  await syncReorder();
};

const deleteItem = async (id: number) => {
  if (!confirm("Are you sure you want to delete this post?")) return;
  try {
    const res = await fetch(`/api/queue/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (res.status === 401) return alert("Unauthorized");
    fetchQueue();
  } catch (err) {
    alert("Failed to delete");
  }
};

const publishNow = async (id: number) => {
  if (
    !confirm(
      "Are you sure you want to publish this post IMMEDIATELY to Buffer?",
    )
  )
    return;
  try {
    const res = await fetch(`/api/queue/${id}/publish`, {
      method: "POST",
      headers: getAuthHeaders(),
    });
    if (res.status === 401) return alert("Unauthorized");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to publish");
    alert("Published successfully!");
    fetchQueue();
  } catch (err: any) {
    alert(err.message);
  }
};
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold text-default">Pending Queue</h1>
      <button
        @click="fetchQueue"
        class="px-4 py-2 bg-default border border-default rounded-md text-sm font-medium text-default hover:bg-muted"
      >
        Refresh
      </button>
    </div>

    <div v-if="loading" class="text-center py-10 text-muted">
      Loading queue...
    </div>
    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      :description="error"
      class="mb-4"
    />
    <div
      v-else-if="queue.length === 0"
      class="text-center py-10 bg-default border border-default rounded-lg text-muted"
    >
      The queue is empty.
    </div>

    <div v-else class="bg-default shadow rounded-lg overflow-hidden">
      <draggable
        v-model="queue"
        tag="ul"
        class="divide-y divide-default"
        handle=".drag-handle"
        ghost-class="opacity-50"
        @end="onDragEnd"
        item-key="id"
      >
        <template #item="{ element: item, index }">
          <li class="p-4 bg-default hover:bg-muted transition-colors">
            <div class="flex items-start space-x-4">
              <div
                class="flex-shrink-0 flex flex-col items-center justify-center space-y-2 mt-1"
              >
                <button
                  class="drag-handle cursor-move text-muted hover:text-default"
                >
                  <GripVertical class="w-6 h-6" />
                </button>

                <div class="flex items-center text-xs text-muted font-medium">
                  <span class="mr-1">#</span>
                  <input
                    type="number"
                    :value="index + 1"
                    min="1"
                    :max="queue.length"
                    @change="(e) => jumpToPosition(index, e)"
                    class="w-12 px-1 py-1 text-center border border-default rounded bg-muted text-default focus:outline-none focus:ring-1 focus:ring-primary"
                    title="Jump to position"
                  />
                </div>
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-default line-clamp-2">
                  {{ item.text }}
                </p>
                <div
                  class="mt-2 flex items-center space-x-2 text-xs text-muted"
                >
                  <UBadge> {{ item.media.length }} media item(s) </UBadge>
                  <span>•</span>
                  <span
                    >Added {{ new Date(item.createdAt).toLocaleString() }}</span
                  >
                </div>

                <div class="mt-3 flex space-x-2" v-if="item.media.length > 0">
                  <div
                    v-for="(m, i) in item.media.slice(0, 3)"
                    :key="i"
                    @click="openLightbox(item.media, Number(i))"
                    class="cursor-pointer hover:opacity-80 transition w-16 h-16 rounded overflow-hidden bg-elevated border border-default"
                  >
                    <img
                      v-if="m.type === 'image'"
                      :src="m.url"
                      class="w-full h-full object-cover"
                    />
                    <div
                      v-else
                      class="w-full h-full flex items-center justify-center text-muted text-xs"
                    >
                      Video
                    </div>
                  </div>
                  <div
                    v-if="item.media.length > 3"
                    @click="openLightbox(item.media, 3)"
                    class="cursor-pointer hover:opacity-80 transition w-16 h-16 rounded bg-elevated border border-default flex items-center justify-center text-sm font-medium text-muted"
                  >
                    +{{ item.media.length - 3 }}
                  </div>
                </div>
              </div>

              <div class="flex-shrink-0 flex space-x-2">
                <router-link
                  :to="'/post/' + item.id"
                  class="p-2 text-muted hover:text-primary rounded-md hover:bg-blue-50"
                  title="Edit details"
                >
                  <Edit class="w-5 h-5" />
                </router-link>
                <button
                  @click="publishNow(item.id)"
                  class="p-2 text-muted hover:text-success rounded-md hover:bg-green-50"
                  title="Publish immediately"
                >
                  <Send class="w-5 h-5" />
                </button>
                <button
                  @click="deleteItem(item.id)"
                  class="p-2 text-muted hover:text-error rounded-md hover:bg-red-50"
                  title="Delete post"
                >
                  <Trash2 class="w-5 h-5" />
                </button>
              </div>
            </div>
          </li>
        </template>
      </draggable>
    </div>
  </div>
</template>
