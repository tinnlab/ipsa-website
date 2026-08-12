getCache <- function (name){
    cacheFile <- paste0(rappdirs::user_cache_dir('BiasCorrection'), '/', name, '.rds')

    if (file.exists(cacheFile)) readRDS(cacheFile) else NULL
}

saveCache <- function(value, name){
    cacheDir <- rappdirs::user_cache_dir('BiasCorrection')
    dir.create(cacheDir, showWarnings = FALSE)

    saveRDS(value, paste0(cacheDir, '/', name, '.rds'))
}

requirePackage <- function(pkg){
    if(!(pkg %in% .packages(all.available=TRUE)))
    {
        stop(paste0("Package ",  pkg, " is not installed."))
    }
    require(pkg, character.only=TRUE, quietly=TRUE)
}

getAnnotation <- function(annotation){

    if (is.null(annotation)) return(NULL)

    annotations <- list(
        GPL96 = "hgu133a.db",
        GPL97 = "hgu133b.db",
        GPL570 = "hgu133plus2.db",
        GPL6244 = "hugene10sttranscriptcluster.db",
        GPL4866 = "hgu133plus2.db",
        GPL16311 = "hgu133plus2.db",
        GPL6244 = "hugene10sttranscriptcluster.db",
        GPL571 = "hgu133a2.db",
        GPL10739 = "hugene10sttranscriptcluster.db",
        GPL201 = "hgfocus.db",
        GPL8300 = "hgu95av2.db",
        GPL80 = "hu6800.db",
        GPL1261 = "mouse4302.db",
        GPL6246 = "mogene10sttranscriptcluster.db",
        GPL81 = "mgu74a.db",
        GPL339  = "moe430a.db",
        GPL10740 = "mogene10sttranscriptcluster.db",
        GPL16570 = "mogene20sttranscriptcluster.db",
        GPL11044 = "mouse4302.db",
        GPL6193 = "moex10sttranscriptcluster.db"
    )

    if (class(annotation) == "ChipDb") return(annotation)
    if (class(annotation) == "OrgDb") return(annotation)

    if (grep("GPL", annotation)){
        if (!is.null(annotations[[annotation]])){
            anno <- annotations[[annotation]]
            requirePackage(anno)
            return(get(anno))
        } else {
            stop(paste0("Platform ",  annotation, " is not supported. Please pass an AnnotationDbi  object instead"))
        }
    }

    if (class(annotation) == "character"){
        for (anno in annotations){
            if (anno == annotation){
                requirePackage(anno)
                return(get(anno))
            }
        }

        stop(paste0("Annotation ",  annotation, " is not supported. Please pass an ChipDb object instead"))
    }
}

runLimma <- function(summarizedExperiment){
    paired <- !is.null(summarizedExperiment$block)

    assay <- SummarizedExperiment::assay(summarizedExperiment)
    group <- factor(c('c','d')[summarizedExperiment$group + 1])

    if (paired){
        block = factor(summarizedExperiment$block)
        G <- group
        design <- model.matrix(~0 + G + block)
        colnames(design) <- substr(colnames(design), 2, 100)
    }  else {
        design <- model.matrix(~0 + group)
        colnames(design) <- levels(group)
    }

    top <- contrasts.fit(
        lmFit(assay, design),
        makeContrasts(contrasts = "d-c", levels = design)
    ) %>% eBayes() %>% topTable(coef = 1, number = nrow(summarizedExperiment))

    return(top)
}

runLimma.exprs <- function(assay, group, block, paired = F){

    group <- factor(c('c','d')[group + 1])

    if (paired){
        block = factor(block)
        design <- model.matrix(~0 + group + block)
        colnames(design) <- substr(colnames(design), 2, 100)
    }  else {
        design <- model.matrix(~0 + group)
        colnames(design) <- levels(group)
    }

    top <- contrasts.fit(
      lmFit(assay, design),
      makeContrasts(contrasts = "d-c", levels = design)
    ) %>% eBayes() %>% topTable(coef = 1, number = nrow(assay))

    return(top)
}

mapEntrezID.limma <- function (exprs, group, block, annotation = NULL, org){
    annotation <- getAnnotation(annotation)
    top <- runLimma.exprs(exprs, group, block, paired = !is.null(block))

    suppressMessages(
        entrezIDMapping <- annotation %>%
            AnnotationDbi::select(keys = rownames(top), columns = "ENTREZID", keytype = "PROBEID") %>% drop_na() %>%
            group_by(PROBEID) %>% mutate(ENTREZID.FIRST = dplyr::first(ENTREZID)) %>% dplyr::select(PROBEID, ENTREZID.FIRST) %>% unique() %>%
            group_by(ENTREZID.FIRST) %>% mutate(PROBEID.FIRST = dplyr::first(PROBEID)) %>% dplyr::select(PROBEID.FIRST, ENTREZID.FIRST) %>% unique() %>%
            dplyr::rename(PROBEID = PROBEID.FIRST, ENTREZID = ENTREZID.FIRST)
    )


    exprs <- exprs[entrezIDMapping$PROBEID, ]
    rownames(exprs) <- paste0(org, ':', entrezIDMapping$ENTREZID)
    return(exprs)
}

mapEntrezID.median <- function (exprs, annotation = NULL, org, keytype = "PROBEID"){
    annotation <- getAnnotation(annotation)

    suppressMessages(
        entrezIDMapping <- annotation %>% AnnotationDbi::select(keys = rownames(exprs), columns = "ENTREZID", keytype = keytype) %>% drop_na()
    )

    exprs <- exprs[entrezIDMapping[[keytype]], ] %>% as.data.frame()
    exprs$ENTREZID <- entrezIDMapping$ENTREZID
    exprs <- exprs %>% group_by(ENTREZID) %>% summarise_each(median) %>% as.data.frame()
    rownames(exprs) <- paste0(org, ":", exprs$ENTREZID)
    exprs %>% dplyr::select(-ENTREZID) %>% as.data.frame()
}

calcStats <- function(summarizedExperiment){
    # filter insignificant genes
    res <- runLimma(summarizedExperiment)

    summarizedExperiment <- summarizedExperiment[rownames(res), ]
    rowData(summarizedExperiment)$FC <- res$logFC
    rowData(summarizedExperiment)$p.value <- res$P.Value

    summarizedExperiment
}

filterAssay <- function(summarizedExperiment, p.value = NULL, FC = NULL, maxGeneByPValue = NULL, maxGeneByFC = NULL){
    # filter insignificant genes
    top <- runLimma(summarizedExperiment)

    if (!is.null(p.value)){
        top <- top[top$P.Value <= p.value, ]
    }
    if (!is.null(FC)){
        top <- top[abs(top$logFC) >= FC, ]
    }
    if (!is.null(maxGeneByPValue)){
        top <- top[1:min(nrow(top), maxGeneByPValue), ]
    }
    if (!is.null(maxGeneByFC)){
        top <- top[(abs(top$logFC) %>% order(decreasing = T))[1:min(nrow(top), maxGeneByFC)], ]
    }

    top <- top %>% drop_na()

    summarizedExperiment <- summarizedExperiment[rownames(top), ]
    rowData(summarizedExperiment)$FC <- top$logFC
    rowData(summarizedExperiment)$p.value <- top$P.Value

    summarizedExperiment
}

getGeneInfo <- function(){
    geneInfo <- (function(){
        conn <- gzcon(url("https://ftp.ncbi.nih.gov/gene/DATA/gene_info.gz"))
        txt <- readLines(conn)
        read.table(textConnection(txt), sep = "\t", header = F,  stringsAsFactors = F)
    })()
}

getGEOData <- function(GEOId, samples, dir = NULL){
    geoData <- GEOquery::getGEO(GEOId, getGPL = F, GSEMatrix = T)
    exprs <- geoData[[1]]@assayData$exprs

    exprs <- as.data.frame(as.matrix(exprs), stringsAsFactors = F)

    notFoundSamples <- samples[!(samples %in% colnames(exprs))]

    if (length(notFoundSamples) > 0){
        stop(paste0(
          "Samples ", paste0(notFoundSamples, collapse= ", "), " not found. ",
          "The series matrix provided only contains these samples: ", paste0(colnames(exprs), collapse = ", ")))
    }

    exprs <- exprs[, samples]
    if (max(exprs) > 100) exprs <- log2(exprs + 1)

    if (!is.null(dir)){
        dir.create(dir)
        write.csv(exprs, paste0(dir, "expression.csv"))
    }

    exprs
}
