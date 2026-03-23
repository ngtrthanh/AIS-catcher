FROM debian:bookworm AS build

ARG RUN_NUMBER=0
ENV RUN_NUMBER=${RUN_NUMBER}

WORKDIR /src
COPY . /src

RUN bash scripts/build-debian.sh -o /tmp/output

FROM debian:bookworm-slim

COPY --from=build /tmp/output/ais-catcher.deb /tmp/ais-catcher.deb

RUN apt-get update && \
    apt-get install -y --no-install-recommends /tmp/ais-catcher.deb && \
    rm -f /tmp/ais-catcher.deb && \
    rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["/usr/bin/AIS-catcher"]
