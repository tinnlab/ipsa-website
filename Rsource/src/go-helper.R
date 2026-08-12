getGOTerms <- function(cache = TRUE, namespace = "biological_process") {

    cacheName <- paste0("GO-terms-", namespace)
    if (cache) {
        terms <- getCache(cacheName)
        if (!is.null(terms)) return(terms)
    }

    cacheDir <- rappdirs::user_cache_dir('BiasCorrection')

    oboFile <- file.path(cacheDir, "go.obo")
    download.file("http://purl.obolibrary.org/obo/go.obo", oboFile)

    rawLines <- readLines(oboFile)

    terms <- list()
    for (i in 1:length(rawLines)) {
        if (rawLines[i] == "[Term]") {
            term <- list(
                id = (rawLines[i + 1] %>% str_split(":", n = 2) %>%  unlist())[2] %>% str_trim(side = "both"),
                name = (rawLines[i + 2] %>%  str_split(":", n = 2) %>% unlist())[2] %>% str_trim(side = "both"),
                namespace = (rawLines[i + 3] %>%  str_split(":", n = 2) %>% unlist())[2] %>% str_trim(side = "both")
            )
            if (term$namespace == namespace) terms <- c(terms, list(term %>% unlist()))
        }
    }
    terms <- terms %>% do.call(what = rbind) %>% as.data.frame()

    saveCache(terms, cacheName)
    terms
}

getGene2GO <- function(cache = T){

    cacheName <- paste0("gene2go")
    if (cache) {
        g2g <- getCache(cacheName)
        if (!is.null(g2g)) return(g2g)
    }

    conn <- gzcon(url("https://ftp.ncbi.nih.gov/gene/DATA/gene2go.gz"))
    txt <- readLines(conn)
    g2g <- read.table(textConnection(txt), sep = "\t", header = F,  stringsAsFactors = F, fill = TRUE)

    saveCache(g2g, cacheName)
    g2g
}

getGenomeList <- function (cache=T){

    cacheName <- paste0("genome-list")
    if (cache) {
        genomeList <- getCache(cacheName)
        if (!is.null(genomeList)) return(genomeList)
    }

    conn <- gzcon(url("http://rest.kegg.jp/list/genome"))
    txt <- readLines(conn)

    genomeList <- txt %>% str_split('\t|, |; ') %>% lapply(function(d) {
        d <- d[c(2,3,4)]
        if (is.na(as.numeric(d[2]))){
            d[2] <- d[3]
        }
        d[c(1,2)]
    }) %>% do.call(what = rbind) %>% as.data.frame()
    colnames(genomeList) <- c("org", "taxId")
    genomeList

    saveCache(genomeList, cacheName)
    genomeList
}

getGOGeneSet <- function(org, cache = TRUE, namespace = "biological_process") {

    cacheName <- paste0(org, "-GO-gene-set-", namespace)
    if (cache) {
        geneSet <- getCache(cacheName)
        if (!is.null(geneSet)) return(geneSet)
    }

    genomeList <- getGenomeList(cache)

    taxId <- genomeList[genomeList$org == org, ]$taxId %>% as.character()

    gene2go <- getGene2GO(cache)

    colnames(gene2go) <- c("tax_id", "GeneID", "GO_ID")
    gene2go <- gene2go[, c("tax_id", "GeneID", "GO_ID")]

    geneset <- gene2go %>% filter(tax_id == taxId) %>% group_by(GO_ID) %>% group_split() %>% lapply(function(dat){
        list(
            goID = dat$GO_ID[1],
            genes = paste0(org, ":", dat$GeneID)
        )
    })
    names(geneset) <- lapply(geneset, function(gs) gs$goID)
    geneset <- lapply(geneset, function(gs) gs$genes)

    terms <- getGOTerms(cache, namespace)

    geneset <- geneset[intersect(terms$id %>% as.character(), names(geneset))]
    geneset.length <- lapply(geneset, length)

    geneset <- geneset[geneset.length >= 5]

    saveCache(geneset, cacheName)
    geneset
}

getGOTermName <- function(cache = TRUE, namespace = "biological_process") {
    cacheName <- paste0("GO-term-names-", namespace)
    if (cache) {
        GONames <- getCache(cacheName)
        if (!is.null(GONames)) return(GONames)
    }

    terms <- getGOTerms(cache)
    GONames <- terms$name
    names(GONames) <- terms$id

    saveCache(GONames, cacheName)
    return(GONames)
}
