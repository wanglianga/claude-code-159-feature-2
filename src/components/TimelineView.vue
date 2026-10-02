<script setup lang="ts">
import { computed } from 'vue'
import type { TimelineEvent } from '@/types'
import { fmtDateTime } from '@/utils/date'

const props = defineProps<{ events: TimelineEvent[] }>()

const KIND_ICON: Record<TimelineEvent['kind'], string> = {
  registered: '📝',
  reviewed: '🔍',
  published: '✅',
  applied: '🙋',
  waitlisted: '⏳',
  confirmed: '🔒',
  handover_started: '🚪',
  handover_confirmed: '📷',
  returned: '↩️',
  restocked: '📥',
  recalled: '↩️',
  scrapped: '🚮',
  quarantined: '🚧',
  feedback: '⚠️',
  overdue_flagged: '⏰',
  delay_flagged: '🐢',
  cancelled: '❌',
  allocation_suggested: '🌙',
  allocated: '🎯',
  help_created: '🆘',
  help_mutual_aid: '🤝',
  help_alternative: '🔄',
  medical_tip: '🏥',
  backfilled: '📦',
  dispute_opened: '❓',
  dispute_replied: '📨',
}

const list = computed(() => [...props.events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)))
</script>

<template>
  <ul v-if="list.length" class="timeline">
    <li v-for="e in list" :key="e.id">
      <div><span aria-hidden="true">{{ KIND_ICON[e.kind] }}</span> {{ e.detail }}</div>
      <div class="t-time">{{ fmtDateTime(e.at) }} · {{ e.actorName }}</div>
    </li>
  </ul>
  <div v-else class="empty">暂无流程记录</div>
</template>
