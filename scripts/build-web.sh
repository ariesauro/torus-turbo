#!/bin/bash
# Build web-portable Torus Turbo and copy to release/Web.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== Building web-portable ==="
npm run build:web:portable

DEST="$PROJECT_DIR/release/Web"
mkdir -p "$DEST"

echo "=== Copying artifacts to release/Web ==="
rm -rf "$DEST/app"
cp -r dist-web "$DEST/app"

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"

cat > "$DEST/README.txt" << 'READMEEOF'
TORUS TURBO v__VERSION__
Platform: Web (Browser)
Backend:  JS CPU + WebGPU (if supported by browser)
Built:    __DATE__

SYSTEM REQUIREMENTS
-------------------
- Modern web browser with ES2020 support
- Chrome 113+ / Edge 113+ / Firefox 120+ / Safari 17+
- WebGPU support recommended (Chrome 113+, Edge 113+)
- Without WebGPU: runs in JS CPU-only mode (slower)
- 4 GB RAM minimum

HOW TO RUN
----------
1. Open app/index.html in a web browser
   OR
2. Serve the app/ directory via any HTTP server:
   npx serve app
   python3 -m http.server -d app 8080

DEPENDENCIES
------------
All dependencies are bundled. No additional installation required.
READMEEOF

sed -i.bak "s/__VERSION__/$VERSION/g" "$DEST/README.txt"
sed -i.bak "s/__DATE__/$(date -u '+%Y-%m-%d %H:%M UTC')/g" "$DEST/README.txt"
rm -f "$DEST/README.txt.bak"

echo "=== Build complete ==="
echo "Artifacts in: $DEST"
