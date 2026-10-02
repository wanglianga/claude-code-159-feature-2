import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type {
  AidRoute,
  AllocationQuestion,
  AllocationRound,
  BorrowRequest,
  Feedback,
  FeedbackType,
  HandoverMethod,
  Item,
  ItemDraft,
  RequestStatus,
  Scene,
  TimelineEvent,
  UrgencyLevel,
} from '@/types'
import {
  AID_ROUTE_HINTS,
  DELIVERY_SLA_HOURS,
  PICKUP_WINDOW_HOURS,
  STOCK_LOCKING_STATUSES,
  buildAllocationRoundDraft,
  planAllocation,
  suggestedAidRoute,
  validateDraft,
} from '@/rules'
import { addHours, daysUntil, hoursSince } from '@/utils/date'
import { BASE_NOW, DEMO_USERS, NEIGHBOR_AID_POINTS, freshState, uid } from '@/data/seed'

const STORAGE_KEY = 'medkit-share-state-v2'

export interface ApplyFactors {
  urgency: UrgencyLevel
  hasChild: boolean
  childAge?: number
  temperature?: number
  distanceMeters?: number
}

interface PersistShape {
  nowIso: string
  currentUserId: string
  items: Item[]
  requests: BorrowRequest[]
  feedbacks: Feedback[]
  timeline: TimelineEvent[]
  allocations: AllocationRound[]
  questions: AllocationQuestion[]
}

interface ActionResult {
  ok: boolean
  message: string
}

export class ActionError extends Error {}

function load(): PersistShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as PersistShape
    if (!Array.isArray(data.items) || !Array.isArray(data.requests)) return null
    // v1 旧数据没有夜间分配集合，直接作废重建，避免半结构状态
    if (!Array.isArray(data.allocations) || !Array.isArray(data.questions)) return null
    return data
  } catch {
    return null
  }
}

export const useMedkitStore = defineStore('medkit', () => {
  const persisted = load()
  const seed = persisted ?? { ...freshState(BASE_NOW), nowIso: BASE_NOW, currentUserId: 'u_b' }

  const nowIso = ref<string>(persisted?.nowIso ?? BASE_NOW)
  const currentUserId = ref<string>(persisted?.currentUserId ?? 'u_b')
  const items = ref<Item[]>(seed.items)
  const requests = ref<BorrowRequest[]>(seed.requests)
  const feedbacks = ref<Feedback[]>(seed.feedbacks)
  const timeline = ref<TimelineEvent[]>(seed.timeline)
  const allocations = ref<AllocationRound[]>(seed.allocations ?? [])
  const questions = ref<AllocationQuestion[]>(seed.questions ?? [])

  function persist() {
    const data: PersistShape = {
      nowIso: nowIso.value,
      currentUserId: currentUserId.value,
      items: items.value,
      requests: requests.value,
      feedbacks: feedbacks.value,
      timeline: timeline.value,
      allocations: allocations.value,
      questions: questions.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }

  function addEvent(e: Omit<TimelineEvent, 'id'>) {
    timeline.value.push({ ...e, id: uid('ev') })
  }

  // ---- 时钟与会话 ----
  function advanceHours(hours: number) {
    nowIso.value = addHours(nowIso.value, hours)
    persist()
  }
  function resetDemo() {
    const f = freshState(BASE_NOW)
    items.value = f.items
    requests.value = f.requests
    feedbacks.value = f.feedbacks
    timeline.value = f.timeline
    allocations.value = f.allocations
    questions.value = f.questions
    nowIso.value = BASE_NOW
    currentUserId.value = 'u_b'
    persist()
  }
  function switchUser(id: string) {
    currentUserId.value = id
    persist()
  }

  const users = DEMO_USERS
  const currentUser = computed(() => DEMO_USERS.find((u) => u.id === currentUserId.value) ?? DEMO_USERS[0])
  const isVolunteer = computed(() => currentUser.value.role === 'volunteer' || currentUser.value.role === 'staff')
  const isStaff = computed(() => currentUser.value.role === 'staff')

  /** 今晚在岗志愿者的总配送运力（总单数 − 已承担的未完成配送单） */
  const volunteerCapacity = computed(() => {
    const total = DEMO_USERS.filter((u) => u.role === 'volunteer' && u.onDuty).reduce((s, u) => s + (u.deliveryCapacity ?? 1), 0)
    const used = new Set(requests.value.filter((r) => ['confirmed', 'handing'].includes(r.status) && r.method === 'volunteer_delivery' && r.volunteerId).map((r) => r.volunteerId)).size
    return Math.max(0, total - used)
  })

  // ---- 库存与状态派生 ----
  const itemsById = computed(() => new Map(items.value.map((i) => [i.id, i])))

  function lockedList(itemId: string): BorrowRequest[] {
    return requests.value.filter((r) => r.itemId === itemId && STOCK_LOCKING_STATUSES.includes(r.status))
  }
  function lockedQty(itemId: string): number {
    return lockedList(itemId).reduce((s, r) => s + r.quantity, 0)
  }
  function availableQty(itemId: string): number {
    const it = itemsById.value.get(itemId)
    if (!it) return 0
    return Math.max(0, it.quantity - lockedQty(itemId))
  }
  function waitingList(itemId: string): BorrowRequest[] {
    return requests.value
      .filter((r) => r.itemId === itemId && r.status === 'waiting')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  }

  /** 根据库存占用重算 可借/部分外借/借完 三态（其他状态不动） */
  function refreshItemStatus(itemId: string) {
    const it = itemsById.value.get(itemId)
    if (!it) return
    if (it.status !== 'published' && it.status !== 'partially_lent' && it.status !== 'lent_out') return
    const locked = lockedQty(itemId)
    if (locked <= 0) it.status = 'published'
    else if (locked < it.quantity) it.status = 'partially_lent'
    else it.status = 'lent_out'
  }

  function requireItem(itemId: string): Item {
    const it = itemsById.value.get(itemId)
    if (!it) throw new ActionError('物品不存在或已被删除。')
    return it
  }

  // ---- 居民：登记 ----
  function register(draft: ItemDraft): ActionResult {
    const { errors, warnings } = validateDraft(draft, nowIso.value)
    if (errors.length) return { ok: false, message: errors.join(' ') }

    const it: Item = reactive({
      ...draft,
      id: uid('i'),
      ownerId: currentUserId.value,
      ownerName: currentUser.value.name,
      status: 'pending_review',
      createdAt: nowIso.value,
    })
    items.value.unshift(it)
    addEvent({
      itemId: it.id,
      at: nowIso.value,
      actorId: currentUserId.value,
      actorName: currentUser.value.name,
      kind: 'registered',
      detail: `登记「${it.name} ${it.spec}」×${it.quantity}`,
    })
    persist()
    return { ok: true, message: warnings.length ? warnings.join(' ') : '登记成功，等待志愿者审核后发布。' }
  }

  // ---- 志愿者：审核 ----
  function reviewItem(itemId: string, approved: boolean, reason?: string): ActionResult {
    if (!isVolunteer.value) return { ok: false, message: '只有志愿者可以审核物品。' }
    const it = requireItem(itemId)
    if (it.status !== 'pending_review') return { ok: false, message: '该物品不在待审核状态。' }

    if (approved) {
      if (daysUntil(it.expiryDate, nowIso.value) < 0) return { ok: false, message: '物品已过期，不能发布，应驳回并引导报废。' }
      it.review = { reviewerId: currentUserId.value, reviewerName: currentUser.value.name, at: nowIso.value, approved: true, reason }
      if (it.category === 'other_consumable') {
        it.review.reason = `志愿者初审通过，待社区工作人员复核${reason ? `：${reason}` : ''}`
        addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'reviewed', detail: '志愿者初审通过，待工作人员复核' })
        persist()
        return { ok: true, message: '初审通过，已转社区工作人员复核。' }
      }
      it.status = 'published'
      it.publishedAt = nowIso.value
      addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'reviewed', detail: `审核通过${reason ? `：${reason}` : ''}` })
      addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'published', detail: '发布到邻里药箱大厅' })
    } else {
      it.status = 'rejected'
      it.review = { reviewerId: currentUserId.value, reviewerName: currentUser.value.name, at: nowIso.value, approved: false, reason: reason || '不符合共享范围' }
      it.closeReason = reason
      addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'reviewed', detail: `审核驳回：${reason || '不符合共享范围（处方药/拆封/冷链/过期等）'}` })
    }
    persist()
    return { ok: true, message: approved ? '已审核通过并发布。' : '已驳回，居民可在“我的共享”看到原因。' }
  }

  /** 工作人员复核“其他非处方耗材” */
  function secondReview(itemId: string, approved: boolean, reason?: string): ActionResult {
    if (!isStaff.value) return { ok: false, message: '需要社区工作人员复核。' }
    const it = requireItem(itemId)
    if (it.status !== 'pending_review' || it.category !== 'other_consumable' || !it.review?.approved) {
      return { ok: false, message: '该物品不需要复核或状态不正确。' }
    }
    if (!approved) {
      it.status = 'rejected'
      it.closeReason = reason
      addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'reviewed', detail: `工作人员复核驳回：${reason ?? '不予共享'}` })
      persist()
      return { ok: true, message: '已复核驳回。' }
    }
    it.status = 'published'
    it.publishedAt = nowIso.value
    addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'published', detail: '工作人员复核通过，发布到大厅' })
    persist()
    return { ok: true, message: '复核通过，已发布。' }
  }

  // ---- 居民：申请借用 ----
  function apply(
    itemId: string,
    quantity: number,
    scene: Scene,
    method: HandoverMethod,
    note?: string,
    factors?: ApplyFactors,
  ): ActionResult {
    const it = requireItem(itemId)
    if (!['published', 'partially_lent', 'lent_out'].includes(it.status)) return { ok: false, message: '该物品当前不可申请。' }
    if (daysUntil(it.expiryDate, nowIso.value) < 0) {
      return { ok: false, message: '该物品已过期（超过有效期），不能借用，已提示工作人员报废。' }
    }
    if (quantity <= 0) return { ok: false, message: '借用数量需大于 0。' }
    const avail = availableQty(itemId)
    if (quantity > it.quantity) return { ok: false, message: '申请数量超过登记总量。' }
    if (factors?.temperature != null && (factors.temperature < 35 || factors.temperature > 43)) {
      return { ok: false, message: '体温数值异常（35–43℃），请核对后再提交。' }
    }
    if (factors?.distanceMeters != null && (factors.distanceMeters < 0 || factors.distanceMeters > 20000)) {
      return { ok: false, message: '距离数值异常（0–20000 米），请核对后再提交。' }
    }

    const req: BorrowRequest = reactive({
      id: uid('r'),
      itemId,
      applicantId: currentUserId.value,
      applicantName: currentUser.value.name,
      scene,
      quantity,
      method,
      note,
      status: 'waiting',
      createdAt: nowIso.value,
      address: currentUser.value.address,
      urgency: factors?.urgency ?? 'spare',
      hasChild: factors?.hasChild ?? false,
      childAge: factors?.childAge,
      temperature: factors?.temperature,
      distanceMeters: factors?.distanceMeters,
    })
    requests.value.unshift(req)
    const ahead = waitingList(itemId).length - 1
    addEvent({
      itemId,
      requestId: req.id,
      at: nowIso.value,
      actorId: currentUserId.value,
      actorName: currentUser.value.name,
      kind: 'waitlisted',
      detail: `提交借用申请「${it.name}」×${quantity}；当前余量 ${avail}，排队候补${ahead ? `，前面还有 ${ahead} 人` : ''}，需共享人/志愿者确认后锁定`,
    })
    persist()
    return {
      ok: true,
      message:
        avail >= quantity
          ? '申请已提交，等待共享人或志愿者确认（先确认者先得）。'
          : `当前余量仅 ${avail}，已进入候补；他人取消或归还后会按顺序递补。`,
    }
  }

  /** 确认申请并锁定库存（余量不足则保持候补） */
  function confirmRequest(requestId: string): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '申请不存在。' }
    if (r.status !== 'waiting') return { ok: false, message: '该申请不在候补中。' }
    const it = requireItem(r.itemId)
    if (it.status === 'recalled' || it.status === 'scrapped' || it.status === 'rejected') {
      return { ok: false, message: '物品已不可借，不能确认。' }
    }
    if (availableQty(r.itemId) < r.quantity) {
      return { ok: false, message: '余量不足，保持候补；可联系申请人协商数量，或等待归还/补充。' }
    }
    r.status = 'confirmed'
    r.confirmedAt = nowIso.value
    r.confirmerId = currentUserId.value
    r.confirmerName = currentUser.value.name
    if (r.method === 'volunteer_delivery' && currentUser.value.role === 'volunteer') {
      r.volunteerId = currentUserId.value
      r.volunteerName = currentUser.value.name
    }
    refreshItemStatus(r.itemId)
    addEvent({ itemId: r.itemId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'confirmed', detail: `确认申请并锁定库存 ×${r.quantity}，${PICKUP_WINDOW_HOURS}小时内需完成交接` })
    persist()
    return { ok: true, message: '已确认并锁定库存，请尽快安排交接。' }
  }

  // ---- 夜间多人争抢：分配建议 / 执行 / 出路 / 补发 / 质疑 ----

  /** 分配预览（不落库）：页面给居民与志愿者实时展示排序建议 */
  function previewAllocationPlan(itemId: string) {
    const candidates = requests.value
      .filter((r) => r.itemId === itemId && r.status === 'waiting')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    return planAllocation({ requests: candidates, availableQty: availableQty(itemId), volunteerCapacity: volunteerCapacity.value })
  }

  /** 参与夜间分配的候选申请数（候补中 ≥2 户且库存不够全部分时才有争抢场景） */
  function allocationContention(itemId: string): { applicants: number; demand: number; available: number } {
    const candidates = requests.value.filter((r) => r.itemId === itemId && r.status === 'waiting')
    return {
      applicants: candidates.length,
      demand: candidates.reduce((s, r) => s + r.quantity, 0),
      available: availableQty(itemId),
    }
  }

  /**
   * 执行一轮夜间分配：评分排序 → 按库存锁定建议分到的申请；
   * 未分到的申请取消但保留求助记录（helpStatus=open），居民随后选择三条出路。
   */
  function executeAllocation(itemId: string): ActionResult & { roundId?: string } {
    if (!isVolunteer.value) return { ok: false, message: '夜间分配由在岗志愿者/社区工作人员执行。' }
    const it = requireItem(itemId)
    const candidates = requests.value
      .filter((r) => r.itemId === itemId && r.status === 'waiting')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    if (candidates.length < 2) return { ok: false, message: '至少要有 2 户同时候补时才需要启动分配规则。' }

    const plan = planAllocation({ requests: candidates, availableQty: availableQty(itemId), volunteerCapacity: volunteerCapacity.value })
    const round: AllocationRound = reactive({
      id: uid('alloc'),
      ...buildAllocationRoundDraft(it.id, it.name, plan),
      createdAt: nowIso.value,
      createdBy: currentUserId.value,
      createdByName: currentUser.value.name,
      status: 'adopted',
      adoptedAt: nowIso.value,
    })
    allocations.value.unshift(round)

    for (const scored of plan.ranked) {
      const r = scored.req
      r.score = scored.score
      r.scoreDetails = scored.details
      r.allocationId = round.id
    }

    // 分到：逐单锁定库存（整盒切分，余量不足的单子已在 plan 中跳过）
    for (const rid of plan.allocatedRequestIds) {
      const r = requests.value.find((x) => x.id === rid)!
      r.allocated = true
      r.status = 'confirmed'
      r.confirmedAt = nowIso.value
      r.confirmerId = currentUserId.value
      r.confirmerName = currentUser.value.name
      if (r.method === 'volunteer_delivery') {
        r.volunteerId = currentUser.value.id
        r.volunteerName = currentUser.value.name
      }
      addEvent({ itemId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'confirmed', detail: `夜间分配执行：${r.applicantName} 综合评分 ${r.score} 分最高，按建议锁定库存 ×${r.quantity}` })
    }

    // 未分到：申请取消但求助记录保留，等待居民选择出路/到货补发
    for (const rid of plan.unallocatedRequestIds) {
      const r = requests.value.find((x) => x.id === rid)!
      r.allocated = false
      r.status = 'cancelled'
      r.closedAt = nowIso.value
      r.helpStatus = 'open'
      r.cancelReason = `夜间分配未分到：库存仅 ${plan.availableQty} 盒，综合评分 ${r.score} 分排序靠后；求助记录已保留，可转相邻小区互助/选择替代用品/收到就医提示，到货后可补发`
      addEvent({ itemId, requestId: r.id, at: nowIso.value, actorId: 'system', actorName: '系统', kind: 'cancelled', detail: `夜间分配未分给 ${r.applicantName}（评分 ${r.score}），库存保留给更高优先级，求助记录保留` })
    }

    refreshItemStatus(itemId)
    addEvent({
      itemId,
      at: nowIso.value,
      actorId: currentUserId.value,
      actorName: currentUser.value.name,
      kind: 'allocation_adopted',
      detail: `夜间分配已执行（${round.ruleVersion}）：${plan.allocatedRequestIds.length} 户分到、${plan.unallocatedRequestIds.length} 户未分到并保留求助记录；分配理由已存档供社区答复质疑`,
    })
    persist()
    return {
      ok: true,
      roundId: round.id,
      message: `分配已执行：${plan.allocatedRequestIds.length} 户分到物品，${plan.unallocatedRequestIds.length} 户未分到并保留求助记录，理由已存档。`,
    }
  }

  /** 未分到物品的居民选择出路：相邻小区互助 / 替代用品 / 就医提示 */
  function chooseAid(requestId: string, route: AidRoute, extra?: { neighborName?: string }): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '申请不存在。' }
    if (r.applicantId !== currentUserId.value && !isVolunteer.value) return { ok: false, message: '只有申请人本人可以选择出路。' }
    if (r.allocated !== false || r.helpStatus !== 'open') return { ok: false, message: '仅未分到物品且求助记录仍有效的申请可以选择出路。' }
    r.aidChosen = route
    r.aidChosenAt = nowIso.value
    if (route === 'neighbor_community') {
      r.aidNeighborName = extra?.neighborName ?? NEIGHBOR_AID_POINTS[0]
    } else if (route === 'alternative') {
      r.aidAlternative = '凉毛巾敷额头、温水擦拭颈部/腋下/腹股沟、减少捂盖、少量多次饮水并持续测温'
    } else {
      // 收到就医提示后诉求闭环，不再进入补发队列
      r.helpStatus = 'closed'
    }
    addEvent({
      itemId: r.itemId,
      requestId: r.id,
      at: nowIso.value,
      actorId: currentUserId.value,
      actorName: currentUser.value.name,
      kind: 'aid_chosen',
      detail:
        route === 'neighbor_community'
          ? `未分到物品，转入相邻小区互助：${r.aidNeighborName}`
          : route === 'alternative'
            ? `未分到物品，选择替代用品：${r.aidAlternative}`
            : '未分到物品，已收到就医提示：持续高热/精神差请立即夜间急诊',
    })
    persist()
    return { ok: true, message: AID_ROUTE_HINTS[route] }
  }

  /** 志愿者/工作人员登记新到货（同品类补货），到货后可为挂起的求助记录补发 */
  function registerRestock(itemId: string, qty: number, note?: string): ActionResult {
    if (!isVolunteer.value) return { ok: false, message: '只有志愿者/工作人员可以登记到货。' }
    const it = requireItem(itemId)
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, message: '到货数量需大于 0。' }
    it.quantity += qty
    // 借完/部分外借状态在有新余量时回到可借
    if (it.status === 'lent_out' || it.status === 'partially_lent') it.status = 'published'
    refreshItemStatus(itemId)
    addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'restocked', detail: `夜间短缺后新到货 ×${qty}，可按求助记录补发${note ? `：${note}` : ''}` })
    persist()
    const open = helpRequests.value.filter((r) => r.itemId === itemId).length
    return { ok: true, message: `已登记到货 ×${qty}。${open ? `当前有 ${open} 条未满足的求助记录可补发。` : '当前没有挂起的求助记录。'}` }
  }

  /** 根据库存到货，对未拿到物品的居民按求助记录补发（重新锁定并进入交接） */
  function fulfillResupply(requestId: string, targetItemId?: string, note?: string): ActionResult {
    if (!isVolunteer.value) return { ok: false, message: '只有志愿者/工作人员可以安排补发。' }
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '求助记录不存在。' }
    if (r.helpStatus !== 'open') return { ok: false, message: '该求助记录已补发或已关闭。' }
    const targetId = targetItemId ?? r.itemId
    if (!itemsById.value.has(targetId)) return { ok: false, message: '补发目标物品不存在。' }
    if (availableQty(targetId) < r.quantity) return { ok: false, message: '到货余量仍不足，请先登记到货或改发其他同品类物品。' }

    r.helpStatus = 'fulfilled'
    r.fulfilledAt = nowIso.value
    r.fulfilledBy = currentUser.value.name
    r.fulfilledItemId = targetId
    r.fulfilledNote = note
    // 重新进入锁定/交接流程，沿用原申请的数量、方式与地址
    r.status = 'confirmed'
    r.confirmedAt = nowIso.value
    r.confirmerId = currentUser.value.id
    r.confirmerName = currentUser.value.name
    r.cancelReason = undefined
    if (r.method === 'volunteer_delivery') {
      r.volunteerId = currentUser.value.id
      r.volunteerName = currentUser.value.name
    }
    refreshItemStatus(targetId)
    addEvent({ itemId: targetId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'help_fulfilled', detail: `按夜间求助记录到货补发给 ${r.applicantName} ×${r.quantity}${note ? `：${note}` : ''}` })
    persist()
    return { ok: true, message: `已按求助记录为 ${r.applicantName} 锁定补发 ×${r.quantity}，可继续安排交接。` }
  }

  /** 居民对某次分配提出质疑 */
  function askAllocation(requestId: string, content: string): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r || !r.allocationId) return { ok: false, message: '该申请没有对应的夜间分配记录。' }
    if (r.applicantId !== currentUserId.value) return { ok: false, message: '只能对自己的分配结果提出质疑。' }
    if (!content.trim()) return { ok: false, message: '请填写质疑内容。' }
    const q: AllocationQuestion = reactive({
      id: uid('q'),
      allocationId: r.allocationId,
      itemId: r.itemId,
      requestId: r.id,
      questionerId: currentUserId.value,
      questionerName: currentUser.value.name,
      content: content.trim(),
      createdAt: nowIso.value,
      status: 'open',
    })
    questions.value.unshift(q)
    addEvent({ itemId: r.itemId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'question', detail: `对夜间分配提出质疑：${content}` })
    persist()
    return { ok: true, message: '质疑已提交，社区工作人员可在“分配理由与质疑”中逐项因子答复你。' }
  }

  /** 社区答复质疑（基于存档的评分理由） */
  function replyQuestion(questionId: string, reply: string): ActionResult {
    if (!isStaff.value) return { ok: false, message: '只有社区工作人员可以答复分配质疑。' }
    const q = questions.value.find((x) => x.id === questionId)
    if (!q || q.status !== 'open') return { ok: false, message: '质疑不存在或已答复。' }
    if (!reply.trim()) return { ok: false, message: '请填写答复内容。' }
    q.status = 'replied'
    q.reply = reply.trim()
    q.repliedAt = nowIso.value
    q.replierName = currentUser.value.name
    addEvent({ itemId: q.itemId, requestId: q.requestId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'question_replied', detail: `答复分配质疑：${reply}` })
    persist()
    return { ok: true, message: '已答复，居民可在“我的借用”看到逐项解释。' }
  }

  /** 系统对未选择出路的高热申请给出默认就医提示（供页面一键采用，规则同 chooseAid） */
  function defaultAidRouteOf(requestId: string): AidRoute | undefined {
    const r = requests.value.find((x) => x.id === requestId)
    return r && r.allocated === false ? suggestedAidRoute(r) : undefined
  }

  // ---- 交接 ----
  function startHandover(requestId: string): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '申请不存在。' }
    if (r.status !== 'confirmed') return { ok: false, message: '需先确认申请才能开始交接。' }
    const it = requireItem(r.itemId)
    if (it.status === 'quarantined') return { ok: false, message: '物品已被风险隔离，暂停交接。' }
    r.status = 'handing'
    r.handingAt = nowIso.value
    if (r.method === 'volunteer_delivery' && !r.volunteerId && isVolunteer.value) {
      r.volunteerId = currentUserId.value
      r.volunteerName = currentUser.value.name
    }
    const detail =
      r.method === 'volunteer_delivery' ? '志愿者出发代送' : r.method === 'door_contactless' ? '已放到约定门口位置（无接触）' : '物品已放到约定取件点，等待自取'
    addEvent({ itemId: r.itemId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'handover_started', detail })
    persist()
    return { ok: true, message: detail }
  }

  function completeHandover(requestId: string, photo: string, note?: string): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '申请不存在。' }
    if (r.status !== 'handing') return { ok: false, message: '交接尚未开始。' }
    if (!photo.trim()) return { ok: false, message: '请先拍照上传交接凭证再确认。' }
    const it = requireItem(r.itemId)
    if (it.status === 'quarantined') return { ok: false, message: '物品已被风险隔离，不能完成交接。' }
    r.status = 'completed'
    r.completedAt = nowIso.value
    r.handoverPhoto = photo
    r.handoverNote = note
    addEvent({ itemId: r.itemId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'handover_confirmed', detail: `交接拍照确认：${note ?? '包装外观完好'}` })
    persist()
    return { ok: true, message: '交接完成。请按约定归还或补充。' }
  }

  /** 志愿者报备配送延误 */
  function reportDelay(requestId: string, reason: string): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '申请不存在。' }
    if (r.status !== 'handing' || r.method !== 'volunteer_delivery') return { ok: false, message: '仅配送中的申请可以报备延误。' }
    r.delayReason = reason || '志愿者临时有事，正在协调改派'
    addEvent({ itemId: r.itemId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'delay_flagged', detail: `配送延误：${r.delayReason}` })
    persist()
    return { ok: true, message: '延误已报备，借用人与工作人员会看到提醒，可改派其他志愿者。' }
  }

  function reassignVolunteer(requestId: string, volunteerId: string): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '申请不存在。' }
    if (r.status !== 'handing' || r.method !== 'volunteer_delivery') return { ok: false, message: '仅配送中的申请可以改派。' }
    const v = DEMO_USERS.find((u) => u.id === volunteerId && (u.role === 'volunteer' || u.role === 'staff'))
    if (!v) return { ok: false, message: '未找到可改派的志愿者。' }
    const old = r.volunteerName ?? '原志愿者'
    r.volunteerId = v.id
    r.volunteerName = v.name
    r.delayReason = undefined
    addEvent({ itemId: r.itemId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'handover_started', detail: `配送改派：${old} → ${v.name}` })
    persist()
    return { ok: true, message: `已改派给 ${v.name}。` }
  }

  // ---- 取消 / 超时未取 ----
  function cancelRequest(requestId: string, reason: string, opts: { bySystem?: boolean } = {}): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '申请不存在。' }
    if (!['waiting', 'confirmed', 'handing'].includes(r.status)) return { ok: false, message: '该申请已结束，不能取消。' }
    const actor = opts.bySystem ? '系统' : currentUser.value.name
    r.status = 'cancelled'
    r.closedAt = nowIso.value
    r.cancelReason = reason
    refreshItemStatus(r.itemId)
    addEvent({ itemId: r.itemId, requestId: r.id, at: nowIso.value, actorId: opts.bySystem ? 'system' : currentUserId.value, actorName: actor, kind: 'cancelled', detail: `申请取消，库存释放：${reason}` })
    persist()
    const next = waitingList(r.itemId)[0]
    return { ok: true, message: next ? `库存已释放，候补队列首位「${next.applicantName}」可确认递补。` : '申请已取消，库存已释放。' }
  }

  // ---- 闭环：归还 / 补充 / 赠予 ----
  function closeBorrow(requestId: string, mode: BorrowRequest['closeMode'], note?: string): ActionResult {
    const r = requests.value.find((x) => x.id === requestId)
    if (!r) return { ok: false, message: '申请不存在。' }
    if (r.status !== 'completed') return { ok: false, message: '仅已取走的借用可以登记归还/补充。' }
    const it = requireItem(r.itemId)
    r.status = 'closed_returned'
    r.closedAt = nowIso.value
    r.closeMode = mode
    r.closeNote = note

    if (mode === 'restock_new') {
      it.quantity += r.quantity
    } else if (mode === 'mutual_aid') {
      it.quantity = Math.max(0, it.quantity - r.quantity)
    }
    // return_sealed：数量不变，申请离开锁定集合，余量自然恢复
    refreshItemStatus(r.itemId)
    addEvent({
      itemId: r.itemId,
      requestId: r.id,
      at: nowIso.value,
      actorId: currentUserId.value,
      actorName: currentUser.value.name,
      kind: mode === 'restock_new' ? 'restocked' : 'returned',
      detail:
        mode === 'restock_new'
          ? `已补充同规格新品 ×${r.quantity}${note ? `：${note}` : ''}`
          : mode === 'mutual_aid'
            ? `邻里赠予，无需归还（库存核销 ×${r.quantity}）`
            : `已归还原物（未拆封）×${r.quantity}${note ? `：${note}` : ''}`,
    })
    persist()
    const next = waitingList(r.itemId)[0]
    return { ok: true, message: next ? `本次借用已闭环，候补首位「${next.applicantName}」可递补。` : '本次借用已闭环，感谢你的守信与互助。' }
  }

  // ---- 共享人撤回 ----
  function recallItem(itemId: string, reason: string): ActionResult {
    const it = requireItem(itemId)
    if (it.ownerId !== currentUserId.value && !isStaff.value) return { ok: false, message: '只有共享人本人可以撤回。' }
    if (it.status === 'scrapped' || it.status === 'recalled') return { ok: false, message: '物品已结束流转。' }
    it.status = 'recalled'
    it.closeReason = reason
    // 已确认/交接中的借用继续履行；候补中申请全部取消
    const waiting = requests.value.filter((r) => r.itemId === itemId && r.status === 'waiting')
    for (const r of waiting) {
      r.status = 'cancelled'
      r.closedAt = nowIso.value
      r.cancelReason = '共享人撤回物品，候补自动取消'
      addEvent({ itemId, requestId: r.id, at: nowIso.value, actorId: 'system', actorName: '系统', kind: 'cancelled', detail: '共享人撤回，候补申请取消' })
    }
    const inflight = requests.value.filter((r) => r.itemId === itemId && ['confirmed', 'handing', 'completed'].includes(r.status)).length
    addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'recalled', detail: `共享人撤回：${reason}${inflight ? `；${inflight} 笔进行中的借用继续完成` : ''}` })
    persist()
    return { ok: true, message: inflight ? `已撤回，不再接受新申请；${inflight} 笔进行中的借用将继续完成交接与归还。` : '物品已撤回，候补申请已通知取消。' }
  }

  // ---- 反馈：包装破损 / 疑似不适 ----
  function reportFeedback(itemId: string, type: FeedbackType, detail: string, requestId?: string): ActionResult {
    const it = requireItem(itemId)
    if (!detail.trim()) return { ok: false, message: '请填写具体情况描述。' }
    const fb: Feedback = reactive({
      id: uid('f'),
      itemId,
      requestId,
      reporterId: currentUserId.value,
      reporterName: currentUser.value.name,
      type,
      detail,
      createdAt: nowIso.value,
      status: 'open',
    })
    feedbacks.value.unshift(fb)
    addEvent({ itemId, requestId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'feedback', detail: `${type === 'package_damaged' ? '包装破损反馈' : type === 'adverse_reaction' ? '疑似使用后不适反馈' : '反馈'}：${detail}` })

    // 安全优先：破损/疑似不适立即隔离，停止新借用与交接
    if ((type === 'package_damaged' || type === 'adverse_reaction') && !['scrapped', 'recalled', 'rejected'].includes(it.status)) {
      it.status = 'quarantined'
      it.closeReason = type === 'package_damaged' ? '收到包装破损反馈，已隔离待核查' : '收到疑似不适反应反馈，已隔离待核查'
      for (const r of requests.value.filter((x) => x.itemId === itemId && ['waiting', 'confirmed', 'handing'].includes(x.status))) {
        const label: RequestStatus = r.status
        r.status = 'cancelled'
        r.closedAt = nowIso.value
        r.cancelReason = type === 'package_damaged' ? '物品包装破损被隔离，暂停交接' : '物品收到疑似不适反馈被隔离，暂停交接'
        addEvent({ itemId, requestId: r.id, at: nowIso.value, actorId: 'system', actorName: '系统', kind: 'cancelled', detail: `风险隔离，${label === 'waiting' ? '候补' : '交接中'}申请取消` })
      }
      addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'quarantined', detail: type === 'package_damaged' ? '包装破损：物品已隔离，待工作人员核查' : '疑似不适反应：物品已隔离，建议反馈人就医并保留包装' })
    }
    persist()
    return {
      ok: true,
      message:
        type === 'adverse_reaction'
          ? '已记录并隔离该物品。如不适持续或加重，请立即就医；社区仅做物品流转与风险提醒，不提供诊断。'
          : '已记录反馈，物品已隔离，待社区工作人员核查处理。',
    }
  }

  /** 工作人员处置反馈：报废 或 核查后重新发布 */
  function resolveFeedback(feedbackId: string, action: 'scrap' | 'republish', note: string): ActionResult {
    if (!isStaff.value) return { ok: false, message: '只有社区工作人员可以处置风险反馈。' }
    const fb = feedbacks.value.find((f) => f.id === feedbackId)
    if (!fb || fb.status !== 'open') return { ok: false, message: '反馈不存在或已处置。' }
    const it = requireItem(fb.itemId)
    fb.handledAt = nowIso.value
    fb.handlerId = currentUserId.value
    fb.handlerName = currentUser.value.name
    fb.handleNote = note

    if (action === 'scrap') {
      fb.status = 'resolved_scrap'
      it.status = 'scrapped'
      it.closeReason = `工作人员核查后报废：${note}`
      for (const r of requests.value.filter((x) => x.itemId === it.id && ['waiting', 'confirmed', 'handing'].includes(x.status))) {
        r.status = 'cancelled'
        r.closedAt = nowIso.value
        r.cancelReason = '物品报废，申请取消'
      }
      addEvent({ itemId: it.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'scrapped', detail: `核查报废：${note}` })
    } else {
      fb.status = 'resolved_republish'
      it.status = 'published'
      it.closeReason = undefined
      refreshItemStatus(it.id)
      addEvent({ itemId: it.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'published', detail: `核查后重新发布：${note}` })
    }
    persist()
    return { ok: true, message: action === 'scrap' ? '已报废并记录，按医疗/有害垃圾流程处理。' : '已解除隔离并重新发布。' }
  }

  /** 工作人员直接报废（过期物品清理等） */
  function scrapItem(itemId: string, reason: string): ActionResult {
    if (!isStaff.value) return { ok: false, message: '只有社区工作人员可以报废物品。' }
    const it = requireItem(itemId)
    if (it.status === 'scrapped') return { ok: false, message: '物品已报废。' }
    it.status = 'scrapped'
    it.closeReason = reason
    for (const r of requests.value.filter((x) => x.itemId === itemId && ['waiting', 'confirmed', 'handing'].includes(x.status))) {
      r.status = 'cancelled'
      r.closedAt = nowIso.value
      r.cancelReason = '物品报废，申请取消'
    }
    addEvent({ itemId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'scrapped', detail: reason })
    persist()
    return { ok: true, message: '已报废，相关进行中申请已取消。' }
  }

  // ---- 看板派生数据 ----
  const reviewQueue = computed(() => items.value.filter((i) => i.status === 'pending_review'))
  const openFeedbackList = computed(() =>
    feedbacks.value
      .filter((f) => f.status === 'open')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  )

  /** 已过期但仍挂在可借状态（大厅会禁借并提示，工作人员应尽快报废） */
  const expiredListed = computed(() =>
    items.value.filter((i) => ['published', 'partially_lent', 'lent_out', 'quarantined'].includes(i.status) && daysUntil(i.expiryDate, nowIso.value) < 0),
  )

  /** 效期临近（60天内）且仍在流转 */
  const expiringSoon = computed(() =>
    items.value
      .filter((i) => ['published', 'partially_lent', 'lent_out'].includes(i.status))
      .map((i) => ({ item: i, days: daysUntil(i.expiryDate, nowIso.value) }))
      .filter((x) => x.days >= 0 && x.days <= 60)
      .sort((a, b) => a.days - b.days),
  )

  interface OverduePickup {
    req: BorrowRequest
    hours: number
  }
  /** 超时未取：确认后超过时限仍未完成交接 */
  const overduePickups = computed<OverduePickup[]>(() =>
    requests.value
      .filter((r) => r.status === 'confirmed' || (r.status === 'handing' && r.method === 'self_pickup'))
      .map((r) => ({ req: r, hours: hoursSince(r.handingAt ?? r.confirmedAt ?? r.createdAt, nowIso.value) }))
      .filter((x) => x.hours > PICKUP_WINDOW_HOURS)
      .sort((a, b) => b.hours - a.hours),
  )

  interface DelayedDelivery {
    req: BorrowRequest
    hours: number
  }
  /** 志愿者配送延误：交接开始后超过 SLA 未完成 */
  const delayedDeliveries = computed<DelayedDelivery[]>(() =>
    requests.value
      .filter((r) => r.status === 'handing' && r.method === 'volunteer_delivery')
      .map((r) => ({ req: r, hours: hoursSince(r.handingAt ?? r.confirmedAt ?? r.createdAt, nowIso.value) }))
      .filter((x) => x.hours > DELIVERY_SLA_HOURS)
      .sort((a, b) => b.hours - a.hours),
  )

  const stats = computed(() => {
    const active = items.value.filter((i) => ['published', 'partially_lent', 'lent_out'].includes(i.status))
    return {
      activeCount: active.length,
      reviewCount: reviewQueue.value.length,
      inFlight: requests.value.filter((r) => ['confirmed', 'handing'].includes(r.status)).length,
      waiting: requests.value.filter((r) => r.status === 'waiting').length,
      completedOpen: requests.value.filter((r) => r.status === 'completed').length,
      openFeedback: openFeedbackList.value.length,
      expired: expiredListed.value.length,
      quarantined: items.value.filter((i) => i.status === 'quarantined').length,
      scrapped: items.value.filter((i) => i.status === 'scrapped').length,
      openHelp: helpRequests.value.filter((r) => r.helpStatus === 'open').length,
      openQuestions: questions.value.filter((q) => q.status === 'open').length,
      allocationRounds: allocations.value.length,
    }
  })

  // ---- 夜间分配相关派生数据 ----
  /** 未拿到物品、被保留下来的求助记录（含已选出路与补发状态） */
  const helpRequests = computed(() =>
    requests.value
      .filter((r) => r.helpStatus != null)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  )
  /** 仍挂起、等待到货补发的求助记录（志愿者视角） */
  const openHelpRequests = computed(() => helpRequests.value.filter((r) => r.helpStatus === 'open'))
  const openQuestions = computed(() =>
    questions.value
      .filter((q) => q.status === 'open')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  )
  function allocationsForItem(itemId: string): AllocationRound[] {
    return allocations.value
      .filter((a) => a.itemId === itemId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }
  function allocationOf(roundId: string): AllocationRound | undefined {
    return allocations.value.find((a) => a.id === roundId)
  }

  /** 社区端夜间短缺复盘：按物品聚合真实未满足需求 */
  const shortageReview = computed(() => {
    const rows = helpRequests.value.map((r) => ({
      req: r,
      item: itemsById.value.get(r.itemId),
      round: allocations.value.find((a) => a.id === r.allocationId),
    }))
    const byItem = new Map<string, { itemName: string; open: number; fulfilled: number; closed: number; total: number }>()
    for (const row of rows) {
      const key = row.req.itemId
      const cur = byItem.get(key) ?? { itemName: row.item?.name ?? key, open: 0, fulfilled: 0, closed: 0, total: 0 }
      cur.total += 1
      if (row.req.helpStatus === 'open') cur.open += 1
      else if (row.req.helpStatus === 'fulfilled') cur.fulfilled += 1
      else cur.closed += 1
      byItem.set(key, cur)
    }
    return { rows, byItem: [...byItem.values()] }
  })

  function itemTimeline(itemId: string): TimelineEvent[] {
    return timeline.value.filter((e) => e.itemId === itemId).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  }
  function itemRequests(itemId: string): BorrowRequest[] {
    return requests.value.filter((r) => r.itemId === itemId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  return {
    // state
    nowIso,
    currentUserId,
    users,
    items,
    requests,
    feedbacks,
    timeline,
    allocations,
    questions,
    // getters
    currentUser,
    isVolunteer,
    isStaff,
    volunteerCapacity,
    reviewQueue,
    openFeedbackList,
    expiredListed,
    expiringSoon,
    overduePickups,
    delayedDeliveries,
    stats,
    helpRequests,
    openHelpRequests,
    openQuestions,
    shortageReview,
    // actions
    advanceHours,
    resetDemo,
    switchUser,
    availableQty,
    lockedQty,
    lockedList,
    waitingList,
    refreshItemStatus,
    register,
    reviewItem,
    secondReview,
    apply,
    confirmRequest,
    startHandover,
    completeHandover,
    reportDelay,
    reassignVolunteer,
    cancelRequest,
    closeBorrow,
    recallItem,
    reportFeedback,
    resolveFeedback,
    scrapItem,
    itemTimeline,
    itemRequests,
    // 夜间多人争抢分配
    previewAllocationPlan,
    allocationContention,
    executeAllocation,
    chooseAid,
    registerRestock,
    fulfillResupply,
    askAllocation,
    replyQuestion,
    allocationsForItem,
    allocationOf,
    defaultAidRouteOf,
  }
})
