<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Trash2, Edit, Send, GripVertical, CalendarClock } from "lucide-vue-next";
import { getAuthHeaders, setPassword } from "../auth";
import { Fancybox } from "@fancyapps/ui";
import draggable from "vuedraggable";

const queue = ref<any[]>([]);
const postingSlots = ref<{day: string, time: string}[]>([]);
const loading = ref(true);
const error = ref("");

const openLightbox = (mediaArray: any[], index: number) => {
  const items = mediaArray.map((m) => ({
    src: m.url,
    type: m.type === "video" ? "video" : "image",
  }));
  Fancybox.show(items, { startIndex: index });
};

const dayMap: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
};

const getNextSlot = (fromDate: Date, sortedSlots: {day: string, time: string}[]) => {
  if (!sortedSlots.length) return null;

  const currentDay = fromDate.getDay();
  const currentHour = fromDate.getHours();
  const currentMinute = fromDate.getMinutes();

  for (let i = 0; i < 7; i++) {
    const searchDay = (currentDay + i) % 7;
    const slotsForDay = sortedSlots.filter(s => dayMap[s.day.toLowerCase()] === searchDay);
    
    for (const slot of slotsForDay) {
      const [h, m] = slot.time.split(':').map(Number);
      if (i === 0) {
        if (h > currentHour || (h === currentHour && m > currentMinute)) {
          const nextDate = new Date(fromDate);
          nextDate.setDate(nextDate.getDate() + i);
          nextDate.setHours(h, m, 0, 0);
          return nextDate;
        }
      } else {
        const nextDate = new Date(fromDate);
        nextDate.setDate(nextDate.getDate() + i);
        nextDate.setHours(h, m, 0, 0);
        return nextDate;
      }
    }
  }
  
  // Wrap to next week
  const firstSlot = sortedSlots[0];
  const [h, m] = firstSlot.time.split(':').map(Number);
  const targetDay = dayMap[firstSlot.day.toLowerCase()];
  let daysToAdd = targetDay - currentDay;
  if (daysToAdd <= 0) daysToAdd += 7;
  
  const nextDate = new Date(fromDate);
  nextDate.setDate(nextDate.getDate() + daysToAdd);
  nextDate.setHours(h, m, 0, 0);
  return nextDate;
};

const calculateExpectedTimes = () => {
  if (!queue.value.length) return;

  const sortedSlots = [...postingSlots.value].sort((a, b) => {
    const dayA = dayMap[a.day.toLowerCase()] || 0;
    const dayB = dayMap[b.day.toLowerCase()] || 0;
    if (dayA !== dayB) return dayA - dayB;
    return a.time.localeCompare(b.time);
  });

  let refDate = new Date();
  
  for (const item of queue.value) {
    if (!sortedSlots.length) {
      item.expectedPostAt = null;
      continue;
    }

    const next = getNextSlot(refDate, sortedSlots);
    if (next) {
      item.expectedPostAt = next;
      refDate = new Date(next.getTime() + 60000);
    } else {
      item.expectedPostAt = null;
    }
  }
};

const fetchSettings = async () => {
  try {
    const res = await fetch("/api/settings", { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      postingSlots.value = data.postingSlots || [];
      calculateExpectedTimes();
    }
  } catch (e) {}
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
    calculateExpectedTimes();
    error.value = "";
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

const syncReorder = async () => {
  try {
    calculateExpectedTimes(); // update UI instantly before sync
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

onMounted(() => {
  fetchQueue();
  fetchSettings();
});

const jumpToPosition = async (currentIndex: number, event: Event) => {
  const target = event.target as HTMLInputElement;
  const newIndex = parseInt(target.value) - 1;

  if (
    isNaN(newIndex) ||
    newIndex < 0 ||
    newIndex >= queue.value.length ||
    newIndex === currentIndex
  ) {
    target.value = (currentIndex + 1).toString();
    return;
  }

  const newQueue = [...queue.value];
  const [movedItem] = newQueue.splice(currentIndex, 1);
  newQueue.splice(newIndex, 0, movedItem);
  queue.value = newQueue;

  target.value = (newIndex + 1).toString();
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

const formatExpectedTime = (dateObj: Date | string) => {
  if (!dateObj) return '';
  const d = new Date(dateObj);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);
};
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold text-default">Posts Queue</h1>
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
                  class="mt-2 flex items-center space-x-3 text-xs text-muted"
                >
                  <UBadge color="gray" variant="soft"> {{ item.media.length }} media </UBadge>
                  
                  <span v-if="item.expectedPostAt" class="flex items-center text-primary font-medium bg-primary-50 px-2 py-0.5 rounded border border-primary-100">
                    <CalendarClock class="w-3.5 h-3.5 mr-1" />
                    {{ formatExpectedTime(item.expectedPostAt) }}
                  </span>
                  <span v-else class="flex items-center text-warning font-medium">
                    <CalendarClock class="w-3.5 h-3.5 mr-1" />
                    No slots configured
                  </span>
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
