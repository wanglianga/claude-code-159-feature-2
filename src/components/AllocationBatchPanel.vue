<script setup lang="ts">
import { computed } from 'vue'
import type { AllocationBatch, AllocationDecision } from '@/types'
import { URGENCY_LABELS, URGENCY_SHORT } from '@/rules'
import { fmtDateTime } from '@/utils/date'
import { formatDistance } from '@/utils/community'
import { METHOD_LABELS } from '@/rules'

const props = defineProps<{
  batch: AllocationBatch
  /** 是否展开全部评分因子（社区/志愿者看完整；居民看摘要） */
  detailed?: boolean
}>()

const SUGGESTION_BADGE: Record<AllocationDecision['suggestion'], { text: string; cls: string }> = {
  allocate: { text: '建议分配', cls: 'badge-green' },
  mutual_aid: { text: '转相邻小区互助', cls: 'badge-blue' },
  alternative: { text: '改选替代用品', cls: 'badge-purple' },
  medical: { text: '优先就医提示', cls: 'badge-red' },
  waiting_backfill: { text: '保留求助·到货补发', cls: 'badge-amber' },
}

const rows = computed(() => [...props.batch.decisions].sort((a, b) => a.rank - b.rank))
</script>

<template>
  <div class="alloc-box">
    <div class="muted" style="margin-bottom: 6px">
      🌙 夜间分配批次 {{ batch.id }} · {{ fmtDateTime(batch.at) }}
      <span v-if="batch.executedAt">· 已于 {{ fmtDateTime(batch.executedAt) }} 由 {{ batch.executorName }} 执行</span>
    </div>
    <div class="muted" style="margin-bottom: 8px">{{ batch.windowLabel }}；当晚可分配 {{ batch.stockQty }} 盒，志愿者代送运力 {{ batch.deliveryCapacity }} 单。</div>

    <div v-for="d in rows" :key="d.requestId" class="alloc-row" :class="{ unmet: d.suggestion !== 'allocate' }">
      <div class="alloc-head">
        <strong>第 {{ d.rank }} 名 · {{ d.applicantName }}</strong>
        <span class="badge" :class="SUGGESTION_BADGE[d.suggestion].cls">{{ SUGGESTION_BADGE[d.suggestion].text }}</span>
      </div>
      <div class="muted" style="margin: 2px 0">
        紧急度：{{ URGENCY_SHORT[d.urgency] }}（{{ URGENCY_LABELS[d.urgency] }}）
        <template v-if="d.hasChild"> · 家中有儿童</template>
        · 距取件点 {{ formatDistance(d.distanceMeters) }}
        · {{ METHOD_LABELS[d.method] }}
        · 综合分 <strong>{{ d.totalScore }}</strong>/100
      </div>
      <div v-if="d.symptom" class="muted">家属描述：{{ d.symptom }}（仅用于核实排序，社区不做诊断）</div>

      <!-- 评分因子明细 -->
      <table v-if="detailed" class="factor-table">
        <thead>
          <tr><th>评分维度</th><th>得分</th><th>依据</th></tr>
        </thead>
        <tbody>
          <tr v-for="f in d.factors" :key="f.key">
            <td>{{ f.label }}</td>
            <td>{{ f.score }}/{{ f.max }}</td>
            <td>{{ f.detail }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 分配/不分配的理由（答复质疑的依据） -->
      <div v-for="(reason, i) in d.reasons" :key="`r${i}`" class="alloc-reason">📝 {{ reason }}</div>

      <!-- 未分配时的去向建议 -->
      <ul v-if="d.fallbackOptions.length" class="fallback-list">
        <li v-for="(opt, i) in d.fallbackOptions" :key="`f${i}`">{{ opt }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.alloc-box {
  border: 1px solid var(--c-gray-200);
  border-radius: 10px;
  padding: 12px;
  background: var(--c-gray-100);
  margin: 8px 0;
}
.alloc-row {
  background: #fff;
  border: 1px solid var(--c-gray-200);
  border-left: 4px solid var(--c-primary);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.alloc-row.unmet {
  border-left-color: var(--c-warn);
}
.alloc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.factor-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
  margin: 8px 0;
}
.factor-table th,
.factor-table td {
  border: 1px solid var(--c-gray-200);
  padding: 5px 8px;
  text-align: left;
  vertical-align: top;
}
.factor-table th {
  background: var(--c-gray-100);
}
.alloc-reason {
  font-size: 0.85rem;
  color: var(--c-gray-700);
  margin-top: 4px;
}
.fallback-list {
  margin: 6px 0 0;
  padding-left: 20px;
  font-size: 0.84rem;
  color: var(--c-gray-700);
}
</style>
