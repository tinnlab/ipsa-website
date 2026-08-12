import { rStringify } from "./utils";

const nCore = Meteor.settings.private.RParallelCore;

export default ({ rdsFile }) => `
    do.call(what = function(expr, group, geneSets, perm, minSize, maxSize, seed = 1){
        expr <- as.matrix(expr)
        g1 <- names(which(group == 0))
        g2 <- names(which(group == 1))

        # Create a factor for the groups that will be used in limma
        group_factor <- factor(ifelse(colnames(expr) %in% g2, "g2", "g1"))
        
        # Create design matrix for limma
        design <- model.matrix(~0 + group_factor)
        colnames(design) <- levels(group_factor)
        
        # Fit linear model and calculate differential expression
        fit <- limma::lmFit(expr, design)
        contrast_matrix <- limma::makeContrasts(contrasts = "g2-g1", levels = design)
        fit2 <- limma::contrasts.fit(fit, contrast_matrix)
        fit2 <- limma::eBayes(fit2)
        
        # Get all genes with their t-statistics
        all_results <- limma::topTable(fit2, coef = 1, number = nrow(expr), sort.by = "none")
        
        # Create ranked gene list using t-statistics
        stats_rank <- all_results$t
        names(stats_rank) <- rownames(all_results)
        
        # Clean up stats_rank: remove NA, Inf, and -Inf values
        stats_rank <- stats_rank[is.finite(stats_rank)]
        # Remove empty or NA names
        stats_rank <- stats_rank[!(is.na(names(stats_rank)) | names(stats_rank) == "")]

        # Sort stats in descending order (required by FGSEA algorithm)
        # FGSEA walks down the ranked list to calculate enrichment scores
        stats_rank <- sort(stats_rank, decreasing = TRUE)

        # Seed the permutation RNG so FGSEA's nperm-based p-values / FDR are
        # reproducible across runs (matches fgsea.js; the limma ranking above is
        # already deterministic under single-threaded BLAS).
        set.seed(seed)

        res <- fgsea::fgsea(pathways = geneSets,
                    stats = stats_rank,
                    nperm = perm, 
                    minSize = minSize, 
                    maxSize = maxSize)

        # Extract both raw p-values and FGSEA's adjusted p-values along with NES
        res <- data.frame(res[, c('pathway', 'pval', 'padj', 'NES')])
        res <- tidyr::drop_na(res)
        colnames(res) <- c("pathway", "pValue", "pValueFDR", "score")

        finalRes <- data.frame(pathway = unique(names(geneSets)), stringsAsFactors = F)
        rownames(finalRes) <- names(geneSets)

        # Initialize default values
        finalRes$pValue <- 1
        finalRes$pValueFDR <- 1
        finalRes$score <- 0
        
        # Update values for pathways that were in the results
        finalRes[as.character(res$pathway), "pValue"] <- res$pValue
        finalRes[as.character(res$pathway), "pValueFDR"] <- res$pValueFDR
        finalRes[as.character(res$pathway), "score"] <- res$score
        
        finalRes
    }, args = readRDS(${rStringify(rdsFile)}))
`;