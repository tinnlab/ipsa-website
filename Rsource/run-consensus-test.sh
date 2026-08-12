#!/usr/bin/env bash
# Reproducible validation of the consensus RRA logic (Bug 2A).
# Runs Rsource/test-consensus.R in a container with dplyr/tidyr + RobustRankAggreg,
# asserting the consensus output is NOT the degenerate "FDR=1 / score=0 for all".
#
# Usage:  bash Rsource/run-consensus-test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

docker run --rm -v "$HERE:/work" -w /work rocker/tidyverse:4.4.1 bash -c '
  R -q -e "if (!requireNamespace(\"RobustRankAggreg\", quietly=TRUE)) install.packages(\"RobustRankAggreg\", repos=\"https://cloud.r-project.org\")" >/dev/null 2>&1
  Rscript test-consensus.R
'
