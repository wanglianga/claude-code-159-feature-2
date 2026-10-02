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

/** 紧急程度（申请人在表单中自述，社区/志愿者可在物品页核实调整建议） */
export type UrgencyLevel =
  | 'child_high_fever' // 儿童高热（≥39℃）/伴精神差，最优先并同步就医提示
  | 'fever' // 发烧中，急需物理降温
  | 'low_fever' // 低热/预防备用
  | 'spare' // 只是家中备货，不急

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
  | 'waiting' // 排队候补（暂无余量，等待他人取消或归还）
  | 'confirmed' // 已确认并锁定数量，等待交接
  | 'handing' // 交接中（自取待取 / 配送中 / 已放门口）
  | 'completed' // 已完成（拍照确认）
  | 'closed_returned' // 已闭环：归还/补充完成
  | 'cancelled' // 已取消（超时未取 / 共享人撤回 / 主动取消 / 配送失败）

/** 反馈类型 */
export type FeedbackType = 'package_damaged' | 'adverse_reaction' | 'other'
export type FeedbackStatus = 'open' | 'resolved_scrap' | 'resolved_republish'

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
  // ---- 夜间多人争抢分配因子（由申请人在表单中如实填写）----
  /** 紧急程度自述 */
  urgency?: UrgencyLevel
  /** 家中是否有儿童需要使用（退热贴等品类的重要优先因子） */
  hasChild?: boolean
  /** 儿童年龄（岁），仅在 hasChild 时填写，用于核实 */
  childAge?: number
  /** 当前测得体温（℃，一位小数），选填，用于核实紧急程度 */
  temperature?: number
  /** 取用人住址（夜间配送距离计算依据） */
  address?: string
  /** 距取用点的步行距离（米），申请人填写或由位置估算 */
  distanceMeters?: number
  // ---- 分配建议（一次分配一轮，随申请持久化）----
  allocationId?: string
  /** 综合评分（越高越优先） */
  score?: number
  /** 评分明细，用于社区端向居民解释“为什么是这个顺序” */
  scoreDetails?: ScoreBreakdown
  /** 系统/志愿者是否按建议把库存分给了本申请 */
  allocated?: boolean
  // ---- 未分到物品后的三条出路 ----
  aidChosen?: AidRoute
  aidChosenAt?: string
  /** 相邻小区互助：承接的小区/站点名 */
  aidNeighborName?: string
  /** 替代用品建议（如 凉毛巾/温水擦拭物理降温） */
  aidAlternative?: string
  /** 未拿到物品的求助记录状态（志愿者到货后可据此补发） */
  helpStatus?: 'open' | 'fulfilled' | 'closed'
  fulfilledAt?: string
  fulfilledBy?: string // 志愿者/工作人员姓名
  fulfilledItemId?: string // 补发时实际发出的物品（可能是新到货批次）
  fulfilledNote?: string
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
}

/** 未分配到物品居民的三条出路 */
export type AidRoute = 'neighbor_community' | 'alternative' | 'medical_advice'

/** 评分因子明细（每一项都可解释，便于社区处理质疑） */
export interface ScoreBreakdown {
  urgencyPoints: number
  childPoints: number
  distancePoints: number
  deliveryPoints: number
  /** 同分时按申请先后的微小次序分，保证排序稳定可解释 */
  orderPoints: number
  /** 评分依据的人话说明（逐因子列出） */
  reasons: string[]
}

/** 一次“多人同时申请同一物品”的分配轮次（夜间退热贴争抢场景） */
export interface AllocationRound {
  id: string
  itemId: string
  /** 参与本轮排序的申请 ID（按下达分配时的候补/新申请快照） */
  requestIds: string[]
  /** 建议分到的申请 ID（按评分 + 库存数量贪心切分） */
  allocatedRequestIds: string[]
  /** 未分到、保留求助记录的申请 ID */
  unallocatedRequestIds: string[]
  /** 参与排序时的可借库存快照 */
  availableQty: number
  /** 参与排序时在岗可配送志愿者数（配送能力因子依据） */
  volunteerCapacity: number
  createdAt: string
  /** 谁执行了分配（志愿者/工作人员，或系统建议） */
  createdBy: string
  createdByName: string
  /** 分配执行状态：suggested=仅给出建议；adopted=已按建议锁定库存 */
  status: 'suggested' | 'adopted'
  adoptedAt?: string
  /** 分配规则版本，便于复盘口径一致 */
  ruleVersion: string
  /** 给社区端的整段分配理由（汇总每个申请人的因子与结论） */
  summary: string
}

/** 居民对某次分配的质疑（社区端可见、可答复） */
export interface AllocationQuestion {
  id: string
  allocationId: string
  itemId: string
  requestId: string
  questionerId: string
  questionerName: string
  content: string
  createdAt: string
  status: 'open' | 'replied'
  reply?: string
  repliedAt?: string
  replierName?: string
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

/** 与物品串联的全流程时间线事件 */
export interface DemoUser {
  id: string
  name: string
  role: 'resident' | 'volunteer' | 'staff'
  address: string
  /** 所属小区（未分到物品时可转相邻小区互助） */
  community?: string
  /** 志愿者：今晚是否在岗可夜间配送 */
  onDuty?: boolean
  /** 志愿者：本轮还能承担的配送单数（配送能力） */
  deliveryCapacity?: number
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
    | 'allocation_suggested'
    | 'allocation_adopted'
    | 'aid_chosen'
    | 'help_fulfilled'
    | 'question'
    | 'question_replied'
  detail?: string
}
