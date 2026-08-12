

import { rStringify } from "./utils";

const nCore = Meteor.settings.private.RParallelCore;

export default ({ rdsFile }) => `
    do.call(what = function(expr, group, geneSets, seed, gsa.method = "maxmean", minSize = 15, maxSize = 1000, perm = 1000) {

        geneSetLength <- sapply(geneSets, length)
        geneSets <- geneSets[geneSetLength >= minSize & geneSetLength <= maxSize]
    
        res <- GSA::GSA(x = as.matrix(expr), y = group + 1, nperms=perm, genesets=geneSets, 
            resp.type = "Two class unpaired",
            genenames = rownames(expr), random.seed = seed,
            method = gsa.method, minsize = minSize, maxsize = maxSize)

        pValues <- apply(cbind(res$pvalues.lo, res$pvalues.hi), 1, min)
        pValues <- data.frame(pValues * 2, pathway = names(geneSets))
        colnames(pValues) <- c('pValue', 'pathway')

        finalRes <- data.frame(pathway = unique(names(geneSets)), stringsAsFactors = F)
        rownames(finalRes) <- names(geneSets)
        
        finalRes$pValue <- 1
        finalRes[as.character(pValues$pathway), "pValue"] <- pValues$pValue
        finalRes$pValueFDR <- p.adjust(finalRes$pValue, method = "fdr")
        finalRes$score <- 0
        finalRes[as.character(pValues$pathway), "score"] <- res$GSA.scores
        finalRes

    }, args = readRDS(${rStringify(rdsFile)}))
`;