import type {
  AidRoute,
  AllocationRound,
  BorrowRequest,
  Category,
  FeedbackType,
  HandoverMethod,
  ItemDraft,
  ItemStatus,
  RequestStatus,
  Scene,
  ScoreBreakdown,
  StorageCondition,
  UrgencyLevel,
} from '@/types'
import { daysUntil } from '@/utils/date'

// ---- 标签字典 ----
export const CATEGORY_LABELS: Record<Category, string> = {
  fever_patch: '退热贴',
  iodophor: '碘伏（棉片/棉签/消毒液）',
  gauze: '纱布',
  bandage: '创可贴',
  mask: '口罩',
  thermometer_battery: '体温计纽扣电池',
  other_consumable: '其他非处方耗材（需审核）',
}

export const CATEGORY_ICONS: Record<Category, string> = {
  fever_patch: '🧊',
  iodophor: '🧴',
  gauze: '🩹',
  bandage: '🩹',
  mask: '😷',
  thermometer_battery: '🔋',
  other_consumable: '📦',
}

export const SCENE_LABELS: Record<Scene, string> = {
  child_night_fever: '孩子夜间发烧（物理降温/测温）',
  elderly_wound: '老人小伤口处理（清洁/包扎）',
  no_mask: '临时缺口罩',
  home_care: '居家护理缺耗材',
}

export const SCENE_HINTS: Record<Scene, string> = {
  child_night_fever: '退热贴、体温计电池等辅助用品；持续高热请及时就医，共享箱不提供退烧药。',
  elderly_wound: '碘伏、纱布、创可贴仅用于浅表小伤口；伤口较深、出血不止或化脓请就医。',
  no_mask: '未拆封的一次性口罩，请注意包装完好与效期。',
  home_care: '护理耗材临时周转；不涉及注射、处方与任何拆封药品。',
}

export const STORAGE_LABELS: Record<StorageCondition, string> = {
  room_temp: '常温避光',
  cool_dry: '阴凉干燥',
  refrigerate: '冷藏（冷链）',
}

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pending_review: '待志愿者审核',
  rejected: '审核未通过',
  published: '可借',
  partially_lent: '部分外借中',
  lent_out: '已借完/外借中',
  quarantined: '风险隔离待核',
  recalled: '共享人已撤回',
  scrapped: '已报废',
}

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  waiting: '候补中',
  confirmed: '已确认待交接',
  handing: '交接中',
  completed: '已取走，待归还/补充',
  closed_returned: '已闭环',
  cancelled: '已取消',
}

export const METHOD_LABELS: Record<HandoverMethod, string> = {
  self_pickup: '自取',
  volunteer_delivery: '志愿者代送',
  door_contactless: '邻居门口无接触交接',
}

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  package_damaged: '包装破损',
  adverse_reaction: '疑似使用后不适',
  other: '其他问题',
}

export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  child_high_fever: '儿童高热（实测≥39℃ 或精神差）',
  fever: '正在发烧，急需物理降温',
  low_fever: '低热观察或刚发现发烧',
  spare: '只是家庭备货，暂不急用',
}

/** 紧急程度基础分（最大因子） */
export const URGENCY_POINTS: Record<UrgencyLevel, number> = {
  child_high_fever: 50,
  fever: 32,
  low_fever: 14,
  spare: 0,
}

export const AID_ROUTE_LABELS: Record<AidRoute, string> = {
  neighbor_community: '转入相邻小区互助',
  alternative: '选择替代用品先物理降温',
  medical_advice: '收到就医提示（持续高热/精神差）',
}

export const AID_ROUTE_HINTS: Record<AidRoute, string> = {
  neighbor_community: '已把你的夜间求助同步给相邻小区共享点，有库存的小区志愿者会接单代送。',
  alternative: '建议先用凉毛巾敷额头、温水擦拭颈部/腋下/腹股沟、减少捂盖、少量多次饮水，并持续测温。',
  medical_advice: '儿童高热不退、伴精神萎靡/抽搐/呼吸急促时，退热贴只是辅助，请立即前往医院夜间急诊。',
}

export const CLOSE_MODE_LABELS = {
  return_sealed: '归还原物（未拆封）',
  restock_new: '补充同规格新品',
  mutual_aid: '邻里赠予，无需归还',
} as const

// ---- 业务规则参数 ----
/** 效期预警阈值（天） */
export const EXPIRY_WARN_DAYS = 60
export const EXPIRY_DANGER_DAYS = 30
/** 确认后取走/完成交接的时限（小时） */
export const PICKUP_WINDOW_HOURS = 24
/** 志愿者配送承诺时限（小时） */
export const DELIVERY_SLA_HOURS = 6

export type ExpiryLevel = 'expired' | 'danger' | 'warn' | 'ok'

export function expiryLevel(expiryDate: string, now: string | Date): ExpiryLevel {
  const d = daysUntil(expiryDate, now)
  if (d < 0) return 'expired'
  if (d <= EXPIRY_DANGER_DAYS) return 'danger'
  if (d <= EXPIRY_WARN_DAYS) return 'warn'
  return 'ok'
}

export const EXPIRY_LEVEL_TEXT: Record<ExpiryLevel, string> = {
  expired: '已过期',
  danger: '临近效期（≤30天）',
  warn: '效期不足60天',
  ok: '效期正常',
}

// ---- 禁入规则：处方药 / 拆封药品 / 冷链药品 不能进入共享 ----
/** 名称中出现这些词，判定为疑似药品（含处方药），一律禁入 */
const FORBIDDEN_NAME_KEYWORDS = [
  '处方',
  '胶囊',
  '颗粒',
  '口服液',
  '混悬',
  '注射液',
  '输液',
  '抗生素',
  '头孢',
  '阿莫西林',
  '布洛芬',
  '对乙酰氨基酚',
  '退烧药',
  '降压',
  '降糖',
  '药片',
]

export interface DraftValidation {
  errors: string[]
  warnings: string[]
}

export function validateDraft(draft: ItemDraft, now: string | Date): DraftValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!draft.name.trim()) errors.push('请填写品名。')
  if (!draft.spec.trim()) errors.push('请填写规格（如 4片/盒、50只/盒）。')
  if (!draft.expiryDate) {
    errors.push('请选择有效期。')
  } else {
    const d = daysUntil(draft.expiryDate, now)
    if (d < 0) errors.push('该物品已过期（超过有效期），不能登记共享，应按有害/医疗垃圾处理。')
    else if (d <= EXPIRY_DANGER_DAYS) warnings.push(`距有效期不足 ${EXPIRY_DANGER_DAYS} 天，审核时将重点确认，可能无法发布。`)
    else if (d <= EXPIRY_WARN_DAYS) warnings.push(`距有效期不足 ${EXPIRY_WARN_DAYS} 天，借用页面会显著提示效期。`)
  }
  if (!draft.location.trim()) errors.push('请填写取用地点（如 3号楼1单元门口共享柜）。')
  if (!draft.quantity || draft.quantity <= 0) errors.push('可借数量需大于 0。')
  if (draft.quantity > 999) errors.push('数量异常，请确认后重新填写。')
  if (draft.sealed === false) {
    errors.push('拆封物品不能进入共享：请只登记整盒/整包未开封的物品。')
  }
  if (draft.storage === 'refrigerate') {
    errors.push('冷链/冷藏药品不能进入共享，脱离冷链存在安全风险。')
  }
  const hit = FORBIDDEN_NAME_KEYWORDS.find((k) => draft.name.includes(k))
  if (hit) {
    errors.push(`「${draft.name}」疑似药品/处方药（命中“${hit}”）。共享箱仅限未拆封非处方耗材，处方药与口服/注射药品一律不能进入。`)
  }
  if (draft.category === 'other_consumable') {
    warnings.push('“其他非处方耗材”需要志愿者与社区工作人员双重确认后才能发布。')
  }
  if (draft.sceneTags.length === 0) warnings.push('未选择适用场景，将较难被有需要的邻居检索到。')
  return { errors, warnings }
}

/** 占用库存的申请状态：确认后即锁定，直到取消或闭环（归还/补充/赠予）才释放 */
export const STOCK_LOCKING_STATUSES: RequestStatus[] = ['confirmed', 'handing', 'completed']

export function isTerminalItemStatus(status: ItemStatus): boolean {
  return status === 'rejected' || status === 'recalled' || status === 'scrapped'
}

// ===========================================================================
// 夜间多人同时申请同一物品（如退热贴）的分配规则
// 评分因子（全部可解释，社区端可逐项答复居民质疑）：
//   1. 紧急程度 urgency      0 / 14 / 32 / 50 分
//   2. 家中是否有儿童       有儿童 +20 分
//   3. 距离（步行米数）      ≤200m +15 / ≤500m +10 / ≤1000m +5 / 更远 0
//   4. 志愿者配送能力        需要代送且今晚仍有在岗运力 +10 分
//   5. 申请先后（同分微调） 越早申请次序分越高，保证排序稳定可解释
// 库存切分：按总分从高到低，逐单整盒锁定；剩余库存不足一单时跳过该单继续看后面，
// 未分到的居民保留求助记录，并给出三条出路（相邻小区/替代用品/就医提示）。
// ===========================================================================

export const ALLOCATION_RULE_VERSION = 'night-allocation-v1'

/** 有儿童加分 */
export const CHILD_POINTS = 20
/** 距离分档（米，含端点） */
export const DISTANCE_TIERS: { maxMeters: number; points: number; label: string }[] = [
  { maxMeters: 200, points: 15, label: '200 米以内' },
  { maxMeters: 500, points: 10, label: '500 米以内' },
  { maxMeters: 1000, points: 5, label: '1 公里以内' },
]
export const DISTANCE_FAR_POINTS = 0
/** 志愿者夜间可配送时，代送申请的加分 */
export const DELIVERY_POINTS = 10

export function distancePointsOf(meters: number | undefined): { points: number; label: string } {
  const m = meters ?? Number.POSITIVE_INFINITY
  const hit = DISTANCE_TIERS.find((t) => m <= t.maxMeters)
  return hit ? { points: hit.points, label: hit.label } : { points: DISTANCE_FAR_POINTS, label: '超过 1 公里' }
}

export interface ScoredRequest {
  req: BorrowRequest
  score: number
  details: ScoreBreakdown
}

export interface AllocationPlan {
  ranked: ScoredRequest[]
  allocatedRequestIds: string[]
  unallocatedRequestIds: string[]
  /** 评分后实际使用的志愿者配送单数（不超过运力） */
  deliveryUsed: number
  volunteerCapacity: number
  availableQty: number
}

/**
 * 计算一单申请的评分明细。deliveryBonus 由 planAllocation 按今晚运力统一分配。
 */
export function scoreRequest(
  req: BorrowRequest,
  ctx: { orderIndex: number; total: number; deliveryBonus: boolean },
): ScoredRequest {
  const reasons: string[] = []

  const urgencyPoints = URGENCY_POINTS[req.urgency ?? 'spare']
  reasons.push(`紧急程度「${URGENCY_LABELS[req.urgency ?? 'spare']}」${urgencyPoints} 分`)

  const childPoints = req.hasChild ? CHILD_POINTS : 0
  reasons.push(
    req.hasChild
      ? `家中有儿童需使用（${req.childAge ? `${req.childAge} 岁，` : ''}${req.temperature ? `实测 ${req.temperature}℃，` : ''}更需优先）+${CHILD_POINTS} 分`
      : '非儿童使用 +0 分',
  )

  const d = distancePointsOf(req.distanceMeters)
  const distancePoints = d.points
  reasons.push(
    req.distanceMeters != null
      ? `距取用点约 ${req.distanceMeters} 米（${d.label}，夜间取送更快）+${d.points} 分`
      : `未填距离，按最远处理（${d.label}）+${d.points} 分`,
  )

  // 越早申请次序分越高（最多 0.9 分，只用于同分时稳定排序，不会改变主因子排序）
  // orderIndex 由 planAllocation 按“申请时间先后”统一编号；直接调用时按入参给出。
  const orderPoints = Number(Math.max(0, (ctx.total - 1 - ctx.orderIndex) * 0.1).toFixed(2))

  const getsDeliveryBonus = ctx.deliveryBonus && req.method === 'volunteer_delivery'
  const deliveryPoints = getsDeliveryBonus ? DELIVERY_POINTS : 0
  if (req.method === 'volunteer_delivery') {
    reasons.push(ctx.deliveryBonus ? `申请志愿者代送且今晚仍有配送运力 +${DELIVERY_POINTS} 分` : '申请志愿者代送，但今晚配送运力已排满 +0 分')
  } else {
    reasons.push('自取/门口交接，不占用夜间配送运力 +0 分')
  }

  const score = Number((urgencyPoints + childPoints + distancePoints + deliveryPoints + orderPoints).toFixed(2))
  return {
    req,
    score,
    details: { urgencyPoints, childPoints, distancePoints, deliveryPoints, orderPoints, reasons },
  }
}

/**
 * 夜间争抢分配：按因子评分排序，再按库存逐单切分。
 * 志愿者运力只够前 N 个“代送”申请拿到配送加分，N 之后的代送申请转为 0 分并在理由中说明。
 */
export function planAllocation(input: {
  requests: BorrowRequest[]
  availableQty: number
  volunteerCapacity: number
}): AllocationPlan {
  const { requests, availableQty, volunteerCapacity } = input
  const total = requests.length

  // 先按“不含配送分”的基础分排序，决定谁能占用今晚有限的配送运力
  const baseRanked = requests
    .map((req, orderIndex) => ({ req, base: scoreRequest(req, { orderIndex, total, deliveryBonus: false }) }))
    .sort((a, b) => b.base.score - a.base.score || (a.req.createdAt < b.req.createdAt ? -1 : 1))

  let deliveryLeft = Math.max(0, volunteerCapacity)
  const deliveryBonusIds = new Set<string>()
  for (const x of baseRanked) {
    if (deliveryLeft <= 0) break
    if (x.req.method === 'volunteer_delivery') {
      deliveryBonusIds.add(x.req.id)
      deliveryLeft -= 1
    }
  }
  const deliveryUsed = Math.max(0, volunteerCapacity - deliveryLeft)

  // 次序分只与“申请时间先后”有关，与输入数组顺序无关：越早申请编号越小
  const byApplyTime = [...requests].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  const orderByTime = new Map(byApplyTime.map((r, i) => [r.id, i]))
  const ranked = requests
    .map((req) => scoreRequest(req, { orderIndex: orderByTime.get(req.id) ?? 0, total, deliveryBonus: deliveryBonusIds.has(req.id) }))
    .sort((a, b) => b.score - a.score || (a.req.createdAt < b.req.createdAt ? -1 : 1))

  // 按库存逐单整盒切分；库存不足一单时跳过，继续尝试后面的申请
  let stock = Math.max(0, availableQty)
  const allocatedRequestIds: string[] = []
  for (const x of ranked) {
    if (stock >= x.req.quantity) {
      allocatedRequestIds.push(x.req.id)
      stock -= x.req.quantity
    }
  }
  const allocatedSet = new Set(allocatedRequestIds)
  const unallocatedRequestIds = ranked.filter((x) => !allocatedSet.has(x.req.id)).map((x) => x.req.id)

  return { ranked, allocatedRequestIds, unallocatedRequestIds, deliveryUsed, volunteerCapacity, availableQty }
}

/** 把评分结果组织成社区端可直接展示/答复质疑的分配理由 */
export function buildAllocationSummary(itemName: string, plan: AllocationPlan): string {
  const lines: string[] = []
  lines.push(
    `本轮「${itemName}」可借库存 ${plan.availableQty} 盒，夜间在岗配送运力 ${plan.volunteerCapacity} 单（实际占用 ${plan.deliveryUsed} 单），共 ${plan.ranked.length} 户同时申请；按紧急程度→是否有儿童→距离→配送能力→申请先后评分：`,
  )
  plan.ranked.forEach((x, i) => {
    const got = plan.allocatedRequestIds.includes(x.req.id)
    const temp = x.req.temperature ? `，实测 ${x.req.temperature}℃` : ''
    lines.push(
      `${i + 1}. ${x.req.applicantName}（${x.req.address ?? '地址未填'}，${x.req.distanceMeters ?? '?'}m${temp}）总分 ${x.score}：${x.details.reasons.join('；')} → ${got ? `建议分配 ×${x.req.quantity}` : '库存不足，不予分配，保留求助记录并给出相邻小区/替代用品/就医提示'}`,
    )
  })
  return lines.join('\n')
}

/** 组装一轮分配记录（不含 id/时间，由 store 补充） */
export function buildAllocationRoundDraft(
  itemId: string,
  itemName: string,
  plan: AllocationPlan,
): Omit<AllocationRound, 'id' | 'createdAt' | 'createdBy' | 'createdByName'> {
  return {
    itemId,
    requestIds: plan.ranked.map((x) => x.req.id),
    allocatedRequestIds: plan.allocatedRequestIds,
    unallocatedRequestIds: plan.unallocatedRequestIds,
    availableQty: plan.availableQty,
    volunteerCapacity: plan.volunteerCapacity,
    status: 'suggested',
    ruleVersion: ALLOCATION_RULE_VERSION,
    summary: buildAllocationSummary(itemName, plan),
  }
}

/** 未分到物品时，根据紧急程度给出默认出路建议（居民可自行改选） */
export function suggestedAidRoute(req: BorrowRequest): AidRoute {
  if (req.urgency === 'child_high_fever') return 'medical_advice'
  if (req.urgency === 'spare') return 'alternative'
  return 'neighbor_community'
}

/** 社区端夜间短缺复盘行：一个未满足求助 = 一条真实需求 */
export interface ShortageRow {
  req: BorrowRequest
  itemName: string
  round?: AllocationRound
}

