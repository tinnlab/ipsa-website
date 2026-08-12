import {rStringify} from "./utils"

export default ({id, samples, savePath}) => `
        samples <- fromJSON('${rStringify(samples)}')
        geoData <- GEOquery::getGEO('${id}', getGPL = F, GSEMatrix = T)
        
        allPlatforms <- names(geoData)
        importedSamples <- c()
        
        for (platform in allPlatforms){
            exprs <- geoData[[platform]]@assayData$exprs
            
            if (nrow(exprs) == 0) stop(paste0("Series matrix file ",platform," does not contain any expression value."))
        
            exprs <- as.data.frame(as.matrix(exprs), stringsAsFactors = F)
            commonSamples <- intersect(colnames(exprs), samples)
            
            if (length(commonSamples) == 0) next()
            
            exprs <- exprs[, commonSamples] %>% as.data.frame()
            colnames(exprs) <- commonSamples
            exprs[is.na(exprs)] <- 0
        
            if (max(exprs) > 100) exprs <- log2(exprs + 1)
        
            write.csv(exprs, paste0('${savePath}', "expression-", platform ,".csv"))
            importedSamples <- c(importedSamples, colnames(exprs))
        }
    
        importedSamples
    `
