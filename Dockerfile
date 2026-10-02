# 邻里药箱 · 一键启动镜像（纯前端静态站点：Vite 构建 → nginx 托管）

# ---- 构建阶段 ----
FROM node:20-alpine AS build
WORKDIR /app

# 先复制依赖清单以利用层缓存
COPY package.json package-lock.json* ./
RUN npm ci --cache /tmp/npm-cache || npm install --cache /tmp/npm-cache

# 复制源码并做类型检查 + 生产构建
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM nginx:1.27-alpine AS runtime
# SPA（hash 路由）静态托管配置
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
