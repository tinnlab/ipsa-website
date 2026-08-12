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
    do.call(what = function(DEResults, method = c("stouffer", "fisher", "addCLT", "geoMean", "minP", "REML")){
        method <- match.arg(method)
    
        if (length(DEResults) == 1) {
            stop("Meta analysis is valid for two or more studies.")
        }
    
        for (DEResult in DEResults) {
            if (is.null(DEResult)) {
                stop("There is null object in the input list.")
            }
    
            if (!all(c("ID", "p.value", "logFC", "logFCSE", "sampleSize") %in% colnames(DEResult))) {
                stop("All the dataframes in the input list must have p.value, logFC, logFCSE, and sampleSize columns.")
            }
        }
    
        if (method != "REML"){
            combinePFunc <- switch(method,
                               fisher = .runFisher,
                               stouffer = .runStouffer,
                               minP = min,
                               addCLT = .runAddCLT,
                               geoMean = .runGeoMean
        )

        pvalRes <- DEResults %>%
            lapply(function(df) {
                df[, c("ID", "p.value", "logFC")] %>% as.data.frame()
            }) %>%
            bind_rows() %>%
            drop_na() %>%
            mutate(
                left.p = ifelse(.$logFC < 0, .$p.value, 1 - .$p.value),
                right.p = ifelse(.$logFC > 0, .$p.value, 1 - .$p.value)
            ) %>%
            group_by(.data$ID) %>%
            summarise(
                left.p = combinePFunc(.data$left.p),
                right.p = combinePFunc(.data$right.p),
                n = length(.data$ID)
            ) %>%
            filter(.data$n == length(DEResults))

        # Fast vectorized effect size calculation (no metagen loop needed!)
        metaResult <- DEResults %>%
            lapply(function(df) {
                df[, c("ID", "logFC", "logFCSE")] %>% as.data.frame()
            }) %>%
            bind_rows() %>%
            drop_na() %>%
            mutate(weight = 1 / (.data$logFCSE^2)) %>%
            group_by(.data$ID) %>%
            filter(n() == length(DEResults)) %>%
            summarise(
                logFC = sum(.data$logFC * .data$weight) / sum(.data$weight),
                logFCSE = sqrt(1 / sum(.data$weight)),
                .groups = 'drop'
            ) %>%
            select("ID", "logFC", "logFCSE") %>%
            inner_join(pvalRes, by = "ID") %>%
            mutate(
                p.value = ifelse(.$logFC < 0, .$left.p, .$right.p),
                pFDR = p.adjust(.data$p.value, method = "fdr")
            ) %>%
            select("ID", "p.value", "pFDR", "logFC", "logFCSE") %>%
            as.data.frame()
        } else {
        # REML method - use metagen loop for random-effects modeling
        metagenRes <- DEResults %>%
            lapply(function(df) {
                df[, c("ID", "logFC", "logFCSE", "p.value", "sampleSize")] %>% as.data.frame()
            }) %>%
            bind_rows() %>%
            group_by(.data$ID) %>%
            group_split() %>%
            lapply(function(dat) {
                if (nrow(dat) < length(DEResults)) {
                    return(NULL)
                }

                res <- try({
                    meta::metagen(data = dat,
                            studlab = dat$ID,
                            TE = dat$logFC,
                            # seTE = logFCSE,
                            pval = dat$p.value,
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
                logFC = unlist(.data$TE.fixed),
                logFCSE = unlist(.data$seTE.fixed)
            ) %>%
            mutate(
                pFDR = p.adjust(.data$p.value, method = "fdr")
            ) %>%
            select("ID", "p.value", "pFDR", "logFC", "logFCSE") %>%
            drop_na() %>%
            as.data.frame()
        }
        
        metaResult <- metaResult[order(metaResult$p.value),]
        rownames(metaResult) <- NULL
        colnames(metaResult)[colnames(metaResult) == "p.value"] <- "pValue"
        metaResult
    }, args = readRDS(${rStringify(rdsFile)}))
`;
