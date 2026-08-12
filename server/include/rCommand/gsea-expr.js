import { rStringify } from "./utils";

const nCore = Meteor.settings.private.RParallelCore;

export default ({ rdsFile }) => `
    require("doParallel")
    source("${Assets.absoluteFilePath("R/GSEA.1.0.1.R")}")
    source("${Assets.absoluteFilePath("R/GSEA_para.R")}")

    do.call(what = function(expr, group, geneSets, perm, seed, gs.size.threshold.min = 15, gs.size.threshold.max = 1000)  {

        geneSetLength <- sapply(geneSets, length)
        geneSets <- geneSets[geneSetLength >= gs.size.threshold.min & geneSetLength <= gs.size.threshold.max]

        cls <- list()
        cls$phen <- levels(as.factor(group))
        cls$class.v <- ifelse(group == cls$phen[1], 0, 1)

        res <- GSEA_para(
                input.ds = as.data.frame(expr),
                input.cls = cls,
                gs.db = geneSets,
                output.directory = "",
                doc.string = "GSEA.analysis",
                non.interactive.run = T,
                nperm = perm,
                random.seed = seed,
                gs.size.threshold.min = gs.size.threshold.min,
                gs.size.threshold.max = gs.size.threshold.max
        )

        res <- Reduce(rbind, res)[, c('SOURCE', 'NOM p-val', 'NES')]
        colnames(res) <- c("pathway", "pValue", "score")
        res$pathway <- as.character(res$pathway)
        res$pValue <- as.numeric(res$pValue)  # Convert pValue to numeric
        res$score <- as.numeric(res$score)    # Convert score to numeric
        
        res <- data.frame(dplyr::summarise(dplyr::group_by(res, pathway), pValue = dplyr::first(pValue), score = dplyr::first(score)))
        rownames(res) <- res$pathway

        finalRes <- data.frame(pathway = unique(names(geneSets)), stringsAsFactors = F)
        rownames(finalRes) <- names(geneSets)
        
        finalRes$pValue <- 1
        finalRes[as.character(res$pathway), "pValue"] <- res$pValue
        finalRes$pValueFDR <- p.adjust(finalRes$pValue, method = "fdr")
        finalRes$score <- 0
        finalRes[as.character(res$pathway), "score"] <- res$score
        finalRes
    }, args = readRDS(${rStringify(rdsFile)}))
`;