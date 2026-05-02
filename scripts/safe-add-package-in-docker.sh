#!/bin/sh

set -eu

if [ "$#" -eq 0 ]; then
  echo "使い方: sh ./scripts/safe-add-package-in-docker.sh <package...>"
  echo "例: sh ./scripts/safe-add-package-in-docker.sh soundfont-player"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker コマンドが見つかりません。Docker Desktop を起動してから再実行してください。"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker デーモンに接続できません。Docker Desktop を起動してから再実行してください。"
  exit 1
fi

# postinstall などの自動スクリプトを防ぎながら依存を追加する。
# package.json / package-lock.json は bind mount 経由でホスト側にも反映される。
docker compose run --rm app npm install --ignore-scripts "$@"
