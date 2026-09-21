#!/usr/bin/env bash
#
# 개발 서버(http://localhost:5173) 관리 스크립트.
#
#   ./manage.sh start | stop | restart | status | logs
#
# vite 를 백그라운드로 띄우고 PID 를 파일에 남긴다. PID 파일만 믿지 않고
# **포트를 실제로 잡고 있는 프로세스**도 함께 본다 — 터미널을 닫아 PID 파일만
# 남고 서버는 죽었거나, 반대로 다른 창에서 띄운 서버가 포트를 물고 있는 경우가
# 흔해서, 그때마다 "이미 실행 중"이나 "포트 사용 중"에 막히면 쓸모가 없다.

set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PORT="${PORT:-5173}"
readonly URL="http://localhost:${PORT}/"
readonly PID_FILE="${ROOT}/.dev-server.pid"
readonly LOG_FILE="${ROOT}/.dev-server.log"
readonly STARTUP_TIMEOUT=30

cd "$ROOT"

# ── 상태 조회 ────────────────────────────────────────────────────────────────

# 포트를 LISTEN 중인 PID 들 (없으면 빈 출력)
port_pids() {
  lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true
}

# 기록해 둔 PID 가 아직 살아 있으면 출력
recorded_pid() {
  [[ -f "$PID_FILE" ]] || return 0
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && echo "$pid"
  return 0
}

# 지금 살아 있는 서버 PID 전부 (중복 제거)
server_pids() {
  { recorded_pid; port_pids; } | sort -u | tr '\n' ' ' | sed 's/ *$//'
}

# ── 명령 ─────────────────────────────────────────────────────────────────────

start() {
  local running
  running="$(server_pids)"
  if [[ -n "$running" ]]; then
    echo "이미 실행 중입니다 (PID ${running}) — ${URL}"
    echo "다시 띄우려면: ./manage.sh restart"
    return 0
  fi

  if [[ ! -d node_modules ]]; then
    echo "node_modules 가 없습니다. npm install 을 먼저 실행합니다."
    npm install
  fi

  echo "개발 서버를 띄웁니다 (포트 ${PORT})..."
  : > "$LOG_FILE"
  # 부모 셸(터미널)이 끝나도 서버가 같이 죽지 않도록 nohup 을 쓴다
  nohup npx vite --port "$PORT" --strictPort >> "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  # 포트를 실제로 열 때까지 기다린다 — 바로 성공을 알리면 아직 안 뜬 주소를 열게 된다
  local waited=0
  while (( waited < STARTUP_TIMEOUT )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "기동에 실패했습니다. 로그:"
      tail -20 "$LOG_FILE"
      rm -f "$PID_FILE"
      return 1
    fi
    if [[ -n "$(port_pids)" ]]; then
      echo "실행 중 (PID ${pid}) — ${URL}"
      echo "로그: ./manage.sh logs"
      return 0
    fi
    sleep 0.5
    waited=$((waited + 1))
  done

  echo "${STARTUP_TIMEOUT} 초 안에 포트가 열리지 않았습니다. 로그:"
  tail -20 "$LOG_FILE"
  return 1
}

stop() {
  local pids
  pids="$(server_pids)"
  if [[ -z "$pids" ]]; then
    echo "실행 중이 아닙니다."
    rm -f "$PID_FILE"
    return 0
  fi

  echo "종료합니다 (PID ${pids})..."
  # 먼저 정상 종료를 요청하고, 버티면 그때 강제한다
  kill $pids 2>/dev/null || true
  local waited=0
  while (( waited < 20 )); do
    [[ -z "$(server_pids)" ]] && break
    sleep 0.25
    waited=$((waited + 1))
  done

  pids="$(server_pids)"
  if [[ -n "$pids" ]]; then
    echo "응답이 없어 강제 종료합니다 (PID ${pids})"
    kill -9 $pids 2>/dev/null || true
    sleep 0.5
  fi

  rm -f "$PID_FILE"
  echo "종료했습니다."
}

restart() {
  stop
  start
}

status() {
  local pids
  pids="$(server_pids)"
  if [[ -n "$pids" ]]; then
    echo "실행 중 (PID ${pids}) — ${URL}"
    return 0
  fi
  echo "정지 상태 (포트 ${PORT} 비어 있음)"
  return 1
}

logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "로그가 없습니다. 먼저 ./manage.sh start 를 실행하세요."
    return 1
  fi
  tail -f "$LOG_FILE"
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) restart ;;
  status)  status ;;
  logs)    logs ;;
  *)
    cat <<USAGE
사용법: ./manage.sh <명령>

  start     개발 서버를 백그라운드로 띄운다 (${URL})
  stop      서버를 종료한다
  restart   재시작한다
  status    실행 여부를 확인한다
  logs      서버 로그를 따라간다 (Ctrl+C 로 빠져나옴)

포트는 PORT 환경변수로 바꿀 수 있습니다: PORT=5174 ./manage.sh start
USAGE
    exit 1
    ;;
esac
