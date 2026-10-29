FROM docker:29-cli AS docker
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl shellcheck sudo python3 \
    && rm -rf /var/lib/apt/lists/* \
    && chmod 0755 /root \
    && useradd -m installer \
    && printf 'installer ALL=(ALL) NOPASSWD: ALL\n' >/etc/sudoers.d/installer
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
