#!/bin/sh
set -e

# Fix ownership of the data directory in case it was mounted as a volume
# owned by root (or another user) from the host.
chown -R bun:bun /data

exec su-exec bun "$@"
