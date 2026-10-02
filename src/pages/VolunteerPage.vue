<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMedkitStore } from '@/stores/medkit'
import { useFlash } from '@/composables/useFlash'
import {
  CATEGORY_LABELS,
  DELIVERY_SLA_HOURS,
  METHOD_LABELS,
  NIGHT_BATCH_MIN_APPLICANTS,
  PICKUP_WINDOW_HOURS,
  SCENE_LABELS,
  STORAGE_LABELS,
  isNightTime,
  validateDraft,
} from '@/rules'
import { daysUntil } from '@/utils/date'
import type { Item } from '@/types'
import SafetyBanner from '@/components/SafetyBanner.vue'
import ExpiryBadge from '@/components/ExpiryBadge.vue'
import PhotoCapture from '@/components/PhotoCapture.vue'
import AllocationBatchPanel from '@/components/AllocationBatchPanel.vue'
import HelpRecordCard from '@/components/HelpRecordCard.vue'

const store = useMedkitStore()
const router = useRouter()
const { show } = useFlash()
const tab = ref<'review' | 'delivery' | 'exceptions' | 'waiting' | 'night' | 'help'>('review')
const photos = ref<Record<string, string>>({})

const reviewQueue = computed(() => store.reviewQueue)
const overdue = computed(() => store.overduePickups)
const delayed = computed(() => store.delayedDeliveries)
const waitingReqs = computed(() =>
  store.requests
    .filter((r) => r.status === 'waiting')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
)

/** 当前志愿者需要配送的任务（工作人员也可在本页兜底处理） */
const deliveryTasks = computed(() =>
  store.requests.filter((r) => r.status === 'handing' && r.method === 'volunteer_delivery'),
)

/** 夜间达到多人同时申请门槛的物品（可生成分配建议） */
const nightCandidates = computed(() => {
  if (!isNightTime(store.nowIso)) return []
  return store.items
    .map((it) => ({ item: it, peers: store.nightConcurrent(it.id) }))
    .filter((x) => x.peers.length >= NIGHT_BATCH_MIN_APPLICANTS)
})

/** 已生成/执行的夜间分配批次 */
const batches = computed(() => [...store.batches].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)))

/** 待跟进求助记录（志愿者按到货继续补发） */
const pendingHelps = computed(() => store.pendingHelpList)
/** 全部求助记录（含已解决，便于志愿者跟进） */
const allHelps = computed(() => [...store.helpRecords].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)))

function alternativesFor(itemId: string): Item[] {
  const it = store.items.find((x) => x.id === itemId)
  if (!it) return []
  return store.items.filter(
    (i) =>
      i.id !== it.id &&
      ['published', 'partially_lent'].includes(i.status) &&
      daysUntil(i.expiryDate, store.nowIso) >= 0 &&
      store.availableQty(i.id) > 0 &&
      (i.category === it.category || (it.category === 'fever_patch' && /冰袋|冷敷|降温/.test(i.name))),
  )
}

function itemOf(id: string) {
  return store.items.find((i) => i.id === id)!
}

function approve(id: string) {
  const r = store.reviewItem(id, true, '核验未拆封、效期与存放条件，符合共享范围')
  show(r.message, r.ok ? 'ok' : 'err')
}
function reject(id: string) {
  const reason = window.prompt('驳回原因（会展示给登记居民）：', '疑似药品/拆封/冷链/过期或包装不符，不能进入共享')
  if (reason === null) return
  const r = store.reviewItem(id, false, reason)
  show(r.message, r.ok ? 'ok' : 'err')
}
function completeDelivery(id: string) {
  const r = store.completeHandover(id, photos.value[id] ?? '', '志愿者送达并拍照确认')
  show(r.message, r.ok ? 'ok' : 'err')
}
function delay(id: string) {
  const reason = window.prompt('延误原因（会通知借用人和社区工作人员）：', '临时有事，预计延迟 2 小时')
  if (reason === null) return
  const r = store.reportDelay(id, reason)
  show(r.message, r.ok ? 'ok' : 'err')
}
function reassign(id: string) {
  const r = store.reassignVolunteer(id, 'u_s')
  show(r.message, r.ok ? 'ok' : 'err')
}
function cancelOverdue(id: string) {
  const r = store.cancelRequest(id, `超过 ${PICKUP_WINDOW_HOURS} 小时未取，志愿者释放库存给候补邻居`, { bySystem: true })
  show(r.message, r.ok ? 'ok' : 'err')
}
function confirmWaiting(id: string) {
  const r = store.confirmRequest(id)
  show(r.message, r.ok ? 'ok' : 'err')
}

function generateBatch(itemId: string) {
  const r = store.generateAllocationBatch(itemId)
  show(r.message, r.ok ? 'ok' : 'err')
}
function executeBatch(batchId: string) {
  const r = store.executeAllocation(batchId)
  show(r.message, r.ok ? 'ok' : 'err')
}
</script>

<template>
  <SafetyBanner compact />

  <div class="card">
    <h2 style="margin-bottom: 4px">志愿者工作台</h2>
    <div class="muted">
      志愿者的重点：把好入口审核关、保障配送履约、盯住超时与候补、<strong>夜间多人同时申请时按评分给出并执行分配建议、跟进求助补发</strong>。不判断病情、不推荐药品，发现破损/不适反馈立即转工作人员隔离核查。
    </div>
    <div class="tabs" style="margin-top: 12px">
      <button class="chip" :class="{ active: tab === 'review' }" @click="tab = 'review'">
        待审物品（{{ reviewQueue.length }}）
      </button>
      <button class="chip" :class="{ active: tab === 'delivery' }" @click="tab = 'delivery'">
        配送任务（{{ deliveryTasks.length }}）<span v-if="delayed.length" class="badge badge-red" style="margin-left: 4px">{{ delayed.length }} 延误</span>
      </button>
      <button class="chip" :class="{ active: tab === 'exceptions' }" @click="tab = 'exceptions'">
        超时未取（{{ overdue.length }}）
      </button>
      <button class="chip" :class="{ active: tab === 'waiting' }" @click="tab = 'waiting'">
        候补协调（{{ waitingReqs.length }}）
      </button>
      <button class="chip" :class="{ active: tab === 'night' }" @click="tab = 'night'">
        🌙 夜间分配<span v-if="nightCandidates.length" class="badge badge-red" style="margin-left: 4px">{{ nightCandidates.length }} 待建议</span>
      </button>
      <button class="chip" :class="{ active: tab === 'help' }" @click="tab = 'help'">
        🆘 求助补发（{{ pendingHelps.length }} 待跟进）
      </button>
    </div>
  </div>

  <!-- 审核 -->
  <template v-if="tab === 'review'">
    <div v-if="!reviewQueue.length" class="card empty">没有待审核物品，辛苦啦 🎉</div>
    <div v-for="it in reviewQueue" :key="it.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ it.name }} · {{ it.spec }}</strong>
        <ExpiryBadge :expiry-date="it.expiryDate" :now="store.nowIso" />
      </div>
      <dl class="kv" style="margin-top: 8px">
        <dt>登记人</dt><dd>{{ it.ownerName }}</dd>
        <dt>品类</dt><dd>{{ CATEGORY_LABELS[it.category] }}</dd>
        <dt>数量</dt><dd>{{ it.quantity }}</dd>
        <dt>存放</dt><dd>{{ STORAGE_LABELS[it.storage] }}</dd>
        <dt>未开封</dt><dd>{{ it.sealed ? '是，承诺整盒未拆封' : '否' }}</dd>
        <dt>地点</dt><dd>{{ it.location }}</dd>
        <dt>场景</dt><dd>{{ it.sceneTags.map((s) => SCENE_LABELS[s]).join('、') || '未标注' }}</dd>
      </dl>
      <p v-if="it.note" class="muted">留言：{{ it.note }}</p>

      <!-- 规则复核提示：再次机器校验，辅助志愿者把关 -->
      <template v-if="validateDraft(it, store.nowIso).errors.length">
        <div v-for="(e, i) in validateDraft(it, store.nowIso).errors" :key="i" class="banner banner-danger" style="margin-top: 8px">⛔ 规则拦截：{{ e }}</div>
      </template>
      <template v-if="validateDraft(it, store.nowIso).warnings.length">
        <div v-for="(w, i) in validateDraft(it, store.nowIso).warnings" :key="`w${i}`" class="banner banner-warn" style="margin-top: 8px">⚠️ {{ w }}</div>
      </template>

      <div class="card-actions">
        <button class="btn btn-primary btn-sm" @click="approve(it.id)">核验通过，发布</button>
        <button class="btn btn-danger btn-sm" @click="reject(it.id)">驳回（处方药/拆封/冷链等）</button>
        <button class="btn btn-sm" @click="router.push(`/items/${it.id}`)">打开物品页</button>
      </div>
    </div>
  </template>

  <!-- 配送 -->
  <template v-else-if="tab === 'delivery'">
    <div v-if="!deliveryTasks.length" class="card empty">当前没有配送中的任务。</div>
    <div v-for="r in deliveryTasks" :key="r.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>代送：{{ itemOf(r.itemId).name }} ×{{ r.quantity }}</strong>
        <span v-if="delayed.some((d) => d.req.id === r.id)" class="badge badge-red">
          已延误 {{ Math.round(delayed.find((d) => d.req.id === r.id)!.hours) }} 小时（承诺 {{ DELIVERY_SLA_HOURS }}h）
        </span>
        <span v-else class="badge badge-blue">配送中（承诺 {{ DELIVERY_SLA_HOURS }} 小时内）</span>
      </div>
      <div class="muted" style="margin: 6px 0">
        收件人：{{ r.applicantName }} · 场景：{{ SCENE_LABELS[r.scene] }} · 取件点：{{ itemOf(r.itemId).location }}
      </div>
      <div v-if="r.note" class="muted">留言：{{ r.note }}</div>
      <div v-if="r.delayReason" class="banner banner-warn" style="margin-top: 8px">延误说明：{{ r.delayReason }}</div>

      <PhotoCapture @captured="(p) => (photos[r.id] = p)" />
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" :disabled="!photos[r.id]" @click="completeDelivery(r.id)">送达拍照，完成交接</button>
        <button class="btn btn-warn btn-sm" @click="delay(r.id)">报备配送延误</button>
        <button class="btn btn-sm" @click="reassign(r.id)">改派工作人员兜底</button>
      </div>
    </div>
  </template>

  <!-- 超时未取 -->
  <template v-else-if="tab === 'exceptions'">
    <div v-if="!overdue.length" class="card empty">没有超时未取的申请。</div>
    <div v-for="x in overdue" :key="x.req.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ itemOf(x.req.itemId).name }} ×{{ x.req.quantity }}</strong>
        <span class="badge badge-red">超时 {{ Math.round(x.hours) }} 小时未取</span>
      </div>
      <div class="muted" style="margin: 6px 0">
        借用人：{{ x.req.applicantName }} · 方式：{{ METHOD_LABELS[x.req.method] }} · 已锁定库存，影响 {{ store.waitingList(x.req.itemId).length }} 位候补
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" @click="show(`已提醒 ${x.req.applicantName} 尽快取件（演示消息）`)">📞 催办提醒</button>
        <button class="btn btn-danger btn-sm" @click="cancelOverdue(x.req.id)">仍未取，取消并释放给候补</button>
      </div>
    </div>
  </template>

  <!-- 候补协调 -->
  <template v-else-if="tab === 'waiting'">
    <div v-if="!waitingReqs.length" class="card empty">没有候补中 的申请。</div>
    <div v-for="r in waitingReqs" :key="r.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ itemOf(r.itemId).name }} ×{{ r.quantity }}</strong>
        <span class="badge badge-amber">候补中</span>
      </div>
      <div class="muted" style="margin: 6px 0">
        申请人：{{ r.applicantName }} · 当前可借 {{ store.availableQty(r.itemId) }}/{{ itemOf(r.itemId).quantity }}
        · 候补 {{ store.waitingList(r.itemId).findIndex((w) => w.id === r.id) + 1 }} 号位
      </div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" :disabled="store.availableQty(r.itemId) < r.quantity" @click="confirmWaiting(r.id)">
          {{ store.availableQty(r.itemId) >= r.quantity ? '余量已恢复，确认递补' : '余量不足，继续等待' }}
        </button>
        <button class="btn btn-sm" @click="router.push(`/items/${r.itemId}`)">查看物品与队列</button>
      </div>
    </div>
  </template>

  <!-- 🌙 夜间多人同时申请分配 -->
  <template v-else-if="tab === 'night'">
    <div class="card">
      <h3 style="margin-bottom: 4px">🌙 夜间多人同时申请分配</h3>
      <div class="muted">
        夜间（20:00–次日06:00）两小时内同一物品 ≥ {{ NIGHT_BATCH_MIN_APPLICANTS }} 户同时申请时，按
        <strong>紧急程度 40 + 儿童 20 + 距离 20 + 库存匹配 10 + 配送能力 10</strong>
        生成建议：需求排序只看紧急度/儿童/距离/库存；代送运力是硬约束，分数够但运力满的家庭不会被挤掉，而是建议自取/门口交接或转相邻小区互助。
        建议先核对评分理由，再一键执行；未分到的家庭自动生成求助记录。
      </div>
      <div v-if="!isNightTime(store.nowIso)" class="banner banner-warn" style="margin-bottom: 0">
        当前演示时钟不是夜间时段。可用底部快进把时钟调到 20:00–次日06:00（例如连续点 +6 小时），再由多户居民提交申请来演示；历史批次见下方。
      </div>
    </div>

    <div v-if="nightCandidates.length" class="card">
      <h3 style="margin-top: 0">待生成建议（{{ nightCandidates.length }} 件物品）</h3>
      <div v-for="x in nightCandidates" :key="x.item.id" class="request-row">
        <div class="row-head">
          <strong>{{ x.item.name }}（{{ x.item.spec }}）</strong>
          <span class="badge badge-red">{{ x.peers.length }} 户夜间同时申请</span>
        </div>
        <div class="muted" style="margin: 4px 0">
          当前可分配 {{ store.availableQty(x.item.id) }} 盒 · 今晚志愿者剩余代送名额 {{ store.nightDeliveryCapacity() }} 单
        </div>
        <div class="muted" style="margin-bottom: 6px">
          <span v-for="p in x.peers" :key="p.id" class="badge badge-amber" style="margin: 2px">
            {{ p.applicantName }}（{{ p.urgency === 'critical' ? '紧急' : p.urgency === 'urgent' ? '较急' : '一般' }}{{ p.hasChild ? '·有儿童' : '' }}）
          </span>
        </div>
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" @click="generateBatch(x.item.id)">生成夜间分配建议</button>
          <button class="btn btn-sm" @click="router.push(`/items/${x.item.id}`)">查看物品</button>
        </div>
      </div>
    </div>

    <div v-if="!nightCandidates.length" class="card empty">当前没有达到夜间同时申请门槛的物品。</div>

    <template v-if="batches.length">
      <h3 class="section-title">历史分配批次（评分与理由全程留痕）</h3>
      <div v-for="b in batches" :key="b.id" class="card">
        <AllocationBatchPanel :batch="b" detailed />
        <div v-if="!b.executedAt" class="card-actions">
          <button class="btn btn-primary btn-sm" @click="executeBatch(b.id)">核对无误，一键执行分配建议</button>
          <button class="btn btn-sm" @click="router.push(`/items/${b.itemId}`)">打开物品页</button>
        </div>
        <div v-else class="banner banner-success" style="margin-bottom: 0">
          该批次已于 {{ b.executedAt.replace('T', ' ').slice(5, 16) }} 执行：分到的家庭已锁定库存，未分到的家庭已生成求助记录（见“求助补发”）。
        </div>
      </div>
    </template>
  </template>

  <!-- 🆘 求助补发 -->
  <template v-else>
    <div class="card">
      <h3 style="margin-bottom: 4px">🆘 未分到物品居民的求助记录</h3>
      <div class="muted">
        夜间分配未分到的居民诉求会<strong>持续保留</strong>，不会因申请取消而丢失：可登记转相邻小区互助、改选替代用品、补发就医提示；库存到货/释放后按记录补发，无需居民重新申请。
      </div>
    </div>

    <h3 class="section-title">待跟进（{{ pendingHelps.length }}）</h3>
    <div v-if="!pendingHelps.length" class="card empty">没有待跟进的求助记录。</div>
    <HelpRecordCard v-for="h in pendingHelps" :key="h.id" :help="h" mode="volunteer" :alternatives="alternativesFor(h.itemId)" />

    <h3 class="section-title">已处理记录（用于跟进与交接）</h3>
    <HelpRecordCard
      v-for="h in allHelps.filter((x) => x.status !== 'pending')"
      :key="h.id"
      :help="h"
      mode="volunteer"
      :alternatives="alternativesFor(h.itemId)"
    />
  </template>
</template>
