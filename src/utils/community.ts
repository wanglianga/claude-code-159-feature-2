// 小区/楼栋与距离估算（演示用，不接地图服务）

/** 从“3号楼1单元…”这类文本里解析楼栋号 */
export function parseBuilding(text?: string): number | undefined {
  if (!text) return undefined
  const m = text.match(/(\d+)\s*号楼/)
  return m ? Number(m[1]) : undefined
}

const SAME_BUILDING_METERS = 60 // 同楼内走到共享柜的经验距离
const PER_BUILDING_METERS = 90 // 每相差一栋楼的经验距离
const CROSS_COMMUNITY_BASE_METERS = 800 // 相邻小区之间额外距离

/**
 * 估算居民住址到物品取件点的夜间步行距离（米）。
 * 演示环境按楼栋号线性估算：同小区同栋 60m，每差一栋 +90m；跨小区 +800m。
 */
export function estimateDistanceMeters(user: { address?: string; community?: string; building?: number }, itemLocation: string): number {
  const userBuilding = user.building ?? parseBuilding(user.address) ?? 1
  const itemBuilding = parseBuilding(itemLocation) ?? userBuilding
  const sameCommunity = (user.community ?? DEFAULT_COMMUNITY) === DEFAULT_COMMUNITY
  const cross = sameCommunity ? 0 : CROSS_COMMUNITY_BASE_METERS
  if (userBuilding === itemBuilding && sameCommunity) return SAME_BUILDING_METERS
  return SAME_BUILDING_METERS + Math.abs(userBuilding - itemBuilding) * PER_BUILDING_METERS + cross
}

/** 默认（本）小区名称，未标注 community 的用户/地点都视为在本小区 */
export const DEFAULT_COMMUNITY = '幸福里小区'

/** 距离的可读文案 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} 米`
  return `${(meters / 1000).toFixed(1)} 公里`
}
