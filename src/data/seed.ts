// 演示用户：居民 / 志愿者 / 社区工作人员
import type {
  AllocationBatch,
  BorrowRequest,
  DemoUser,
  DisputeRecord,
  Feedback,
  HelpRecord,
  Item,
  MutualAidPoint,
  TimelineEvent,
} from '@/types'
import { addDays, addHours } from '@/utils/date'
import { buildAllocationSuggestion, type NightApplicant } from '@/utils/allocation'
import { estimateDistanceMeters } from '@/utils/community'

export type { DemoUser }

export const DEMO_USERS: DemoUser[] = [
  { id: 'u_a', name: '王秀兰', role: 'resident', address: '幸福里小区 3号楼1单元', community: '幸福里小区', building: 3 },
  { id: 'u_b', name: '李建国', role: 'resident', address: '幸福里小区 2号楼2单元', community: '幸福里小区', building: 2 },
  { id: 'u_c', name: '周敏', role: 'resident', address: '幸福里小区 5号楼3单元', community: '幸福里小区', building: 5 },
  // —— 昨夜（09-27 凌晨）同时申请退热贴的 5 户家长 ——
  { id: 'u_d', name: '张莉', role: 'resident', address: '幸福里小区 2号楼1单元', community: '幸福里小区', building: 2 },
  { id: 'u_e', name: '刘梅', role: 'resident', address: '幸福里小区 4号楼2单元', community: '幸福里小区', building: 4 },
  { id: 'u_f', name: '赵强', role: 'resident', address: '幸福里小区 6号楼1单元', community: '幸福里小区', building: 6 },
  { id: 'u_g', name: '吴芳', role: 'resident', address: '幸福里小区 1号楼2单元', community: '幸福里小区', building: 1 },
  { id: 'u_h', name: '郑伟', role: 'resident', address: '幸福里小区 8号楼3单元', community: '幸福里小区', building: 8 },
  { id: 'u_v', name: '陈芳（志愿者）', role: 'volunteer', address: '幸福里小区 1号楼', community: '幸福里小区', building: 1 },
  { id: 'u_s', name: '赵磊（社区工作人员）', role: 'staff', address: '幸福里社区居委会', community: '幸福里小区' },
]

/** 相邻小区互助点（夜间短缺时由社区/志愿者协调，不占用本小区库存） */
export const MUTUAL_AID_POINTS: MutualAidPoint[] = [
  {
    id: 'mp1',
    community: '安康苑小区',
    distanceMeters: 900,
    contact: '安康苑夜间值守志愿者 周师傅（门卫室）',
    note: '与幸福里一墙之隔，步行约 10 分钟，已建立夜间耗材互助约定。',
    stocks: [
      // 3 盒中已有 1 盒在昨夜批次 b1 协调给赵强（见求助记录 h1），余 2 盒
      { category: 'fever_patch', name: '医用退热贴', spec: '4贴/盒', quantity: 2, expiryDate: '' },
      { category: 'iodophor', name: '碘伏棉片', spec: '20片/盒', quantity: 4, expiryDate: '' },
    ],
  },
  {
    id: 'mp2',
    community: '和平里小区',
    distanceMeters: 1600,
    contact: '和平里社区门卫室',
    note: '距离稍远，仅在安康苑也无库存时协调。',
    stocks: [{ category: 'mask', name: '一次性医用口罩', spec: '50只/盒', quantity: 40, expiryDate: '' }],
  },
]

// 演示“当前时间”基准，时钟可在页面底部快进，用于演示效期/超时
export const BASE_NOW = '2026-09-27T09:00:00'
/** 昨夜多户家长同时申请退热贴、志愿者执行分配的时间 */
const NIGHT_BATCH_AT = '2026-09-27T01:50:00'
const NIGHT_BATCH_DONE = '2026-09-27T01:52:00'

let seq = 0
export function uid(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 6)}`
}

function buildSeed(now: string): {
  items: Item[]
  requests: BorrowRequest[]
  feedbacks: Feedback[]
  batches: AllocationBatch[]
  helpRecords: HelpRecord[]
  disputes: DisputeRecord[]
  mutualAidPoints: MutualAidPoint[]
} {
  // 互助点效期按当前时钟补齐
  for (const p of MUTUAL_AID_POINTS) {
    for (const s of p.stocks) s.expiryDate = addDays(now, 200).slice(0, 10)
  }

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
      // 昨夜分配前共 4 盒：1 盒被更早确认的 r3 锁定（今早已超时未取，可在志愿者页释放），夜间可分配 3 盒
      quantity: 4,
      location: '3号楼1单元一楼“邻里药箱”共享柜 A格',
      sceneTags: ['child_night_fever'],
      note: '家里备多了，未拆封，夜间急用可先取。',
      status: 'lent_out',
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
      // 昨夜退热贴短缺后，社区今早协调上架的物理降温替代品
      id: 'i13',
      ownerId: 'u_s',
      ownerName: '赵磊（社区工作人员）',
      name: '一次性医用冰袋（冷敷）',
      category: 'other_consumable',
      spec: '100g/袋 即捏即冷',
      expiryDate: addDays(now, 365).slice(0, 10),
      storage: 'room_temp',
      sealed: true,
      quantity: 6,
      location: '3号楼1单元一楼“邻里药箱”共享柜 C格',
      sceneTags: ['child_night_fever', 'home_care'],
      note: '夜间退热贴短缺后，社区今早补充的物理降温用品，可作为退热贴替代；志愿者初审、工作人员复核均通过。',
      status: 'published',
      createdAt: '2026-09-27T07:40:00',
      publishedAt: '2026-09-27T08:00:00',
      review: { reviewerId: 'u_v', reviewerName: '陈芳（志愿者）', at: '2026-09-27T07:50:00', approved: true, reason: '志愿者初审通过；社区工作人员复核通过（夜间短缺应急补充）' },
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
      note: '家里口罩用完了，一早要陪老人去医院，请志愿者尽快代送。',
      status: 'handing',
      // 凌晨退热贴批次（01:50–02:28）结束后才排单配送，故不占用当晚退热贴分配的 2 个代送名额
      createdAt: '2026-09-27T02:35:00',
      confirmedAt: '2026-09-27T02:35:00',
      handingAt: '2026-09-27T02:40:00',
      confirmerId: 'u_a',
      confirmerName: '王秀兰',
      volunteerId: 'u_v',
      volunteerName: '陈芳（志愿者）',
    },
  ]

  // ---- 昨夜 5 户家长几乎同时申请同一盒退热贴（01:22-01:35）----
  const nightUsers = ['u_d', 'u_e', 'u_f', 'u_g', 'u_h'] as const
  const nightInput: Array<{
    uid: string
    createdAt: string
    urgency: BorrowRequest['urgency']
    symptom: string
    method: BorrowRequest['method']
  }> = [
    { uid: 'u_d', createdAt: '2026-09-27T01:22:00', urgency: 'critical', symptom: '孩子 39.3℃，精神差、嗜睡，家里没有退热用品', method: 'volunteer_delivery' },
    { uid: 'u_e', createdAt: '2026-09-27T01:25:00', urgency: 'critical', symptom: '孩子 39.1℃，手脚发凉哭闹，大人无法离开', method: 'volunteer_delivery' },
    { uid: 'u_f', createdAt: '2026-09-27T01:31:00', urgency: 'critical', symptom: '孩子 39.5℃ 伴寒战，此前有过热性惊厥，不敢下楼', method: 'volunteer_delivery' },
    { uid: 'u_g', createdAt: '2026-09-27T01:28:00', urgency: 'urgent', symptom: '孩子 38.4℃，想先物理降温观察', method: 'door_contactless' },
    { uid: 'u_h', createdAt: '2026-09-27T01:35:00', urgency: 'normal', symptom: '孩子 37.8℃ 略发热，想备一盒夜里观察', method: 'self_pickup' },
  ]

  const nightApplicants: NightApplicant[] = []
  for (const n of nightInput) {
    const user = DEMO_USERS.find((u) => u.id === n.uid)!
    const distanceMeters = estimateDistanceMeters(user, items[0].location)
    const id = `r_${n.uid}`
    requests.push({
      id,
      itemId: 'i1',
      applicantId: n.uid,
      applicantName: user.name,
      scene: 'child_night_fever',
      quantity: 1,
      method: n.method,
      note: n.symptom,
      status: 'waiting',
      createdAt: n.createdAt,
      urgency: n.urgency,
      hasChild: true,
      symptom: n.symptom,
      distanceMeters,
    })
    nightApplicants.push({
      requestId: id,
      applicantId: n.uid,
      applicantName: user.name,
      urgency: n.urgency!,
      hasChild: true,
      symptom: n.symptom,
      distanceMeters,
      quantity: 1,
      method: n.method,
      createdAt: n.createdAt,
    })
  }

  // 用真实分配引擎生成昨夜 01:50 的建议（当晚可分配 3 盒、志愿者可代送 2 单、无本小区替代品）
  const suggestion = buildAllocationSuggestion({
    item: { id: 'i1', name: '医用退热贴', location: items[0].location },
    stockQty: 3,
    applicants: nightApplicants,
    deliveryCapacity: 2,
    alternativesFor: () => [],
    mutualAidPoints: MUTUAL_AID_POINTS,
    now: NIGHT_BATCH_AT,
  })

  const batch: AllocationBatch = {
    id: 'b1',
    itemId: 'i1',
    itemName: '医用退热贴（4贴/盒）',
    at: NIGHT_BATCH_AT,
    windowLabel: '09-27 01:22–01:35，约 2 小时内 5 户家长同时申请（夜间时段）',
    stockQty: 3,
    deliveryCapacity: 2,
    decisions: suggestion.decisions,
    executedAt: NIGHT_BATCH_DONE,
    executorId: 'u_v',
    executorName: '陈芳（志愿者）',
  }

  // ---- 按执行结果回写申请状态 ----
  const byRequest = new Map(suggestion.decisions.map((d) => [d.requestId, d]))
  const nightReqIds = nightUsers.map((u) => `r_${u}`)
  const finishTimes: Record<string, { confirm: string; handing?: string; complete?: string }> = {
    r_u_d: { confirm: NIGHT_BATCH_DONE, handing: '2026-09-27T01:58:00', complete: '2026-09-27T02:22:00' },
    r_u_e: { confirm: NIGHT_BATCH_DONE, handing: '2026-09-27T02:00:00', complete: '2026-09-27T02:28:00' },
    r_u_g: { confirm: NIGHT_BATCH_DONE, handing: '2026-09-27T01:55:00', complete: '2026-09-27T02:10:00' },
  }
  for (const id of nightReqIds) {
    const r = requests.find((x) => x.id === id)!
    const d = byRequest.get(id)!
    r.batchId = 'b1'
    r.allocationRank = d.rank
    if (d.suggestion === 'allocate') {
      const t = finishTimes[id]!
      r.status = 'completed'
      r.confirmedAt = t.confirm
      r.confirmerId = 'u_v'
      r.confirmerName = '陈芳（志愿者）'
      if (r.method === 'volunteer_delivery') {
        r.volunteerId = 'u_v'
        r.volunteerName = '陈芳（志愿者）'
      }
      r.handingAt = t.handing
      r.completedAt = t.complete
      r.handoverPhoto = `handover-${id}.jpg（演示凭证：${r.method === 'volunteer_delivery' ? '志愿者夜间送达拍照' : r.method === 'door_contactless' ? '放至门口后拍照' : '取件拍照'}）`
      r.handoverNote = '夜间紧急分配，包装封签完好。'
    } else {
      r.status = 'cancelled'
      r.closedAt = NIGHT_BATCH_DONE
      r.cancelReason = d.capacityBlocked
        ? '夜间分配未中：综合排序第 ' + d.rank + '（' + d.totalScore + ' 分），库存本可满足但当晚志愿者代送运力已满（2 单排满），已协调相邻小区互助并保留求助记录'
        : '夜间分配未中：综合排序第 ' + d.rank + '（' + d.totalScore + ' 分），当晚库存仅 3 盒已按排序分完，已保留求助记录，到货后按记录补发'
    }
  }

  // ---- 未分到物品的居民：求助记录全程保留 ----
  const helpRecords: HelpRecord[] = [
    {
      id: 'h1',
      batchId: 'b1',
      itemId: 'i1',
      itemName: '医用退热贴（4贴/盒）',
      requestId: 'r_u_f',
      applicantId: 'u_f',
      applicantName: '赵强',
      urgency: 'critical',
      hasChild: true,
      symptom: '孩子 39.5℃ 伴寒战，此前有过热性惊厥，不敢下楼',
      distanceMeters: byRequest.get('r_u_f')!.distanceMeters,
      quantity: 1,
      createdAt: NIGHT_BATCH_AT,
      status: 'mutual_aid_transfer',
      resolvedAt: '2026-09-27T02:05:00',
      mutualAidCommunity: '安康苑小区',
      disputeId: 'dp1',
      actions: [
        { id: 'h1_a1', at: NIGHT_BATCH_DONE, actorId: 'u_v', actorName: '陈芳（志愿者）', kind: 'created', detail: '夜间分配未中，自动保留求助记录（综合排序第 3，当晚代送运力已满）' },
        { id: 'h1_a2', at: '2026-09-27T01:55:00', actorId: 'u_v', actorName: '陈芳（志愿者）', kind: 'medical_tip', detail: '电话告知：若再次出现抽搐、意识不清或呼吸异常，立即拨打 120 就医；途中侧卧、温水擦浴，退热用品仅为辅助' },
        { id: 'h1_a3', at: '2026-09-27T02:05:00', actorId: 'u_v', actorName: '陈芳（志愿者）', kind: 'transfer_mutual_aid', detail: '协调安康苑小区门卫室预留医用退热贴 1 盒（距本小区 900 米），家属 02:30 自行取走，问题解决' },
      ],
    },
    {
      id: 'h2',
      batchId: 'b1',
      itemId: 'i1',
      itemName: '医用退热贴（4贴/盒）',
      requestId: 'r_u_h',
      applicantId: 'u_h',
      applicantName: '郑伟',
      urgency: 'normal',
      hasChild: true,
      symptom: '孩子 37.8℃ 略发热，想备一盒夜里观察',
      distanceMeters: byRequest.get('r_u_h')!.distanceMeters,
      quantity: 1,
      createdAt: NIGHT_BATCH_AT,
      status: 'pending',
      actions: [
        { id: 'h2_a1', at: NIGHT_BATCH_DONE, actorId: 'u_v', actorName: '陈芳（志愿者）', kind: 'created', detail: '夜间分配未中，自动保留求助记录（综合排序第 5，62 分，当晚库存已分完）；系统同时建议转安康苑互助，家属考虑距离较远选择等待本小区补货——库存到货/释放后按本记录补发，无需重新申请' },
      ],
    },
  ]

  // ---- 赵强对夜间分配结果提出质疑，社区待答复（用于演示“分配理由可追溯、可处理质疑”）----
  const disputes: DisputeRecord[] = [
    {
      id: 'dp1',
      batchId: 'b1',
      itemId: 'i1',
      helpRecordId: 'h1',
      requestId: 'r_u_f',
      applicantId: 'u_f',
      applicantName: '赵强',
      reason: '孩子 39.5℃ 还伴寒战、以前惊厥过，我自认情况最急，为什么当晚没有先分给我们家？要求给出分配理由。',
      createdAt: '2026-09-27T08:10:00',
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

  return { items, requests, feedbacks, batches: [batch], helpRecords, disputes, mutualAidPoints: MUTUAL_AID_POINTS }
}

/** 由物品/申请/反馈/夜间分配/求助/质疑快照重建全流程时间线（种子数据与数据修复共用） */
export function rebuildTimeline(
  items: Item[],
  requests: BorrowRequest[],
  feedbacks: Feedback[],
  batches: AllocationBatch[] = [],
  helpRecords: HelpRecord[] = [],
  disputes: DisputeRecord[] = [],
): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const push = (e: TimelineEvent) => events.push(e)

  for (const it of items) {
    push({ id: `${it.id}_reg`, itemId: it.id, at: it.createdAt, actorId: it.ownerId, actorName: it.ownerName, kind: 'registered', detail: `登记「${it.name} ${it.spec}」×${it.quantity}` })
    if (it.review) {
      push({ id: `${it.id}_review`, itemId: it.id, at: it.review.at, actorId: it.review.reviewerId, actorName: it.review.reviewerName, kind: 'reviewed', detail: it.review.approved ? `审核通过${it.review.reason ? `：${it.review.reason}` : ''}` : `审核驳回：${it.review.reason ?? '不符合共享范围'}` })
    }
    if (it.publishedAt) {
      push({ id: `${it.id}_pub`, itemId: it.id, at: it.publishedAt, actorId: 'u_v', actorName: '志愿者', kind: 'published', detail: '发布到邻里药箱大厅' })
    }
    if (it.status === 'recalled') {
      push({ id: `${it.id}_recall`, itemId: it.id, at: it.publishedAt ?? it.createdAt, actorId: it.ownerId, actorName: it.ownerId, kind: 'recalled', detail: it.closeReason ?? '共享人撤回' })
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
    push({ id: `${r.id}_apply`, itemId: r.itemId, requestId: r.id, at: r.createdAt, actorId: r.applicantId, actorName: r.applicantName, kind: r.status === 'waiting' ? 'waitlisted' : 'applied', detail: `申请借用「${name}」×${r.quantity}${r.urgency ? `（紧急度：${r.urgency === 'critical' ? '紧急' : r.urgency === 'urgent' ? '较急' : '一般'}${r.hasChild ? '、家中有儿童' : ''}）` : ''}` })
    if (r.confirmedAt) push({ id: `${r.id}_confirm`, itemId: r.itemId, requestId: r.id, at: r.confirmedAt, actorId: r.confirmerId ?? 'u_v', actorName: r.confirmerName ?? '志愿者', kind: 'confirmed', detail: `确认申请并锁定库存 ×${r.quantity}${r.batchId ? '（夜间多人同时申请分配执行）' : ''}` })
    if (r.handingAt) push({ id: `${r.id}_handing`, itemId: r.itemId, requestId: r.id, at: r.handingAt, actorId: r.volunteerId ?? r.confirmerId ?? 'u_v', actorName: r.volunteerName ?? r.confirmerName ?? '志愿者', kind: 'handover_started', detail: r.method === 'volunteer_delivery' ? '志愿者出发代送' : r.method === 'door_contactless' ? '已放到约定门口位置' : '物品已备好，等待自取' })
    if (r.completedAt) push({ id: `${r.id}_done`, itemId: r.itemId, requestId: r.id, at: r.completedAt, actorId: r.applicantId, actorName: r.applicantName, kind: 'handover_confirmed', detail: `交接拍照确认：${r.handoverPhoto ?? '已上传照片'}${r.handoverNote ? `；${r.handoverNote}` : ''}` })
    if (r.status === 'closed_returned' && r.closedAt) {
      push({ id: `${r.id}_close`, itemId: r.itemId, requestId: r.id, at: r.closedAt, actorId: r.applicantId, actorName: r.applicantName, kind: r.closeMode === 'restock_new' ? 'restocked' : 'returned', detail: r.closeMode === 'mutual_aid' ? '邻里赠予，无需归还' : r.closeMode === 'restock_new' ? '已补充同规格新品' : '已归还原物（未拆封）' })
    }
    if (r.status === 'cancelled') {
      push({ id: `${r.id}_cancel`, itemId: r.itemId, requestId: r.id, at: r.closedAt ?? r.createdAt, actorId: r.applicantId, actorName: r.applicantName, kind: 'cancelled', detail: r.cancelReason ?? '申请取消，库存释放' })
    }
  }

  // 夜间分配批次：建议 → 逐户执行 → 求助记录动作 → 质疑
  for (const b of batches) {
    push({
      id: `${b.id}_suggest`,
      itemId: b.itemId,
      at: b.at,
      actorId: 'u_v',
      actorName: '陈芳（志愿者）',
      kind: 'allocation_suggested',
      detail: `夜间多人同时申请分配建议：${b.windowLabel}；按紧急程度/儿童/距离/库存/夜间运力评分，可分配 ${b.stockQty} 盒、代送运力 ${b.deliveryCapacity} 单，建议分给 ${b.decisions.filter((d) => d.suggestion === 'allocate').map((d) => d.applicantName).join('、')}`,
    })
    for (const d of b.decisions.filter((x) => x.suggestion === 'allocate')) {
      push({ id: `${b.id}_alloc_${d.requestId}`, itemId: b.itemId, requestId: d.requestId, at: b.executedAt ?? b.at, actorId: b.executorId ?? 'u_v', actorName: b.executorName ?? '志愿者', kind: 'allocated', detail: `夜间分配执行：${d.applicantName} 综合排序第 ${d.rank}（${d.totalScore} 分），分配 ${d.allocatedQty} 盒` })
    }
  }

  for (const h of helpRecords) {
    const mapActionKind: Record<string, TimelineEvent['kind'] | null> = {
      created: 'help_created',
      transfer_mutual_aid: 'help_mutual_aid',
      choose_alternative: 'help_alternative',
      medical_tip: 'medical_tip',
      restock_backfill: 'restocked',
      delivered_backfill: 'backfilled',
      close: null,
      dispute_opened: 'dispute_opened',
      dispute_replied: 'dispute_replied',
    }
    for (const a of h.actions) {
      const kind = mapActionKind[a.kind]
      if (!kind) continue
      push({ id: a.id, itemId: h.itemId, requestId: h.requestId, at: a.at, actorId: a.actorId, actorName: a.actorName, kind, detail: `求助记录（${h.applicantName}）：${a.detail}` })
    }
  }

  for (const d of disputes) {
    push({ id: `${d.id}_open`, itemId: d.itemId, requestId: d.requestId, at: d.createdAt, actorId: d.applicantId, actorName: d.applicantName, kind: 'dispute_opened', detail: `居民提出质疑：${d.reason}` })
    if (d.status === 'replied' && d.repliedAt) {
      push({ id: `${d.id}_reply`, itemId: d.itemId, requestId: d.requestId, at: d.repliedAt, actorId: d.replierId ?? 'u_s', actorName: d.replierName ?? '社区工作人员', kind: 'dispute_replied', detail: `社区答复：${d.reply ?? ''}` })
    }
  }

  for (const f of feedbacks) {
    push({ id: `${f.id}_fb`, itemId: f.itemId, requestId: f.requestId, at: f.createdAt, actorId: f.reporterId, actorName: f.reporterName, kind: 'feedback', detail: `${f.type === 'package_damaged' ? '包装破损反馈' : f.type === 'adverse_reaction' ? '疑似不适反应反馈' : '其他反馈'}：${f.detail}` })
  }

  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export function freshState(now: string) {
  const { items, requests, feedbacks, batches, helpRecords, disputes, mutualAidPoints } = buildSeed(now)
  return {
    items,
    requests,
    feedbacks,
    batches,
    helpRecords,
    disputes,
    mutualAidPoints,
    timeline: rebuildTimeline(items, requests, feedbacks, batches, helpRecords, disputes),
  }
}
