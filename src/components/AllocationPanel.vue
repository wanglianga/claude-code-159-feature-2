<script setup lang="ts">
import type { AllocationRound, BorrowRequest, ScoreBreakdown } from '@/types'
import { METHOD_LABELS, URGENCY_LABELS } from '@/rules'
import { fmtDateTime } from '@/utils/date'

/**
 * 夜间多人争抢的“分配建议/理由”面板：
 * - mode=preview 实时评分排序（志愿者未执行前）
 * - mode=round   已存档的分配轮次（社区端可据此答复质疑）
 */
const props = defineProps<{
  mode: 'preview' | 'round'
  itemName: string
  availableQty: number
  volunteerCapacity: number
  ranked?: { req: BorrowRequest; score: number; details: ScoreBreakdown }[]
  round?: AllocationRound
  requestsById?: Map<string, BorrowRequest>
}>()

function scoreOf(r: BorrowRequest): number | undefined {
  return props.ranked?.find((x) => x.req.id === r.id)?.score ?? r.score
}
function detailsOf(r: BorrowRequest): ScoreBreakdown | undefined {
  return props.ranked?.find((x) => x.req.id === r.id)?.details ?? r.scoreDetails
}
function reqs(): BorrowRequest[] {
  if (props.mode === 'preview') return props.ranked?.map((x) => x.req) ?? []
  return props.round
    ? props.round.requestIds.map((id) => props.requestsById?.get(id)).filter((r): r is BorrowRequest => !!r)
    : []
}
function got(r: BorrowRequest): boolean {
  if (props.mode === 'preview') return false
  return !!props.round?.allocatedRequestIds.includes(r.id)
}
</script>

<template>
  <div class="alloc-panel">
    <div class="banner banner-info" style="margin-top: 0">
      <strong>🌙 夜间多人同时申请 · 分配建议（按规则 {{ round?.ruleVersion ?? 'night-allocation-v1' }}）</strong>
      评分因子：<strong>紧急程度</strong>（最高 50 分）→ <strong>是否有儿童</strong>（+20）→
      <strong>距离</strong>（≤200m +15 / ≤500m +10 / ≤1km +5）→
      <strong>志愿者配送能力</strong>（在岗有运力 +10）→ 申请先后（同分微调）。
      本次可借 <strong>{{ availableQty }}</strong> 盒，今晚还能配送 <strong>{{ volunteerCapacity }}</strong> 单。
    </div>

    <div v-for="(r, i) in reqs()" :key="r.id" class="alloc-row" :class="{ got }">
      <div class="alloc-head">
        <span class="alloc-rank">#{{ i + 1 }}</span>
        <strong>{{ r.applicantName }}</strong>
        <span class="badge" :class="got(r) ? 'badge-green' : 'badge-gray'">
          {{ mode === 'preview' ? `综合 ${scoreOf(r)} 分` : got(r) ? `已分配（${scoreOf(r)} 分）` : `未分配（${scoreOf(r)} 分）` }}
        </span>
      </div>
      <div class="muted">
        {{ URGENCY_LABELS[r.urgency ?? 'spare'] }}
        <template v-if="r.hasChild"> · 儿童 {{ r.childAge ? `${r.childAge} 岁` : '' }}<template v-if="r.temperature"> · 实测 {{ r.temperature }}℃</template></template>
        · {{ r.distanceMeters ?? '?' }} 米 · {{ METHOD_LABELS[r.method] }}
      </div>
      <ul class="factor-list">
        <li v-for="(reason, j) in detailsOf(r)?.reasons ?? []" :key="j">{{ reason }}</li>
      </ul>
    </div>

    <div v-if="round" class="muted alloc-foot">
      执行时间：{{ fmtDateTime(round.createdAt) }} · 执行人：{{ round.createdByName }} ·
      建议 {{ round.allocatedRequestIds.length }} 户、未满足 {{ round.unallocatedRequestIds.length }} 户
    </div>
  </div>
</template>

<style scoped>
.alloc-panel {
  border: 1px solid var(--c-gray-200);
  border-radius: 10px;
  padding: 12px;
  margin-top: 10px;
  background: #fcfdfd;
}
.alloc-row {
  border: 1px solid var(--c-gray-200);
  border-left: 4px solid var(--c-gray-300);
  border-radius: 8px;
  padding: 8px 12px;
  margin: 8px 0;
  background: #fff;
}
.alloc-row.got {
  border-left-color: var(--c-primary);
  background: var(--c-primary-soft);
}
.alloc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.alloc-rank {
  font-weight: 700;
  color: var(--c-primary-dark);
}
.factor-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 0.84rem;
  color: var(--c-gray-700);
}
.alloc-foot {
  margin-top: 8px;
}
</style>
