<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMedkitStore } from '@/stores/medkit'
import { useFlash } from '@/composables/useFlash'
import { CLOSE_MODE_LABELS, DELIVERY_SLA_HOURS, PICKUP_WINDOW_HOURS } from '@/rules'
import SafetyBanner from '@/components/SafetyBanner.vue'
import RequestCard from '@/components/RequestCard.vue'
import PhotoCapture from '@/components/PhotoCapture.vue'
import ExpiryBadge from '@/components/ExpiryBadge.vue'
import HelpRecordCard from '@/components/HelpRecordCard.vue'
import { hoursSince } from '@/utils/date'
import type { BorrowRequest } from '@/types'

const store = useMedkitStore()
const router = useRouter()
const { show } = useFlash()

const myRequests = computed(() => store.requests.filter((r) => r.applicantId === store.currentUserId))
/** 夜间未分到物品时为我保留的求助记录（含互助/替代/就医/补发全过程与质疑答复） */
const myHelps = computed(() => store.helpRecordsOf({ applicantId: store.currentUserId }))
const photos = ref<Record<string, string>>({})
const closeMode = ref<Record<string, BorrowRequest['closeMode']>>({})

function itemOf(id: string) {
  return store.items.find((i) => i.id === id)
}
function overdueHours(r: BorrowRequest) {
  return hoursSince(r.handingAt ?? r.confirmedAt ?? r.createdAt, store.nowIso)
}

function startHandover(id: string) {
  const r = store.startHandover(id)
  show(r.message, r.ok ? 'ok' : 'err')
}
function completeHandover(id: string) {
  const r = store.completeHandover(id, photos.value[id] ?? '', '取件人拍照确认，包装外观完好')
  show(r.message, r.ok ? 'ok' : 'err')
}
function cancelMine(id: string) {
  const r = store.cancelRequest(id, '借用人主动取消')
  show(r.message, r.ok ? 'ok' : 'err')
}
function closeBorrow(id: string) {
  const mode = closeMode.value[id] ?? 'return_sealed'
  const r = store.closeBorrow(id, mode, mode === 'return_sealed' ? '原物未拆封归还至共享柜' : mode === 'restock_new' ? '已购买同规格新品补充' : '共享人同意赠予')
  show(r.message, r.ok ? 'ok' : 'err')
}
</script>

<template>
  <SafetyBanner compact />

  <div class="card">
    <h2 style="margin-bottom: 4px">我的借用</h2>
    <div class="muted">
      申请、候补、交接拍照、归还/补充约定都在这里。请在确认后 {{ PICKUP_WINDOW_HOURS }} 小时内取走；志愿者配送承诺 {{ DELIVERY_SLA_HOURS }} 小时内送达。
    </div>
  </div>

  <!-- 夜间未分到物品时为我保留的求助记录 -->
  <template v-if="myHelps.length">
    <h3 class="section-title">🆘 我的夜间求助记录（未分到也不会丢，到货会按记录补发）</h3>
    <HelpRecordCard v-for="h in myHelps" :key="h.id" :help="h" mode="resident" />
  </template>

  <div v-if="!myRequests.length" class="card empty">
    你还没有借用记录。<RouterLink to="/hall">去药箱大厅看看邻居分享了什么 →</RouterLink>
  </div>

  <div v-for="r in myRequests" :key="r.id" class="card">
    <RequestCard :req="r" :item-name="itemOf(r.itemId)?.name ?? r.itemId" />

    <div v-if="itemOf(r.itemId)" class="muted" style="margin: 6px 0">
      物品效期：<ExpiryBadge :expiry-date="itemOf(r.itemId)!.expiryDate" :now="store.nowIso" />
      · 取用地点：{{ itemOf(r.itemId)!.location }}
    </div>

    <!-- 候补 -->
    <div v-if="r.status === 'waiting'" class="card-actions">
      <span class="muted">余量不足时按申请顺序候补，他人取消或归还后可递补。</span>
      <button class="btn btn-sm btn-danger" @click="cancelMine(r.id)">取消候补</button>
      <button class="btn btn-sm" @click="router.push(`/items/${r.itemId}`)">查看物品</button>
    </div>

    <!-- 已确认，等待交接 -->
    <template v-else-if="r.status === 'confirmed'">
      <div v-if="overdueHours(r) > PICKUP_WINDOW_HOURS" class="banner banner-danger" style="margin-top: 8px">
        ⏰ 已超过 {{ PICKUP_WINDOW_HOURS }} 小时取走时限，共享人/志愿者可能取消申请并释放库存给候补邻居，请尽快联系。
      </div>
      <div v-else class="banner banner-info" style="margin-top: 8px">
        已为你锁定库存，请按时取走；自取请在取件点检查包装封签。
      </div>
      <div class="card-actions">
        <button v-if="r.method === 'self_pickup'" class="btn btn-primary btn-sm" @click="startHandover(r.id)">我已到取件点，开始取件</button>
        <button class="btn btn-sm btn-danger" @click="cancelMine(r.id)">去不了，取消释放给他人</button>
      </div>
    </template>

    <!-- 交接中 -->
    <template v-else-if="r.status === 'handing'">
      <PhotoCapture @captured="(p) => (photos[r.id] = p)" />
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" :disabled="!photos[r.id]" @click="completeHandover(r.id)">照片已拍，确认收到</button>
      </div>
      <div v-if="r.method === 'door_contactless'" class="muted" style="margin-top: 6px">无接触交接：取走后请拍照，便于共享人确认。</div>
    </template>

    <!-- 已取走，约定归还/补充 -->
    <template v-else-if="r.status === 'completed'">
      <div class="banner banner-success" style="margin-top: 8px">
        已取走并拍照确认。请与共享人约定的方式闭环：<strong>归还原物（须仍未拆封）</strong>、<strong>补充同规格新品</strong>，或经共享人同意作为邻里赠予。
      </div>
      <label class="field" style="margin-top: 8px">
        <span>归还 / 补充方式</span>
        <select v-model="closeMode[r.id]">
          <option value="return_sealed">{{ CLOSE_MODE_LABELS.return_sealed }}</option>
          <option value="restock_new">{{ CLOSE_MODE_LABELS.restock_new }}</option>
          <option value="mutual_aid">{{ CLOSE_MODE_LABELS.mutual_aid }}</option>
        </select>
      </label>
      <div class="card-actions">
        <button class="btn btn-primary btn-sm" @click="closeBorrow(r.id)">登记归还 / 补充完成</button>
        <button class="btn btn-sm btn-danger" @click="router.push(`/items/${r.itemId}`)">使用中发现问题？去反馈</button>
      </div>
    </template>
  </div>
</template>
