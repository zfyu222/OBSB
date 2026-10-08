ARG OPENCODE_IMAGE
FROM ${OPENCODE_IMAGE}

USER root
RUN apk add --no-cache bash curl git jq openssh-client py3-pip py3-yaml python3 ripgrep tzdata
RUN if ! getent passwd 1026 >/dev/null; then adduser -D -H -u 1026 -G users -h /var/lib/brain-agent obsb; fi

ENV HOME=/var/lib/brain-agent \
    XDG_CONFIG_HOME=/var/lib/brain-agent/.config \
    XDG_DATA_HOME=/var/lib/brain-agent/.local/share \
    XDG_CACHE_HOME=/var/lib/brain-agent/.cache

RUN mkdir -p /var/lib/brain-agent && chown -R 1026:100 /var/lib/brain-agent

USER 1026:100
WORKDIR /workspace
ENTRYPOINT ["opencode"]
CMD ["serve", "--hostname", "0.0.0.0", "--port", "4096"]
