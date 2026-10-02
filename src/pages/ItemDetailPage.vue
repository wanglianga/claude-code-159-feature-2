<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMedkitStore } from '@/stores/medkit'
import { useFlash } from '@/composables/useFlash'
import {
  AID_ROUTE_HINTS,
  AID_ROUTE_LABELS,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  FEEDBACK_TYPE_LABELS,
  METHOD_LABELS,
  SCENE_HINTS,
  SCENE_LABELS,
  STORAGE_LABELS,
  URGENCY_LABELS,
} from '@/rules'
import { daysUntil } from '@/utils/date'
import type { AidRoute, FeedbackType, HandoverMethod, Scene, UrgencyLevel } from '@/types'
import SafetyBanner from '@/components/SafetyBanner.vue'
import ExpiryBadge from '@/components/ExpiryBadge.vue'
import ItemStatusBadge from '@/components/ItemStatusBadge.vue'
import TimelineView from '@/components/TimelineView.vue'
import RequestCard from '@/components/RequestCard.vue'
import AllocationPanel from '@/components/AllocationPanel.vue'

const route = useRoute()
const router = useRouter()
const store = useMedkitStore()
const { show } = useFlash()

const item = computed(() => store.items.find((i) => i.id === route.params.id))
const available = computed(() => (item.value ? store.availableQty(item.value.id) : 0))
const waiting = computed(() => (item.value ? store.waitingList(item.value.id) : []))
const relatedRequests = computed(() => (item.value ? store.itemRequests(item.value.id) : []))
const itemFeedback = computed(() => (item.value ? store.feedbacks.filter((f) => f.itemId === item.value!.id) : []))
const rounds = computed(() => (item.value ? store.allocationsForItem(item.value.id) : []))
const requestsById = computed(() => new Map(store.requests.map((r) => [r.id, r])))

// ---- 申请表单 ----
const showApply = ref(false)
const form = reactive<{
  quantity: number
  scene: Scene
  method: HandoverMethod
  note: string
  urgency: UrgencyLevel
  hasChild: boolean
  childAge?: number
  temperature?: number
  distanceMeters?: number
}>({
  quantity: 1,
  scene: 'child_night_fever',
  method: 'self_pickup',
  note: '',
  urgency: 'low_fever',
  hasChild: false,
  childAge: undefined,
  temperature: undefined,
  distanceMeters: undefined,
})
const agreed = reactive({ source: false, expiry: false, package: false, limit: false })
const agreeAll = computed(() => agreed.source && agreed.expiry && agreed.package && agreed.limit)

const expired = computed(() => (item.value ? daysUntil(item.value.expiryDate, store.nowIso) < 0 : false))
const blocked = computed(() => !item.value || ['rejected', 'recalled', 'scrapped', 'quarantined', 'pending_review'].includes(item.value.status))

// 夜间争抢候选（≥2 户同时候补）时展示实时分配建议
const previewPlan = computed(() => {
  if (!item.value || waiting.value.length < 2) return null
  return store.previewAllocationPlan(item.value.id)
})
const contention = computed(() => (item.value ? store.allocationContention(item.value.id) : null))

function openApply() {
  if (!item.value) return
  form.quantity = Math.min(1, item.value.quantity) || 1
  form.scene = item.value.sceneTags[0] ?? 'home_care'
  form.urgency = 'low_fever'
  form.hasChild = false
  form.childAge = undefined
  form.temperature = undefined
  form.distanceMeters = undefined
  form.note = ''
  showApply.value = true
}

function submitApply() {
  if (!item.value) return
  if (!agreeAll.value) {
    show('请先逐项确认来源、效期、包装状态与适用限制。', 'err')
    return
  }
  if (form.hasChild && form.childAge != null && (form.childAge < 0 || form.childAge > 18)) {
    show('请填写真实的儿童年龄（0–18 岁）。', 'err')
    return
  }
  const r = store.apply(
    item.value.id,
    form.quantity,
    form.scene,
    form.method,
    form.note || undefined,
    {
      urgency: form.urgency,
      hasChild: form.hasChild,
      childAge: form.hasChild ? form.childAge : undefined,
      temperature: form.temperature,
      distanceMeters: form.distanceMeters,
    },
  )
  show(r.message, r.ok ? 'ok' : 'err')
  if (r.ok) {
    showApply.value = false
    router.push('/my-borrows')
  }
}

function executeAllocation() {
  if (!item.value) return
  const r = store.executeAllocation(item.value.id)
  show(r.message, r.ok ? 'ok' : 'err')
}

// ---- 未分到物品：出路选择 ----
function chooseAid(reqId: string, route: AidRoute) {
  const r = store.chooseAid(reqId, route)
  show(r.message, r.ok ? 'ok' : 'err')
}

// ---- 对分配提出质疑 ----
const questionText = reactive<Record<string, string>>({})
function askQuestion(reqId: string) {
  const content = questionText[reqId]?.trim()
  if (!content) {
    show('请先填写质疑内容，社区会依据存档的逐项评分理由答复。', 'err')
    return
  }
  const r = store.askAllocation(reqId, content)
  show(r.message, r.ok ? 'ok' : 'err')
  if (r.ok) questionText[reqId] = ''
}

function answerOf(reqId: string) {
  return store.questions.find((q) => q.requestId === reqId && q.status === 'replied')
}

// ---- 反馈 ----
const showFeedback = ref(false)
const fbForm = reactive<{ type: FeedbackType; detail: string }>({ type: 'package_damaged', detail: '' })
function submitFeedback() {
  if (!item.value) return
  const r = store.reportFeedback(item.value.id, fbForm.type, fbForm.detail)
  show(r.message, r.ok ? 'ok' : 'err')
  if (r.ok) {
    showFeedback.value = false
    fbForm.detail = ''
  }
}
</script>

<template>
  <SafetyBanner compact />

  <div v-if="!item" class="card empty">
    物品不存在或已被清理。<RouterLink to="/hall">回到药箱大厅</RouterLink>
  </div>

  <template v-else>
    <button class="btn btn-sm" @click="router.push('/hall')">← 返回大厅</button>

    <div v-if="expired" class="banner banner-danger">
      <strong>该物品已过有效期，禁止借用与交接。</strong>
      系统已提示社区工作人员尽快报废，请选择其他在效期内的物品。
    </div>
    <div v-if="item.status === 'quarantined'" class="banner banner-danger">
      <strong>该物品因风险反馈已被隔离，暂停一切借用与交接。</strong>
      {{ item.closeReason }}
    </div>
    <div v-if="item.status === 'recalled'" class="banner banner-warn">
      <strong>共享人已撤回该物品。</strong>{{ item.closeReason }}
    </div>

    <div class="card">
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
        <span style="font-size: 1.8rem">{{ CATEGORY_ICONS[item.category] }}</span>
        <h2 style="margin: 0">{{ item.name }}</h2>
        <ItemStatusBadge :status="item.status" />
        <ExpiryBadge :expiry-date="item.expiryDate" :now="store.nowIso" />
      </div>

      <dl class="kv" style="margin-top: 14px">
        <dt>品类</dt><dd>{{ CATEGORY_LABELS[item.category] }}</dd>
        <dt>规格</dt><dd>{{ item.spec }}</dd>
        <dt>有效期</dt><dd>{{ item.expiryDate }}</dd>
        <dt>存放条件</dt><dd>{{ STORAGE_LABELS[item.storage] }}</dd>
        <dt>包装状态</dt><dd>整盒/整包<strong>未开封</strong>（登记人承诺，志愿者已现场/照片核验）</dd>
        <dt>登记数量</dt><dd>{{ item.quantity }}</dd>
        <dt>当前可借</dt>
        <dd>
          <strong :style="{ color: available > 0 ? 'var(--c-primary-dark)' : 'var(--c-warn)' }">{{ available }}</strong>
          <span v-if="waiting.length" class="badge badge-amber" style="margin-left: 8px">{{ waiting.length }} 人候补中</span>
        </dd>
        <dt>来源</dt><dd>邻居 {{ item.ownerName }}（{{ item.review ? `志愿者 ${item.review.reviewerName} 已审核` : '待志愿者审核' }}）</dd>
        <dt>取用地点</dt><dd>{{ item.location }}</dd>
        <dt>适用场景</dt>
        <dd>
          <span v-for="s in item.sceneTags" :key="s" class="badge badge-blue" style="margin: 2px">{{ SCENE_LABELS[s] }}</span>
          <span v-if="!item.sceneTags.length" class="muted">未标注</span>
        </dd>
      </dl>
      <p v-if="item.note" class="muted" style="margin-top: 8px">共享人留言：{{ item.note }}</p>

      <div class="banner banner-info" style="margin-top: 12px">
        <strong>适用限制（借用前必读）</strong>
        仅用于对应场景下的临时辅助：物理降温、浅表小伤口清洁包扎、口罩应急与居家护理耗材周转。
        本物品<strong>不是药品、不能替代药物与医生诊治</strong>；儿童高热不退、老人伤口较深/出血不止/化脓、呼吸困难等情况请立即就医。
      </div>

      <div class="card-actions" style="margin-top: 12px">
        <button v-if="!blocked && !expired" class="btn btn-primary" @click="openApply">我要申请借用</button>
        <button class="btn btn-danger btn-sm" @click="showFeedback = true">反馈包装破损 / 疑似不适</button>
      </div>
    </div>

    <!-- 申请弹窗 -->
    <div v-if="showApply" class="card" style="border: 2px solid var(--c-primary)">
      <h3>申请借用「{{ item.name }}」</h3>
      <label class="field">
        <span>使用场景</span>
        <select v-model="form.scene">
          <option v-for="[k, v] in Object.entries(SCENE_LABELS)" :key="k" :value="k">{{ v }}</option>
        </select>
        <span class="hint">{{ SCENE_HINTS[form.scene] }}</span>
      </label>
      <label class="field">
        <span>借用数量（当前可借 {{ available }}）</span>
        <input v-model.number="form.quantity" type="number" min="1" :max="item.quantity" />
      </label>
      <label class="field">
        <span>交接方式</span>
        <select v-model="form.method">
          <option value="self_pickup">{{ METHOD_LABELS.self_pickup }}：自行到 {{ item.location }} 取</option>
          <option value="volunteer_delivery">{{ METHOD_LABELS.volunteer_delivery }}：志愿者按约定时限代送</option>
          <option value="door_contactless">{{ METHOD_LABELS.door_contactless }}：放到约定门口位置</option>
        </select>
      </label>

      <div class="banner banner-warn" style="margin-top: 0">
        <strong>🌙 夜间多人同时申请时，这些信息决定分配顺序，请如实填写</strong>
        系统会综合<strong>紧急程度、家中是否有儿童、距取用点距离、库存数量、今晚志愿者配送能力</strong>给出分配建议，
        每项因子都会留痕，社区端可据此答复质疑。
      </div>
      <label class="field">
        <span>紧急程度（当前实际情况）</span>
        <select v-model="form.urgency">
          <option v-for="[k, v] in Object.entries(URGENCY_LABELS)" :key="k" :value="k">{{ v }}</option>
        </select>
      </label>
      <label class="check-row" style="margin-top: -6px">
        <input type="checkbox" v-model="form.hasChild" />
        <span>是给家中儿童使用（有儿童的家庭在分配中优先）</span>
      </label>
      <div class="field-row">
        <label class="field">
          <span>儿童年龄（岁，选填）</span>
          <input v-model.number="form.childAge" type="number" min="0" max="18" :disabled="!form.hasChild" placeholder="如 3" />
        </label>
        <label class="field">
          <span>当前实测体温（℃，选填）</span>
          <input v-model.number="form.temperature" type="number" min="35" max="43" step="0.1" placeholder="如 39.4" />
        </label>
        <label class="field">
          <span>距取用点距离（米）</span>
          <input v-model.number="form.distanceMeters" type="number" min="0" max="20000" step="10" placeholder="如 150" />
          <span class="hint">不知道可填大概值：同小区楼栋间一般 100–800 米</span>
        </label>
      </div>

      <label class="field">
        <span>备注（可选）</span>
        <textarea v-model="form.note" placeholder="例如：老人行动不便、希望今晚 8 点后送达"></textarea>
      </label>

      <div class="banner banner-warn">
        <strong>请逐项确认后再提交（每次借用都必须看到这四项）</strong>
        <label class="check-row"><input type="checkbox" v-model="agreed.source" /> 我已知晓<strong>来源</strong>：{{ item.ownerName }} 共享、志愿者审核，社区只做物品流转，不做担保与诊断。</label>
        <label class="check-row"><input type="checkbox" v-model="agreed.expiry" /> 我已核对<strong>效期</strong>：{{ item.expiryDate }}，临期物品会显著标注，过期不得使用。</label>
        <label class="check-row"><input type="checkbox" v-model="agreed.package" /> 我将在交接时检查<strong>包装状态</strong>：须整盒/整包未开封、封签完好；破损当场拒收并拍照反馈。</label>
        <label class="check-row"><input type="checkbox" v-model="agreed.limit" /> 我了解<strong>适用限制</strong>：仅限临时辅助，不替代就医；如症状加重或使用后不适立即就医并反馈。</label>
      </div>

      <div>
        <button class="btn btn-primary" :disabled="!agreeAll" @click="submitApply">确认无误，提交申请</button>
        <button class="btn" @click="showApply = false">取消</button>
      </div>
    </div>

    <!-- 反馈弹窗 -->
    <div v-if="showFeedback" class="card" style="border: 2px solid var(--c-danger)">
      <h3>问题反馈（包装破损 / 疑似使用后不适）</h3>
      <label class="field">
        <span>问题类型</span>
        <select v-model="fbForm.type">
          <option value="package_damaged">{{ FEEDBACK_TYPE_LABELS.package_damaged }}</option>
          <option value="adverse_reaction">{{ FEEDBACK_TYPE_LABELS.adverse_reaction }}</option>
          <option value="other">{{ FEEDBACK_TYPE_LABELS.other }}</option>
        </select>
      </label>
      <label class="field">
        <span>具体情况</span>
        <textarea v-model="fbForm.detail" placeholder="请描述发现时间、包装/身体反应具体表现、是否保留包装与照片"></textarea>
      </label>
      <div v-if="fbForm.type === 'adverse_reaction'" class="banner banner-danger">
        如出现皮疹、红肿加重、呼吸不畅等情况，请<strong>立即停止使用并就医</strong>，保留物品与包装备查；社区会同步隔离同批次物品。
      </div>
      <button class="btn btn-danger" @click="submitFeedback">提交反馈并隔离该物品</button>
      <button class="btn" @click="showFeedback = false">取消</button>
    </div>

    <!-- 夜间多人争抢：实时分配建议 -->
    <template v-if="previewPlan && contention">
      <h3 class="section-title">🌙 夜间同时申请（{{ contention.applicants }} 户争抢 {{ contention.available }} 盒）</h3>
      <div class="card">
        <AllocationPanel
          mode="preview"
          :item-name="item.name"
          :available-qty="contention.available"
          :volunteer-capacity="store.volunteerCapacity"
          :ranked="previewPlan.ranked"
        />
        <div v-if="store.isVolunteer" class="card-actions" style="margin-top: 10px">
          <button class="btn btn-primary" @click="executeAllocation">按建议执行分配并锁定库存</button>
        </div>
        <div v-else class="muted" style="margin-top: 8px">
          在岗志愿者将按以上建议执行分配；未分到的居民会保留求助记录，可转相邻小区互助、选择替代用品或收到就医提示，到货后志愿者按记录补发。
        </div>
      </div>
    </template>

    <!-- 已执行的夜间分配轮次：理由留痕，便于处理质疑 -->
    <template v-for="round in rounds" :key="round.id">
      <h3 class="section-title">📜 夜间分配记录与理由（{{ round.createdAt.replace('T', ' ').slice(0, 16) }}）</h3>
      <div class="card">
        <AllocationPanel mode="round" :item-name="item.name" :available-qty="round.availableQty" :volunteer-capacity="round.volunteerCapacity" :round="round" :requests-by-id="requestsById" />

        <!-- 未分到居民的求助记录与三条出路 -->
        <div v-for="rid in round.unallocatedRequestIds" :key="`${round.id}-${rid}`" class="aid-block">
          <template v-if="requestsById.get(rid)">
            <div class="aid-head">
              <strong>未分到：{{ requestsById.get(rid)!.applicantName }}</strong>
              <span class="badge" :class="requestsById.get(rid)!.helpStatus === 'fulfilled' ? 'badge-green' : requestsById.get(rid)!.helpStatus === 'closed' ? 'badge-gray' : 'badge-amber'">
                求助记录：{{ { open: '待补发', fulfilled: '已到货补发', closed: '已关闭' }[requestsById.get(rid)!.helpStatus ?? 'open'] }}
              </span>
            </div>

            <!-- 本人视角：选择出路 -->
            <template v-if="requestsById.get(rid)!.applicantId === store.currentUserId && requestsById.get(rid)!.helpStatus === 'open'">
              <div class="muted">很遗憾本次未分到物品，请选择接下来的安排（均可，求助记录仍会保留等待到货补发）：</div>
              <div class="card-actions">
                <button class="btn btn-sm btn-primary" @click="chooseAid(rid, 'neighbor_community')">{{ AID_ROUTE_LABELS.neighbor_community }}</button>
                <button class="btn btn-sm" @click="chooseAid(rid, 'alternative')">{{ AID_ROUTE_LABELS.alternative }}</button>
                <button class="btn btn-sm btn-danger" @click="chooseAid(rid, 'medical_advice')">{{ AID_ROUTE_LABELS.medical_advice }}</button>
              </div>
              <div v-if="requestsById.get(rid)!.aidChosen" class="banner banner-info">
                已选择「{{ AID_ROUTE_LABELS[requestsById.get(rid)!.aidChosen!] }}」：{{ AID_ROUTE_HINTS[requestsById.get(rid)!.aidChosen!] }}
                <template v-if="requestsById.get(rid)!.aidNeighborName">承接点：{{ requestsById.get(rid)!.aidNeighborName }}</template>
              </div>
            </template>

            <!-- 其他视角：只读看到该户的去向 -->
            <div v-else-if="requestsById.get(rid)!.aidChosen" class="muted">
              已选择：{{ AID_ROUTE_LABELS[requestsById.get(rid)!.aidChosen!] }}
              <template v-if="requestsById.get(rid)!.aidNeighborName">（{{ requestsById.get(rid)!.aidNeighborName }}）</template>
              <template v-if="requestsById.get(rid)!.fulfilledAt"> · 已于 {{ requestsById.get(rid)!.fulfilledAt!.replace('T', ' ').slice(0, 16) }} 由 {{ requestsById.get(rid)!.fulfilledBy }} 补发</template>
            </div>

            <!-- 本人对分配结果有疑问 -->
            <template v-if="requestsById.get(rid)!.applicantId === store.currentUserId">
              <div class="inline-form" style="margin-top: 8px">
                <input v-model="questionText[rid]" type="text" placeholder="对分配有疑问？写给社区，工作人员会按逐项因子答复" />
                <button class="btn btn-sm" @click="askQuestion(rid)">提交质疑</button>
              </div>
              <div v-if="answerOf(rid)" class="banner banner-success" style="margin-top: 8px">
                社区答复（{{ answerOf(rid)!.repliedAt?.replace('T', ' ').slice(0, 16) }}）：{{ answerOf(rid)!.reply }}
              </div>
            </template>
          </template>
        </div>

        <!-- 社区端：完整理由 + 质疑入口提示 -->
        <details class="reason-details">
          <summary>查看本次分配的完整理由（社区答复质疑口径）</summary>
          <pre class="reason-text">{{ round.summary }}</pre>
        </details>
        <div v-if="store.questions.some((q) => q.allocationId === round.id && q.status === 'open')" class="banner banner-warn">
          有 {{ store.questions.filter((q) => q.allocationId === round.id && q.status === 'open').length }} 条居民质疑待答复，请前往「社区工作台 → 分配理由与质疑」。
        </div>
      </div>
    </template>

    <!-- 同物品的借用记录 -->
    <h3 class="section-title">🔗 该物品的借用/候补记录（与登记审核串联）</h3>
    <template v-if="relatedRequests.length">
      <RequestCard v-for="r in relatedRequests" :key="r.id" :req="r" :item-name="item.name" />
    </template>
    <div v-else class="empty">暂无借用记录</div>

    <!-- 反馈记录 -->
    <template v-if="itemFeedback.length">
      <h3 class="section-title">⚠️ 风险反馈（{{ itemFeedback.length }}）</h3>
      <div v-for="f in itemFeedback" :key="f.id" class="banner" :class="f.status === 'open' ? 'banner-danger' : 'banner-info'">
        <strong>{{ FEEDBACK_TYPE_LABELS[f.type] }} · {{ f.status === 'open' ? '待工作人员核查' : '已处置' }}</strong>
        {{ f.detail }}<br />
        <span class="muted">{{ f.reporterName }} 报告 · {{ f.handleNote ? `处置：${f.handleNote}` : '' }}</span>
      </div>
    </template>

    <h3 class="section-title">📋 全流程时间线（登记 → 审核 → 借出 → 交接 → 归还/报废 → 反馈）</h3>
    <div class="card">
      <TimelineView :events="store.itemTimeline(item.id)" />
    </div>
  </template>
</template>

<style scoped>
.field-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.aid-block {
  border: 1px dashed var(--c-gray-300);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 10px 0;
  background: #fff;
}
.aid-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
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
</style>
