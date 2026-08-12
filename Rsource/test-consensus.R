# Standalone validation of the consensus R logic, mirroring
# server/include/rCommand/ConsensusAnalysis.js:
#  - input frames carry a real `pFDR` column,
#  - RRA ranks by the rank.by it is given (live pipeline always passes it
#    explicitly; "pFDR" is just this mirror's match.arg default),
#  - the bogus `result$pathwaySize <- allData[, "pathwaySize"]` line is removed,
#  - enrichment scores flow through,
#  - weightedZMean uses the RCPA weighted mean with a (0,1) clamp + finite guard.
# Asserts the output is NOT the degenerate "FDR=1 / score=0 for all" result, and
# pins the weightedZMean numeric formula. Run via Rsource/run-consensus-test.sh.

suppressMessages({
  library(dplyr)
  library(tidyr)
  library(RobustRankAggreg)
})

.normalizeToZScore <- function(scores) {
  mean_score <- mean(scores, na.rm = TRUE)
  sd_score <- sd(scores, na.rm = TRUE)
  if (sd_score == 0 || is.na(sd_score)) sd_score <- 1
  (scores - mean_score) / sd_score
}

.combineEnrichmentScores <- function(resultsDFs, weightsLst) {
  if (length(resultsDFs) != length(weightsLst)) stop("length mismatch")
  all_pathways <- Reduce(union, lapply(resultsDFs, function(df) df$ID))
  z_matrix <- matrix(NA, nrow = length(all_pathways), ncol = length(resultsDFs))
  rownames(z_matrix) <- all_pathways
  for (i in 1:length(resultsDFs)) {
    df <- resultsDFs[[i]]
    score_col <- NULL
    if ("enrichmentScore" %in% colnames(df)) score_col <- "enrichmentScore"
    else if ("score" %in% colnames(df)) score_col <- "score"
    else if ("normalizedScore" %in% colnames(df)) score_col <- "normalizedScore"
    if (!is.null(score_col)) {
      z_scores <- .normalizeToZScore(df[[score_col]])
      indices <- match(df$ID, all_pathways)
      z_matrix[indices, i] <- z_scores
    }
  }
  weighted_z_scores <- numeric(length(all_pathways))
  for (i in 1:length(all_pathways)) {
    pathway_scores <- z_matrix[i, ]
    valid <- !is.na(pathway_scores)
    if (sum(valid) > 0) weighted_z_scores[i] <- weighted.mean(pathway_scores[valid], weightsLst[valid], na.rm = TRUE)
    else weighted_z_scores[i] <- NA
  }
  data.frame(ID = all_pathways, score = weighted_z_scores, stringsAsFactors = FALSE)
}

.runRankPathways <- function(resultsDFs, rankParam) {
  if (rankParam == "pFDR") {
    lapply(resultsDFs, function(data) data[order(data$pFDR, decreasing = FALSE), ][["ID"]])
  } else if (rankParam == "p.value") {
    lapply(resultsDFs, function(data) data[order(data$p.value, decreasing = FALSE), ][["ID"]])
  } else {
    lapply(resultsDFs, function(data) data[order(abs(data$normalizedScore), decreasing = TRUE), ][["ID"]])
  }
}

runConsensus <- function(PAResults,
                         method = "RRA",
                         # Mirror ConsensusAnalysis.js: default vector + match.arg, so the
                         # DEFAULT resolves to "pFDR" (asserted standalone below). Callers may
                         # pass rank.by explicitly to exercise other ranking paths.
                         rank.by = c("pFDR", "normalizedScore", "p.value", "both", "score"),
                         includeScore = TRUE) {
  rank.by <- match.arg(rank.by)
  commonPathways <- Reduce(intersect, lapply(PAResults, function(d) d$ID))
  if (length(commonPathways) == 0) stop("no common pathways")
  commonResults <- lapply(PAResults, function(d) d[d$ID %in% commonPathways, ])
  weightsList <- rep(1, length(commonResults))

  enrichmentScores <- if (includeScore) .combineEnrichmentScores(PAResults, weightsList) else NULL

  rankedPathwaysList <- .runRankPathways(PAResults, rank.by)
  spaceSet <- unique(unlist(rankedPathwaysList))
  r <- RobustRankAggreg::rankMatrix(rankedPathwaysList, N = length(spaceSet))
  result <- RobustRankAggreg::aggregateRanks(rmat = r, full = TRUE, method = "RRA")
  colnames(result) <- c("ID", "p.value")
  allData <- do.call(rbind, PAResults)
  result$pValueFDR <- p.adjust(result$p.value, method = "fdr")
  result$name <- allData[match(result$ID, allData$ID), c("name")]
  if (includeScore) result <- result %>% left_join(enrichmentScores, by = "ID")
  result <- result[order(result$p.value), ]
  result <- result %>% rename(pValue = p.value)
  result$pathway <- result$ID
  if ("score" %in% colnames(result)) result <- result %>% select(ID, pathway, pValue, pValueFDR, name, score)
  else result <- result %>% select(ID, pathway, pValue, pValueFDR, name)
  result
}

# Mirrors the FIXED .runWeightedMean in server/include/rCommand/ConsensusAnalysis.js:
# RCPA weighted MEAN of z-values  ->  p = pnorm(weighted.mean(qnorm(p_i), w_i)),
# including the (0,1) clamp + is.finite guard the live code adds.
# Scope: this mirror covers ONLY the mean math + clamp/guard. It deliberately
# does NOT reproduce the live template's output plumbing (pValueFDR derivation,
# .combineEnrichmentScores join, rename/select). Keep in sync if the formula
# or the clamp/guard changes.
.runWeightedMean <- function(resultsDFs, weightsLst, useFDR = TRUE) {
  resultsDFs <- lapply(seq_along(resultsDFs), function(i) {
    resultsDFs[[i]]$weight <- rep(weightsLst[i], nrow(resultsDFs[[i]]))
    resultsDFs[[i]]
  })
  allResults <- do.call(rbind, resultsDFs)
  do.call(rbind, lapply(split(allResults, allResults$ID), function(data) {
    pvals <- if (useFDR) data$pFDR else data$p.value
    pvals <- pmin(pmax(pvals, .Machine$double.xmin), 1 - 1e-16)
    z <- qnorm(pvals)
    ok <- is.finite(z) & is.finite(data$weight)
    p <- if (any(ok)) pnorm(weighted.mean(z[ok], data$weight[ok])) else NA_real_
    data.frame(ID = data$ID[1], p.value = p, name = data$name[1], stringsAsFactors = FALSE)
  }))
}

mkMethod <- function(pfdr, scores) {
  ids <- paste0("P", seq_along(pfdr))
  data.frame(ID = ids, p.value = pfdr / 2, pFDR = pfdr, normalizedScore = scores,
             sampleSize = rep(20, length(pfdr)), name = ids, stringsAsFactors = FALSE)
}

PAResults <- list(
  mkMethod(c(0.001, 0.005, 0.01, 0.2, 0.5, 0.9),  c(2.5, 2.0, 1.5, 0.5, -0.5, -1.0)),
  mkMethod(c(0.002, 0.004, 0.02, 0.3, 0.6, 0.8),  c(2.4, 1.9, 1.4, 0.4, -0.6, -1.1)),
  mkMethod(c(0.001, 0.006, 0.03, 0.25, 0.55, 0.95), c(2.6, 2.1, 1.3, 0.3, -0.4, -1.2))
)

# NOTE: the LIVE pipeline always passes rank.by explicitly — analysis.js writes a
# 3-key RDS (PAResults, method, rank.by="${safeRankBy}") from resolveConsensusOptions,
# so ConsensusAnalysis.js never falls back to its match.arg default in production.
# The authoritative guard for the live default ("pFDR") is the JS unit test
# tests/consensus-wiring.tests.js (resolveConsensusOptions({}).rankBy === "pFDR").
# The assertion below only documents that THIS mirror's match.arg picks "pFDR".
stopifnot(eval(formals(runConsensus)$rank.by)[1] == "pFDR")

# Call WITHOUT rank.by to exercise the mirror's default-arg resolution path.
res <- runConsensus(PAResults, method = "RRA")
cat("=== consensus result ===\n")
print(res)

stopifnot(nrow(res) == 6)
stopifnot(!all(res$pValueFDR == 1))          # FDR is NOT 1 for every pathway
stopifnot(min(res$pValueFDR) < 1)            # top pathway has a real FDR
stopifnot("score" %in% colnames(res))
stopifnot(!all(res$score == 0))              # score is NOT 0 for every pathway
stopifnot(any(abs(res$score) > 0.1))
# Top-ranked pathway (lowest consensus p) should be one of the concordant winners.
stopifnot(res$pathway[1] %in% c("P1", "P2"))

# --- weightedZMean numeric regression (RCPA weighted mean, NOT Stouffer) ---
commonPathways <- Reduce(intersect, lapply(PAResults, function(d) d$ID))
commonResults <- lapply(PAResults, function(d) d[d$ID %in% commonPathways, ])
weightsList <- rep(1, length(commonResults))
wzm <- .runWeightedMean(commonResults, weightsList, useFDR = TRUE)
cat("\n=== weightedZMean result ===\n")
print(wzm)

# Hand-computed expected p-value for P1 (equal weights, useFDR = TRUE):
#   z_i = qnorm(pFDR_i);  consensus p = pnorm(mean(z_i)).
p1_pfdr     <- sapply(PAResults, function(d) d$pFDR[d$ID == "P1"])
expected_p1 <- pnorm(mean(qnorm(p1_pfdr)))
got_p1      <- wzm$p.value[wzm$ID == "P1"]
stopifnot(abs(got_p1 - expected_p1) < 1e-9)        # matches RCPA weighted mean

# It must NOT equal the OLD Stouffer formula (sum(z)/sqrt(n)), which is far more
# extreme for concordant inputs — guards against re-introducing the regression.
stouffer_p1 <- pnorm(sum(qnorm(p1_pfdr)) / sqrt(length(p1_pfdr)))
stopifnot(abs(got_p1 - stouffer_p1) > 1e-6)
cat(sprintf("weightedZMean P1 p=%.6g (RCPA mean), Stouffer would be %.3g\n", got_p1, stouffer_p1))

# useFDR = FALSE: z from raw p.value (= pFDR/2 here), still a weighted mean.
wzm_raw <- .runWeightedMean(commonResults, weightsList, useFDR = FALSE)
p1_pval <- sapply(PAResults, function(d) d$p.value[d$ID == "P1"])
stopifnot(abs(wzm_raw$p.value[wzm_raw$ID == "P1"] - pnorm(mean(qnorm(p1_pval)))) < 1e-9)

# Non-equal weights: consensus = pnorm(weighted.mean(z, w)), not the unweighted mean.
w <- c(1, 2, 3)
wzm_w <- .runWeightedMean(commonResults, w, useFDR = TRUE)
stopifnot(abs(wzm_w$p.value[wzm_w$ID == "P1"] - pnorm(weighted.mean(qnorm(p1_pfdr), w))) < 1e-9)
# Weights actually matter: on a pathway with divergent per-method FDR (P4), the
# weighted consensus differs from the equal-weight one (P1's per-method z's are
# near-identical, so weighting it barely moves the result — a poor witness).
p4_pfdr <- sapply(PAResults, function(d) d$pFDR[d$ID == "P4"])
stopifnot(abs(wzm_w$p.value[wzm_w$ID == "P4"] - pnorm(weighted.mean(qnorm(p4_pfdr), w))) < 1e-9)
stopifnot(abs(pnorm(weighted.mean(qnorm(p4_pfdr), w)) - pnorm(mean(qnorm(p4_pfdr)))) > 1e-6)

# Edge case: a pathway whose pFDR is exactly 1 in every method must NOT yield
# NaN/Inf (qnorm(1)=+Inf without the clamp). Clamp -> finite -> p == 1.
edge <- list(
  data.frame(ID = "PX", p.value = 1, pFDR = 1, normalizedScore = 0, sampleSize = 20, name = "PX", stringsAsFactors = FALSE),
  data.frame(ID = "PX", p.value = 1, pFDR = 1, normalizedScore = 0, sampleSize = 20, name = "PX", stringsAsFactors = FALSE)
)
edge_res <- .runWeightedMean(edge, c(1, 1), useFDR = TRUE)
stopifnot(is.finite(edge_res$p.value), abs(edge_res$p.value - 1) < 1e-6)

# RRA ranking by normalizedScore (feature C): the |score| winner (P1) ranks top.
res_ns <- runConsensus(PAResults, method = "RRA", rank.by = "normalizedScore")
stopifnot(nrow(res_ns) == 6)
stopifnot(res_ns$pathway[1] %in% c("P1", "P2"))

# weightedZMean pValueFDR contract for the live useFDR=FALSE branch
# (ConsensusAnalysis.js: result$pValueFDR <- p.adjust(result$p.value, "fdr")).
# This documents the contract — the mirror above does not execute that branch —
# so the load-bearing assertion is NON-tautological: BH must actually inflate at
# least one consensus p. A regression that left pValueFDR == the raw consensus p
# (no adjustment) would fail `any(adj > raw)`, whereas the BH bounds below hold
# for any input and only serve as sanity rails.
wzm_fdr_false <- p.adjust(wzm_raw$p.value, method = "fdr")
stopifnot(length(wzm_fdr_false) == nrow(wzm_raw))
stopifnot(any(wzm_fdr_false > wzm_raw$p.value + 1e-9))                # adjustment actually changed values
stopifnot(all(wzm_fdr_false <= 1 + 1e-12), all(wzm_fdr_false >= wzm_raw$p.value - 1e-12))

cat("\nALL CONSENSUS ASSERTIONS PASSED\n")
