#!/usr/bin/env bash
# Open the demo instance again with the data of the last recording (http://127.0.0.1:8010).
set -euo pipefail
cd "$(dirname "$0")/.."
export HKM_DEMO_KEEP=1
exec bash video/run_demo.sh
