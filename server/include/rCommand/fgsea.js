import { rStringify } from "./utils";

const nCore = Meteor.settings.private.RParallelCore;

export default ({ rdsFile }) => `
    do.call(what = function(geneList, geneStat, geneSets, perm, seed = 1, ...) {
        set.seed(seed)
        names(geneStat) <- geneList

        res <- fgsea::fgsea(pathways = geneSets, stats = geneStat,
                    nperm = perm, nproc = ${nCore}, ...)

        # Extract both raw p-values, adjusted p-values, and NES from fgsea results
        res <- data.frame(res[, c('pathway', 'pval', 'padj', 'NES')])
        res <- tidyr::drop_na(res)
        colnames(res) <- c("pathway", "pValue", "pValueFDR", "score")

        finalRes <- data.frame(pathway = unique(names(geneSets)), stringsAsFactors = F)
        rownames(finalRes) <- names(geneSets)

        # Initialize default values
        finalRes$pValue <- 1
        finalRes$pValueFDR <- 1  # Initialize pValueFDR with default value of 1
        finalRes$score <- 0

        # Update values for pathways that were in the results
        finalRes[as.character(res$pathway), "pValue"] <- res$pValue
        finalRes[as.character(res$pathway), "pValueFDR"] <- res$pValueFDR
        finalRes[as.character(res$pathway), "score"] <- res$score

        finalRes
    }, args = readRDS(${rStringify(rdsFile)}))
`;