import type {
  Category,
  FeedbackType,
  HandoverMethod,
  ItemDraft,
  ItemStatus,
  RequestStatus,
  Scene,
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

export const CLOSE_MODE_LABELS = {
  return_sealed: '归还原物（未拆封）',
  restock_new: '补充同规格新品',
  mutual_aid: '邻里赠予，无需归还',
} as const

// ---- 夜间多人同时申请：紧急程度字典 ----
export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  critical: '紧急（持续高热 / 精神差等家属描述的最高紧急度）',
  urgent: '较急（发热明显，需要尽快物理降温）',
  normal: '一般（备着预防，暂无明显症状）',
}

export const URGENCY_SHORT: Record<UrgencyLevel, string> = {
  critical: '紧急',
  urgent: '较急',
  normal: '一般',
}

/** 夜间时段：20:00 - 次日 06:00，触发多人同时申请分配建议 */
export const NIGHT_START_HOUR = 20
export const NIGHT_END_HOUR = 6

export function isNightTime(iso: string | Date): boolean {
  const d = iso instanceof Date ? iso : new Date(iso)
  const h = d.getHours()
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR
}

// ---- 业务规则参数 ----
/** 效期预警阈值（天） */
export const EXPIRY_WARN_DAYS = 60
export const EXPIRY_DANGER_DAYS = 30
/** 确认后取走/完成交接的时限（小时） */
export const PICKUP_WINDOW_HOURS = 24
/** 志愿者配送承诺时限（小时） */
export const DELIVERY_SLA_HOURS = 6

// ---- 夜间多人同时申请的分配评分参数（满分 100）----
/** 紧急程度权重 */
export const SCORE_URGENCY = 40
/** 家中有儿童（夜间退热场景）权重 */
export const SCORE_CHILD = 20
/** 距离权重（越近分越高，最远按 DISTANCE_REF_METERS 线性递减到 0） */
export const SCORE_DISTANCE = 20
/** 库存数量匹配权重（申请数量不超过当前可分配量时给基础分，整盒需求另有说明） */
export const SCORE_STOCK = 10
/** 志愿者配送能力权重（仅在选择志愿者代送时参与；自取/门口交接不受限） */
export const SCORE_CAPACITY = 10
/** 距离评分的参考最远值（米）：超过即距离分为 0 */
export const DISTANCE_REF_METERS = 1200
/** 夜间一位志愿者可承接的代送单数 */
export const NIGHT_DELIVERY_CAPACITY = 2
/** 夜间多户同时申请的触发门槛：同一物品候补中申请数 ≥ 该值 */
export const NIGHT_BATCH_MIN_APPLICANTS = 2
/** 同一物品相邻两笔夜间申请视为“同时”的时间窗（小时） */
export const NIGHT_BATCH_WINDOW_HOURS = 2

export const URGENCY_SCORE: Record<UrgencyLevel, number> = {
  critical: 40,
  urgent: 26,
  normal: 10,
}

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
