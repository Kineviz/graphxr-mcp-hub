#!/usr/bin/env bash
# GraphXR MCP Hub Docker 发布脚本
# 支持构建、测试、推送 Docker 镜像
set -euo pipefail

IMAGE_NAME="kineviz/graphxr-mcp-server"
NPM_PACKAGE="@kineviz/graphxr_mcp_server"
CONTAINER_NAME="graphxr-mcp-test"
PORT=8899
HEALTH_URL="http://localhost:${PORT}/health"

# 切换到项目根目录
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")

# --- 参数解析 ---
DO_PUSH=false
DO_TEST=false
DO_NPM=false
IMAGE_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)  DO_PUSH=true; shift ;;
    --test)  DO_TEST=true; shift ;;
    --npm)   DO_NPM=true; shift ;;
    --tag)   IMAGE_TAG="$2"; shift 2 ;;
    -h|--help) IMAGE_TAG="__help__"; shift ;;
    *)
      echo "未知参数: $1"
      IMAGE_TAG="__help__"
      break
      ;;
  esac
done

IMAGE_TAG="${IMAGE_TAG:-${VERSION}}"

# --- 用法提示 ---
usage() {
  cat <<EOF
GraphXR MCP Hub Docker 发布脚本

用法:
  ./scripts/publish.sh [选项]

选项:
  --test       构建镜像后启动容器并运行健康检查测试
  --push       构建镜像后推送到 Docker Hub
  --npm        发布 npm 包到 npmjs.com (${NPM_PACKAGE})
  --tag TAG    指定镜像 tag (默认: package.json 版本号 ${VERSION})
  -h, --help   显示此帮助信息

示例:
  ./scripts/publish.sh --test              # 构建并测试
  ./scripts/publish.sh --push              # 构建并推送 Docker
  ./scripts/publish.sh --npm               # 发布 npm 包
  ./scripts/publish.sh --test --push --npm # 全部发布
  ./scripts/publish.sh --tag v1.0.0 --push # 指定 tag 构建并推送

Docker 镜像: ${IMAGE_NAME}
npm 包: ${NPM_PACKAGE}
EOF
}

if [[ "$IMAGE_TAG" == "__help__" ]] || { ! $DO_PUSH && ! $DO_TEST && ! $DO_NPM; }; then
  usage
  exit 0
fi

# --- 构建 ---
build() {
  echo "=== 构建 Docker 镜像: ${IMAGE_NAME}:${IMAGE_TAG} ==="
  docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

  # 同时打上 latest 标签
  if [[ "$IMAGE_TAG" != "latest" ]]; then
    docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:latest"
    echo "  已标记 ${IMAGE_NAME}:latest"
  fi
  echo ""
}

# --- 测试 ---
test_image() {
  echo "=== 启动测试容器 ==="
  docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true
  docker run -d --name "${CONTAINER_NAME}" -p "${PORT}:${PORT}" "${IMAGE_NAME}:${IMAGE_TAG}"

  echo ""
  echo "=== 等待服务就绪 ==="
  local max_retries=15
  local interval=2
  for i in $(seq 1 $max_retries); do
    if curl -sf "${HEALTH_URL}" > /dev/null 2>&1; then
      echo "  服务已就绪 (第 ${i} 次检测)"
      break
    fi
    if [ "$i" -eq "$max_retries" ]; then
      echo "  错误: 服务在 $((max_retries * interval)) 秒内未就绪"
      echo "  容器日志:"
      docker logs "${CONTAINER_NAME}"
      docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true
      exit 1
    fi
    echo "  等待中... (${i}/${max_retries})"
    sleep $interval
  done

  echo ""
  echo "=== 健康检查 ==="
  local health_response
  health_response=$(curl -sf "${HEALTH_URL}")
  echo "  GET /health -> ${health_response}"

  if echo "${health_response}" | grep -q '"status":"ok"'; then
    echo "  [PASS] 健康检查通过"
  else
    echo "  [FAIL] 健康检查失败"
    docker logs "${CONTAINER_NAME}"
    docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true
    exit 1
  fi

  echo ""
  echo "=== MCP 信息检查 ==="
  local mcp_response
  mcp_response=$(curl -sf "http://localhost:${PORT}/mcp-info" || echo "")
  if [ -n "${mcp_response}" ]; then
    echo "  GET /mcp-info -> ${mcp_response}"
    echo "  [PASS] MCP 信息端点正常"
  else
    echo "  [WARN] MCP 信息端点无响应 (非致命)"
  fi

  echo ""
  echo "=== Docker HEALTHCHECK 状态 ==="
  sleep 5
  local health_status
  health_status=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "unknown")
  echo "  Docker health status: ${health_status}"

  echo ""
  echo "=== 清理测试容器 ==="
  docker rm -f "${CONTAINER_NAME}" > /dev/null
  echo "  已清理"

  echo ""
  echo "=== 测试完成 [PASS] ==="
}

# --- 推送 ---
push_image() {
  echo "=== 推送镜像到 Docker Hub ==="
  docker push "${IMAGE_NAME}:${IMAGE_TAG}"
  if [[ "$IMAGE_TAG" != "latest" ]]; then
    docker push "${IMAGE_NAME}:latest"
  fi
  echo "  已推送 ${IMAGE_NAME}:${IMAGE_TAG}"
  echo ""
}

# --- 执行 ---
build

if $DO_TEST; then
  test_image
fi

if $DO_PUSH; then
  push_image
fi

# --- npm 发布 ---
publish_npm() {
  echo "=== 发布 npm 包: ${NPM_PACKAGE}@${VERSION} ==="

  # 检查 shebang
  local entry="dist/graphxr_mcp_server/index.js"
  if ! head -1 "$entry" | grep -q '^#!/usr/bin/env node'; then
    echo "  错误: ${entry} 缺少 shebang 行，请先运行 npm run build:server"
    exit 1
  fi

  # 预览包内容
  echo ""
  echo "=== npm pack 预览 ==="
  npm pack --dry-run 2>&1 | tail -20
  echo ""

  # 发布 (scoped 包默认 restricted，需要 --access public)
  npm publish --access public
  echo "  已发布 ${NPM_PACKAGE}@${VERSION}"
  echo ""
}

if $DO_NPM; then
  publish_npm
fi

echo "完成!"
if $DO_PUSH || $DO_TEST; then
  echo "  Docker: ${IMAGE_NAME}:${IMAGE_TAG}"
fi
if $DO_NPM; then
  echo "  npm: ${NPM_PACKAGE}@${VERSION}"
fi
