import { rStringify } from "./utils";

const nCore = Meteor.settings.private.RParallelCore;

export default (paramRDSFile) => `
    do.call(what = function(DEGenes, geneSets, backgroundGenes = NULL, backgroundLength){
        
        if (length(backgroundGenes) == 0) {
            backgroundGenes <- unique(unlist(geneSets))
        }
        
        GSOverlap <- sapply(geneSets, function(gs) length(intersect(gs, backgroundGenes)))
        DEOverlap <- sapply(geneSets, function(gs) length(intersect(gs, DEGenes)))
        NoneDEInBackground <- length(backgroundGenes) - length(DEGenes)
        Expected <- GSOverlap * length(DEGenes) / length(backgroundGenes)
    
        pvals <- 1 - phyper(DEOverlap - 1, length(DEGenes), NoneDEInBackground, GSOverlap)
        ES <- log2(DEOverlap / Expected)

        res <- data.frame(
            pathway = names(geneSets),
            pValue = pvals,
            pValueFDR = p.adjust(pvals, method = "fdr"),
            score = ES,
            stringsAsFactors = FALSE
        )
        
        rownames(res) <- NULL
        res
    }, args = readRDS(${rStringify(paramRDSFile)}))
`;
