<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMedkitStore } from '@/stores/medkit'
import { useFlash } from '@/composables/useFlash'
import { CATEGORY_ICONS, CATEGORY_LABELS, FEEDBACK_TYPE_LABELS, ITEM_STATUS_LABELS } from '@/rules'
import { daysUntil, fmtDateTime } from '@/utils/date'
import type { AllocationBatch, AllocationDecision, DisputeRecord, Item } from '@/types'
import SafetyBanner from '@/components/SafetyBanner.vue'
import ExpiryBadge from '@/components/ExpiryBadge.vue'
import ItemStatusBadge from '@/components/ItemStatusBadge.vue'
import TimelineView from '@/components/TimelineView.vue'
import AllocationBatchPanel from '@/components/AllocationBatchPanel.vue'
import HelpRecordCard from '@/components/HelpRecordCard.vue'

const store = useMedkitStore()
const router = useRouter()
const { show } = useFlash()
const tab = ref<'risk' | 'expiry' | 'review2' | 'allocation' | 'review' | 'trace'>('risk')
const traceId = ref('')

const stats = computed(() => store.stats)
const secondReviewQueue = computed(() => store.items.filter((i) => i.status === 'pending_review' && i.category === 'other_consumable' && i.review?.approved))
const quarantined = computed(() => store.items.filter((i) => i.status === 'quarantined'))
const shortageReview = computed(() => store.shortageReview)
const openDisputes = computed(() => store.openDisputes)
const batches = computed(() => [...store.batches].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)))

function feedbackItem(itemId: string) {
  return store.items.find((i) => i.id === itemId)
}

function scrapFeedback(fid: string) {
  const note = window.prompt('核查与报废说明：', '确认包装/安全性不合格，报废并按医疗垃圾流程处理')
  if (note === null) return
  const r = store.resolveFeedback(fid, 'scrap', note || '核查报废')
  show(r.message, r.ok ? 'ok' : 'err')
}
function republishFeedback(fid: string) {
  const note = window.prompt('核查后重新发布的依据：', '现场核验包装封签完好，反馈问题排除，恢复共享')
  if (note === null) return
  const r = store.resolveFeedback(fid, 'republish', note || '核查无误')
  show(r.message, r.ok ? 'ok' : 'err')
}
function scrapItem(id: string, reason: string) {
  const r = store.scrapItem(id, reason)
  show(r.message, r.ok ? 'ok' : 'err')
}
function approve2(id: string) {
  const r = store.secondReview(id, true, '工作人员复核符合共享范围')
  show(r.message, r.ok ? 'ok' : 'err')
}
function reject2(id: string) {
  const reason = window.prompt('复核驳回原因：', '无法确认安全性，不予共享')
  if (reason === null) return
  const r = store.secondReview(id, false, reason || '复核不通过')
  show(r.message, r.ok ? 'ok' : 'err')
}

/** 生成附完整评分理由的质疑答复草稿 */
function disputeDraft(dp: DisputeRecord): string {
  const b = store.batches.find((x) => x.id === dp.batchId)
  const d: AllocationDecision | undefined = b?.decisions.find((x) => x.requestId === dp.requestId)
  if (!b || !d) return '该批次记录缺失，正在人工核查后单独答复。'
  const alloc = b.decisions.filter((x) => x.suggestion === 'allocate')
  const factorLine = d.factors.map((f) => `${f.label} ${f.score}/${f.max}`).join('、')
  return (
    `感谢反馈。${fmtDateTime(b.at)} 的夜间分配中，您家综合排序第 ${d.rank}（${d.totalScore} 分，${factorLine}）。` +
    `当晚仅有 ${b.stockQty} 盒、志愿者可代送 ${b.deliveryCapacity} 单，按“紧急程度→儿童→距离→库存→运力”评分后，${alloc.map((x) => x.applicantName).join('、')} 排在前列获得分配。` +
    (d.capacityBlocked
      ? '您家的需求评分本可分到库存，但选择志愿者代送而当晚运力已满；我们已为您协调相邻小区互助/保留到货补发资格。'
      : '您家当晚库存排序未能进入前 3 名；求助记录已保留，新货到货会优先按记录补发。') +
    `退热贴仅为物理降温辅助，孩子如持续高热、精神差、抽搐或呼吸异常请立即就医。完整评分依据可在物品页“夜间分配记录”查看。`
  )
}
function replyDispute(dp: DisputeRecord) {
  const draft = disputeDraft(dp)
  const reply = window.prompt('答复居民（已附完整评分与分配理由草稿，可修改）：', draft)
  if (reply === null) return
  const r = store.replyDispute(dp.id, reply || draft)
  show(r.message, r.ok ? 'ok' : 'err')
}

function helpsOfBatch(b: AllocationBatch) {
  return store.helpRecords.filter((h) => h.batchId === b.id)
}
function itemOf(id: string) {
  return store.items.find((i) => i.id === id)
}
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
</script>

<template>
  <SafetyBanner compact />

  <div class="card">
    <h2 style="margin-bottom: 4px">社区工作人员工作台 · 风险与公平看板</h2>
    <div class="muted">
      工作人员的重点：守住安全底线——风险反馈处置、过期报废、双重复核、<strong>夜间分配理由公开与质疑答复、夜间短缺真实需求复盘</strong>、全链路追溯。社区只做<strong>物品流转和风险提醒</strong>，不做诊断建议。
    </div>
    <div class="stat-cards" style="margin-top: 12px; margin-bottom: 0">
      <div class="stat-card"><div class="num" :style="{ color: 'var(--c-danger)' }">{{ stats.openFeedback }}</div><div class="lbl">待处置风险反馈</div></div>
      <div class="stat-card"><div class="num" :style="{ color: 'var(--c-danger)' }">{{ stats.quarantined }}</div><div class="lbl">风险隔离中物品</div></div>
      <div class="stat-card"><div class="num" :style="{ color: 'var(--c-warn)' }">{{ stats.expired }}</div><div class="lbl">已过期待报废</div></div>
      <div class="stat-card"><div class="num" :style="{ color: stats.openDisputes ? 'var(--c-danger)' : undefined }">{{ stats.openDisputes }}</div><div class="lbl">待答复分配质疑</div></div>
      <div class="stat-card"><div class="num" :style="{ color: stats.pendingHelp ? 'var(--c-warn)' : undefined }">{{ stats.pendingHelp }}</div><div class="lbl">待跟进求助</div></div>
      <div class="stat-card"><div class="num">{{ stats.nightBatches }}</div><div class="lbl">夜间分配批次</div></div>
      <div class="stat-card"><div class="num">{{ stats.inFlight }}</div><div class="lbl">交接中</div></div>
      <div class="stat-card"><div class="num">{{ stats.waiting }}</div><div class="lbl">候补中</div></div>
    </div>
    <div class="tabs" style="margin-top: 14px; margin-bottom: 0">
      <button class="chip" :class="{ active: tab === 'risk' }" @click="tab = 'risk'">风险反馈与隔离（{{ stats.openFeedback + stats.quarantined }}）</button>
      <button class="chip" :class="{ active: tab === 'allocation' }" @click="tab = 'allocation'">
        分配理由与质疑<span v-if="stats.openDisputes" class="badge badge-red" style="margin-left: 4px">{{ stats.openDisputes }} 待答复</span>
      </button>
      <button class="chip" :class="{ active: tab === 'review' }" @click="tab = 'review'">🌙 夜间短缺复盘</button>
      <button class="chip" :class="{ active: tab === 'expiry' }" @click="tab = 'expiry'">效期与报废</button>
      <button class="chip" :class="{ active: tab === 'review2' }" @click="tab = 'review2'">复核（{{ secondReviewQueue.length }}）</button>
      <button class="chip" :class="{ active: tab === 'trace' }" @click="tab = 'trace'">全链路追溯</button>
    </div>
  </div>

  <!-- 风险反馈处置 -->
  <template v-if="tab === 'risk'">
    <div v-if="!store.openFeedbackList.length && !quarantined.length" class="card empty">没有待处置的风险反馈与隔离物品。</div>

    <div v-for="f in store.openFeedbackList" :key="f.id" class="card" style="border-left: 4px solid var(--c-danger)">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ FEEDBACK_TYPE_LABELS[f.type] }}：{{ feedbackItem(f.itemId)?.name ?? f.itemId }}</strong>
        <span class="badge badge-red">待核查</span>
      </div>
      <p style="margin: 8px 0">{{ f.detail }}</p>
      <div class="muted">报告人：{{ f.reporterName }} · 时间：{{ f.createdAt.replace('T', ' ').slice(0, 16) }}</div>
      <div v-if="f.type === 'adverse_reaction'" class="banner banner-danger" style="margin-top: 8px">
        处置要求：① 电话回访身体情况并<strong>提醒就医</strong>；② 同批次物品全部隔离暂停借用；③ 保留包装凭证，必要时上报市场监管/卫健部门。
      </div>
      <div v-if="feedbackItem(f.itemId)" class="muted" style="margin-top: 6px">
        当前物品状态：<ItemStatusBadge :status="feedbackItem(f.itemId)!.status" />
      </div>
      <div class="card-actions">
        <button class="btn btn-danger btn-sm" @click="scrapFeedback(f.id)">核查后报废同批次</button>
        <button class="btn btn-primary btn-sm" @click="republishFeedback(f.id)">核验无问题，解除隔离重新发布</button>
        <button class="btn btn-sm" @click="router.push(`/items/${f.itemId}`)">打开物品全流程</button>
      </div>
    </div>

    <h3 v-if="quarantined.length" class="section-title">已隔离物品（暂停一切借用与交接）</h3>
    <div v-for="it in quarantined" :key="it.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ CATEGORY_ICONS[it.category] }} {{ it.name }} · {{ it.spec }}</strong>
        <ItemStatusBadge :status="it.status" />
      </div>
      <div class="muted" style="margin: 6px 0">{{ it.closeReason }}</div>
      <div class="card-actions">
        <button class="btn btn-danger btn-sm" @click="scrapItem(it.id, '工作人员核查后报废：隔离物品复核不合格')">直接报废</button>
        <button class="btn btn-sm" @click="router.push(`/items/${it.id}`)">查看反馈与时间线</button>
      </div>
    </div>
  </template>

  <!-- 分配理由与质疑 -->
  <template v-else-if="tab === 'allocation'">
    <h3 class="section-title">❓ 待答复的分配质疑（{{ openDisputes.length }}）</h3>
    <div v-if="!openDisputes.length" class="card empty">当前没有待处理的质疑。每次夜间分配的评分与理由都可在下方批次记录中核验。</div>
    <div v-for="dp in openDisputes" :key="dp.id" class="card" style="border-left: 4px solid var(--c-danger)">
      <div class="row-head" style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ dp.applicantName }} 对批次 {{ dp.batchId }}（{{ itemOf(dp.itemId)?.name ?? dp.itemId }}）的分配结果提出质疑</strong>
        <span class="badge badge-red">待答复</span>
      </div>
      <p style="margin: 8px 0">{{ dp.reason }}</p>
      <div class="muted">提出时间：{{ fmtDateTime(dp.createdAt) }} · 关联求助：{{ dp.helpRecordId }}</div>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" @click="replyDispute(dp)">附完整评分理由答复</button>
        <button class="btn btn-sm" @click="router.push(`/items/${dp.itemId}`)">查看该物品全流程与评分</button>
      </div>
    </div>

    <h3 class="section-title">🌙 每次夜间分配的评分与理由（处理质疑的依据）</h3>
    <div v-if="!batches.length" class="card empty">暂无夜间分配批次。</div>
    <div v-for="b in batches" :key="b.id" class="card">
      <AllocationBatchPanel :batch="b" detailed />
      <div v-if="helpsOfBatch(b).length" style="margin-top: 8px">
        <strong class="muted">该批次未分到居民的求助记录：</strong>
        <HelpRecordCard v-for="h in helpsOfBatch(b)" :key="h.id" :help="h" mode="staff" :alternatives="alternativesFor(b.itemId)" />
      </div>
    </div>
  </template>

  <!-- 夜间短缺复盘 -->
  <template v-else-if="tab === 'review'">
    <div class="card">
      <h3 style="margin-top: 0">🌙 夜间短缺真实需求复盘</h3>
      <div class="muted">
        汇总每次夜间多户同时申请的<strong>真实需求量、实际满足量、未满足家庭的去向</strong>（相邻小区互助/替代用品/到货补发/仍待跟进），
        用于评估是否需要增加常备库存、招募更多夜间配送志愿者或与相邻小区扩大互助约定。
      </div>
    </div>

    <div v-if="!shortageReview.length" class="card empty">暂无夜间分配批次，无法复盘。</div>
    <div v-for="row in shortageReview" :key="row.batch.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ row.batch.itemName }}</strong>
        <span class="badge badge-blue">{{ fmtDateTime(row.batch.at) }}</span>
      </div>
      <div class="stat-cards" style="margin: 10px 0">
        <div class="stat-card"><div class="num">{{ row.total }}</div><div class="lbl">夜间真实申请户数</div></div>
        <div class="stat-card"><div class="num" :style="{ color: 'var(--c-primary-dark)' }">{{ row.allocated }}</div><div class="lbl">本小区当晚满足</div></div>
        <div class="stat-card"><div class="num" :style="{ color: 'var(--c-danger)' }">{{ row.unmet }}</div><div class="lbl">未满足户数</div></div>
        <div class="stat-card"><div class="num" :style="{ color: 'var(--c-warn)' }">{{ row.capacityBlocked }}</div><div class="lbl">其中被运力卡住</div></div>
        <div class="stat-card"><div class="num" :style="{ color: 'var(--c-danger)' }">{{ row.criticalUnmet }}</div><div class="lbl">紧急家庭未满足</div></div>
      </div>
      <div class="muted">
        未满足去向：相邻小区互助 <strong>{{ row.byMutualAid }}</strong> · 替代用品 <strong>{{ row.byAlternative }}</strong>
        · 到货已补发 <strong>{{ row.byBackfill }}</strong> · 自行关闭 <strong>{{ row.closed }}</strong>
        · <strong :style="{ color: row.pending ? 'var(--c-danger)' : undefined }">仍待跟进 {{ row.pending }}</strong>
      </div>
      <div class="banner banner-info" style="margin-top: 8px; margin-bottom: 0">
        <strong>复盘建议（系统依据数据生成）：</strong>
        <template v-if="row.capacityBlocked">存在“需求够分但夜间代送运力不足”的家庭，建议增加夜间志愿者排班或引导自取/门口无接触交接；</template>
        <template v-if="row.unmet - row.capacityBlocked > 0">有 {{ row.unmet - row.capacityBlocked }} 户属于真实库存缺口，建议提高退热贴等高频夜间用品常备量并与相邻小区扩大互助；</template>
        <template v-if="row.criticalUnmet">有紧急家庭未满足，除补发外应电话回访并确认已就医；</template>
        <template v-if="!row.unmet">本次全部满足，保持当前库存与运力即可。</template>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" @click="router.push(`/items/${row.batch.itemId}`)">查看物品完整链路</button>
      </div>
    </div>
  </template>

  <!-- 效期与报废 -->
  <template v-else-if="tab === 'expiry'">
    <h3 class="section-title">🚮 已过期仍挂在系统中（大厅已自动禁借，需报废清理）</h3>
    <div v-if="!store.expiredListed.length" class="card empty">没有过期物品。</div>
    <div v-for="it in store.expiredListed" :key="it.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ CATEGORY_ICONS[it.category] }} {{ it.name }}</strong>
        <ExpiryBadge :expiry-date="it.expiryDate" :now="store.nowIso" />
      </div>
      <div class="muted" style="margin: 6px 0">状态：{{ ITEM_STATUS_LABELS[it.status] }} · 地点：{{ it.location }}</div>
      <div class="card-actions">
        <button class="btn btn-danger btn-sm" @click="scrapItem(it.id, '已过有效期，工作人员报废并按医疗/有害垃圾处理')">确认报废</button>
      </div>
    </div>

    <h3 class="section-title">⏳ 效期 60 天内（提醒共享人优先流转或到期前报废）</h3>
    <div v-if="!store.expiringSoon.length" class="card empty">近期没有临近效期的物品。</div>
    <div v-for="x in store.expiringSoon" :key="x.item.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ CATEGORY_ICONS[x.item.category] }} {{ x.item.name }} · {{ x.item.spec }}</strong>
        <ExpiryBadge :expiry-date="x.item.expiryDate" :now="store.nowIso" />
      </div>
      <div class="muted" style="margin: 6px 0">
        共享人：{{ x.item.ownerName }} · 可借 {{ store.availableQty(x.item.id) }}/{{ x.item.quantity }}
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" @click="show(`已提醒共享人 ${x.item.ownerName}：物品 ${x.days} 天后到期（演示消息）`)">📞 提醒共享人</button>
        <button class="btn btn-sm" @click="router.push(`/items/${x.item.id}`)">查看物品</button>
      </div>
    </div>
  </template>

  <!-- 双重复核 -->
  <template v-else-if="tab === 'review2'">
    <div v-if="!secondReviewQueue.length" class="card empty">没有需要工作人员复核的“其他非处方耗材”。</div>
    <div v-for="it in secondReviewQueue" :key="it.id" class="card">
      <strong>{{ it.name }} · {{ it.spec }}</strong>
      <div class="muted" style="margin: 6px 0">
        登记人：{{ it.ownerName }} · 志愿者 {{ it.review?.reviewerName }} 已初审：{{ it.review?.reason }}
      </div>
      <p class="muted">{{ CATEGORY_LABELS[it.category] }}：请确认确属未拆封非处方耗材、无药品成分、无需冷链且效期合规。</p>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" @click="approve2(it.id)">复核通过，发布</button>
        <button class="btn btn-danger btn-sm" @click="reject2(it.id)">复核驳回</button>
      </div>
    </div>
  </template>

  <!-- 全链路追溯 -->
  <template v-else>
    <div class="card">
      <label class="field" style="margin-bottom: 8px">
        <span>选择一件物品，查看从登记到报废的完整链路</span>
        <select v-model="traceId">
          <option value="" disabled>请选择物品…</option>
          <option v-for="it in [...store.items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))" :key="it.id" :value="it.id">
            {{ it.name }} · {{ it.spec }}（{{ it.ownerName }} / {{ ITEM_STATUS_LABELS[it.status] }}）
          </option>
        </select>
      </label>
      <div v-if="traceId">
        <TimelineView :events="store.itemTimeline(traceId)" />
      </div>
      <div v-else class="empty">选择物品后，这里展示登记 → 审核 → 发布 → 申请/候补 → 夜间分配 → 求助/补发 → 锁定 → 交接拍照 → 归还/补充 → 反馈/隔离/报废的全部记录。</div>
    </div>
  </template>
</template>
