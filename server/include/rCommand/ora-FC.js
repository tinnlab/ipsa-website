import { rStringify } from "./utils";

export default ({ rdsFile }) => `
    do.call(what = function(expr, group, pThreshold, fcThreshold, maxDEGene){
        allGenesLength <- nrow(expr)

        group <- factor(c('c','d')[group + 1])

        design <- model.matrix(~0 + group)
        colnames(design) <- levels(group)

        top <- limma::topTable(limma::eBayes(limma::contrasts.fit(
            limma::lmFit(expr, design),
            limma::makeContrasts(contrasts = "d-c", levels = design)
        )), coef = 1, number = allGenesLength)

        top <- top[top$adj.P.Value <= pThreshold, , drop = F]
        top <- top[abs(top$logFC) >= fcThreshold, , drop = F]
        if (nrow(top) > maxDEGene) {
            top <- dplyr::arrange(top, desc(abs(logFC)))
        }
        res <- data.frame(top[, c('logFC', 'P.Value')])
        colnames(res) <- c("FC", "pValue")
        res$id <- rownames(top)
        res
    }, args = readRDS(${rStringify(rdsFile)}))
`;
