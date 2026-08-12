import {rStringify} from "./utils";

const nCore = Meteor.settings.private.RParallelCore;
const tempDir = Meteor.settings.private.tempDir;

export default ({rdsFile}) => `
    do.call(what = function(expr, group, geneSets, pThreshold, fcThreshold, minDEGene){
        debugFile <- "${tempDir}/r_debug_log.txt"
        cat("==== DEBUG START ====", format(Sys.time()), "\\n", file=debugFile)
        
        # Function to append to debug file
        debugLog <- function(...) {
            cat(..., "\\n", file=debugFile, append=TRUE)
        }
        
        # Get total number of genes
        allGenesLength <- nrow(expr)
        
        # Convert group to factor with specified levels
        group <- factor(c('c','d')[group + 1])
        
        # Create design matrix for limma
        design <- model.matrix(~0 + group)
        colnames(design) <- levels(group)
        
        # Fit linear model and calculate differential expression
        fit <- limma::lmFit(expr, design)
        contrast_matrix <- limma::makeContrasts(contrasts = "d-c", levels = design)
        fit2 <- limma::contrasts.fit(fit, contrast_matrix)
        fit2 <- limma::eBayes(fit2)
        
        # Get all genes with their statistics
        top <- limma::topTable(fit2, coef = 1, number = allGenesLength)
        
        # Filter by adjusted p-value and fold change
        top <- top[top$adj.P.Val <= pThreshold, , drop = F]
        top <- top[abs(top$logFC) >= fcThreshold, , drop = F]
        
        # Get DE gene names
        DEGenes <- rownames(top)
        
        # Perform ORA for each gene set in parallel
        res <- parallel::mclapply(geneSets, mc.cores = ${nCore}, function(gs) {
            # Calculate overlap between gene set and DE genes
            wBallDraw <- length(intersect(gs, DEGenes)) - 1
            
            # If no overlap, return p-value of 1
            if (wBallDraw < 0) {
                return(c(1, 0))
            }
            
            # Prepare for hypergeometric test
            wBall <- length(DEGenes)             # Number of DE genes
            bBall <- allGenesLength - wBall      # Number of non-DE genes
            ballDraw <- length(intersect(gs, rownames(expr)))  # Size of gene set
            
            # Calculate hypergeometric p-value
            pValue <- 1 - phyper(wBallDraw, wBall, bBall, ballDraw)
            
            # Calculate enrichment score
            GSOverlap <- ballDraw
            DEOverlap <- wBallDraw + 1
            Expected <- (GSOverlap * wBall) / (wBall + bBall)
            score <- log2(DEOverlap / Expected)
            
            # Add number of overlapping genes to the result
            # DEOverlap is already wBallDraw + 1
            c(pValue, score, DEOverlap)
        })
        
        # Extract p-values, scores, and overlap counts
        pValues <- sapply(res, function(x) {
            if (length(x) == 1) return(x)
            return(x[1])
        })
        scores <- sapply(res, function(x) {
            if (length(x) == 1) return(0)
            return(x[2])
        })
        overlaps <- sapply(res, function(x) {
            if (length(x) == 1) return(0)
            return(x[3])
        })
        
        # Create results data frame
        res <- data.frame(
            pValue = pValues, 
            score = scores,
            overlap = overlaps,
            pathway = names(res), 
            stringsAsFactors = F
        )
        
        # Remove NA values
        res <- tidyr::drop_na(res)
        
        # Create final results data frame
        finalRes <- data.frame(
            pathway = unique(names(geneSets)), 
            stringsAsFactors = F
        )
        rownames(finalRes) <- finalRes$pathway
        
        # Initialize with default values
        finalRes$pValue <- 1
        finalRes[as.character(res$pathway), "pValue"] <- res$pValue
        
        # Initialize overlap count
        finalRes$overlap <- 0
        finalRes[as.character(res$pathway), "overlap"] <- res$overlap
        
        # Calculate FDR-adjusted p-values ONLY for pathways with overlap > minDEGene
        # First identify pathways with sufficient overlap
        significantPathways <- rownames(finalRes)[finalRes$overlap > minDEGene]
        
        # Set all pValueFDR to 1 initially
        finalRes$pValueFDR <- 1
        
        if (length(significantPathways) > 0) {
            # Get p-values for pathways with sufficient overlap
            pValuesForFDR <- finalRes[significantPathways, "pValue"]
            
            # Calculate FDR-adjusted p-values only for these pathways
            pValuesFDR <- p.adjust(pValuesForFDR, method = "fdr")
            
            # Update only those pathways
            finalRes[significantPathways, "pValueFDR"] <- pValuesFDR
        }
        
        # Initialize scores with zeros
        finalRes$score <- 0
        finalRes[as.character(res$pathway), "score"] <- res$score
        
        # Final result stats
        #debugLog("Number of significant pathways (FDR < 0.05):", sum(finalRes$pValueFDR < 0.05))
        
        # Return final results
        finalRes
    }, args = readRDS(${rStringify(rdsFile)}))
`;