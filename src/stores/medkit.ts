import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type {
  AllocationBatch,
  AllocationDecision,
  BorrowRequest,
  DisputeRecord,
  Feedback,
  FeedbackType,
  HandoverMethod,
  HelpRecord,
  Item,
  ItemDraft,
  MutualAidPoint,
  RequestStatus,
  Scene,
  TimelineEvent,
  UrgencyLevel,
} from '@/types'
import {
  DELIVERY_SLA_HOURS,
  NIGHT_BATCH_MIN_APPLICANTS,
  NIGHT_BATCH_WINDOW_HOURS,
  NIGHT_DELIVERY_CAPACITY,
  PICKUP_WINDOW_HOURS,
  STOCK_LOCKING_STATUSES,
  isNightTime,
  validateDraft,
} from '@/rules'
import { addHours, daysUntil, hoursSince } from '@/utils/date'
import { estimateDistanceMeters } from '@/utils/community'
import { buildAllocationSuggestion, type AlternativeItem, type NightApplicant } from '@/utils/allocation'
import { BASE_NOW, DEMO_USERS, freshState, uid } from '@/data/seed'

const STORAGE_KEY = 'medkit-share-state-v2'

interface PersistShape {
  nowIso: string
  currentUserId: string
  items: Item[]
  requests: BorrowRequest[]
  feedbacks: Feedback[]
  timeline: TimelineEvent[]
  batches: AllocationBatch[]
  helpRecords: HelpRecord[]
  disputes: DisputeRecord[]
  mutualAidPoints: MutualAidPoint[]
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
    const data = JSON.parse(raw) as Partial<PersistShape>
    // 旧版本（v1）或缺字段的快照不兼容夜间分配数据，直接重建种子
    if (!Array.isArray(data.items) || !Array.isArray(data.requests)) return null
    if (!Array.isArray(data.batches) || !Array.isArray(data.helpRecords) || !Array.isArray(data.disputes) || !Array.isArray(data.mutualAidPoints)) return null
    return data as PersistShape
  } catch {
    return null
  }
}

export const useMedkitStore = defineStore('medkit', () => {
  const persisted = load()
  const base = persisted ?? { ...freshState(BASE_NOW), nowIso: BASE_NOW, currentUserId: 'u_b' }

  const nowIso = ref<string>(persisted?.nowIso ?? BASE_NOW)
  const currentUserId = ref<string>(persisted?.currentUserId ?? 'u_b')
  const items = ref<Item[]>(base.items)
  const requests = ref<BorrowRequest[]>(base.requests)
  const feedbacks = ref<Feedback[]>(base.feedbacks)
  const timeline = ref<TimelineEvent[]>(base.timeline)
  const batches = ref<AllocationBatch[]>(base.batches)
  const helpRecords = ref<HelpRecord[]>(base.helpRecords)
  const disputes = ref<DisputeRecord[]>(base.disputes)
  const mutualAidPoints = ref<MutualAidPoint[]>(base.mutualAidPoints)

  function persist() {
    const data: PersistShape = {
      nowIso: nowIso.value,
      currentUserId: currentUserId.value,
      items: items.value,
      requests: requests.value,
      feedbacks: feedbacks.value,
      timeline: timeline.value,
      batches: batches.value,
      helpRecords: helpRecords.value,
      disputes: disputes.value,
      mutualAidPoints: mutualAidPoints.value,
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
    batches.value = f.batches
    helpRecords.value = f.helpRecords
    disputes.value = f.disputes
    mutualAidPoints.value = f.mutualAidPoints
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
    opts: { note?: string; urgency?: UrgencyLevel; hasChild?: boolean; symptom?: string } = {},
  ): ActionResult {
    const it = requireItem(itemId)
    if (!['published', 'partially_lent', 'lent_out'].includes(it.status)) return { ok: false, message: '该物品当前不可申请。' }
    if (daysUntil(it.expiryDate, nowIso.value) < 0) {
      return { ok: false, message: '该物品已过期（超过有效期），不能借用，已提示工作人员报废。' }
    }
    if (quantity <= 0) return { ok: false, message: '借用数量需大于 0。' }
    const avail = availableQty(itemId)
    if (quantity > it.quantity) return { ok: false, message: '申请数量超过登记总量。' }

    const distanceMeters = estimateDistanceMeters(
      DEMO_USERS.find((u) => u.id === currentUserId.value) ?? { address: '' },
      it.location,
    )

    const req: BorrowRequest = reactive({
      id: uid('r'),
      itemId,
      applicantId: currentUserId.value,
      applicantName: currentUser.value.name,
      scene,
      quantity,
      method,
      note: opts.note,
      status: 'waiting',
      createdAt: nowIso.value,
      urgency: opts.urgency,
      hasChild: opts.hasChild,
      symptom: opts.symptom,
      distanceMeters,
    })
    requests.value.unshift(req)
    const ahead = waitingList(itemId).length - 1
    const night = isNightTime(nowIso.value)
    const nightPeers = nightConcurrent(itemId).length
    addEvent({
      itemId,
      requestId: req.id,
      at: nowIso.value,
      actorId: currentUserId.value,
      actorName: currentUser.value.name,
      kind: 'waitlisted',
      detail: `提交借用申请「${it.name}」×${quantity}${opts.urgency ? `（紧急度：${opts.urgency === 'critical' ? '紧急' : opts.urgency === 'urgent' ? '较急' : '一般'}${opts.hasChild ? '、家中有儿童' : ''}）` : ''}；当前余量 ${avail}，排队候补${ahead ? `，前面还有 ${ahead} 人` : ''}，需共享人/志愿者确认后锁定`,
    })
    persist()
    return {
      ok: true,
      message: night && nightPeers >= NIGHT_BATCH_MIN_APPLICANTS
        ? `夜间已有 ${nightPeers} 户同时申请该物品：志愿者将按“紧急程度→家中有儿童→距离→库存数量→夜间配送能力”综合评分给出分配建议；未分到的家庭会自动保留求助记录，可转相邻小区互助/选择替代品/收到就医提示，到货后还会按记录补发。`
        : avail >= quantity
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

  // ============================================================
  // 夜间多人同时申请：分配建议 / 执行 / 求助记录 / 质疑 / 复盘
  // ============================================================

  /** 当前夜间时间窗内、同一物品尚未进入分配批次的候补申请 */
  function nightConcurrent(itemId: string): BorrowRequest[] {
    if (!isNightTime(nowIso.value)) return []
    const cutoff = addHours(nowIso.value, -NIGHT_BATCH_WINDOW_HOURS)
    return requests.value
      .filter((r) => r.itemId === itemId && r.status === 'waiting' && !r.batchId && r.createdAt >= cutoff)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  }

  /** 当晚志愿者剩余代送名额：NIGHT_DELIVERY_CAPACITY 减去进行中的代送单 */
  function nightDeliveryCapacity(): number {
    const inFlight = requests.value.filter(
      (r) => ['confirmed', 'handing'].includes(r.status) && r.method === 'volunteer_delivery',
    ).length
    return Math.max(0, NIGHT_DELIVERY_CAPACITY - inFlight)
  }

  /** 同类/同用途替代用品（退热贴可由即冷冰袋等物理降温用品替代） */
  function alternativeItemsFor(category: Item['category'], applicantId: string, excludeItemId: string): AlternativeItem[] {
    const user = DEMO_USERS.find((u) => u.id === applicantId)
    return items.value
      .filter(
        (i) =>
          i.id !== excludeItemId &&
          ['published', 'partially_lent'].includes(i.status) &&
          daysUntil(i.expiryDate, nowIso.value) >= 0 &&
          availableQty(i.id) > 0 &&
          (i.category === category || (category === 'fever_patch' && /冰袋|冷敷|降温/.test(i.name))),
      )
      .map((i) => ({
        id: i.id,
        name: i.name,
        spec: i.spec,
        availableQty: availableQty(i.id),
        distanceMeters: user ? estimateDistanceMeters(user, i.location) : 0,
      }))
  }

  /** 志愿者生成一次夜间分配建议（先出建议、留痕，再由志愿者/工作人员一键执行） */
  function generateAllocationBatch(itemId: string): { ok: boolean; message: string; batchId?: string } {
    if (!isVolunteer.value) return { ok: false, message: '只有志愿者/工作人员可以生成夜间分配建议。' }
    const it = requireItem(itemId)
    const peers = nightConcurrent(itemId)
    if (!isNightTime(nowIso.value)) return { ok: false, message: '当前不是夜间时段（20:00–次日06:00），多人同时申请分配建议仅在夜间启用。' }
    if (peers.length < NIGHT_BATCH_MIN_APPLICANTS) return { ok: false, message: `同一物品至少 ${NIGHT_BATCH_MIN_APPLICANTS} 户在 ${NIGHT_BATCH_WINDOW_HOURS} 小时内同时申请，才会生成夜间分配建议。` }

    const applicants: NightApplicant[] = peers.map((r) => ({
      requestId: r.id,
      applicantId: r.applicantId,
      applicantName: r.applicantName,
      urgency: r.urgency ?? 'normal',
      hasChild: !!r.hasChild,
      symptom: r.symptom,
      distanceMeters: r.distanceMeters ?? 0,
      quantity: r.quantity,
      method: r.method,
      createdAt: r.createdAt,
    }))

    const result = buildAllocationSuggestion({
      item: { id: it.id, name: it.name, location: it.location },
      stockQty: availableQty(it.id),
      applicants,
      deliveryCapacity: nightDeliveryCapacity(),
      alternativesFor: (a) => alternativeItemsFor(it.category, a.applicantId, it.id),
      mutualAidPoints: mutualAidPoints.value,
      now: nowIso.value,
    })

    const firstAt = peers[0].createdAt.replace('T', ' ').slice(5, 16)
    const lastAt = peers[peers.length - 1].createdAt.replace('T', ' ').slice(5, 16)
    const batch = reactive<AllocationBatch>({
      id: uid('b'),
      itemId: it.id,
      itemName: `${it.name}（${it.spec}）`,
      at: nowIso.value,
      windowLabel: `${firstAt}–${lastAt}，约 ${NIGHT_BATCH_WINDOW_HOURS} 小时内 ${peers.length} 户同时申请（夜间时段）`,
      stockQty: availableQty(it.id),
      deliveryCapacity: nightDeliveryCapacity(),
      decisions: result.decisions,
    })
    batches.value.unshift(batch)
    for (const r of peers) r.batchId = batch.id
    addEvent({
      itemId: it.id,
      at: nowIso.value,
      actorId: currentUserId.value,
      actorName: currentUser.value.name,
      kind: 'allocation_suggested',
      detail: `夜间多人同时申请分配建议：${batch.windowLabel}；可分配 ${batch.stockQty} 盒、代送运力 ${batch.deliveryCapacity} 单，建议分给 ${result.decisions.filter((d) => d.suggestion === 'allocate').map((d) => d.applicantName).join('、') || '（库存/运力均不足，无家庭可分配）'}`,
    })
    persist()
    return { ok: true, message: `已生成分配建议：${result.allocatedCount} 户建议分配、${result.unmetCount} 户需转互助/替代/补发。核对评分理由后可一键执行。`, batchId: batch.id }
  }

  /** 执行分配建议：分到的确认锁库存；未分到的保留求助记录 */
  function executeAllocation(batchId: string): ActionResult {
    if (!isVolunteer.value) return { ok: false, message: '只有志愿者/工作人员可以执行分配。' }
    const b = batches.value.find((x) => x.id === batchId)
    if (!b) return { ok: false, message: '分配批次不存在。' }
    if (b.executedAt) return { ok: false, message: '该批次已执行。' }

    b.executedAt = nowIso.value
    b.executorId = currentUserId.value
    b.executorName = currentUser.value.name

    for (const d of b.decisions) {
      const r = requests.value.find((x) => x.id === d.requestId)
      if (!r) continue
      r.allocationRank = d.rank
      if (d.suggestion === 'allocate') {
        if (r.status !== 'waiting' || availableQty(b.itemId) < r.quantity) {
          // 执行时库存已变化：退回求助，不强行锁定
          d.suggestion = 'waiting_backfill'
          d.allocatedQty = 0
          d.reasons.push('执行时余量已变化，未能锁定，转求助记录等待补发。')
        } else {
          r.status = 'confirmed'
          r.confirmedAt = nowIso.value
          r.confirmerId = currentUserId.value
          r.confirmerName = currentUser.value.name
          if (r.method === 'volunteer_delivery') {
            r.volunteerId = currentUserId.value
            r.volunteerName = currentUser.value.name
          }
          refreshItemStatus(b.itemId)
          addEvent({ itemId: b.itemId, requestId: r.id, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'allocated', detail: `夜间分配执行：${d.applicantName} 综合排序第 ${d.rank}（${d.totalScore} 分），分配 ${d.allocatedQty} 盒，已锁定库存待交接` })
          continue
        }
      }
      // 未分配：申请取消（候补本不锁库存），求助记录全程保留
      r.status = 'cancelled'
      r.closedAt = nowIso.value
      r.cancelReason = `夜间分配未中：综合排序第 ${d.rank}（${d.totalScore} 分），${d.capacityBlocked ? '库存可满足但当晚志愿者代送运力已满' : '当晚库存已按评分排序分完'}；已保留求助记录`
      addEvent({ itemId: b.itemId, requestId: r.id, at: nowIso.value, actorId: 'system', actorName: '系统', kind: 'cancelled', detail: `夜间分配未中，候补申请转求助记录：${r.cancelReason}` })
      createHelpFromDecision(b, d, r)
    }
    persist()
    return { ok: true, message: '分配建议已执行：分到的家庭已锁定库存，未分到的家庭已保留求助记录并给出去向建议。' }
  }

  function createHelpFromDecision(b: AllocationBatch, d: AllocationDecision, r: BorrowRequest): HelpRecord {
    const firstOption = d.fallbackOptions[0] ?? '等待库存到货后补发'
    const h: HelpRecord = reactive({
      id: uid('h'),
      batchId: b.id,
      itemId: b.itemId,
      itemName: b.itemName,
      requestId: r.id,
      applicantId: d.applicantId,
      applicantName: d.applicantName,
      urgency: d.urgency,
      hasChild: d.hasChild,
      symptom: d.symptom,
      distanceMeters: d.distanceMeters,
      quantity: d.requestedQty,
      method: r.method,
      createdAt: nowIso.value,
      status: 'pending',
      actions: [],
    })
    h.actions.push({ id: uid('ha'), at: nowIso.value, actorId: b.executorId ?? 'system', actorName: b.executorName ?? '系统', kind: 'created', detail: `夜间分配未中，自动保留求助记录（综合排序第 ${d.rank}，${d.totalScore} 分）；首要去向建议：${firstOption}` })
    addEvent({ itemId: b.itemId, requestId: r.id, at: nowIso.value, actorId: b.executorId ?? 'system', actorName: b.executorName ?? '系统', kind: 'help_created', detail: `为未分到物品的 ${d.applicantName} 保留求助记录：${firstOption}` })
    // critical 家庭执行时同步下发就医提示（提示不是闭环，求助仍保持待跟进）
    if (d.urgency === 'critical') {
      const tip = d.fallbackOptions.find((x) => x.startsWith('就医提示'))
      h.actions.push({ id: uid('ha'), at: nowIso.value, actorId: b.executorId ?? 'system', actorName: b.executorName ?? '系统', kind: 'medical_tip', detail: tip ?? '持续高热不退/精神差/抽搐/呼吸异常请立即就医或拨打 120，退热用品仅为辅助。' })
      addEvent({ itemId: b.itemId, requestId: r.id, at: nowIso.value, actorId: b.executorId ?? 'system', actorName: b.executorName ?? '系统', kind: 'medical_tip', detail: `向 ${d.applicantName} 下发夜间就医提示` })
    }
    helpRecords.value.unshift(h)
    return h
  }

  function requireHelp(helpId: string): HelpRecord {
    const h = helpRecords.value.find((x) => x.id === helpId)
    if (!h) throw new ActionError('求助记录不存在。')
    return h
  }

  function logHelp(h: HelpRecord, kind: HelpRecord['actions'][number]['kind'], detail: string, eventKind: TimelineEvent['kind'] | null) {
    h.actions.push({ id: uid('ha'), at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind, detail })
    if (eventKind) addEvent({ itemId: h.itemId, requestId: h.requestId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: eventKind, detail: `求助记录（${h.applicantName}）：${detail}` })
  }

  /** 转相邻小区互助：登记协调结果并占用对方小区互助库存（不占本小区库存） */
  function transferToMutualAid(helpId: string, pointId: string, note?: string): ActionResult {
    if (!isVolunteer.value) return { ok: false, message: '仅志愿者/工作人员可登记跨小区互助协调。' }
    const h = requireHelp(helpId)
    if (h.status !== 'pending') return { ok: false, message: '该求助记录已结束。' }
    const point = mutualAidPoints.value.find((p) => p.id === pointId)
    if (!point) return { ok: false, message: '未找到该相邻小区互助点。' }
    const category = itemsById.value.get(h.itemId)?.category
    const stock = point.stocks.find((s) => (!category || s.category === category) && s.quantity >= h.quantity && daysUntil(s.expiryDate, nowIso.value) >= 0)
    if (!stock) return { ok: false, message: `该互助点已无在有效期内的同类（${category ?? '所需物品'}）余量。` }
    stock.quantity -= h.quantity
    h.status = 'mutual_aid_transfer'
    h.resolvedAt = nowIso.value
    h.mutualAidCommunity = point.community
    logHelp(h, 'transfer_mutual_aid', `协调「${point.community}」预留${stock.name} ${stock.spec} ×${h.quantity}（距本小区约 ${point.distanceMeters} 米，联系人 ${point.contact}）${note ? `；${note}` : ''}；家属自行取走，问题解决。`, 'help_mutual_aid')
    persist()
    return { ok: true, message: `已转「${point.community}」互助解决，求助记录标记为已协调。` }
  }

  /** 返回某物品在相邻小区仍有在效期余量的互助点（供页面下拉） */
  function mutualAidPointsForItem(itemId: string): MutualAidPoint[] {
    const category = itemsById.value.get(itemId)?.category
    if (!category) return []
    return mutualAidPoints.value.filter((p) => p.stocks.some((s) => s.category === category && s.quantity > 0 && daysUntil(s.expiryDate, nowIso.value) >= 0))
  }

  /** 改选替代用品：直接为该居民生成一笔已确认的替代用品借用并锁库存 */
  function chooseAlternative(helpId: string, altItemId: string): ActionResult {
    if (!isVolunteer.value) return { ok: false, message: '仅志愿者/工作人员可代为改选替代用品。' }
    const h = requireHelp(helpId)
    if (h.status !== 'pending') return { ok: false, message: '该求助记录已结束。' }
    const alt = items.value.find((i) => i.id === altItemId)
    if (!alt || availableQty(alt.id) < h.quantity) return { ok: false, message: '替代用品余量不足。' }
    const req: BorrowRequest = reactive({
      id: uid('r'),
      itemId: alt.id,
      applicantId: h.applicantId,
      applicantName: h.applicantName,
      scene: 'child_night_fever',
      quantity: h.quantity,
      method: h.method ?? 'self_pickup',
      note: `夜间未分到「${h.itemName}」，改选替代用品「${alt.name}」`,
      status: 'confirmed',
      createdAt: nowIso.value,
      confirmedAt: nowIso.value,
      confirmerId: currentUserId.value,
      confirmerName: currentUser.value.name,
    })
    requests.value.unshift(req)
    refreshItemStatus(alt.id)
    h.status = 'alternative'
    h.resolvedAt = nowIso.value
    h.alternativeItemId = alt.id
    logHelp(h, 'choose_alternative', `已为 ${h.applicantName} 改申请本小区替代用品「${alt.name} ${alt.spec}」×${h.quantity}，库存已锁定，可按原方式交接。`, 'help_alternative')
    persist()
    return { ok: true, message: `已改选「${alt.name}」并锁定库存。` }
  }

  /** 补发就医提示（不改变求助状态，提示本身不是闭环） */
  function sendMedicalTip(helpId: string, customNote?: string): ActionResult {
    const h = requireHelp(helpId)
    if (h.status !== 'pending') return { ok: false, message: '该求助记录已结束。' }
    if (!isVolunteer.value && currentUserId.value !== h.applicantId) return { ok: false, message: '仅志愿者或本人可操作。' }
    logHelp(h, 'medical_tip', customNote || '电话/消息提示：持续高热不退、精神差、抽搐或呼吸异常请立即就医或拨打 120；可温水擦浴物理降温，退热用品仅为辅助、不替代诊治。', 'medical_tip')
    persist()
    return { ok: true, message: '就医提示已记录并发送（求助记录继续保留，不视为已解决）。' }
  }

  /** 库存到货/释放后为求助记录安排补发（生成一笔已确认的补发借用） */
  function arrangeBackfill(helpId: string): ActionResult {
    if (!isVolunteer.value) return { ok: false, message: '仅志愿者/工作人员可安排补发。' }
    const h = requireHelp(helpId)
    if (h.status !== 'pending') return { ok: false, message: '该求助记录已结束或已安排补发。' }
    if (availableQty(h.itemId) < h.quantity) return { ok: false, message: `原物品当前可借余量不足（需 ${h.quantity}），等新货上架或他人归还后再补发。` }
    const req: BorrowRequest = reactive({
      id: uid('r'),
      itemId: h.itemId,
      applicantId: h.applicantId,
      applicantName: h.applicantName,
      scene: 'child_night_fever',
      quantity: h.quantity,
      method: h.method ?? 'self_pickup',
      note: '库存到货后按夜间求助记录补发，无需重新申请',
      status: 'confirmed',
      createdAt: nowIso.value,
      confirmedAt: nowIso.value,
      confirmerId: currentUserId.value,
      confirmerName: currentUser.value.name,
    })
    if (req.method === 'volunteer_delivery') {
      req.volunteerId = currentUserId.value
      req.volunteerName = currentUser.value.name
    }
    requests.value.unshift(req)
    refreshItemStatus(h.itemId)
    h.backfillRequestId = req.id
    logHelp(h, 'restock_backfill', `库存到货/释放，按求助记录为 ${h.applicantName} 补发 ×${h.quantity}，已锁定库存生成借用单，等待交接。`, 'restocked')
    persist()
    return { ok: true, message: '已按求助记录安排补发并锁定库存，完成交接后该求助自动闭环。' }
  }

  /** 标记补发交接完成（演示：志愿者可一键标记） */
  function completeBackfill(helpId: string): ActionResult {
    if (!isVolunteer.value) return { ok: false, message: '仅志愿者/工作人员可标记补发完成。' }
    const h = requireHelp(helpId)
    if (!h.backfillRequestId) return { ok: false, message: '尚未安排补发。' }
    const req = requests.value.find((r) => r.id === h.backfillRequestId)
    if (!req) return { ok: false, message: '补发借用单不存在。' }
    if (req.status === 'confirmed') {
      req.status = 'handing'
      req.handingAt = nowIso.value
    }
    req.status = 'completed'
    req.completedAt = nowIso.value
    req.handoverPhoto = `backfill-${req.id}.jpg（演示凭证：到货补发交接拍照）`
    req.handoverNote = '按夜间求助记录补发，包装封签完好。'
    h.status = 'backfilled'
    h.resolvedAt = nowIso.value
    logHelp(h, 'delivered_backfill', `补发物品已交到 ${h.applicantName} 手中并拍照确认，求助记录闭环。`, 'backfilled')
    persist()
    return { ok: true, message: '补发已完成，求助记录闭环。' }
  }

  /** 居民/志愿者关闭求助（已自行购买等） */
  function closeHelp(helpId: string, note?: string): ActionResult {
    const h = requireHelp(helpId)
    if (h.status !== 'pending') return { ok: false, message: '该求助记录已结束。' }
    if (!isVolunteer.value && currentUserId.value !== h.applicantId) return { ok: false, message: '仅志愿者或本人可关闭。' }
    h.status = 'closed'
    h.resolvedAt = nowIso.value
    logHelp(h, 'close', note || '居民表示已自行解决（如自行购买/症状缓解），关闭求助；记录保留用于夜间短缺复盘。', null)
    persist()
    return { ok: true, message: '求助记录已关闭（仍保留在复盘数据中）。' }
  }

  // ---- 质疑：居民对分配结果提出，社区答复（理由全部可查）----
  function openDispute(helpId: string, reason: string): ActionResult {
    const h = requireHelp(helpId)
    if (currentUserId.value !== h.applicantId && !isStaff.value) return { ok: false, message: '仅本人可以对该分配结果提出质疑。' }
    if (!reason.trim()) return { ok: false, message: '请填写质疑原因。' }
    const dp: DisputeRecord = reactive({
      id: uid('dp'),
      batchId: h.batchId ?? '',
      itemId: h.itemId,
      helpRecordId: h.id,
      requestId: h.requestId,
      applicantId: h.applicantId,
      applicantName: h.applicantName,
      reason,
      createdAt: nowIso.value,
      status: 'open',
    })
    disputes.value.unshift(dp)
    h.disputeId = dp.id
    logHelp(h, 'dispute_opened', `居民提出质疑：${reason}`, 'dispute_opened')
    persist()
    return { ok: true, message: '质疑已提交给社区工作人员，答复会附完整评分与分配理由。' }
  }

  function replyDispute(disputeId: string, reply: string): ActionResult {
    if (!isStaff.value) return { ok: false, message: '只有社区工作人员可以答复质疑。' }
    const dp = disputes.value.find((x) => x.id === disputeId)
    if (!dp || dp.status !== 'open') return { ok: false, message: '质疑不存在或已答复。' }
    if (!reply.trim()) return { ok: false, message: '请填写答复内容。' }
    dp.status = 'replied'
    dp.reply = reply
    dp.repliedAt = nowIso.value
    dp.replierId = currentUserId.value
    dp.replierName = currentUser.value.name
    if (dp.helpRecordId) {
      const h = helpRecords.value.find((x) => x.id === dp.helpRecordId)
      if (h) logHelp(h, 'dispute_replied', `社区答复质疑：${reply}`, 'dispute_replied')
    } else {
      addEvent({ itemId: dp.itemId, requestId: dp.requestId, at: nowIso.value, actorId: currentUserId.value, actorName: currentUser.value.name, kind: 'dispute_replied', detail: `社区答复 ${dp.applicantName} 的质疑：${reply}` })
    }
    persist()
    return { ok: true, message: '质疑已答复，居民端可看到完整评分理由与答复。' }
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
      pendingHelp: pendingHelpList.value.length,
      openDisputes: openDisputes.value.length,
      nightBatches: batches.value.length,
    }
  })

  function itemTimeline(itemId: string): TimelineEvent[] {
    return timeline.value.filter((e) => e.itemId === itemId).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  }
  function itemRequests(itemId: string): BorrowRequest[] {
    return requests.value.filter((r) => r.itemId === itemId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }
  function batchesOfItem(itemId: string): AllocationBatch[] {
    return batches.value.filter((b) => b.itemId === itemId).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  }
  function helpRecordsOf(user?: { applicantId?: string; itemId?: string }): HelpRecord[] {
    return helpRecords.value
      .filter((h) => (user?.applicantId ? h.applicantId === user.applicantId : true))
      .filter((h) => (user?.itemId ? h.itemId === user.itemId : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }

  const openDisputes = computed(() =>
    disputes.value.filter((d) => d.status === 'open').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  )
  const pendingHelpList = computed(() =>
    helpRecords.value.filter((h) => h.status === 'pending').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  )

  /** 夜间短缺复盘：每个批次的真实需求、满足情况、求助去向 */
  const shortageReview = computed(() =>
    batches.value
      .map((b) => {
        const total = b.decisions.length
        const allocated = b.decisions.filter((d) => d.suggestion === 'allocate').length
        const unmet = total - allocated
        const helps = helpRecords.value.filter((h) => h.batchId === b.id)
        const capacityBlocked = b.decisions.filter((d) => d.capacityBlocked).length
        return {
          batch: b,
          total,
          allocated,
          unmet,
          capacityBlocked,
          byMutualAid: helps.filter((h) => h.status === 'mutual_aid_transfer').length,
          byAlternative: helps.filter((h) => h.status === 'alternative').length,
          byBackfill: helps.filter((h) => h.status === 'backfilled').length,
          pending: helps.filter((h) => h.status === 'pending').length,
          closed: helps.filter((h) => h.status === 'closed').length,
          criticalUnmet: b.decisions.filter((d) => d.suggestion !== 'allocate' && d.urgency === 'critical').length,
        }
      })
      .sort((a, b) => (a.batch.at < b.batch.at ? 1 : a.batch.at > b.batch.at ? -1 : 0)),
  )

  return {
    // state
    nowIso,
    currentUserId,
    users,
    items,
    requests,
    feedbacks,
    timeline,
    batches,
    helpRecords,
    disputes,
    mutualAidPoints,
    // getters
    currentUser,
    isVolunteer,
    isStaff,
    reviewQueue,
    openFeedbackList,
    expiredListed,
    expiringSoon,
    overduePickups,
    delayedDeliveries,
    stats,
    openDisputes,
    pendingHelpList,
    shortageReview,
    // actions
    advanceHours,
    resetDemo,
    switchUser,
    availableQty,
    lockedQty,
    lockedList,
    waitingList,
    nightConcurrent,
    nightDeliveryCapacity,
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
    // 夜间分配
    generateAllocationBatch,
    executeAllocation,
    // 求助记录
    transferToMutualAid,
    chooseAlternative,
    sendMedicalTip,
    arrangeBackfill,
    completeBackfill,
    closeHelp,
    helpRecordsOf,
    batchesOfItem,
    mutualAidPointsForItem,
    // 质疑
    openDispute,
    replyDispute,
    itemTimeline,
    itemRequests,
  }
})
