// 演示用户：居民 / 志愿者 / 社区工作人员
import type { AllocationQuestion, AllocationRound, BorrowRequest, DemoUser, Feedback, Item, TimelineEvent } from '@/types'
import { addDays, addHours } from '@/utils/date'
import { buildAllocationRoundDraft, planAllocation } from '@/rules'

export type { DemoUser }

export const DEMO_USERS: DemoUser[] = [
  { id: 'u_a', name: '王秀兰', role: 'resident', address: '幸福里小区 3号楼1单元', community: '幸福里小区' },
  { id: 'u_b', name: '李建国', role: 'resident', address: '幸福里小区 2号楼2单元', community: '幸福里小区' },
  { id: 'u_c', name: '周敏', role: 'resident', address: '幸福里小区 5号楼3单元', community: '幸福里小区' },
  { id: 'u_d', name: '张晨', role: 'resident', address: '幸福里小区 6号楼2单元', community: '幸福里小区' },
  { id: 'u_e', name: '李梅', role: 'resident', address: '幸福里小区 4号楼1单元', community: '幸福里小区' },
  { id: 'u_f', name: '杨光', role: 'resident', address: '幸福里小区 9号楼4单元', community: '幸福里小区' },
  { id: 'u_g', name: '赵桂兰', role: 'resident', address: '幸福里小区 2号楼3单元', community: '幸福里小区' },
  { id: 'u_h', name: '周文', role: 'resident', address: '环河路自建房 12 号', community: '幸福里小区' },
  { id: 'u_v', name: '陈芳（志愿者）', role: 'volunteer', address: '幸福里小区 1号楼', community: '幸福里小区', onDuty: true, deliveryCapacity: 1 },
  { id: 'u_v2', name: '孙磊（志愿者）', role: 'volunteer', address: '幸福里小区 7号楼', community: '幸福里小区', onDuty: true, deliveryCapacity: 1 },
  { id: 'u_s', name: '赵磊（社区工作人员）', role: 'staff', address: '幸福里社区居委会', community: '幸福里小区' },
]

/** 相邻小区互助点（未分到物品时可转入） */
export const NEIGHBOR_AID_POINTS = ['朝阳园小区东门共享点（24 小时岗亭）', '滨河家园北门便利店代收点']

// 演示“当前时间”基准，时钟可在页面底部快进，用于演示效期/超时
export const BASE_NOW = '2026-09-27T09:00:00'

let seq = 0
export function uid(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 6)}`
}

function buildSeed(now: string): {
  items: Item[]
  requests: BorrowRequest[]
  feedbacks: Feedback[]
  allocations: AllocationRound[]
  questions: AllocationQuestion[]
} {
  const items: Item[] = [
    {
      id: 'i1',
      ownerId: 'u_a',
      ownerName: '王秀兰',
      name: '医用退热贴',
      category: 'fever_patch',
      spec: '4贴/盒',
      expiryDate: addDays(now, 180).slice(0, 10),
      storage: 'cool_dry',
      sealed: true,
      quantity: 2,
      location: '3号楼1单元一楼“邻里药箱”共享柜 A格',
      sceneTags: ['child_night_fever'],
      note: '家里备多了，未拆封，夜间急用可先取。',
      status: 'published',
      createdAt: addDays(now, -10),
      publishedAt: addDays(now, -9),
    },
    {
      id: 'i2',
      ownerId: 'u_c',
      ownerName: '周敏',
      name: '碘伏棉片',
      category: 'iodophor',
      spec: '独立包装 20片/盒',
      expiryDate: addDays(now, 45).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 5,
      location: '5号楼3单元门口便民架',
      sceneTags: ['elderly_wound', 'home_care'],
      note: '效期不足两个月，页面会显著提示，请按需借用。',
      status: 'published',
      createdAt: addDays(now, -6),
      publishedAt: addDays(now, -6),
    },
    {
      id: 'i4',
      ownerId: 'u_c',
      ownerName: '周敏',
      name: '创可贴',
      category: 'bandage',
      spec: '100片/盒',
      expiryDate: addDays(now, 300).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 4,
      location: '5号楼3单元门口便民架',
      sceneTags: ['elderly_wound', 'home_care'],
      status: 'published',
      createdAt: addDays(now, -15),
      publishedAt: addDays(now, -14),
    },
    {
      id: 'i5',
      ownerId: 'u_a',
      ownerName: '王秀兰',
      name: '一次性使用医用口罩',
      category: 'mask',
      spec: '50只/盒（灭菌级）',
      expiryDate: addDays(now, 400).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 20,
      location: '3号楼1单元一楼“邻里药箱”共享柜 B格',
      sceneTags: ['no_mask', 'home_care'],
      status: 'published',
      createdAt: addDays(now, -8),
      publishedAt: addDays(now, -8),
    },
    {
      id: 'i6',
      ownerId: 'u_c',
      ownerName: '周敏',
      name: '体温计纽扣电池',
      category: 'thermometer_battery',
      spec: 'LR41 2粒/板',
      expiryDate: addDays(now, 700).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 2,
      location: '5号楼3单元门口便民架',
      sceneTags: ['child_night_fever', 'home_care'],
      note: '电子体温计没电时应急更换。',
      status: 'published',
      createdAt: addDays(now, -12),
      publishedAt: addDays(now, -12),
    },
    {
      id: 'i7',
      ownerId: 'u_b',
      ownerName: '李建国',
      name: '儿童退热贴',
      category: 'fever_patch',
      spec: '6贴/盒',
      expiryDate: addDays(now, 240).slice(0, 10),
      storage: 'cool_dry',
      sealed: true,
      quantity: 1,
      location: '2号楼2单元201门口挂袋',
      sceneTags: ['child_night_fever'],
      status: 'pending_review',
      createdAt: addHours(now, -2),
    },
    {
      id: 'i8',
      ownerId: 'u_a',
      ownerName: '王秀兰',
      name: '碘伏消毒液',
      category: 'iodophor',
      spec: '100ml/瓶 带密封盖',
      expiryDate: addDays(now, 20).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 2,
      location: '3号楼1单元一楼“邻里药箱”共享柜 A格',
      sceneTags: ['elderly_wound'],
      note: '临近效期，请志愿者审核时重点确认。',
      status: 'pending_review',
      createdAt: addDays(now, -1),
    },
    {
      id: 'i9',
      ownerId: 'u_a',
      ownerName: '王秀兰',
      name: '防水创可贴',
      category: 'bandage',
      spec: '20片/盒',
      expiryDate: addDays(now, 200).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 1,
      location: '3号楼1单元一楼“邻里药箱”共享柜 A格',
      sceneTags: ['elderly_wound'],
      status: 'quarantined',
      createdAt: addDays(now, -5),
      publishedAt: addDays(now, -5),
      closeReason: '借用反馈包装破损，已隔离待工作人员核查',
    },
    {
      id: 'i3',
      ownerId: 'u_a',
      ownerName: '王秀兰',
      name: '无菌纱布块',
      category: 'gauze',
      spec: '5片/袋（独立灭菌）',
      expiryDate: addDays(now, 12).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 3,
      location: '3号楼1单元一楼“邻里药箱”共享柜 A格',
      sceneTags: ['elderly_wound', 'home_care'],
      note: '临近效期，且收到疑似不适反馈已隔离。',
      status: 'quarantined',
      createdAt: addDays(now, -7),
      publishedAt: addDays(now, -7),
      closeReason: '借用人反馈使用后伤口周围发红，疑似不适，已隔离',
    },
    {
      id: 'i10',
      ownerId: 'u_c',
      ownerName: '周敏',
      name: '儿童防护口罩',
      category: 'mask',
      spec: '10只/包',
      expiryDate: addDays(now, 300).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 1,
      location: '5号楼3单元门口便民架',
      sceneTags: ['no_mask'],
      status: 'recalled',
      createdAt: addDays(now, -9),
      publishedAt: addDays(now, -8),
      closeReason: '家中孩子也要用，共享人主动撤回',
    },
    {
      id: 'i11',
      ownerId: 'u_a',
      ownerName: '王秀兰',
      name: '老式脱脂纱布（旧）',
      category: 'gauze',
      spec: '散装旧包装',
      expiryDate: addDays(now, -200).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 1,
      location: '社区库房',
      sceneTags: [],
      status: 'scrapped',
      createdAt: addDays(now, -60),
      publishedAt: addDays(now, -59),
      closeReason: '已过期，工作人员报废并按医疗垃圾处理',
    },
    {
      id: 'i12',
      ownerId: 'u_c',
      ownerName: '周敏',
      name: '一次性防护口罩（库存遗留）',
      category: 'mask',
      spec: '20只/盒',
      expiryDate: addDays(now, -3).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 6,
      location: '5号楼3单元门口便民架',
      sceneTags: ['no_mask'],
      note: '已过期：大厅不可借用，等待工作人员报废。',
      status: 'published',
      createdAt: addDays(now, -200),
      publishedAt: addDays(now, -199),
    },
    {
      // 夜间多户争抢的同一盒退热贴：整盒仅剩 1 盒可借
      id: 'i13',
      ownerId: 'u_a',
      ownerName: '王秀兰',
      name: '夜间应急退热贴（整盒）',
      category: 'fever_patch',
      spec: '6贴/盒',
      expiryDate: addDays(now, 260).slice(0, 10),
      storage: 'cool_dry',
      sealed: true,
      quantity: 1,
      location: '幸福里小区 1号楼门岗“夜间共享药箱”',
      sceneTags: ['child_night_fever'],
      note: '门岗夜间可取，志愿者在岗可代送；昨晚多户同时申请，系统已按规则给出分配建议。',
      status: 'lent_out',
      createdAt: addDays(now, -2),
      publishedAt: addDays(now, -2),
    },
  ]

  const requests: BorrowRequest[] = [
    {
      id: 'r1',
      itemId: 'i4',
      applicantId: 'u_b',
      applicantName: '李建国',
      scene: 'elderly_wound',
      quantity: 1,
      method: 'volunteer_delivery',
      note: '老人在家不方便下楼，麻烦志愿者送一下。',
      status: 'completed',
      createdAt: addDays(now, -3),
      confirmedAt: addDays(now, -3),
      handingAt: addDays(now, -3),
      completedAt: addDays(now, -2),
      confirmerId: 'u_c',
      confirmerName: '周敏',
      volunteerId: 'u_v',
      volunteerName: '陈芳（志愿者）',
      handoverPhoto: 'handover-r1.jpg（演示凭证：志愿者送达后拍照）',
      handoverNote: '已交到本人手中，外包装完好。',
    },
    {
      id: 'r2',
      itemId: 'i6',
      applicantId: 'u_b',
      applicantName: '李建国',
      scene: 'child_night_fever',
      quantity: 2,
      method: 'self_pickup',
      status: 'completed',
      createdAt: addDays(now, -1),
      confirmedAt: addDays(now, -1),
      handingAt: addDays(now, -1),
      completedAt: addDays(now, -1),
      confirmerId: 'u_c',
      confirmerName: '周敏',
      handoverPhoto: 'handover-r2.jpg（演示凭证：共享柜取件自拍）',
      handoverNote: '从共享柜取走，封签完好。',
    },
    {
      id: 'r3',
      itemId: 'i1',
      applicantId: 'u_c',
      applicantName: '周敏',
      scene: 'child_night_fever',
      quantity: 1,
      method: 'self_pickup',
      note: '孩子夜里烧起来了，先物理降温观察。',
      status: 'confirmed',
      createdAt: addHours(now, -27),
      confirmedAt: addHours(now, -26),
      confirmerId: 'u_a',
      confirmerName: '王秀兰',
    },
    {
      id: 'r4',
      itemId: 'i6',
      applicantId: 'u_a',
      applicantName: '王秀兰',
      scene: 'home_care',
      quantity: 1,
      method: 'door_contactless',
      note: '家里体温计没电，排队等归还。',
      status: 'waiting',
      createdAt: addHours(now, -5),
    },
    {
      id: 'r5',
      itemId: 'i5',
      applicantId: 'u_c',
      applicantName: '周敏',
      scene: 'no_mask',
      quantity: 5,
      method: 'volunteer_delivery',
      note: '家里口罩用完了，明天要陪老人去医院。',
      status: 'handing',
      createdAt: addHours(now, -9),
      confirmedAt: addHours(now, -9),
      handingAt: addHours(now, -8),
      confirmerId: 'u_a',
      confirmerName: '王秀兰',
      volunteerId: 'u_v',
      volunteerName: '陈芳（志愿者）',
    },
  ]

  // ---- 昨夜（约 23:00）多户家长同时申请同一盒退热贴 i13：争抢分配场景 ----
  const nightRequests: BorrowRequest[] = [
    {
      id: 'r6',
      itemId: 'i13',
      applicantId: 'u_d',
      applicantName: '张晨',
      scene: 'child_night_fever',
      quantity: 1,
      method: 'volunteer_delivery',
      note: '孩子 3 岁，烧到 39.4℃，手脚发烫有点蔫，急！',
      status: 'waiting',
      createdAt: addHours(now, -10),
      urgency: 'child_high_fever',
      hasChild: true,
      childAge: 3,
      temperature: 39.4,
      address: '幸福里小区 6号楼2单元',
      distanceMeters: 150,
    },
    {
      id: 'r7',
      itemId: 'i13',
      applicantId: 'u_e',
      applicantName: '李梅',
      scene: 'child_night_fever',
      quantity: 1,
      method: 'self_pickup',
      note: '7 岁孩子 38.6℃，我们可以自己下楼取。',
      status: 'waiting',
      createdAt: addHours(now, -9.8),
      urgency: 'fever',
      hasChild: true,
      childAge: 7,
      temperature: 38.6,
      address: '幸福里小区 4号楼1单元',
      distanceMeters: 300,
    },
    {
      id: 'r8',
      itemId: 'i13',
      applicantId: 'u_f',
      applicantName: '杨光',
      scene: 'child_night_fever',
      quantity: 1,
      method: 'volunteer_delivery',
      note: '大人自己发烧 38.2℃，住得有点远，希望能送。',
      status: 'waiting',
      createdAt: addHours(now, -9.6),
      urgency: 'fever',
      hasChild: false,
      temperature: 38.2,
      address: '幸福里小区 9号楼4单元',
      distanceMeters: 900,
    },
    {
      id: 'r9',
      itemId: 'i13',
      applicantId: 'u_g',
      applicantName: '赵桂兰',
      scene: 'child_night_fever',
      quantity: 1,
      method: 'self_pickup',
      note: '孙子 10 岁低热 37.8℃ 伴咳嗽，先备着。',
      status: 'waiting',
      createdAt: addHours(now, -9.4),
      urgency: 'low_fever',
      hasChild: true,
      childAge: 10,
      temperature: 37.8,
      address: '幸福里小区 2号楼3单元',
      distanceMeters: 1200,
    },
    {
      id: 'r10',
      itemId: 'i13',
      applicantId: 'u_h',
      applicantName: '周文',
      scene: 'child_night_fever',
      quantity: 1,
      method: 'self_pickup',
      note: '家里两个孩子，想备一盒以防夜里烧起来。',
      status: 'waiting',
      createdAt: addHours(now, -9.2),
      urgency: 'spare',
      hasChild: true,
      childAge: 5,
      address: '环河路自建房 12 号',
      distanceMeters: 1800,
    },
  ]
  requests.push(...nightRequests)

  // 用与运行时完全相同的规则引擎，对昨夜的申请快照评分并生成分配轮次
  const nightPlan = planAllocation({ requests: nightRequests, availableQty: 1, volunteerCapacity: 2 })
  for (const scored of nightPlan.ranked) {
    const r = requests.find((x) => x.id === scored.req.id)!
    r.score = scored.score
    r.scoreDetails = scored.details
    r.allocated = nightPlan.allocatedRequestIds.includes(r.id)
    r.allocationId = 'alloc1'
  }
  // 首位（张晨）已按建议确认锁定，志愿者夜间配送中
  const r6 = requests.find((x) => x.id === 'r6')!
  r6.status = 'handing'
  r6.confirmedAt = addHours(now, -9.9)
  r6.handingAt = addHours(now, -9.7)
  r6.confirmerId = 'u_v'
  r6.confirmerName = '陈芳（志愿者）'
  r6.volunteerId = 'u_v'
  r6.volunteerName = '陈芳（志愿者）'

  // 未分到的三户已选择出路；最后一户求助记录仍挂起，等待到货补发
  const r7 = requests.find((x) => x.id === 'r7')!
  r7.status = 'cancelled'
  r7.closedAt = addHours(now, -9.9)
  r7.cancelReason = '夜间分配未分到：库存仅 1 盒，评分排序靠后；已转入相邻小区互助'
  r7.helpStatus = 'open'
  r7.aidChosen = 'neighbor_community'
  r7.aidChosenAt = addHours(now, -9.9)
  r7.aidNeighborName = NEIGHBOR_AID_POINTS[0]
  const r8 = requests.find((x) => x.id === 'r8')!
  r8.status = 'cancelled'
  r8.closedAt = addHours(now, -9.9)
  r8.cancelReason = '夜间分配未分到：已选择替代用品物理降温'
  r8.helpStatus = 'open'
  r8.aidChosen = 'alternative'
  r8.aidChosenAt = addHours(now, -9.9)
  r8.aidAlternative = '凉毛巾敷额头 + 温水擦拭颈部/腋下/腹股沟，少量多次饮水，每小时测温'
  const r9 = requests.find((x) => x.id === 'r9')!
  r9.status = 'cancelled'
  r9.closedAt = addHours(now, -9.9)
  r9.cancelReason = '夜间分配未分到：孩子伴咳嗽，已收到就医提示'
  r9.helpStatus = 'closed'
  r9.aidChosen = 'medical_advice'
  r9.aidChosenAt = addHours(now, -9.9)
  const r10 = requests.find((x) => x.id === 'r10')!
  r10.status = 'cancelled'
  r10.closedAt = addHours(now, -9.9)
  r10.cancelReason = '夜间分配未分到：备货类申请，求助记录保留等待到货补发'
  r10.helpStatus = 'open'

  const allocations: AllocationRound[] = [
    {
      id: 'alloc1',
      ...buildAllocationRoundDraft('i13', '夜间应急退热贴（整盒）', nightPlan),
      createdAt: addHours(now, -9.9),
      createdBy: 'u_v',
      createdByName: '陈芳（志愿者）',
      status: 'adopted',
      adoptedAt: addHours(now, -9.9),
    },
  ]

  const questions: AllocationQuestion[] = [
    {
      id: 'q1',
      allocationId: 'alloc1',
      itemId: 'i13',
      requestId: 'r7',
      questionerId: 'u_e',
      questionerName: '李梅',
      content: '我家也有孩子发烧，为什么退热贴先给了 6 号楼？距离不是更近吗？',
      createdAt: addHours(now, -9.5),
      status: 'open',
    },
  ]

  const feedbacks: Feedback[] = [
    {
      id: 'f1',
      itemId: 'i9',
      reporterId: 'u_b',
      reporterName: '李建国',
      type: 'package_damaged',
      detail: '盒子被压裂，里面两片创可贴的密封纸翘起，不敢使用。',
      createdAt: addHours(now, -6),
      status: 'open',
    },
    {
      id: 'f2',
      itemId: 'i3',
      requestId: undefined,
      reporterId: 'u_c',
      reporterName: '周敏',
      type: 'adverse_reaction',
      detail: '使用纱布包扎后伤口周围发红发痒，已取下并用清水冲洗。不确定是否与物品有关，先报备。',
      createdAt: addHours(now, -3),
      status: 'open',
    },
  ]

  return { items, requests, feedbacks, allocations, questions }
}

/** 由物品/申请/反馈快照重建全流程时间线（种子数据与数据修复共用） */
export function rebuildTimeline(
  items: Item[],
  requests: BorrowRequest[],
  feedbacks: Feedback[],
  allocations: AllocationRound[] = [],
  questions: AllocationQuestion[] = [],
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const push = (e: TimelineEvent) => events.push(e)
  const itemNameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id

  for (const it of items) {
    push({ id: `${it.id}_reg`, itemId: it.id, at: it.createdAt, actorId: it.ownerId, actorName: it.ownerName, kind: 'registered', detail: `登记「${it.name} ${it.spec}」×${it.quantity}` })
    if (it.review) {
      push({ id: `${it.id}_review`, itemId: it.id, at: it.review.at, actorId: it.review.reviewerId, actorName: it.review.reviewerName, kind: 'reviewed', detail: it.review.approved ? `审核通过${it.review.reason ? `：${it.review.reason}` : ''}` : `审核驳回：${it.review.reason ?? '不符合共享范围'}` })
    }
    if (it.publishedAt) {
      push({ id: `${it.id}_pub`, itemId: it.id, at: it.publishedAt, actorId: 'u_v', actorName: '志愿者', kind: 'published', detail: '发布到邻里药箱大厅' })
    }
    if (it.status === 'recalled') {
      push({ id: `${it.id}_recall`, itemId: it.id, at: it.publishedAt ?? it.createdAt, actorId: it.ownerId, actorName: it.ownerName, kind: 'recalled', detail: it.closeReason ?? '共享人撤回' })
    }
    if (it.status === 'scrapped') {
      push({ id: `${it.id}_scrap`, itemId: it.id, at: it.publishedAt ?? it.createdAt, actorId: 'u_s', actorName: '社区工作人员', kind: 'scrapped', detail: it.closeReason ?? '报废处理' })
    }
    if (it.status === 'quarantined') {
      push({ id: `${it.id}_quar`, itemId: it.id, at: it.publishedAt ?? it.createdAt, actorId: 'u_s', actorName: '社区工作人员', kind: 'quarantined', detail: it.closeReason ?? '风险隔离' })
    }
  }

  for (const r of requests) {
    const item = items.find((i) => i.id === r.itemId)
    const name = item ? `${item.name}` : r.itemId
    push({ id: `${r.id}_apply`, itemId: r.itemId, requestId: r.id, at: r.createdAt, actorId: r.applicantId, actorName: r.applicantName, kind: r.status === 'waiting' ? 'waitlisted' : 'applied', detail: `申请借用「${name}」×${r.quantity}` })
    if (r.confirmedAt) push({ id: `${r.id}_confirm`, itemId: r.itemId, requestId: r.id, at: r.confirmedAt, actorId: r.confirmerId ?? 'u_v', actorName: r.confirmerName ?? '志愿者', kind: 'confirmed', detail: `确认申请并锁定库存 ×${r.quantity}` })
    if (r.handingAt) push({ id: `${r.id}_handing`, itemId: r.itemId, requestId: r.id, at: r.handingAt, actorId: r.volunteerId ?? r.confirmerId ?? 'u_v', actorName: r.volunteerName ?? r.confirmerName ?? '志愿者', kind: 'handover_started', detail: r.method === 'volunteer_delivery' ? '志愿者出发代送' : r.method === 'door_contactless' ? '已放到约定门口位置' : '物品已备好，等待自取' })
    if (r.completedAt) push({ id: `${r.id}_done`, itemId: r.itemId, requestId: r.id, at: r.completedAt, actorId: r.applicantId, actorName: r.applicantName, kind: 'handover_confirmed', detail: `交接拍照确认：${r.handoverPhoto ?? '已上传照片'}${r.handoverNote ? `；${r.handoverNote}` : ''}` })
    if (r.status === 'closed_returned' && r.closedAt) {
      push({ id: `${r.id}_close`, itemId: r.itemId, requestId: r.id, at: r.closedAt, actorId: r.applicantId, actorName: r.applicantName, kind: r.closeMode === 'restock_new' ? 'restocked' : 'returned', detail: r.closeMode === 'mutual_aid' ? '邻里赠予，无需归还' : r.closeMode === 'restock_new' ? '已补充同规格新品' : '已归还原物（未拆封）' })
    }
    if (r.status === 'cancelled') {
      push({ id: `${r.id}_cancel`, itemId: r.itemId, requestId: r.id, at: r.closedAt ?? r.createdAt, actorId: r.applicantId, actorName: r.applicantName, kind: 'cancelled', detail: r.cancelReason ?? '申请取消，库存释放' })
    }
  }

  for (const f of feedbacks) {
    push({ id: `${f.id}_fb`, itemId: f.itemId, requestId: f.requestId, at: f.createdAt, actorId: f.reporterId, actorName: f.reporterName, kind: 'feedback', detail: `${f.type === 'package_damaged' ? '包装破损反馈' : f.type === 'adverse_reaction' ? '疑似不适反应反馈' : '其他反馈'}：${f.detail}` })
  }

  // ---- 夜间分配轮次：建议/执行 + 每户去向 + 到货补发 ----
  for (const a of allocations) {
    push({
      id: `${a.id}_suggest`,
      itemId: a.itemId,
      at: a.createdAt,
      actorId: a.createdBy,
      actorName: a.createdByName,
      kind: 'allocation_suggested',
      detail: `夜间多人申请分配建议（${a.ruleVersion}）：库存 ${a.availableQty} 盒、在岗配送运力 ${a.volunteerCapacity} 单，建议分给 ${a.allocatedRequestIds.length} 户，${a.unallocatedRequestIds.length} 户未分到并保留求助记录`,
    })
    if (a.status === 'adopted' && a.adoptedAt) {
      push({ id: `${a.id}_adopt`, itemId: a.itemId, at: a.adoptedAt, actorId: a.createdBy, actorName: a.createdByName, kind: 'allocation_adopted', detail: `已按建议执行分配：${a.allocatedRequestIds.map((id) => requests.find((r) => r.id === id)?.applicantName ?? id).join('、')} 分到物品` })
    }
    for (const rid of a.unallocatedRequestIds) {
      const r = requests.find((x) => x.id === rid)
      if (!r) continue
      if (r.aidChosen && r.aidChosenAt) {
        const aidText =
          r.aidChosen === 'neighbor_community'
            ? `转入相邻小区互助：${r.aidNeighborName ?? ''}`
            : r.aidChosen === 'alternative'
              ? `选择替代用品：${r.aidAlternative ?? '物理降温'}`
              : '收到就医提示，建议夜间急诊'
        push({ id: `${r.id}_aid`, itemId: a.itemId, requestId: r.id, at: r.aidChosenAt, actorId: r.applicantId, actorName: r.applicantName, kind: 'aid_chosen', detail: `未分到「${itemNameOf(a.itemId)}」，${aidText}；求助记录${r.helpStatus === 'open' ? '保留，等待到货补发' : '已关闭'}` })
      }
      if (r.helpStatus === 'fulfilled' && r.fulfilledAt) {
        push({ id: `${r.id}_fulfill`, itemId: a.itemId, requestId: r.id, at: r.fulfilledAt, actorId: 'u_v', actorName: r.fulfilledBy ?? '志愿者', kind: 'help_fulfilled', detail: `到货补发完成：${r.fulfilledNote ?? '按求助记录补发'}${r.fulfilledItemId ? `（发出物品 ${itemNameOf(r.fulfilledItemId)}）` : ''}` })
      }
    }
  }

  for (const q of questions) {
    push({ id: `${q.id}_ask`, itemId: q.itemId, requestId: q.requestId, at: q.createdAt, actorId: q.questionerId, actorName: q.questionerName, kind: 'question', detail: `居民对分配提出质疑：${q.content}` })
    if (q.status === 'replied' && q.repliedAt) {
      push({ id: `${q.id}_reply`, itemId: q.itemId, requestId: q.requestId, at: q.repliedAt, actorId: 'u_s', actorName: q.replierName ?? '社区工作人员', kind: 'question_replied', detail: `社区答复：${q.reply ?? ''}` })
    }
  }

  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export function freshState(now: string) {
  const { items, requests, feedbacks, allocations, questions } = buildSeed(now)
  return { items, requests, feedbacks, allocations, questions, timeline: rebuildTimeline(items, requests, feedbacks, allocations, questions) }
}
