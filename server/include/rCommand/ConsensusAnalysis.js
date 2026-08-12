import {rStringify} from "./utils";

export default (rdsFile) => `
    library(dplyr)
    library(tidyr)
    library(RobustRankAggreg)
    
    # Convert enrichment scores to Z-scores
    .normalizeToZScore <- function(scores) {
        mean_score <- mean(scores, na.rm = TRUE)
        sd_score <- sd(scores, na.rm = TRUE)
        # Avoid division by zero
        if (sd_score == 0 || is.na(sd_score)) sd_score <- 1
        z_scores <- (scores - mean_score) / sd_score
        return(z_scores)
    }
    
    # Function to combine enrichment scores using Z-score transformation
    .combineEnrichmentScores <- function(resultsDFs, weightsLst) {
        if(length(resultsDFs) != length(weightsLst)){
            stop("The length of input list of results must be equal to the length of weights vector!")
        }
        
        # Extract all unique pathway IDs
        all_pathways <- Reduce(union, lapply(resultsDFs, function(df) df$ID))
        
        # Create a matrix to store Z-scores (pathways x methods)
        z_matrix <- matrix(NA, nrow = length(all_pathways), ncol = length(resultsDFs))
        rownames(z_matrix) <- all_pathways
        
        # Calculate Z-scores for each method
        for (i in 1:length(resultsDFs)) {
            df <- resultsDFs[[i]]
            score_col <- NULL
            
            # Check which score column to use, with priority order
            if ("enrichmentScore" %in% colnames(df)) {
                score_col <- "enrichmentScore"
            } else if ("score" %in% colnames(df)) {
                score_col <- "score"
            } else if ("normalizedScore" %in% colnames(df)) {
                score_col <- "normalizedScore"
            }
            
            if (!is.null(score_col)) {
                z_scores <- .normalizeToZScore(df[[score_col]])
                indices <- match(df$ID, all_pathways)
                z_matrix[indices, i] <- z_scores
            }
        }
        
        # Calculate weighted mean of Z-scores for each pathway
        weighted_z_scores <- numeric(length(all_pathways))
        for (i in 1:length(all_pathways)) {
            pathway_scores <- z_matrix[i, ]
            valid_indices <- !is.na(pathway_scores)
            
            if (sum(valid_indices) > 0) {
                pathway_weights <- weightsLst[valid_indices]
                weighted_z_scores[i] <- weighted.mean(pathway_scores[valid_indices], 
                                                     pathway_weights, 
                                                     na.rm = TRUE)
            } else {
                weighted_z_scores[i] <- NA
            }
        }
        
        # Create results data frame
        result <- data.frame(
            ID = all_pathways,
            score = weighted_z_scores,
            stringsAsFactors = FALSE
        )
        
        return(result)
    }
    
    .runWeightedMean <- function(resultsDFs, weightsLst, useFDR){
        if(length(resultsDFs) != length(weightsLst)){
            stop("The length of input list of results must be equal to the length of weights vector!")
        }
    
        study.names <- resultsDFs %>% names()
    
        resultsDFs <- 1:length(resultsDFs) %>% lapply(function(i){
            resultsDFs[[i]]$weight <- rep(weightsLst[i], nrow(resultsDFs[[i]]))
            resultsDFs[[i]]
        }) %>% \`names<-\`(study.names)
    
        allResults <- resultsDFs %>% do.call(what = rbind)
    
        consensusResults <- allResults %>% group_by(.data$ID) %>% group_split() %>% lapply(function (data){
            # Consensus via the weighted MEAN of z-values, matching
            # RCPA::runConsensusAnalysis (method = "weightedZMean"):
            #   z_i = Phi^-1(p_i);  consensus p = Phi( weighted.mean(z_i, w_i) ).
            # NB: this is a weighted mean (divide by sum of weights), NOT Stouffer's
            # weighted sum (divide by sqrt(sum of squared weights)). Our inputs are
            # multiple methods on the SAME dataset (positively correlated), where
            # Stouffer over-rejects; the conservative mean is the intended RCPA behavior.
            pvals <- if(useFDR == TRUE) data$pFDR else data$p.value
            # Clamp to the open interval (0,1) before qnorm. CPA feeds a default
            # pFDR/p.value of 1 for pathways absent from a method (see fgsea.js,
            # ora-expr.js, etc.), and exact 0/1 map to -/+Inf under qnorm, which
            # would yield NaN/degenerate consensus p-values. This guard diverges
            # from RCPA's unclamped math on purpose, because RCPA's typical fgsea
            # inputs rarely contain exact 0/1 whereas ours routinely do.
            pvals <- pmin(pmax(pvals, .Machine$double.xmin), 1 - 1e-16)
            data$zscore <- qnorm(pvals)

            # Drop any non-finite z (e.g. from an NA input p-value) so a single
            # bad row can't turn the whole pathway's consensus into NaN.
            ok <- is.finite(data$zscore) & is.finite(data$weight)
            consensusPval <- if(any(ok)) pnorm(weighted.mean(data$zscore[ok], data$weight[ok])) else NA_real_

            data.frame(
                ID = data$ID[1],
                p.value = consensusPval,
                name = data$name[1],
                stringsAsFactors = FALSE
            )
        }) %>% do.call(what = rbind)
    
        consensusResults
    }
    
    .runRankPathways <- function (resultsDFs, rankParam){
        rankedList <- NULL
    
        if(rankParam == "normalizedScore"){
            rankedList <- resultsDFs %>% lapply(function (data){
                data[order(abs(data$normalizedScore), decreasing = TRUE),] %>% \`[[\`("ID")
            })
        }else if(rankParam == "pFDR"){
            rankedList <- resultsDFs %>% lapply(function (data){
                data[order(data$pFDR, decreasing = FALSE),] %>% \`[[\`("ID")
            })
        }else if(rankParam == "p.value"){
            rankedList <- resultsDFs %>% lapply(function (data){
                data[order(data$p.value, decreasing = FALSE),] %>% \`[[\`("ID")
            })
        }else if(rankParam == "score"){
            rankedList <- resultsDFs %>% lapply(function (data){
                if("score" %in% colnames(data)) {
                    data[order(abs(data$score), decreasing = TRUE),] %>% \`[[\`("ID")
                } else if("enrichmentScore" %in% colnames(data)) {
                    data[order(abs(data$enrichmentScore), decreasing = TRUE),] %>% \`[[\`("ID") 
                } else {
                    data[order(abs(data$normalizedScore), decreasing = TRUE),] %>% \`[[\`("ID")
                }
            })
        }else{
            rankedList <- resultsDFs %>% lapply(function (data){
                data[order(abs(data$normalizedScore), data$pFDR, decreasing = c(TRUE, FALSE)),] %>% \`[[\`("ID")
            })
        }
    
        rankedList
    }
    
    do.call(what = function(PAResults,
                            method = c("weightedZMean", "RRA"),
                            weightsList = NULL,
                            useFDR = TRUE,
                            rank.by = c("pFDR", "normalizedScore", "p.value", "both", "score"),
                            backgroundSpace = NULL,
                            includeScore = TRUE){
        method <- match.arg(method)
        rank.by <- match.arg(rank.by)

        if(is.null(PAResults)){
            stop("There is no study to be integrated!")
        }
    
        if(length(PAResults) < 2){
            stop("Number of studies to perform consensus analysis should be at least two!")
        }
    
        commonPathways <- Reduce(intersect, lapply(PAResults, function (data) data$ID))
    
        if(length(commonPathways) == 0){
            stop("There is no common pathways among input data!")
        }
    
        commonResults <- lapply(PAResults, function(data) data[data$ID %in% commonPathways,])
    
        commonResults <- commonResults[!is.na(commonResults)]
        commonResults <- commonResults[!is.null(commonResults)]
    
        if(length(commonResults) < 2){
            stop("After intersecting the results, there is less than two results to be analyzed!")
        }
    
        result <- NULL
        
        # Set default weights if not provided
        if(is.null(weightsList)){
            weightsList <- rep(1, length(commonResults))
        }
    
        # Calculate consensus enrichment scores if requested
        enrichmentScores <- NULL
        if(includeScore) {
            # Calculate consensus enrichment scores using Z-score transformation
            enrichmentScores <- .combineEnrichmentScores(PAResults, weightsList)
        }
        
        if(method == "weightedZMean"){
            # Run standard weightedZMean
            result <- .runWeightedMean(commonResults, weightsList, useFDR)
    
            # Faithful to RCPA::runConsensusAnalysis: when useFDR=TRUE the inputs
            # are already FDR-adjusted, so the consensus p IS the adjusted value
            # (pValueFDR == pValue by design); otherwise BH-adjust the consensus p.
            if(useFDR == TRUE){
                result$pValueFDR <- result$p.value
            }else{
                result$pValueFDR <- p.adjust(result$p.value, method = "fdr")
            }
            
            # Add in enrichment scores if requested
            if(includeScore) {
                result <- result %>% 
                    left_join(enrichmentScores, by = "ID")
            }
    
        }else if(method == "RRA"){
            # Run standard RRA
            spaceSet <- NULL
            rankedPathwaysList <- .runRankPathways(PAResults, rank.by)
    
            if(!is.null(backgroundSpace)){
                backgroundSpace <- backgroundSpace[!is.na(backgroundSpace)]
    
                if(length(backgroundSpace) != length(PAResults)){
                    stop("In the case of specifying backgroundSpace, the length of backgroundSpace and PAResults must be equal!")
                }
                spaceSet <- backgroundSpace %>% unlist() %>% unique()
    
            }else{
                spaceSet <- rankedPathwaysList %>% unlist() %>% unique()
            }
    
            r = RobustRankAggreg::rankMatrix(rankedPathwaysList, N = length(spaceSet))
    
            result = RobustRankAggreg::aggregateRanks(rmat = r, full = TRUE, method = "RRA")
            colnames(result) <- c("ID", "p.value")
    
            allData <- PAResults %>% do.call(what = rbind)
    
            result$pValueFDR <- p.adjust(result$p.value, method = "fdr")
            result$name <- allData[match(result$ID, allData$ID), c("name")]

            # Add in enrichment scores if requested
            if(includeScore) {
                result <- result %>% 
                    left_join(enrichmentScores, by = "ID")
            }
        }
    
        if(is.null(result)){
            stop("There is an error in performing consensus analysis!")
        }
        
        result <- result[order(result$p.value),]
        rownames(result) <- NULL
        result <- result %>% rename(pValue = p.value)
        result$pathway <- result$ID
        
        # Create final output with all columns
        if("score" %in% colnames(result)) {
            result <- result %>% select(ID, pathway, pValue, pValueFDR, name, score)
        } else {
            result <- result %>% select(ID, pathway, pValue, pValueFDR, name)
        }
        
        result
    }, args = readRDS(${rStringify(rdsFile)}))
`