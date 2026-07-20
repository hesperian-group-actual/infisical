#!/bin/sh

update-ca-certificates

# Prefer an explicit Railway/env override; fall back to a low runtime heap.
# max-old-space-size is a V8 ceiling (MB). The previous image default of 2048
# matched ~2GB steady RAM on Railway and drove most of the Infisical bill.
if [ -z "$NODE_OPTIONS" ]; then
  export NODE_OPTIONS="--max-old-space-size=768"
fi

exec node --enable-source-maps dist/main.mjs
