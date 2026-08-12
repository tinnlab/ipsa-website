import { rStringify } from "./utils";

const nCore = Meteor.settings.private.RParallelCore;

export default ({ rdsFile, method }) => `
    do.call(what = function(expr, group, geneSets){
        if (max(expr) > 100) expr <- log2(expr + 1)

        FC <- rowMeans(expr[, names(which(group == 1)), drop = F]) - rowMeans(expr[, names(which(group == 0)), drop = F])
    
        test <- if ("${method}" == "ks") ks.test else wilcox.test
    
        allGenes <- rownames(expr)
    
        res <- parallel::mclapply(geneSets, mc.cores = ${nCore}, function(gs){
    
            DEhit <- FC[allGenes[allGenes %in% gs]]
            DEmiss <- FC[allGenes[!allGenes %in% gs]]
    
            if (length(DEhit) == 0 | length(DEmiss) == 0) return(NA)
    
            pValue <- test(DEhit, DEmiss)$p.value
            score <- median(DEhit) - median(DEmiss)
            c(pValue = pValue, score = score)
        })

        res <- data.frame(pValue = sapply(res, function(x) x["pValue"]), 
                          score = sapply(res, function(x) x["score"]),
                          pathway = names(geneSets))
        res <- tidyr::drop_na(res)

        finalRes <- data.frame(pathway = unique(names(geneSets)), stringsAsFactors = F)
        rownames(finalRes) <- names(geneSets)

        finalRes$pValue <- 1
        finalRes[as.character(res$pathway), "pValue"] <- res$pValue
        finalRes$pValueFDR <- p.adjust(finalRes$pValue, method = "fdr")
        finalRes$score <- NA
        finalRes[as.character(res$pathway), "score"] <- res$score
        finalRes 
    }, args = readRDS(${rStringify(rdsFile)}))
`;
