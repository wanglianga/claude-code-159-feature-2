<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMedkitStore } from '@/stores/medkit'
import { useFlash } from '@/composables/useFlash'
import { AID_ROUTE_LABELS, CATEGORY_ICONS, CATEGORY_LABELS, FEEDBACK_TYPE_LABELS, ITEM_STATUS_LABELS, URGENCY_LABELS } from '@/rules'
import SafetyBanner from '@/components/SafetyBanner.vue'
import ExpiryBadge from '@/components/ExpiryBadge.vue'
import ItemStatusBadge from '@/components/ItemStatusBadge.vue'
import TimelineView from '@/components/TimelineView.vue'
import AllocationPanel from '@/components/AllocationPanel.vue'

const store = useMedkitStore()
const router = useRouter()
const { show } = useFlash()
const tab = ref<'risk' | 'expiry' | 'review2' | 'allocation' | 'shortage' | 'trace'>('risk')
const traceId = ref('')
const replyText = ref<Record<string, string>>({})

const stats = computed(() => store.stats)
const secondReviewQueue = computed(() => store.items.filter((i) => i.status === 'pending_review' && i.category === 'other_consumable' && i.review?.approved))
const quarantined = computed(() => store.items.filter((i) => i.status === 'quarantined'))
const allocationRounds = computed(() => store.allocations)
const requestsById = computed(() => new Map(store.requests.map((r) => [r.id, r])))
const shortage = computed(() => store.shortageReview)

function feedbackItem(itemId: string) {
  return store.items.find((i) => i.id === itemId)
}
function reqOf(id: string) {
  return requestsById.value.get(id)
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
function replyQuestion(qid: string) {
  const reply = replyText.value[qid]?.trim()
  if (!reply) {
    show('请填写答复内容（建议引用该户各项评分因子说明顺序）。', 'err')
    return
  }
  const r = store.replyQuestion(qid, reply)
  show(r.message, r.ok ? 'ok' : 'err')
  if (r.ok) replyText.value[qid] = ''
}
</script>

<template>
  <SafetyBanner compact />

  <div class="card">
    <h2 style="margin-bottom: 4px">社区工作人员工作台 · 风险看板</h2>
    <div class="muted">
      工作人员的重点：守住安全底线——风险反馈处置、过期报废、双重复核与全链路追溯。社区只做<strong>物品流转和风险提醒</strong>，不做诊断建议。
    </div>
    <div class="stat-cards" style="margin-top: 12px; margin-bottom: 0">
      <div class="stat-card"><div class="num" :style="{ color: 'var(--c-danger)' }">{{ stats.openFeedback }}</div><div class="lbl">待处置风险反馈</div></div>
      <div class="stat-card"><div class="num" :style="{ color: 'var(--c-danger)' }">{{ stats.quarantined }}</div><div class="lbl">风险隔离中物品</div></div>
      <div class="stat-card"><div class="num" :style="{ color: 'var(--c-warn)' }">{{ stats.expired }}</div><div class="lbl">已过期待报废</div></div>
      <div class="stat-card"><div class="num">{{ stats.reviewCount }}</div><div class="lbl">志愿者待审</div></div>
      <div class="stat-card"><div class="num">{{ stats.inFlight }}</div><div class="lbl">交接中</div></div>
      <div class="stat-card"><div class="num">{{ stats.waiting }}</div><div class="lbl">候补中</div></div>
      <div class="stat-card"><div class="num">{{ stats.activeCount }}</div><div class="lbl">在架物品</div></div>
      <div class="stat-card"><div class="num">{{ stats.scrapped }}</div><div class="lbl">累计报废</div></div>
      <div class="stat-card"><div class="num" :style="{ color: 'var(--c-warn)' }">{{ stats.openHelp }}</div><div class="lbl">夜间求助待补发</div></div>
      <div class="stat-card"><div class="num" :style="{ color: 'var(--c-danger)' }">{{ stats.openQuestions }}</div><div class="lbl">分配质疑待答复</div></div>
    </div>
    <div class="tabs" style="margin-top: 14px; margin-bottom: 0">
      <button class="chip" :class="{ active: tab === 'risk' }" @click="tab = 'risk'">风险反馈与隔离（{{ stats.openFeedback + stats.quarantined }}）</button>
      <button class="chip" :class="{ active: tab === 'expiry' }" @click="tab = 'expiry'">效期与报废</button>
      <button class="chip" :class="{ active: tab === 'review2' }" @click="tab = 'review2'">复核（{{ secondReviewQueue.length }}）</button>
      <button class="chip" :class="{ active: tab === 'allocation' }" @click="tab = 'allocation'">分配理由与质疑（{{ stats.openQuestions }}）</button>
      <button class="chip" :class="{ active: tab === 'shortage' }" @click="tab = 'shortage'">夜间短缺复盘</button>
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

  <!-- 分配理由与质疑 -->
  <template v-else-if="tab === 'allocation'">
    <div v-if="!allocationRounds.length" class="card empty">还没有夜间多人分配记录。</div>

    <div v-for="a in allocationRounds" :key="a.id" class="card" style="border-left: 4px solid var(--c-info)">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>🌙 夜间分配：{{ feedbackItem(a.itemId)?.name ?? a.itemId }}</strong>
        <span class="badge badge-blue">{{ a.status === 'adopted' ? '已执行' : '仅建议' }} · {{ a.ruleVersion }}</span>
      </div>

      <AllocationPanel
        mode="round"
        :item-name="feedbackItem(a.itemId)?.name ?? a.itemId"
        :available-qty="a.availableQty"
        :volunteer-capacity="a.volunteerCapacity"
        :round="a"
        :requests-by-id="requestsById"
      />

      <details class="reason-details" open>
        <summary>分配理由全文（用于答复居民质疑）</summary>
        <pre class="reason-text">{{ a.summary }}</pre>
      </details>

      <h4 class="section-title" style="font-size: 0.98rem">本户居民的质疑与答复</h4>
      <template v-for="rid in a.unallocatedRequestIds" :key="`q-${rid}`">
        <div v-for="q in store.questions.filter((x) => x.requestId === rid)" :key="q.id" class="question-block" :class="q.status === 'open' ? 'is-open' : ''">
          <div>
            <strong>{{ q.questionerName }}</strong>
            <span class="muted">（{{ reqOf(rid)?.address }} · 评分 {{ reqOf(rid)?.score }} 分）</span>
            <span class="badge" :class="q.status === 'open' ? 'badge-red' : 'badge-green'" style="margin-left: 6px">
              {{ q.status === 'open' ? '待答复' : '已答复' }}
            </span>
          </div>
          <div style="margin: 4px 0">问：{{ q.content }}</div>
          <div v-if="q.status === 'replied'" class="banner banner-success" style="margin: 6px 0">
            答（{{ q.replierName }} · {{ q.repliedAt?.replace('T', ' ').slice(0, 16) }}）：{{ q.reply }}
          </div>
          <template v-if="q.status === 'open'">
            <textarea v-model="replyText[q.id]" placeholder="参照上方逐户评分因子解释，例如：该户紧急程度为儿童高热 50 分且距离仅 150 米，综合分高于 38.6℃ 的家庭，故优先；你已转入相邻小区互助，到货后仍会补发。"></textarea>
            <div class="card-actions">
              <button class="btn btn-primary btn-sm" @click="replyQuestion(q.id)">提交答复（居民可见）</button>
              <button class="btn btn-sm" @click="router.push(`/items/${a.itemId}`)">打开物品时间线</button>
            </div>
          </template>
        </div>
      </template>
      <div v-if="!store.questions.some((q) => q.allocationId === a.id)" class="muted">本轮暂无居民质疑。</div>
    </div>
  </template>

  <!-- 夜间短缺复盘 -->
  <template v-else-if="tab === 'shortage'">
    <div class="card">
      <h2 style="margin-bottom: 4px">夜间短缺复盘 · 真实需求</h2>
      <div class="muted">
        每一条未满足的求助记录都代表一户夜间的真实需求。按物品聚合：多少户未分到、多少户靠相邻小区/替代用品/就医提示过渡、
        多少户最终由到货补发满足——据此决定下次夜间该在门岗预置多少库存、协调多少配送运力。
      </div>
    </div>

    <div class="stat-cards">
      <div v-for="g in shortage.byItem" :key="g.itemName" class="stat-card">
        <div class="num" :style="{ color: 'var(--c-warn)' }">{{ g.open }}</div>
        <div class="lbl">
          {{ g.itemName }}：待补发 {{ g.open }} / 已补发 {{ g.fulfilled }} / 已关闭 {{ g.closed }}（共 {{ g.total }} 户未即时满足）
        </div>
      </div>
    </div>
    <div v-if="!shortage.rows.length" class="card empty">没有未满足的夜间求助记录。</div>

    <div v-for="row in shortage.rows" :key="row.req.id" class="card">
      <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap">
        <strong>{{ row.item?.name ?? row.req.itemId }} · {{ row.req.applicantName }}</strong>
        <span class="badge" :class="row.req.helpStatus === 'fulfilled' ? 'badge-green' : row.req.helpStatus === 'closed' ? 'badge-gray' : 'badge-amber'">
          {{ { open: '待到货补发', fulfilled: '已补发满足', closed: '已转就医/关闭' }[row.req.helpStatus ?? 'open'] }}
        </span>
      </div>
      <div class="muted" style="margin: 6px 0">
        {{ URGENCY_LABELS[row.req.urgency ?? 'spare'] }}<template v-if="row.req.hasChild"> · 儿童{{ row.req.childAge ? ` ${row.req.childAge} 岁` : '' }}</template>
        · {{ row.req.distanceMeters ?? '?' }} 米 · 申请 {{ row.req.quantity }} 盒
      </div>
      <div v-if="row.req.aidChosen" class="muted">夜间过渡出路：{{ AID_ROUTE_LABELS[row.req.aidChosen] }}</div>
      <div v-if="row.req.fulfilledAt" class="banner banner-success" style="margin-top: 8px">
        {{ row.req.fulfilledAt.replace('T', ' ').slice(0, 16) }} 由 {{ row.req.fulfilledBy }} 到货补发。{{ row.req.fulfilledNote }}
      </div>
      <div v-if="row.round" class="muted" style="margin-top: 6px">分配轮次 {{ row.round.ruleVersion }}：该户评分 {{ row.req.score }} 分，排第 {{ row.round.requestIds.indexOf(row.req.id) + 1 }} 位。</div>
    </div>
  </template>

  <!-- 全链路追溯 -->
  <template v-else-if="tab === 'trace'">
    <div class="card">
      <label class="field" style="margin-bottom: 8px">
        <span>选择一件物品，查看从登记到报废的完整链路</span>
        <select v-model="traceId">
          <option value="" disabled>请选择物品…</option>
          <option v-for="it in [...store.items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))" :key="it.id" :value="it.id">
            {{ it.name }} · {{ it.spec }}（{{ it.ownerName }} / {{ ITEM_STATUS_LABELS[it.status] }}）
          </option>
        </select>
      </label>
      <div v-if="traceId">
        <TimelineView :events="store.itemTimeline(traceId)" />
      </div>
      <div v-else class="empty">选择物品后，这里展示登记 → 审核 → 发布 → 申请/候补 → 锁定 → 交接拍照 → 归还/补充 → 反馈/隔离/报废的全部记录。</div>
    </div>
  </template>
</template>

<style scoped>
.reason-details {
  margin-top: 10px;
}
.reason-details summary {
  cursor: pointer;
  color: var(--c-primary-dark);
  font-size: 0.88rem;
}
.reason-text {
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--c-gray-100);
  border-radius: 8px;
  padding: 10px;
  font-size: 0.82rem;
  font-family: inherit;
  margin: 8px 0 0;
}
.question-block {
  border: 1px solid var(--c-gray-200);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 8px 0;
  background: #fff;
}
.question-block.is-open {
  border-left: 4px solid var(--c-danger);
}
</style>
