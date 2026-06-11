FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8642

ENTRYPOINT ["/entrypoint.sh"]
