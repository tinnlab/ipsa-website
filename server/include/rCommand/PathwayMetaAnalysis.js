import { rStringify } from "./utils";

export default (rdsFile) => `
    library(dplyr)
    library(tidyr)
    library(meta)
    .runFisher <- function(pvals) {
        pvals[pvals == 0] <- .Machine$double.eps
        p.value <- pchisq(-2 * sum(log(pvals)), df = 2 * length(pvals), lower.tail = FALSE)
        return(p.value)
    }
    .runStouffer <- function(pvals) {
        pvals[pvals == 0] <- .Machine$double.eps
        p.value <- pnorm(sum(qnorm(pvals)) / sqrt(length(pvals)))
        return(p.value)
    }
    .runAddCLT <- function(pvals) {
        pvals <- pvals[!is.na(pvals)]
        pvals[pvals == 0] <- .Machine$double.eps
        n <- length(pvals)
        p.value <- 1
        if (n <= 20) {
            x <- sum(pvals)
            p.value <- 1 / factorial(n) * sum(sapply(0:floor(x), function(k) (-1)^k * choose(n, k) * (x - k)^(n)))
        }else {
            p.value <- pnorm(sum(pvals), n / 2, sqrt(n / 12), lower.tail = TRUE)
        }
        return(p.value)
    }
    .runGeoMean <- function(pvals) {
        pvals[pvals == 0] <- .Machine$double.eps
        p.value <- exp(mean(log(pvals)))
        return(p.value)
    }
    .normalizeToZScore <- function(scores) {
        mean_score <- mean(scores, na.rm = TRUE)
        sd_score <- sd(scores, na.rm = TRUE)
        # Avoid division by zero
        if (sd_score == 0 || is.na(sd_score)) sd_score <- 1
        z_scores <- (scores - mean_score) / sd_score
        return(z_scores)
    }
    do.call(what = function(PAResults, method = c("stouffer", "fisher", "addCLT", "geoMean", "minP", "REML")){
        method <- match.arg(method)

        if (length(PAResults) == 1) {
            stop("Meta analysis is valid for two or more studies.")
        }

        for (PAResult in PAResults) {
            if (is.null(PAResult)) {
                stop("There is null object in the input list.")
            }

            if (!all(c("ID", "p.value", "normalizedScore", "sampleSize") %in% colnames(PAResult))) {
                stop("All the dataframes in the input list must have ID, p.value, normalizedScore and sampleSize columns.")
            }
        }
    
        if (method != "REML"){
            combinePFunc <- switch(method,
                               fisher = .runFisher,
                               stouffer = .runStouffer,
                               minP = min,
                               addCLT = .runAddCLT,
                               geoMean = .runGeoMean)

            pvalRes <- PAResults %>%
                lapply(function(df) {
                    df[, c("ID", "p.value", "normalizedScore")] %>% as.data.frame()
                }) %>%
                bind_rows() %>%
                drop_na() %>%
                mutate(
                    left.p = ifelse(.$normalizedScore < 0, .$p.value, 1 - .$p.value),
                    right.p = ifelse(.$normalizedScore > 0, .$p.value, 1 - .$p.value)
                ) %>%
                group_by(.data$ID) %>%
                summarise(
                    left.p = combinePFunc(.data$left.p),
                    right.p = combinePFunc(.data$right.p),
                    n = length(.data$ID)
                ) %>%
                filter(.data$n == length(PAResults))

            # Fast vectorized score calculation with Z-score normalization
            # Normalize scores within each study, then combine across studies
            metaResult <- PAResults %>%
                lapply(function(df) {
                    # Normalize scores to Z-scores within this study
                    df$zScore <- .normalizeToZScore(df$normalizedScore)
                    df[, c("ID", "zScore")] %>% as.data.frame()
                }) %>%
                bind_rows() %>%
                drop_na() %>%
                group_by(.data$ID) %>%
                filter(n() == length(PAResults)) %>%
                summarise(
                    score = mean(.data$zScore),  # Mean of Z-scores across studies
                    .groups = 'drop'
                ) %>%
                mutate(normalizedScore = score) %>%
                select("ID", "score", "normalizedScore") %>%
                inner_join(pvalRes, by = "ID") %>%
                mutate(
                    p.value = ifelse(.$normalizedScore < 0, .$left.p, .$right.p),
                    pFDR = p.adjust(.data$p.value, method = "fdr")
                )
        } else {
        # REML method - use metagen loop for random-effects modeling
        metagenRes <- PAResults %>%
            lapply(function(df) {
                df[, c("ID", "normalizedScore", "p.value", "sampleSize")] %>% as.data.frame()
            }) %>%
            bind_rows() %>%
            group_by(.data$ID) %>%
            group_split() %>%
            lapply(function(dat) {
                if (nrow(dat) < length(PAResults)) {
                    return(NULL)
                }

                # Calculate standard error from p-value and effect size
                # Using inverse normal approximation: SE ≈ |TE| / |Z|
                # where Z = qnorm(p/2) for two-tailed test
                dat$seTE <- abs(dat$normalizedScore) / abs(qnorm(dat$p.value / 2))

                # Handle edge cases
                dat$seTE[is.na(dat$seTE) | is.infinite(dat$seTE)] <- 1
                dat$seTE[dat$seTE == 0] <- 0.01

                res <- try({
                    meta::metagen(data = dat,
                            studlab = dat$ID,
                            TE = dat$normalizedScore,
                            seTE = dat$seTE,
                            sm = "SMD",
                            method.tau = "REML",
                            hakn = TRUE,
                            n.e = dat$sampleSize
                    ) }, silent = TRUE)
                if (inherits(res, "try-error")) {
                    res <- NULL
                }

                return(res)
            }) %>%
            do.call(what = rbind)

        metaResult <- metagenRes[, c("studlab", "TE.fixed", "seTE.fixed", "pval.fixed")] %>%
            as.data.frame() %>%
            mutate(
                ID = .data$studlab %>% sapply(\`[\`, 1),
                p.value = unlist(.data$pval.fixed),
                score = unlist(.data$TE.fixed),
                normalizedScore = .data$score,
                # seTE here is the pooled fixed-effect standard error of THIS pathway's
                # meta-estimate (one row per pathway), not a per-study SE. The funnel
                # plot uses it as the pathway-level precision measure.
                seTE = unlist(.data$seTE.fixed)
            ) %>%
            mutate(
                pFDR = p.adjust(.data$p.value, method = "fdr")
            ) %>%
            # Mirror the gene-level (DEMetaAnalysis) REML branch: drop pathways whose
            # pooled estimate could not be computed (NA p-value / score / seTE).
            drop_na(p.value, score, seTE)
        }

        metaResult <- metaResult[order(metaResult$p.value),]

        rownames(metaResult) <- NULL
        metaResult <- metaResult %>% rename(pValue = p.value)
        # seTE (the pooled fixed-effect SE of each pathway's meta-estimate) only exists
        # for the REML branch; the p-value combination methods
        # (stouffer/fisher/addCLT/geoMean/minP) never produce one.
        # any_of() keeps seTE when present and silently drops it otherwise, so the
        # projection is safe for every method. It also drops the REML branch's raw
        # metagen carry-over columns (studlab/TE.fixed/seTE.fixed/pval.fixed).
        metaResult <- metaResult %>% select(dplyr::any_of(c("ID", "pValue", "pFDR", "score", "normalizedScore", "seTE")))
        metaResult
    }, args = readRDS(${rStringify(rdsFile)}))
`;
