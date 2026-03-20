#!/bin/sh
set -e

# дача (dacha) installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/eabrouwer3/dacha/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/eabrouwer3/dacha/main/install.sh | sh -s -- --repo https://github.com/user/dotfiles

GITHUB_OWNER="eabrouwer3"
REPO="dacha"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="dacha"

# ── Helpers ──────────────────────────────────────────────

info() {
  printf '\033[1;34m==>\033[0m %s\n' "$1"
}

success() {
  printf '\033[1;32m==>\033[0m %s\n' "$1"
}

warn() {
  printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2
}

error() {
  printf '\033[1;31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

# ── Platform detection ───────────────────────────────────

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin) OS="darwin" ;;
    Linux)  OS="linux" ;;
    *)      error "Unsupported OS: $OS" ;;
  esac

  case "$ARCH" in
    arm64 | aarch64) ARCH="arm64" ;;
    x86_64)          ARCH="x64" ;;
    *)               error "Unsupported architecture: $ARCH" ;;
  esac

  BINARY="dacha-${OS}-${ARCH}"
  info "Detected platform: ${OS}/${ARCH}"
}

# ── Download ─────────────────────────────────────────────

download() {
  url="$1"
  dest="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$dest" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    error "Neither curl nor wget found. Please install one and retry."
  fi
}

# ── Checksum verification ────────────────────────────────

verify_checksum() {
  binary_path="$1"
  checksums_path="$2"

  expected="$(grep "${BINARY}" "$checksums_path" | awk '{print $1}')"
  if [ -z "$expected" ]; then
    error "No checksum found for ${BINARY} in sha256sums.txt"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$binary_path" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$binary_path" | awk '{print $1}')"
  else
    warn "Neither sha256sum nor shasum found — skipping checksum verification"
    return 0
  fi

  if [ "$expected" != "$actual" ]; then
    error "Checksum mismatch!\n  expected: ${expected}\n  actual:   ${actual}"
  fi

  info "Checksum verified"
}

# ── Install ──────────────────────────────────────────────

install_binary() {
  BASE_URL="https://github.com/${GITHUB_OWNER}/${REPO}/releases/latest/download"
  TMPDIR_INSTALL="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_INSTALL"' EXIT

  info "Downloading ${BINARY}..."
  download "${BASE_URL}/${BINARY}" "${TMPDIR_INSTALL}/${BINARY}"

  info "Downloading sha256sums.txt..."
  download "${BASE_URL}/sha256sums.txt" "${TMPDIR_INSTALL}/sha256sums.txt"

  verify_checksum "${TMPDIR_INSTALL}/${BINARY}" "${TMPDIR_INSTALL}/sha256sums.txt"

  mkdir -p "$INSTALL_DIR"
  mv "${TMPDIR_INSTALL}/${BINARY}" "${INSTALL_DIR}/${BINARY_NAME}"
  chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

  success "Installed ${BINARY_NAME} to ${INSTALL_DIR}/${BINARY_NAME}"
}

# ── PATH check ───────────────────────────────────────────

check_path() {
  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) ;;
    *)
      warn "${INSTALL_DIR} is not in your PATH"
      printf '\n  Add it by appending one of these to your shell config:\n'
      printf '    export PATH="%s:$PATH"        # bash/zsh (~/.bashrc or ~/.zshrc)\n' "$INSTALL_DIR"
      printf '    fish_add_path %s               # fish (~/.config/fish/config.fish)\n' "$INSTALL_DIR"
      printf '\n'
      ;;
  esac
}

# ── Argument parsing ─────────────────────────────────────

parse_args() {
  REPO_URL=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo)
        shift
        if [ $# -eq 0 ]; then
          error "--repo requires a URL argument"
        fi
        REPO_URL="$1"
        ;;
      *)
        warn "Unknown argument: $1"
        ;;
    esac
    shift
  done
}

# ── Main ─────────────────────────────────────────────────

main() {
  parse_args "$@"
  detect_platform
  install_binary
  check_path

  if [ -n "$REPO_URL" ]; then
    info "Running: ${BINARY_NAME} init ${REPO_URL} --path ~/.dacha"
    "${INSTALL_DIR}/${BINARY_NAME}" init "$REPO_URL" --path "$HOME/.dacha"
  fi

  success "Done! Run 'dacha --help' to get started."
}

main "$@"
