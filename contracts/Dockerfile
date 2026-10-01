# Reproducible Soroban toolchain: Rust + wasm32v1-none + Stellar CLI.
# Used for contract build/test/deploy on any host (see docs/DECISIONS.md D-014).
FROM rust:1.92-bookworm

ARG STELLAR_CLI_VERSION=28.1.0

RUN rustup target add wasm32v1-none \
 && rustup component add rustfmt clippy \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq libdbus-1-3 libudev1 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/stellar-cli-${STELLAR_CLI_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xz -C /usr/local/bin stellar \
 && stellar --version

WORKDIR /work/contracts
