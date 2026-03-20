#!/bin/bash
# Build native Torus Turbo for the current platform.
# Usage:
#   ./scripts/build-native.sh              # current platform
#   ./scripts/build-native.sh macos-arm64  # Apple Silicon
#   ./scripts/build-native.sh macos-x64    # Intel Mac
#   ./scripts/build-native.sh linux-x64    # Linux x86_64

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

TARGET="${1:-auto}"
RELEASE_ROOT="$PROJECT_DIR/release"

case "$TARGET" in
  macos-arm64)
    RUST_TARGET="aarch64-apple-darwin"
    PLATFORM_DIR="MacOS (Apple Silicon)"
    ;;
  macos-x64)
    RUST_TARGET="x86_64-apple-darwin"
    PLATFORM_DIR="MacOS (Intel)"
    ;;
  macos-universal)
    echo "Building universal macOS binary..."
    "$0" macos-arm64
    "$0" macos-x64
    echo "Creating universal binary with lipo..."
    CORE_DIR="torus-core/target"
    mkdir -p "$CORE_DIR/universal-apple-darwin/release"
    lipo -create \
      "$CORE_DIR/aarch64-apple-darwin/release/libtorus_physics.a" \
      "$CORE_DIR/x86_64-apple-darwin/release/libtorus_physics.a" \
      -output "$CORE_DIR/universal-apple-darwin/release/libtorus_physics.a"
    echo "Universal binary created."
    exit 0
    ;;
  linux-x64)
    RUST_TARGET="x86_64-unknown-linux-gnu"
    PLATFORM_DIR="Linux"
    ;;
  linux-arm64)
    RUST_TARGET="aarch64-unknown-linux-gnu"
    PLATFORM_DIR="Linux"
    ;;
  auto)
    RUST_TARGET=""
    ARCH="$(uname -m)"
    OS="$(uname -s)"
    if [ "$OS" = "Darwin" ]; then
      if [ "$ARCH" = "arm64" ]; then
        PLATFORM_DIR="MacOS (Apple Silicon)"
      else
        PLATFORM_DIR="MacOS (Intel)"
      fi
    elif [ "$OS" = "Linux" ]; then
      PLATFORM_DIR="Linux"
    else
      PLATFORM_DIR="Other"
    fi
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Supported: macos-arm64, macos-x64, macos-universal, linux-x64, linux-arm64, auto"
    exit 1
    ;;
esac

echo "=== Building Rust core ==="
if [ -n "$RUST_TARGET" ]; then
  echo "Target: $RUST_TARGET"
  cargo build --release --manifest-path torus-core/Cargo.toml --target "$RUST_TARGET"
else
  cargo build --release --manifest-path torus-core/Cargo.toml
fi

echo "=== Running core tests ==="
if [ -z "$RUST_TARGET" ]; then
  cargo test --release --manifest-path torus-core/Cargo.toml
fi

echo "=== Building frontend ==="
npm run build

echo "=== Building Tauri app (native-core) ==="
if [ -n "$RUST_TARGET" ]; then
  CI=false npx tauri build --features native-core --target "$RUST_TARGET"
else
  CI=false npx tauri build --features native-core
fi

echo "=== Copying artifacts to release/$PLATFORM_DIR ==="
DEST="$RELEASE_ROOT/$PLATFORM_DIR"
mkdir -p "$DEST"

if [ -n "$RUST_TARGET" ]; then
  BUNDLE_DIR="src-tauri/target/$RUST_TARGET/release/bundle"
else
  BUNDLE_DIR="src-tauri/target/release/bundle"
fi

if [ -d "$BUNDLE_DIR/dmg" ]; then
  cp -v "$BUNDLE_DIR/dmg/"*.dmg "$DEST/" 2>/dev/null || true
fi
if [ -d "$BUNDLE_DIR/macos" ]; then
  cp -rv "$BUNDLE_DIR/macos/"*.app "$DEST/" 2>/dev/null || true
fi
if [ -d "$BUNDLE_DIR/deb" ]; then
  cp -v "$BUNDLE_DIR/deb/"*.deb "$DEST/" 2>/dev/null || true
fi
if [ -d "$BUNDLE_DIR/appimage" ]; then
  cp -v "$BUNDLE_DIR/appimage/"*.AppImage "$DEST/" 2>/dev/null || true
fi
if [ -d "$BUNDLE_DIR/rpm" ]; then
  cp -v "$BUNDLE_DIR/rpm/"*.rpm "$DEST/" 2>/dev/null || true
fi

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
RUST_TARGET_DISPLAY="${RUST_TARGET:-$(rustc -vV 2>/dev/null | grep 'host:' | awk '{print $2}' || echo 'native')}"
BUILD_DATE="$(date -u '+%Y-%m-%d %H:%M UTC')"

case "$PLATFORM_DIR" in
  "MacOS (Apple Silicon)")
    SYS_REQUIREMENTS="- macOS 11.0 (Big Sur) or later
- Apple Silicon (M1/M2/M3/M4)
- 4 GB RAM minimum, 8 GB recommended"
    INSTALL_INSTRUCTIONS="1. Open the .dmg file
2. Drag 'Torus Turbo.app' to the Applications folder
3. On first launch: right-click > Open (to bypass Gatekeeper)"
    ;;
  "MacOS (Intel)")
    SYS_REQUIREMENTS="- macOS 10.15 (Catalina) or later
- Intel x86_64 processor
- 4 GB RAM minimum, 8 GB recommended"
    INSTALL_INSTRUCTIONS="1. Open the .dmg file
2. Drag 'Torus Turbo.app' to the Applications folder
3. On first launch: right-click > Open (to bypass Gatekeeper)"
    ;;
  "Linux")
    SYS_REQUIREMENTS="- Ubuntu 20.04+ / Fedora 35+ / Arch Linux (or compatible)
- x86_64 processor
- 4 GB RAM minimum, 8 GB recommended
- WebKit2GTK 4.1+ runtime"
    INSTALL_INSTRUCTIONS="AppImage:
  chmod +x Torus_Turbo*.AppImage
  ./Torus_Turbo*.AppImage

Debian/Ubuntu (.deb):
  sudo dpkg -i torus-turbo_*.deb

Fedora/RHEL (.rpm):
  sudo rpm -i torus-turbo-*.rpm"
    ;;
  *)
    SYS_REQUIREMENTS="See project documentation."
    INSTALL_INSTRUCTIONS="See project documentation."
    ;;
esac

cat > "$DEST/README.txt" << READMEEOF
TORUS TURBO v${VERSION}
Platform: ${PLATFORM_DIR}
Target:   ${RUST_TARGET_DISPLAY}
Backend:  Native (Rust CPU + Native GPU)
Built:    ${BUILD_DATE}

SYSTEM REQUIREMENTS
-------------------
${SYS_REQUIREMENTS}

INSTALLATION
------------
${INSTALL_INSTRUCTIONS}

DEPENDENCIES
------------
All dependencies are bundled. No additional installation required.
READMEEOF

echo "=== Build complete ==="
echo "Artifacts in: $DEST"
