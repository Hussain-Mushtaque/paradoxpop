#!/usr/bin/env bash
# Installs Node 24 and a static FFmpeg into ./.tools without sudo (Muse's VM has no root).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .tools/bin
export PATH="$PWD/.tools/bin:$PATH"
case "$(uname -m)" in
  x86_64) node_arch=x64; ff_arch=amd64 ;;
  aarch64|arm64) node_arch=arm64; ff_arch=arm64 ;;
  *) echo "unsupported architecture $(uname -m)"; exit 1 ;;
esac

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  file=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk "/linux-${node_arch}\.tar\.xz\$/ {print \$2}")
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$file" | tar -xJ -C .tools
  ln -sf "$PWD/.tools/${file%.tar.xz}/bin/node" .tools/bin/node
fi
if ! command -v ffmpeg >/dev/null; then
  curl -fsSL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${ff_arch}-static.tar.xz" | tar -xJ -C .tools
  for bin in ffmpeg ffprobe; do ln -sf "$(ls -d "$PWD"/.tools/ffmpeg-*-static)/$bin" ".tools/bin/$bin"; done
fi
node --version
ffmpeg -version | head -1
