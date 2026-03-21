#!/bin/sh
set -e

# дача (dacha) installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/eabrouwer3/dacha/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/eabrouwer3/dacha/main/install.sh | sh -s -- --repo https://github.com/user/dotfiles

GITHUB_OWNER="eabrouwer3"
REPO="dacha"
INSTALL_DIR="$HOME/.local/bin"
DACHA_DIR="$HOME/.local/share/dacha/cli"

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

# ── Download helper ──────────────────────────────────────

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

# ── Ensure Deno is installed ─────────────────────────────

ensure_deno() {
  if command -v deno >/dev/null 2>&1; then
    info "Deno already installed: $(deno --version | head -1)"
    return
  fi

  info "Installing Deno..."
  # Download installer to a temp file to avoid nested pipe-to-shell issues
  # (when this script itself is piped via curl | sh, stdin is consumed)
  DENO_INSTALLER="$(mktemp)"
  curl -fsSL -o "$DENO_INSTALLER" https://deno.land/install.sh
  sh "$DENO_INSTALLER"
  rm -f "$DENO_INSTALLER"

  # Add to PATH for this session
  export DENO_INSTALL="$HOME/.deno"
  export PATH="$DENO_INSTALL/bin:$PATH"

  if ! command -v deno >/dev/null 2>&1; then
    error "Deno installation failed. Please install manually: https://deno.land"
  fi

  success "Deno installed: $(deno --version | head -1)"
}

# ── Resolve latest version tag ───────────────────────────

resolve_version() {
  TAG=""
  if command -v curl >/dev/null 2>&1; then
    REDIRECT_URL="$(curl -fsSo /dev/null -w '%{redirect_url}' "https://github.com/${GITHUB_OWNER}/${REPO}/releases/latest" 2>/dev/null || true)"
    TAG="$(printf '%s' "$REDIRECT_URL" | grep -o '[^/]*$' 2>/dev/null || true)"
  elif command -v wget >/dev/null 2>&1; then
    REDIRECT_URL="$(wget --spider --max-redirect=0 "https://github.com/${GITHUB_OWNER}/${REPO}/releases/latest" 2>&1 | grep -o 'Location:.*' || true)"
    TAG="$(printf '%s' "$REDIRECT_URL" | grep -o '[^/]*$' 2>/dev/null || true)"
  fi

  if [ -z "$TAG" ]; then
    TAG="main"
    warn "Could not resolve latest release — using main branch"
  fi

  info "Version: ${TAG}"
}

# ── Clone or update dacha source ─────────────────────────

install_source() {
  if [ -d "$DACHA_DIR/.git" ]; then
    info "Updating dacha source..."
    git -C "$DACHA_DIR" fetch --tags --quiet
    git -C "$DACHA_DIR" checkout "$TAG" --quiet 2>/dev/null || git -C "$DACHA_DIR" checkout "origin/$TAG" --quiet
  else
    info "Cloning dacha source..."
    mkdir -p "$(dirname "$DACHA_DIR")"
    git clone --quiet "https://github.com/${GITHUB_OWNER}/${REPO}.git" "$DACHA_DIR"
    git -C "$DACHA_DIR" checkout "$TAG" --quiet 2>/dev/null || true
  fi
}

# ── Create launcher script ───────────────────────────────

install_launcher() {
  mkdir -p "$INSTALL_DIR"

  cat > "${INSTALL_DIR}/dacha" << 'LAUNCHER'
#!/bin/sh
# dacha launcher — runs dacha via deno from source
DACHA_DIR="$HOME/.local/share/dacha/cli"
DENO_INSTALL="$HOME/.deno"

# Ensure deno is on PATH
if [ -d "$DENO_INSTALL/bin" ]; then
  PATH="$DENO_INSTALL/bin:$PATH"
fi

exec deno run --allow-all "$DACHA_DIR/src/cli.ts" "$@"
LAUNCHER

  chmod +x "${INSTALL_DIR}/dacha"
  success "Installed dacha launcher to ${INSTALL_DIR}/dacha"
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
  ensure_deno
  resolve_version
  install_source
  install_launcher
  check_path

  # Cache deno dependencies
  info "Caching dependencies..."
  deno cache "$DACHA_DIR/src/cli.ts" 2>/dev/null || true

  if [ -n "$REPO_URL" ]; then
    info "Running: dacha init ${REPO_URL} --path ~/.dacha"
    "${INSTALL_DIR}/dacha" init "$REPO_URL" --path "$HOME/.dacha"
  fi

  success "Done! Run 'dacha --help' to get started."
}

main "$@"
