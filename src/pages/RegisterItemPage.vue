<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useMedkitStore } from '@/stores/medkit'
import { useFlash } from '@/composables/useFlash'
import { CATEGORY_LABELS, SCENE_LABELS, STORAGE_LABELS, validateDraft } from '@/rules'
import { addDays } from '@/utils/date'
import type { Category, ItemDraft, Scene } from '@/types'
import SafetyBanner from '@/components/SafetyBanner.vue'

const store = useMedkitStore()
const router = useRouter()
const { show } = useFlash()

const categories = Object.entries(CATEGORY_LABELS) as [Category, string][]
const scenes = Object.entries(SCENE_LABELS) as [Scene, string][]

function todayPlus(days: number): string {
  return addDays(store.nowIso, days).slice(0, 10)
}

const form = reactive<ItemDraft>({
  name: '',
  category: 'fever_patch',
  spec: '',
  expiryDate: todayPlus(180),
  storage: 'room_temp',
  sealed: true,
  quantity: 1,
  location: '',
  sceneTags: [],
  note: '',
})

const validation = computed(() => validateDraft(form, store.nowIso))

function toggleScene(s: Scene) {
  const i = form.sceneTags.indexOf(s)
  if (i >= 0) form.sceneTags.splice(i, 1)
  else form.sceneTags.push(s)
}

function submit() {
  const { errors, warnings } = validation.value
  if (errors.length) {
    show(errors.join(' '), 'err')
    return
  }
  const r = store.register({ ...form, note: form.note?.trim() || undefined })
  show(r.message || (warnings.length ? warnings.join(' ') : '登记成功，等待审核。'), r.ok ? 'ok' : 'err')
  if (r.ok) router.push('/my-shares')
}
</script>

<template>
  <SafetyBanner compact />

  <div class="card">
    <h2>登记共享物品</h2>
    <div class="muted" style="margin-bottom: 12px">
      仅限<strong>未拆封、在有效期内、无需冷藏的常备非处方耗材</strong>。处方药、口服/注射药品、拆封与冷链物品在提交时即被拦截。
    </div>

    <label class="field">
      <span>品名</span>
      <input v-model="form.name" type="text" placeholder="如：医用退热贴、碘伏棉片、无菌纱布" />
    </label>

    <label class="field">
      <span>品类</span>
      <select v-model="form.category">
        <option v-for="[k, v] in categories" :key="k" :value="k">{{ v }}</option>
      </select>
    </label>

    <label class="field">
      <span>规格</span>
      <input v-model="form.spec" type="text" placeholder="如：4贴/盒、20片/盒、50只/盒" />
    </label>

    <div class="grid grid-2">
      <label class="field">
        <span>有效期至</span>
        <input v-model="form.expiryDate" type="date" />
      </label>
      <label class="field">
        <span>可借数量（盒/包）</span>
        <input v-model.number="form.quantity" type="number" min="1" max="999" />
      </label>
    </div>

    <label class="field">
      <span>存放条件</span>
      <select v-model="form.storage">
        <option value="room_temp">{{ STORAGE_LABELS.room_temp }}</option>
        <option value="cool_dry">{{ STORAGE_LABELS.cool_dry }}</option>
        <option value="refrigerate">{{ STORAGE_LABELS.refrigerate }}（冷链禁入）</option>
      </select>
    </label>

    <label class="check-row">
      <input v-model="form.sealed" type="checkbox" />
      我确认物品整盒/整包<strong>未开封、封签完好</strong>（拆封物品不能进入共享）
    </label>

    <label class="field" style="margin-top: 10px">
      <span>取用地点</span>
      <input v-model="form.location" type="text" placeholder="如：3号楼1单元一楼“邻里药箱”共享柜 A格" />
    </label>

    <label class="field">
      <span>适用场景（可多选）</span>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <label v-for="[k, v] in scenes" :key="k" class="check-row" style="padding: 4px 0">
          <input type="checkbox" :checked="form.sceneTags.includes(k)" @change="toggleScene(k)" />
          {{ v }}
        </label>
      </div>
    </label>

    <label class="field">
      <span>给邻居的留言（可选）</span>
      <textarea v-model="form.note" placeholder="如：家里备多了，未拆封，夜间急用可先取。"></textarea>
    </label>

    <div v-for="(e, i) in validation.errors" :key="`e${i}`" class="banner banner-danger">⛔ {{ e }}</div>
    <div v-for="(w, i) in validation.warnings" :key="`w${i}`" class="banner banner-warn">⚠️ {{ w }}</div>

    <div class="card-actions">
      <button class="btn btn-primary" :disabled="!!validation.errors.length" @click="submit">提交登记，送志愿者审核</button>
      <button class="btn" @click="router.push('/hall')">取消</button>
    </div>
  </div>
</template>
