makeSPIAData <- function(org, cache = TRUE){
   requirePackage("KEGGREST")
   
   dataDir <- paste0(rappdirs::user_cache_dir('BiasCorrection'), '/', org, "-SPIA-data")
   
   if (cache){
       if (dir.exists(dataDir)) return(dataDir)
   }
   
   keggPathway <- getKEGGPathway(org, cache)
   
   relationships <- c("activation", "compound", "binding/association", 
                    "expression", "inhibition", "activation_phosphorylation", 
                    "phosphorylation", "inhibition_phosphorylation", 
                    "inhibition_dephosphorylation", "dissociation", "dephosphorylation", 
                    "activation_dephosphorylation", "state change", "activation_indirect effect", 
                    "inhibition_ubiquination", "ubiquination", "expression_indirect effect", 
                    "inhibition_indirect effect", "repression", "dissociation_phosphorylation", 
                    "indirect effect_phosphorylation", "activation_binding/association", 
                    "indirect effect", "activation_compound", "activation_ubiquination")
   
   replacements = list(
       c('ubiquitination', 'ubiquination'),
       c(',missing interaction', ''),
       c('missing interaction', ''),
       c('compound,activation', 'activation,compound')
   )
   
   keggRels <- keggPathway %>% lapply(function(e) e@edgeData@data %>% lapply(function(e) {
       s <- e$subtype
       for (r in replacements){
           s <- sub(r[1], r[2], s)
       }
       s
   })) %>% unlist() %>% unique() %>% sub(pattern = ",", replacement = "_") %>% strsplit(',') %>% unlist() %>% unique()
   
   keggPathwayNames <- KEGGREST::keggList("pathway", "hsa")
   
   path.info <- lapply(keggPathway, function(pathway){
           nodes <- pathway@nodes
           edgeData <- pathway@edgeData@data
           
           rels <- lapply(keggRels, function(relationship){
                   dat <- matrix(0, nrow = length(nodes), ncol = length(nodes), dimnames = list(nodes, nodes))
                   
                   reactions <- edgeData %>% lapply(function(e) {
                       s <- e$subtype
                       for (r in replacements){
                           s <- sub(r[1], r[2], s)
                       }
                       s <- sub(',', '_', s)
                       relationship %in% (strsplit(s, ",") %>% unlist())
                   }) %>% unlist() %>% which() %>% names() %>% strsplit('\\|')
                   
                   for (r in reactions){
                           dat[r[2], r[1]] <- 1
                   }
                   
                   return(dat)
           })
           
           names(rels) <- keggRels
           rels <- rels[relationships]
           rels$dissociation_phosphorylation = matrix(0, nrow = length(nodes), ncol = length(nodes), dimnames = list(nodes, nodes))
           rels$nodes <- nodes
           rels$NumberOfReactions = 0
           
           return(rels)
   })
   
   for (pathwayId in names(path.info)){
           path.info[[pathwayId]]$title = keggPathwayNames[pathwayId] %>% as.character()
   }
   
   unlink(dataDir, recursive=TRUE)
   dir.create(dataDir, showWarnings = FALSE)
   
   save(path.info, file = paste0(dataDir, "/", org, "SPIA.RData"))
   return(dataDir)
}

makeCePaPathwayCat <- function(org, cache = TRUE){
   requirePackage("CePa")
   
   cacheName = paste0(org, '-CePa-pathway-cat')
   if (cache){
       cat <- getCache(cacheName)
       if (!is.null(cat)) return(cat)
   }
   
   keggPathway <- getKEGGPathway(org, cache)
   
   interactionList <- lapply(keggPathway, function(pathway){
           pathway@edgeData %>% names()
   }) %>% do.call(what=c) %>% unique()
   
   pathList <- lapply(keggPathway, function(pathway){
           (interactionList %in% (pathway@edgeData %>% names())) %>% which() %>% as.character()
   })
   
   interactionList <- seq(length(interactionList)) %>% as.character() %>% cbind(
           interactionList %>% strsplit('\\|') %>% do.call(what=rbind) 
   ) %>% data.frame(stringsAsFactors = FALSE)
   
   colnames(interactionList) <- c("interaction.id", "input", "output")
   rownames(interactionList) <- interactionList$interaction.id
   
   mapping <- lapply(keggPathway, function(pathway) pathway@nodes) %>% unlist() %>% unique()
   mapping <- data.frame(node.id = mapping, symbol = mapping, stringsAsFactors = FALSE)
   
   cat <- CePa::set.pathway.catalogue(pathList, interactionList, mapping, min.node = 2, max.node = 1e+6)
   
   saveCache(cat, cacheName)
   
   return(cat)
}     

getRefEntrezIDs <- function(org){
   requirePackage("AnnotationDbi")
   
   if (org == 'hsa'){
       requirePackage("org.Hs.eg.db")
       annotation = org.Hs.eg.db
   } else if (org == 'mmu'){
       requirePackage("org.Mm.eg.db")
       annotation = org.Mm.eg.db
   } else {
       stop(paste0("Please pass `bk` parameter for organism ", org))
   }
   
   keggGenes <- getKEGGGeneSet(org) %>% unlist() %>% unique()
   
   keys <- AnnotationDbi::keys(annotation, keytype = "ENTREZID")
   keys <- AnnotationDbi::select(annotation, keys = keys, keytype = "ENTREZID", column = c("ENTREZID", "ENSEMBL")) %>% tidyr::drop_na()
   keys <- keys$ENTREZID %>% as.character() %>% unique()
   c(paste0(org, ':', keys), keggGenes) %>% unique()
}

pathnet.GeneNetworkToAdjacency <- function(grn){
   res <- lapply(grn, function(pathway){
      nodes <- pathway@nodes
      edges <- pathway@edgeData %>% names() %>% strsplit('\\|') %>% c(list(NULL)) %>% do.call(what = rbind) %>% data.frame() 
      colnames(edges) <- c("from", "to")
      edges$value <- 1
      
      tmpAdj <- tidyr::spread(edges, to, value, fill = 0)
      rnames <- tmpAdj$from %>% as.character()
      cnames <- colnames(tmpAdj)[2:ncol(tmpAdj)]
      tmpAdj <- tmpAdj[, 2:ncol(tmpAdj)] %>% as.matrix()
      rownames(tmpAdj) <- rnames
      colnames(tmpAdj) <- cnames
      
      adj <- matrix(0, nrow = length(nodes), ncol = length(nodes))
      rownames(adj) <- colnames(adj) <- nodes
      
      adj[rownames(tmpAdj), colnames(tmpAdj)] <- tmpAdj
      
      adj[,] <- adj + t(adj)
      adj[adj > 0] <- 1
      
      return(adj)
   })
   
   allGenes <- res %>% lapply(function(m) c(rownames(m), colnames(m))) %>% unlist() %>% unique()
   adj <- matrix(0, nrow = length(allGenes), ncol = length(allGenes))
   rownames(adj) <- colnames(adj) <- allGenes
   
   for (m in res){
      adj[rownames(m), colnames(m)] <- adj[rownames(m), colnames(m)] + m
      adj[colnames(m), rownames(m)] <- adj[colnames(m), rownames(m)] + m
   }
   
   adj[adj > 0] <- 1
   adj <- adj[rowSums(adj) > 0, colSums(adj) >0]
   
   rownames(adj) <- rownames(adj) %>% strsplit(":") %>% lapply(function(x) x[2]) %>% unlist() %>% as.numeric()
   colnames(adj) <- colnames(adj) %>% strsplit(":") %>% lapply(function(x) x[2]) %>% unlist() %>% as.numeric()
   return(adj)
}

pathnet.GeneNetworkToPathway <- function(grn){
   res <- lapply(names(grn), function(pname){
      edges <- grn[[pname]]@edgeData %>% names() %>% strsplit('\\|') %>% c(list(NULL)) %>% do.call(what = rbind) %>% data.frame(stringsAsFactors = F) 
      colnames(edges) <- c("id1", "id2")
      edges$title = pname
      return(edges)
   }) %>% do.call(what=rbind)
   
   res$id1 <- res$id1 %>% strsplit(":") %>% lapply(function(x) x[2]) %>% unlist() %>% as.numeric()
   res$id2 <- res$id2 %>% strsplit(":") %>% lapply(function(x) x[2]) %>% unlist() %>% as.numeric()
   
   res
}

WebGestaltR.GetGeneSetFile <- function(geneSet){
   
   data <- names(geneSet) %>% lapply(function(pathway){
      data.frame(geneSet = pathway, description = pathway, gene = geneSet[[pathway]])
   }) %>% do.call(what = rbind)
   
   gmtFile <- paste0(tempfile(), '.gmt')
   write.table(data, file = gmtFile, sep = "\t", row.names = F, col.names = F, quote = F)

   return(gmtFile)
}
