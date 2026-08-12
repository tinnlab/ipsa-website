import { rStringify } from "./utils";

export default ({ file }) => `
        library(tidyverse)
        data <- read.csv('${file}', row.names = 1) %>% as.data.frame()
        samples <- colnames(data)
        rownames <- rownames(data)
        pcaData <- prcomp(t(data), rank.=2)$x %>% as.data.frame()
        data$id <- rownames
        list(data = head(data, 10), rownames = rownames, samples = samples, pcaData = pcaData)
    `
