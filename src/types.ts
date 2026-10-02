// 社区药箱共享 —— 领域类型定义

/** 可共享品类（白名单：仅限未拆封常备非处方耗材） */
export type Category =
  | 'fever_patch' // 退热贴
  | 'iodophor' // 碘伏（棉片/棉签/消毒液）
  | 'gauze' // 纱布
  | 'bandage' // 创可贴
  | 'mask' // 口罩
  | 'thermometer_battery' // 体温计纽扣电池
  | 'other_consumable' // 其他经审核的非处方耗材

/** 症状/使用场景 */
export type Scene =
  | 'child_night_fever' // 孩子夜间发烧
  | 'elderly_wound' // 老人小伤口处理
  | 'no_mask' // 临时缺口罩
  | 'home_care' // 居家护理缺耗材

/** 存放条件 */
export type StorageCondition = 'room_temp' | 'cool_dry' | 'refrigerate'

/** 物品全流程状态 */
export type ItemStatus =
  | 'pending_review' // 待审核
  | 'rejected' // 审核驳回（不进入共享）
  | 'published' // 已发布，可借
  | 'partially_lent' // 部分借出，仍有可借余量
  | 'lent_out' // 可借余量为 0（外借中，待归还/补充）
  | 'quarantined' // 风险隔离（包装破损/疑似不适反应待核）
  | 'recalled' // 共享人撤回
  | 'scrapped' // 报废（过期/破损/核查不合格）

/** 交接方式 */
export type HandoverMethod = 'self_pickup' | 'volunteer_delivery' | 'door_contactless'

/** 借用申请状态 */
export type RequestStatus =
  | 'waiting' // 排队候补（暂无余量，等待他人取消或归还/夜间分配中）
  | 'confirmed' // 已确认并锁定数量，等待交接
  | 'handing' // 交接中（自取待取 / 配送中 / 已放门口）
  | 'completed' // 已完成（拍照确认）
  | 'closed_returned' // 已闭环：归还/补充完成
  | 'cancelled' // 已取消（超时未取 / 共享人撤回 / 主动取消 / 配送失败 / 转互助 / 改申请替代品）

/** 反馈类型 */
export type FeedbackType = 'package_damaged' | 'adverse_reaction' | 'other'
export type FeedbackStatus = 'open' | 'resolved_scrap' | 'resolved_republish'

/**
 * 夜间多人同时申请时的紧急程度（由申请人自报，志愿者电话核实，社区不做诊断）。
 * critical 仅表示“家属描述的紧急程度最高”，不代表医学诊断结论。
 */
export type UrgencyLevel = 'critical' | 'urgent' | 'normal'

/** 物品登记内容 */
export interface ItemDraft {
  name: string
  category: Category
  spec: string // 规格
  expiryDate: string // YYYY-MM-DD
  storage: StorageCondition
  sealed: boolean // 是否整盒未开封
  quantity: number // 可借数量
  location: string // 取用地点
  sceneTags: Scene[] // 适用场景
  note?: string
}

export interface Item extends ItemDraft {
  id: string
  ownerId: string
  ownerName: string
  status: ItemStatus
  createdAt: string
  publishedAt?: string
  /** 审核记录 */
  review?: { reviewerId: string; reviewerName: string; at: string; approved: boolean; reason?: string }
  /** 最近一次报废/撤回原因 */
  closeReason?: string
}

export interface BorrowRequest {
  id: string
  itemId: string
  applicantId: string
  applicantName: string
  scene: Scene
  quantity: number
  method: HandoverMethod
  note?: string
  status: RequestStatus
  createdAt: string
  confirmedAt?: string
  handingAt?: string
  completedAt?: string
  closedAt?: string
  /** 确认人（共享人/志愿者） */
  confirmerId?: string
  confirmerName?: string
  /** 交接拍照凭证（演示环境用文件名/dataURL 占位） */
  handoverPhoto?: string
  handoverNote?: string
  /** 志愿者配送相关 */
  volunteerId?: string
  volunteerName?: string
  delayReason?: string
  cancelReason?: string
  /** 归还/补充方式 */
  closeMode?: 'return_sealed' | 'restock_new' | 'mutual_aid'
  closeNote?: string

  // ---- 夜间多人同时申请分配相关 ----
  /** 自报紧急程度 */
  urgency?: UrgencyLevel
  /** 家中是否有儿童（用于夜间退热等场景排序） */
  hasChild?: boolean
  /** 症状简述（如“39.2℃，精神差”，仅用于核实与排序，社区不据此诊断） */
  symptom?: string
  /** 申请人住址到取件点的估算距离（米） */
  distanceMeters?: number
  /** 所属夜间分配批次 */
  batchId?: string
  /** 批次内分配名次 */
  allocationRank?: number
}

export interface Feedback {
  id: string
  itemId: string
  requestId?: string
  reporterId: string
  reporterName: string
  type: FeedbackType
  detail: string
  createdAt: string
  status: FeedbackStatus
  handledAt?: string
  handlerId?: string
  handlerName?: string
  handleNote?: string
}

/** 演示用户：居民 / 志愿者 / 社区工作人员 */
export interface DemoUser {
  id: string
  name: string
  role: 'resident' | 'volunteer' | 'staff'
  address: string
  /** 所在小区（默认幸福里小区；其他小区为相邻互助小区） */
  community?: string
  /** 楼栋号（用于夜间距离估算） */
  building?: number
}

/** 相邻小区互助点（库存属于对方小区，仅做协调记录，不进入本小区库存锁定） */
export interface MutualAidStock {
  category: Category
  name: string
  spec: string
  quantity: number
  expiryDate: string
}
export interface MutualAidPoint {
  id: string
  community: string
  /** 距本小区共享柜的步行距离（米） */
  distanceMeters: number
  contact: string
  stocks: MutualAidStock[]
  note?: string
}

/** 求助跟进动作 */
export interface HelpAction {
  id: string
  at: string
  actorId: string
  actorName: string
  kind:
    | 'created' // 夜间分配后保留求助记录
    | 'transfer_mutual_aid' // 转相邻小区互助
    | 'choose_alternative' // 改选替代用品
    | 'medical_tip' // 收到就医提示
    | 'restock_backfill' // 到货后安排补发
    | 'delivered_backfill' // 补发完成
    | 'close' // 居民关闭（不再需要）
    | 'dispute_opened' // 提出质疑
    | 'dispute_replied' // 社区答复质疑
  detail: string
}

/** 求助记录状态：未分到物品的居民诉求持续保留，便于补发与社区复盘 */
export type HelpStatus =
  | 'pending' // 待跟进（仍可到货补发；收到就医提示不算结束）
  | 'mutual_aid_transfer' // 已由相邻小区互助解决
  | 'alternative' // 已改申请本小区替代用品
  | 'backfilled' // 库存到货后已补发
  | 'closed' // 居民自行关闭（已自行购买等）

export interface HelpRecord {
  id: string
  batchId?: string
  itemId: string
  itemName: string
  requestId?: string
  applicantId: string
  applicantName: string
  urgency: UrgencyLevel
  hasChild: boolean
  symptom?: string
  distanceMeters: number
  /** 申请数量（补发时按此数量锁定） */
  quantity: number
  /** 原申请的交接方式（补发/协调替代品时沿用） */
  method?: HandoverMethod
  createdAt: string
  status: HelpStatus
  actions: HelpAction[]
  resolvedAt?: string
  /** 协调去的相邻小区 */
  mutualAidCommunity?: string
  /** 改申请的替代用品 */
  alternativeItemId?: string
  /** 到货补发所生成的借用申请 */
  backfillRequestId?: string
  /** 关联质疑 */
  disputeId?: string
}

/** 分配评分因子（分数与理由全部留痕，社区端可据此答复质疑） */
export interface AllocationFactor {
  key: 'urgency' | 'child' | 'distance' | 'stock' | 'capacity'
  label: string
  score: number
  max: number
  detail: string
}

/** 给单户家庭的分配建议 */
export interface AllocationDecision {
  requestId: string
  applicantId: string
  applicantName: string
  urgency: UrgencyLevel
  hasChild: boolean
  symptom?: string
  distanceMeters: number
  requestedQty: number
  method: HandoverMethod
  totalScore: number
  factors: AllocationFactor[]
  rank: number
  /** allocate=建议分给该户；其余为未分配时的主要去向建议 */
  suggestion: 'allocate' | 'mutual_aid' | 'alternative' | 'medical' | 'waiting_backfill'
  allocatedQty: number
  /** 夜间运力是否卡住（评分足够但志愿者无法代送） */
  capacityBlocked: boolean
  /** 未分配时可走的全部路径 */
  fallbackOptions: string[]
  /** 一条条可读的分配/不分配理由（答复质疑用） */
  reasons: string[]
}

/** 一次夜间多人同时申请的分配批次 */
export interface AllocationBatch {
  id: string
  itemId: string
  itemName: string
  /** 生成建议的时间 */
  at: string
  /** 参与排序的申请创建时间范围说明 */
  windowLabel: string
  /** 当时可分配库存 */
  stockQty: number
  /** 当晚志愿者可承接的代送单数 */
  deliveryCapacity: number
  decisions: AllocationDecision[]
  /** 建议生成后尚未执行 */
  executedAt?: string
  executorId?: string
  executorName?: string
}

/** 居民对分配结果的质疑（社区端处理并回复） */
export interface DisputeRecord {
  id: string
  batchId: string
  itemId: string
  helpRecordId?: string
  requestId?: string
  applicantId: string
  applicantName: string
  reason: string
  createdAt: string
  status: 'open' | 'replied'
  reply?: string
  repliedAt?: string
  replierId?: string
  replierName?: string
}

export interface TimelineEvent {
  id: string
  itemId: string
  requestId?: string
  at: string
  actorId: string
  actorName: string
  kind:
    | 'registered'
    | 'reviewed'
    | 'published'
    | 'applied'
    | 'waitlisted'
    | 'confirmed'
    | 'handover_started'
    | 'handover_confirmed'
    | 'returned'
    | 'restocked'
    | 'recalled'
    | 'scrapped'
    | 'quarantined'
    | 'feedback'
    | 'overdue_flagged'
    | 'delay_flagged'
    | 'cancelled'
    | 'allocation_suggested' // 夜间分配建议生成
    | 'allocated' // 夜间分配执行（单户）
    | 'help_created' // 为未分到的居民保留求助记录
    | 'help_mutual_aid' // 转相邻小区互助
    | 'help_alternative' // 改选替代用品
    | 'medical_tip' // 下发就医提示
    | 'backfilled' // 到货补发
    | 'dispute_opened' // 居民提出质疑
    | 'dispute_replied' // 社区答复质疑
  detail?: string
}
