import { rStringify } from "./utils";

export default (sourcePackage) => `
        BiocManager::install(${rStringify(sourcePackage)}, update = F)
        library(${sourcePackage})

        res <- lapply(keytypes(${sourcePackage}), function(type){
            if (type != "ENTREZID"){
                data <- try({
                    AnnotationDbi::select(${sourcePackage}, keytype = type, keys = keys(${sourcePackage}, keytype = type), columns = c(type, "ENTREZID"))
                })
                if(inherits(data, "try-error")){
                    return(NULL)
                }
                data <- data[, c(type, "ENTREZID")]
                colnames(data) <- c("to", "from")
                data$type <- type
                return(apply(data, 1, as.list))
            }
            return(NULL)
        })
        version <- packageVersion(${rStringify(sourcePackage)}) %>% as.character() %>% unlist()
        list(res = res, version = version)
    `
