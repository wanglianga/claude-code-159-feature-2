<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { HelpRecord, Item, MutualAidPoint } from '@/types'
import { useMedkitStore } from '@/stores/medkit'
import { useFlash } from '@/composables/useFlash'
import { URGENCY_SHORT } from '@/rules'
import { fmtDateTime } from '@/utils/date'
import { formatDistance } from '@/utils/community'

const props = defineProps<{
  help: HelpRecord
  mode: 'resident' | 'volunteer' | 'staff'
  /** 可改选的替代用品（志愿者/工作人员视角传入） */
  alternatives?: Item[]
}>()

const store = useMedkitStore()
const router = useRouter()
const { show } = useFlash()

const STATUS: Record<HelpRecord['status'], { text: string; cls: string }> = {
  pending: { text: '待跟进（可到货补发）', cls: 'badge-amber' },
  mutual_aid_transfer: { text: '已由相邻小区互助解决', cls: 'badge-blue' },
  backfilled: { text: '到货已补发', cls: 'badge-green' },
  alternative: { text: '已改选替代用品', cls: 'badge-purple' },
  closed: { text: '已关闭（保留复盘）', cls: 'badge-gray' },
}

const points = computed<MutualAidPoint[]>(() => store.mutualAidPointsForItem(props.help.itemId))
const dispute = computed(() => store.disputes.find((d) => d.id === props.help.disputeId))
const canManage = computed(() => props.mode !== 'resident')
/** 居民视角下，只有本人能对自己的求助记录操作；他人记录仅公示处理进度 */
const isOwner = computed(() => store.currentUserId === props.help.applicantId)

function pointQty(p: MutualAidPoint): number {
  const it = store.items.find((x) => x.id === props.help.itemId)
  return p.stocks.filter((s) => s.category === it?.category).reduce((sum, s) => sum + s.quantity, 0)
}

function transfer(pointId: string) {
  const r = store.transferToMutualAid(props.help.id, pointId)
  show(r.message, r.ok ? 'ok' : 'err')
}
function chooseAlt(itemId: string) {
  const r = store.chooseAlternative(props.help.id, itemId)
  show(r.message, r.ok ? 'ok' : 'err')
}
function medical() {
  const note = window.prompt('就医提示内容（可直接使用默认）：', '持续高热不退、精神差、抽搐或呼吸异常请立即就医或拨打 120；退热用品仅为辅助。')
  if (note === null) return
  const r = store.sendMedicalTip(props.help.id, note || undefined)
  show(r.message, r.ok ? 'ok' : 'err')
}
function backfill() {
  const r = store.arrangeBackfill(props.help.id)
  show(r.message, r.ok ? 'ok' : 'err')
}
function completeBackfill() {
  const r = store.completeBackfill(props.help.id)
  show(r.message, r.ok ? 'ok' : 'err')
}
function close() {
  const note = window.prompt('关闭原因（仍会保留在夜间短缺复盘里）：', '已自行购买/症状缓解，不再需要补发')
  if (note === null) return
  const r = store.closeHelp(props.help.id, note || undefined)
  show(r.message, r.ok ? 'ok' : 'err')
}
function disputeAction() {
  const reason = window.prompt('请说明你对本次分配结果的疑问，社区会附完整评分与分配理由答复：', '')
  if (reason === null) return
  const r = store.openDispute(props.help.id, reason || '')
  show(r.message, r.ok ? 'ok' : 'err')
}
</script>

<template>
  <div class="help-card" :class="`st-${help.status}`">
    <div class="alloc-head">
      <strong>🆘 求助记录 · {{ help.itemName }} ×{{ help.quantity }}</strong>
      <span class="badge" :class="STATUS[help.status].cls">{{ STATUS[help.status].text }}</span>
    </div>
    <div class="muted" style="margin: 4px 0">
      {{ help.applicantName }} · 紧急度 {{ URGENCY_SHORT[help.urgency] }}
      <template v-if="help.hasChild"> · 家中有儿童</template>
      · 距取件点 {{ formatDistance(help.distanceMeters) }}
      · 记录于 {{ fmtDateTime(help.createdAt) }}
      <template v-if="help.batchId"> · 批次 {{ help.batchId }}</template>
    </div>
    <div v-if="help.symptom" class="muted">家属描述：{{ help.symptom }}</div>

    <!-- 跟进动作流水（全程留痕，社区据此处理质疑与复盘） -->
    <ul class="action-log">
      <li v-for="a in help.actions" :key="a.id">
        <span class="t-time">{{ fmtDateTime(a.at) }} · {{ a.actorName }}</span>
        <div>{{ a.detail }}</div>
      </li>
    </ul>

    <!-- 质疑与答复 -->
    <div v-if="dispute" class="banner" :class="dispute.status === 'open' ? 'banner-warn' : 'banner-info'" style="margin: 8px 0">
      <strong>❓ 居民质疑（{{ dispute.status === 'open' ? '待社区答复' : '已答复' }}）</strong>
      {{ dispute.reason }}
      <div v-if="dispute.reply" style="margin-top: 4px">📨 社区答复：{{ dispute.reply }}（{{ dispute.replierName }}，{{ fmtDateTime(dispute.repliedAt!) }}）</div>
    </div>

    <div v-if="help.status === 'pending'" class="card-actions">
      <!-- 志愿者/工作人员：协调去向 -->
      <template v-if="canManage">
        <select v-if="points.length" :value="''" style="max-width: 260px" @change="transfer(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="" disabled>转相邻小区互助…</option>
          <option v-for="p in points" :key="p.id" :value="p.id">{{ p.community }}（约 {{ formatDistance(p.distanceMeters) }}，同类余 {{ pointQty(p) }}）</option>
        </select>
        <select v-if="alternatives && alternatives.length" :value="''" style="max-width: 260px" @change="chooseAlt(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="" disabled>改选替代用品…</option>
          <option v-for="a in alternatives" :key="a.id" :value="a.id">{{ a.name }} {{ a.spec }}（可借 {{ store.availableQty(a.id) }}）</option>
        </select>
        <button class="btn btn-sm" @click="medical">🏥 补发就医提示</button>
        <button class="btn btn-sm btn-primary" :disabled="store.availableQty(help.itemId) < help.quantity" @click="backfill">
          {{ store.availableQty(help.itemId) >= help.quantity ? '📦 到货后安排补发' : `余量不足（${store.availableQty(help.itemId)}/${help.quantity}），等新货` }}
        </button>
        <button v-if="help.backfillRequestId" class="btn btn-sm btn-primary" @click="completeBackfill">补发已送达，拍照闭环</button>
        <button class="btn btn-sm btn-danger" @click="close">关闭求助</button>
        <button class="btn btn-sm" @click="router.push(`/items/${help.itemId}`)">查看物品与时间线</button>
      </template>
      <!-- 居民本人：提质疑 / 自行关闭 -->
      <template v-else-if="isOwner">
        <button v-if="!dispute" class="btn btn-sm btn-danger" @click="disputeAction">❓ 对分配结果有疑问</button>
        <span v-else class="muted">已提出质疑，等待社区答复，完整评分理由可在物品页分配记录中查看。</span>
        <button class="btn btn-sm" @click="close">已自行解决，关闭求助</button>
      </template>
      <!-- 其他居民查看：仅公示，不能操作 -->
      <span v-else class="muted">该求助记录由 {{ help.applicantName }} 提交，处理进度如上公示；如有疑问可在“我的借用”查看自己的记录。</span>
    </div>
  </div>
</template>

<style scoped>
.help-card {
  border: 1px solid var(--c-gray-200);
  border-left: 4px solid var(--c-warn);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  background: #fff;
}
.help-card.st-mutual_aid_transfer {
  border-left-color: var(--c-info);
}
.help-card.st-backfilled,
.help-card.st-alternative {
  border-left-color: var(--c-primary);
}
.help-card.st-closed {
  border-left-color: var(--c-gray-300);
}
.alloc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.action-log {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  border-left: 2px solid var(--c-gray-200);
}
.action-log li {
  padding: 4px 0 4px 12px;
  font-size: 0.85rem;
}
.action-log .t-time {
  color: var(--c-gray-500);
  font-size: 0.76rem;
}
</style>
