singleMethod <- function(method, data, group, block = NULL, geneSet = NULL, geneNetwork = NULL, org = "hsa", perm=1000, alpha = 0.05, maxDEGene = 1000, seed = 1, DEGenes = NULL, removeNA = F, ...){
    res  <- NULL

    # checking input
    {
        group <- group %>% sort()
        data <- data[, names(group)]

        if (ncol(data) < 2) stop("Samples in expression data and group do not match")

    }

    # Checking geneset and genenetwork
    {
        if (method %in% c("gsea", "gsea.preranked", "fgsea", "padog", "ora", "gsa", "go.stats", "ks.test", "wilcox.test", "web.gestalt")){
            if (is.null(geneSet)){
                stop(paste0("geneSet cannot be NULL when running ", method))
            }
        }

        if (method %in% c("pe")){
            if (is.null(geneNetwork)){
                stop(paste0("geneNetwork cannot be NULL when running ", method))
            }
        }
    }

    # create summarizedExperiment object
    {
        colData <- data.frame(group = group)
        rownames(colData) <- names(group)
        if (!is.null(block)) colData$block = block

        summarizedExperiment <- SummarizedExperiment::SummarizedExperiment(
            assays = data %>% as.matrix(),
            colData = colData
        )
    }

    # Check if geneset matched with input data
    if (!is.null(geneSet)) {
        allGenes <- geneSet %>% unlist() %>% unique()
        commonGenes <- intersect(names(summarizedExperiment), allGenes)

        if (length(commonGenes) == 0){
            stop("There is no common gene between the input expression matrix and genes in geneSet")
        }
    } else {
        allGenes <- lapply(geneNetwork, function(pathway) pathway@nodes) %>% unlist() %>% unique()
        commonGenes <- intersect(names(summarizedExperiment), allGenes)

        if (length(commonGenes) == 0){
            stop("This error is likely to occur when the gene network from KEGG database does not use Entrez ID. Please remove this method from your analysis if this is the case.")
        }
    }

    # intersect with KEGG genes
    summarizedExperiment <- summarizedExperiment[commonGenes,]

    # filter geneset
    {
        geneSet.names <- NULL
        if (!is.null(geneSet)){
            geneSet.names <- names(geneSet)
            geneSet <- geneSet[(geneSet %>% lapply(function(gs) intersect(gs, names(summarizedExperiment))) %>% lapply(length) > 5) %>% which()]
        }
    }

    # Run each method
    {
        if (method == "gsea") {
            res <- .gsea(summarizedExperiment, geneSet, perm, seed, ...)
        } else if (method %in% c("gsea.preranked", "fgsea")) {
            res <- .gsea.preranked(summarizedExperiment, geneSet, perm, alpha, seed, ...)
        } else if (method == "padog"){
            res <- .padog(summarizedExperiment, geneSet, perm, seed, ...)
        } else if (method == "cepa.ora"){
            res <- .cepa("ora", summarizedExperiment, alpha, maxDEGene, perm, DEGenes, seed, ...)
        } else if (method == "cepa.gsa"){
            res <- .cepa("gsa", summarizedExperiment, alpha, maxDEGene, perm, DEGenes, seed, ...)
        } else if (method == "ora"){
            res <- .ora(summarizedExperiment, geneSet, alpha, maxDEGene, DEGenes, seed, ...)
        } else if (method == "pe"){
            res <- .pe(summarizedExperiment, geneNetwork, alpha, maxDEGene, perm, seed, ...)
        } else if (method == "gsa"){
            res <- .gsa(summarizedExperiment, geneSet, perm, seed, ...)
        } else if (method == "go.stats"){
            res <- .go.stats(summarizedExperiment, geneSet, alpha, maxDEGene, DEGenes, seed, ...)
        } else if (method == "ks.test"){
            res <- .ks.wilcox.test(method = "ks", summarizedExperiment, geneSet, alpha, maxDEGene, seed, DEGenes, ...)
        } else if (method == "wilcox.test"){
            res <- .ks.wilcox.test(method = "wilcox", summarizedExperiment, geneSet, alpha, maxDEGene, seed, DEGenes, ...)
        }  else if (method == "web.gestalt"){
            res <- .WebGestaltR(summarizedExperiment, geneSet, alpha, maxDEGene, DEGenes, seed, ...)
        }  else {
            stop(paste0("Method '", method, "' is not supported"))
        }
    }

    if (is.null(res)) return(NULL)

    res$p.value <- res$p.value %>% as.character() %>% as.numeric()

    res <- res[, c('pathway',  'p.value')]

    if (removeNA) return(res)

    finalRes <- data.frame(pathway = c(names(geneNetwork), geneSet.names) %>% unique(), stringsAsFactors = F)

    rownames(finalRes) <- finalRes$pathway
    finalRes$p.value <- 1
    finalRes[res$pathway %>% as.character(), 'p.value'] <- res$p.value
    finalRes
}

.gsea <- function(summarizedExperiment, geneSet, perm, seed, ...) {

    params <- list(...)
    if (!is.null(params$nperm)) {
        perm <- params$nperm
        params$nperm <- NULL
    }
    if (!is.null(params$random.seed)) {
        seed <- params$random.seed
        params$random.seed <- NULL
    }

    if (!is.null(params$gs.size.threshold.min)){
        keeps <- geneSet %>% lapply(length) %>% unlist() %>% `>=`(params$gs.size.threshold.min) %>% which() %>% names()
        geneSet <- geneSet[keeps]
    }

    if (!is.null(params$gs.size.threshold.max)){
        keeps <- geneSet %>% lapply(length) %>% unlist() %>% `<=`(params$gs.size.threshold.max) %>% which() %>% names()
        geneSet <- geneSet[keeps]
    }

    for (p in c("input.ds", "input.cls", "gs.db", "output.directory", "doc.string", "non.interactive.run")){
        if (!is.null(params[[p]])){
            stop(paste0("Sending parameter ", p ," for GSEA is not allowed"))
        }
    }


    cls <- list()
    cls$phen <- levels(as.factor(summarizedExperiment$group))
    cls$class.v <- ifelse(summarizedExperiment$group == cls$phen[1], 0, 1)

    params <- c(
        list(
            input.ds = as.data.frame(SummarizedExperiment::assay(summarizedExperiment)),
            input.cls = cls,
            gs.db = geneSet,
            output.directory = "",
            doc.string = "GSEA.analysis",
            non.interactive.run = T,
            nperm = perm,
            random.seed = seed
        ),
        params
    )

    res <- do.call(GSEA_para, params)

    res <- Reduce(rbind, res)[, c('SOURCE', 'NOM p-val')]
    colnames(res) <- c("pathway", "p.value")
    res$pathway <- res$pathway %>% as.character()

    res <- res %>% group_by(pathway) %>% summarise(p.value = dplyr::first(p.value)) %>% as.data.frame()

    rownames(res) <- res$pathway

    return(res)
}

.fgsea <- function(summarizedExperiment, geneSet, perm, alpha, seed, ...) {
    requirePackage('fgsea')

    set.seed(seed)
    colDat <- SummarizedExperiment::colData(summarizedExperiment)
    assay <- SummarizedExperiment::assay(summarizedExperiment)

    g1 <- rownames(colDat)[colDat$group == 0]
    g2 <- rownames(colDat)[colDat$group == 1]

    snr <- (rowMeans(assay[, g1]) - rowMeans(assay[, g2]))/(sd(assay[, g1]) - sd(assay[, g2]))

    res <- fgsea(pathways = geneSet,
                 stats = snr,
                 nperm=perm, ...)

    res <- res[,c('pathway', 'pval')] %>% as.data.frame() %>% drop_na()
    colnames(res) <- c("pathway", "p.value")

    return(res)
}

.gsea.preranked <- .fgsea

.fgsea.gl <- function(geneList, geneStat, geneSet, perm, ...) {
    requirePackage('fgsea')

    set.seed(1)

    names(geneStat) <- geneList

    res <- fgsea(pathways = geneSet,
                 stats = geneStat,
                 nperm=perm, ...)

    res <- res[,c('pathway', 'pval')] %>% as.data.frame() %>% drop_na()
    colnames(res) <- c("pathway", "p.value")

    finalRes <- data.frame(pathway = names(geneSet) %>% unique(), stringsAsFactors = F)
    rownames(finalRes) <- names(geneSet)

    finalRes$p.value <- 1
    finalRes[res$pathway %>% as.character(), 'p.value'] <- res$p.value
    finalRes

    return(finalRes)
}

.padog <- function(summarizedExperiment, geneSet, perm, seed, ncore = 1, ...){
    requirePackage("PADOG")

    assay <- SummarizedExperiment::assay(summarizedExperiment)
    group <- c("c", "d")[SummarizedExperiment::colData(summarizedExperiment)$group + 1]

    res <- PADOG::padog(esetm = as.matrix(assay), group = group, gslist = geneSet, annotation = NULL,
                        gs.names = names(geneSet), NI = perm, plots = FALSE, targetgs = NULL, dseed = seed,
                         parallel = TRUE, ncr = ncore, ...)

    res <- res[,c('ID', 'Ppadog')]
    colnames(res) <- c("pathway", "p.value")

    return(res)
}

.cepa <- function(method, summarizedExperiment, alpha, maxDEGene, perm, DEGenes, seed, pc, ...){
    requirePackage("CePa")

    bk = names(summarizedExperiment)

    if (!is.null(DEGenes)){
        summarizedExperiment <- summarizedExperiment[DEGenes,]
    }

    if (method == "ora"){
        set.seed(seed)
        summarizedExperiment <- filterAssay(summarizedExperiment, p.value = alpha, maxGeneByFC = maxDEGene)
    }

    assay <- SummarizedExperiment::assay(summarizedExperiment)
    label <- CePa::sampleLabel(as.character(summarizedExperiment$group), treatment = "1", control = "0")

    set.seed(seed)
    if (method == "ora"){
        res <- CePa::cepa.all(dif = rownames(assay), bk = bk, label = label, pc = pc, iter = perm, ...)
    } else {
        res <- CePa::cepa.all(bk = bk, mat = assay, label = label, pc = pc, iter = perm, ...)
    }

    pvalues <- CePa::p.table(res) %>% apply(1, min) %>% data.frame()
    colnames(pvalues) <- c("p.value")
    pvalues$pathway <- rownames(pvalues)

    return(pvalues)
}

.ora <- function(summarizedExperiment, geneSet, alpha, maxDEGene, DEGenes, seed, ncore = 1, minFC = 0, ...){

    if(.Platform$OS.type == "windows") {
            ncore = 1
    }

    if (is.null(ncore)) ncore = 1
    if (ncore > 1) requirePackage("parallel")

    set.seed(seed)
    if (is.null(DEGenes)){
        DEGenes <- filterAssay(summarizedExperiment, p.value = alpha, maxGeneByFC = maxDEGene, FC = minFC) %>% names()
    }

    set.seed(seed)
    res <- parallel::mclapply(geneSet, mc.cores = ncore, function(gs){

        wBallDraw <- intersect(gs, DEGenes) %>%  length() - 1
        if (wBallDraw < 0) return(1)

        wBall <- length(DEGenes)
        bBall <- nrow(summarizedExperiment) - length(DEGenes)
        ballDraw <- length(intersect(gs, names(summarizedExperiment)))

        1 - phyper(wBallDraw, wBall, bBall, ballDraw)

    }) %>% unlist() %>% data.frame(stringsAsFactors = F)

    colnames(res) <- 'p.value'
    res$pathway = rownames(res)
    res %>% tidyr::drop_na()
}

.ora.gl <- function(DEGenes, geneSet, ncore = 1){

    if(.Platform$OS.type == "windows") {
        ncore = 1
    }

    if (is.null(ncore)) ncore = 1
    if (ncore > 1) requirePackage("parallel")

    allGenesLength <- geneSet %>% unlist() %>% unique() %>% length()

    res <- parallel::mclapply(geneSet, mc.cores = ncore, function(gs){

        wBallDraw <- intersect(gs, DEGenes) %>%  length() - 1
        if (wBallDraw < 0) return(1)

        wBall <- length(DEGenes)
        bBall <- allGenesLength - length(DEGenes)
        ballDraw <- length(gs)

        1 - phyper(wBallDraw, wBall, bBall, ballDraw)

    }) %>% unlist() %>% data.frame(stringsAsFactors = F)

    colnames(res) <- 'p.value'
    res$pathway = rownames(res)
    res <- res %>% tidyr::drop_na()

    finalRes <- data.frame(pathway = names(geneSet) %>% unique(), stringsAsFactors = F)
    rownames(finalRes) <- names(geneSet)

    finalRes$p.value <- 1
    finalRes[res$pathway %>% as.character(), 'p.value'] <- res$p.value
    finalRes

    return(finalRes)
}

.pe <- function(summarizedExperiment, grn, alpha, maxDEGene, perm, seed, ncore = 1, ...){
    requirePackage("ROntoTools")

    ref = names(summarizedExperiment)

    set.seed(seed)
    summarizedExperiment <- filterAssay(summarizedExperiment, p.value = alpha, maxGeneByFC = maxDEGene)

    FC <- SummarizedExperiment::rowData(summarizedExperiment)$FC
    names(FC) <- names(summarizedExperiment)

    devParams <- list(...)
    # ROntoTools has bugs with parallel
    if (is.null(devParams$isServer)){
        ncore = 1
    }

    if (ncore <= 1){
        res <- ROntoTools::pe(x=FC, graphs=grn, ref = ref, nboot=perm, verbose = F, seed = seed)
    } else {
        cl <- makeCluster(ncore)
        res <- ROntoTools::pe(x=FC, graphs=grn, ref = ref, nboot=perm, verbose = F, seed = seed, cluster = cl)
        stopCluster(cl)
    }
    res <- ROntoTools::Summary(res)

    if (nrow(res) == 0) return(NULL)

    pList <- rownames(res)
    res <- res$pPert %>% data.frame()
    colnames(res) <- 'p.value'
    res$pathway = pList

    res <- tidyr::replace_na(res, list(p.value = 1))
    res <- res[, c('pathway', 'p.value')]

    res
}

.gsa <- function(summarizedExperiment, geneSet, perm, seed, gsa.method = "maxmean", minsize = 15, maxsize = 1000, ncore = 1,...){
    requirePackage("GSA")

    params <- list(...)
    if (!is.null(params$nperms)) {
        perm <- params$nperms
        params$nperms <- NULL
    }
    if (!is.null(params$random.seed)){
        seed <- params$random.seed
        params$random.seed <- NULL
    }

    if (!is.null(params$minsize)){
        keeps <- geneSet %>% lapply(length) %>% unlist() %>% `>=`(params$minsize) %>% which() %>% names()
        geneSet <- geneSet[keeps]
    }

    if (!is.null(params$maxsize)){
        keeps <- geneSet %>% lapply(length) %>% unlist() %>% `<=`(params$maxsize) %>% which() %>% names()
        geneSet <- geneSet[keeps]
    }

    for (p in c("x", "y", "genesets", "resp.type", "genenames")){
        if (!is.null(params[[p]])){
            stop(paste0("Sending parameter ", p ," for GSA is not allowed"))
        }
    }

    assay <- SummarizedExperiment::assay(summarizedExperiment)
    allGenes <- rownames(summarizedExperiment)

    group <- summarizedExperiment$group + 1

    resp.type <- "Two class unpaired"

    if (!is.null(summarizedExperiment$block)){
        resp.type <- "Two class paired"
        group <- ((group - 1)*2 - 1) * (summarizedExperiment$block %>% factor %>% as.numeric())
    }

    params <- c(
        list(
            x = as.matrix(assay), y = group, nperms=perm, genesets=geneSet, resp.type = resp.type,
            genenames=allGenes, random.seed = seed,
            method = gsa.method, minsize = minsize, maxsize = maxsize
        ),
        params
    )

    if (ncore > 1){
        params$ncore = ncore
    }

    res <- do.call(what = GSA::GSA, params)

    p.values <- cbind(res$pvalues.lo, res$pvalues.hi) %>% apply(1, min)
    p.values <- (p.values * 2) %>% data.frame(pathway = names(geneSet))
    colnames(p.values) <- c('p.value', 'pathway')

    return(drop_na(p.values))
}

.go.stats <- function(summarizedExperiment, geneSet, alpha, maxDEGene, DEGenes, seed, testDirection = "over", ...){
    requirePackage("GOstats")
    requirePackage("GSEABase")

    universeGeneIds = names(summarizedExperiment)

    if (is.null(DEGenes)){
        set.seed(seed)
        summarizedExperiment <- filterAssay(summarizedExperiment, p.value = alpha, maxGeneByFC = maxDEGene)
        DEGenes              <- names(summarizedExperiment)
    }

    geneSetCollection <- mapply(function(geneIds, keggId){
        GeneSet(geneIds, geneIdType=EntrezIdentifier(), collectionType=KEGGCollection(keggId), setName=keggId)
    }, geneSet, names(geneSet)) %>% GeneSetCollection()

    set.seed(seed)
    res <-  Category::GSEAKEGGHyperGParams(name="params",
                                           geneSetCollection = geneSetCollection,
                                           geneIds = DEGenes,
                                           universeGeneIds = universeGeneIds,
                                           pvalueCutoff = 1,
                                           testDirection = testDirection, ...) %>%
        GOstats::hyperGTest() %>% summary()

    res <- res %>% dplyr::select(KEGGID, Pvalue) %>% dplyr::rename(pathway = KEGGID, p.value = Pvalue)

    return(res)

}


.ks.wilcox.test <- function(method = "ks", summarizedExperiment, geneSet, alpha, maxDEGene, seed, DEGenes = NULL, FC = NULL, ncore = 1,...){

    if(.Platform$OS.type == "windows") {
        ncore = 1
    }

    if (is.null(ncore)) ncore = 1
    if (ncore > 1) requirePackage("parallel")

    set.seed(seed)
    summarizedExperiment <- calcStats(summarizedExperiment)

    if (is.null(FC)){
        FC      <- SummarizedExperiment::rowData(summarizedExperiment)$FC %>% abs()
        names(FC) <- names(summarizedExperiment)
    }

    test <- if (method == "ks") ks.test else wilcox.test

    allGenes <- names(FC)

    res <- parallel::mclapply(geneSet, mc.cores = ncore, function(gs){

        DEhit <- FC[allGenes[allGenes %in% gs]]
        DEmiss <- FC[allGenes[!allGenes %in% gs]]

        if (length(DEhit) == 0 | length(DEmiss) == 0) return(NA)

        test(DEhit, DEmiss)$p.value
    }) %>% unlist() %>% data.frame(pathway=names(geneSet))

    colnames(res) <- c("p.value", "pathway")

    res %>% drop_na()
}

.ks.wilcox.test.gl <- function(method = "ks", geneList, geneStat, geneSet, ncore = 1){

    if(.Platform$OS.type == "windows") {
        ncore = 1
    }

    if (is.null(ncore)) ncore = 1
    if (ncore > 1) requirePackage("parallel")

    FC <- geneStat
    names(FC) <- geneList

    test <- if (method == "ks") ks.test else wilcox.test

    allGenes <- geneList

    res <- parallel::mclapply(geneSet, mc.cores = ncore, function(gs){

        DEhit <- FC[allGenes[allGenes %in% gs]]
        DEmiss <- FC[allGenes[!allGenes %in% gs]]

        if (length(DEhit) == 0 | length(DEmiss) == 0) return(NA)

        test(DEhit, DEmiss)$p.value
    }) %>% unlist() %>% data.frame(pathway=names(geneSet))

    colnames(res) <- c("p.value", "pathway")

    res <- res %>% drop_na()

    finalRes <- data.frame(pathway = names(geneSet) %>% unique(), stringsAsFactors = F)
    rownames(finalRes) <- names(geneSet)

    finalRes$p.value <- 1
    finalRes[res$pathway %>% as.character(), 'p.value'] <- res$p.value
    finalRes

    return(finalRes)
}

.pathnet <- function(summarizedExperiment, grn, perm, seed, ...){
    requirePackage("PathNet")

    set.seed(seed)
    summarizedExperiment <- calcStats(summarizedExperiment)

    p.values <- SummarizedExperiment::rowData(summarizedExperiment)$p.value
    p.values <- data.frame(gene = names(summarizedExperiment) %>% strsplit(":") %>% lapply(function(x) x[2]) %>% unlist() %>% as.numeric(),
                           p.value = -log10(p.values))

    adjacency <- pathnet.GeneNetworkToAdjacency(grn)
    pathway <- pathnet.GeneNetworkToPathway(grn)

    set.seed(seed)
    suppressMessages(
        res <- PathNet::PathNet(Enrichment_Analysis = TRUE,
                                DirectEvidence_info = p.values,
                                Adjacency = adjacency,
                                pathway = pathway,
                                Column_DirectEvidence = 2,
                                n_perm = perm, threshold = 1)
    )

    res <- res$enrichment_results[,c('Name', 'p_PathNet')]

    colnames(res) <- c('pathway', 'p.value')

    return(res)
}

.WebGestaltR <- function(summarizedExperiment, geneSet, alpha, maxDEGene, DEGenes, seed, sigMethod = "top",...){
    requirePackage("WebGestaltR")

    referenceGenes = names(summarizedExperiment)

    if (is.null(DEGenes)){
        set.seed(seed)
        summarizedExperiment <- filterAssay(summarizedExperiment, p.value = alpha, maxGeneByFC = maxDEGene)
        DEGenes <- names(summarizedExperiment)
    }

    gmtFile <- WebGestaltR.GetGeneSetFile(geneSet)

    set.seed(1)
    enrichResult <- try(WebGestaltR(enrichMethod = "ORA", organism = "others",
                                    enrichDatabase = "others", enrichDatabaseFile = gmtFile,
                                    interestGene = DEGenes,
                                    fdrThr = 1, topThr = 500, reportNum = 500, sigMethod = sigMethod,
                                    setCoverNum = 500, minNum = 1, maxNum = 1000,
                                    referenceGene = referenceGenes,
                                    isOutput=F))

    unlink(gmtFile)

    if (class(enrichResult) == "try-error") return(NULL)

    res <- enrichResult %>% dplyr::select(geneSet, pValue)
    colnames(res) <- c("pathway", "p.value")
    res
}
