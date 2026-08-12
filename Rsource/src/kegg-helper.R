getKEGGPathway <- function(org, cache = TRUE){
    requirePackage("ROntoTools")

    cacheName <- paste0(org, "-KEGG-pathway")
    if(cache){
        keggPathway <- getCache(cacheName)
        if (!is.null(keggPathway)) return(keggPathway)
    }

    keggPathway <- suppressMessages(ROntoTools::keggPathwayGraphs(organism = org, updateCache=!cache, verbose = FALSE, relPercThresh = 0))

    saveCache(keggPathway, cacheName)
    return(keggPathway)
}

getKEGGGeneSet <- function(org, cache = TRUE){
    cacheName <- paste0(org, "-KEGG-gene-set")
    if(cache){
        geneSet <- getCache(cacheName)
        if (!is.null(geneSet)) return(geneSet)
    }

    geneLink <- read.table(paste0("http://rest.kegg.jp/link/", org, "/pathway"), sep = "\t", header = F,  stringsAsFactors = F);
    colnames(geneLink) <- c("geneset", "gene")

    geneLink <- geneLink %>% group_by(geneset) %>% group_split() %>% lapply(function(dat){
        list(
          name = dat$geneset[1] %>% as.character(),
          genes = dat$gene %>% as.character()
        )
    })

    names(geneLink) <- geneLink %>% lapply(function(gl) gl$name)
    geneLink <- geneLink %>% lapply(function(gl) gl$genes)

    keeps <- geneLink %>% lapply(length) %>% unlist() %>% `>=`(5) %>% which() %>% names()
    geneLink <- geneLink[keeps]

    saveCache(geneLink, cacheName)

    return(geneLink)
}

getKEGGPathwayName <- function(org, cache = TRUE){
    cacheName <- paste0(org, "-KEGG-names")
    if(cache){
        keggNames <- getCache(cacheName)
        if (!is.null(keggNames)) return(keggNames)
    }

    gsNames <- read.table(paste0("http://rest.kegg.jp/list/pathway/", org), sep = "\t", header = F, stringsAsFactors = F);
    id <- gsNames[, 1]
    gsNames <- gsNames[,2]
    names(gsNames) <- id

    saveCache(gsNames, cacheName)

    return(gsNames)
}
