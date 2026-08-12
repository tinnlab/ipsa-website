import { rStringify } from "./utils";

const nCore = Meteor.settings.private.RParallelCore;

export default ({ rdsFile }) => `
    do.call(what = function(expr, group, geneSets, perm, seed) {
        library(PADOG)

        # Filter gene sets
        geneSetCommonLength <- sapply(geneSets, function(gs){
            length(intersect(rownames(expr), gs))
        })
        geneSets <- geneSets[geneSetCommonLength >= 3]
        
        # If no gene sets meet the minimum criteria, return early
        if (length(geneSets) == 0) {
            return(data.frame(
                pathway = character(0),
                pValue = numeric(0),
                pValueFDR = numeric(0),
                score = numeric(0),
                stringsAsFactors = FALSE
            ))
        }
        
        group <- c("c", "d")[group + 1]

        # Run PADOG
        res <- try(PADOG::padog(
            esetm = as.matrix(expr),
            group = group,
            gslist = geneSets,
            annotation = NULL,
            gs.names = names(geneSets),
            NI = perm,
            plots = FALSE,
            targetgs = NULL,
            Nmin = 3,
            dseed = seed,
            parallel = TRUE,
            ncr = ${nCore}
        ), silent = TRUE)

        # Check for errors
        if (inherits(res, "try-error")) {
            print(paste("Error in PADOG:", res))
            finalRes <- data.frame(
                pathway = names(geneSets),
                pValue = 1,
                pValueFDR = 1,
                score = 0,
                stringsAsFactors = FALSE
            )
            rownames(finalRes) <- finalRes$pathway
            return(finalRes)
        }

        # Process results
        print("Structure of PADOG result:")
        print(str(res))
        print("Column names of PADOG result:")
        print(colnames(res))

        # Create finalRes with all gene sets
        finalRes <- data.frame(
            pathway = names(geneSets),
            pValue = 1,
            pValueFDR = 1,
            score = 0,
            stringsAsFactors = FALSE
        )
        rownames(finalRes) <- finalRes$pathway

        # Update finalRes with PADOG results if available
        if (!is.null(res) && is.data.frame(res) && nrow(res) > 0) {
            # According to PADOG documentation, we expect these column names
            # From the docs, we expect: ID, Ppadog, and padog0
            
            # Get column names carefully with fallbacks
            id_col <- NULL
            if ("ID" %in% colnames(res)) {
                id_col <- "ID"
            } else {
                possible_id_cols <- grep("^id$|^pathway$|^Name$", colnames(res), ignore.case = TRUE, value = TRUE)
                if (length(possible_id_cols) > 0) id_col <- possible_id_cols[1]
            }
            
            pvalue_col <- NULL
            if ("Ppadog" %in% colnames(res)) {
                pvalue_col <- "Ppadog"
            } else {
                possible_p_cols <- grep("^p(value)?$", colnames(res), ignore.case = TRUE, value = TRUE)
                if (length(possible_p_cols) > 0) pvalue_col <- possible_p_cols[1]
            }
            
            # Look for FDR column
            fdr_col <- NULL
            if ("FDR" %in% colnames(res)) {
                fdr_col <- "FDR"
            } else {
                possible_fdr_cols <- grep("^fdr$|^q(value)?$", colnames(res), ignore.case = TRUE, value = TRUE)
                if (length(possible_fdr_cols) > 0) fdr_col <- possible_fdr_cols[1]
            }
            
            # Look for score column
            score_col <- NULL
            if ("padog0" %in% colnames(res)) {
                score_col <- "padog0"
            } else {
                possible_score_cols <- grep("^score$", colnames(res), ignore.case = TRUE, value = TRUE)
                if (length(possible_score_cols) > 0) score_col <- possible_score_cols[1]
            }
            
            print(paste("Using columns - ID:", id_col, "pValue:", pvalue_col, "FDR:", fdr_col, "Score:", score_col))

            # Update values if columns are found
            if (!is.null(id_col) && !is.null(pvalue_col)) {
                # Ensure values in res columns are not NULL
                if (length(res[[id_col]]) > 0 && length(res[[pvalue_col]]) > 0) {
                    matching_rows <- match(res[[id_col]], finalRes$pathway)
                    matching_rows <- matching_rows[!is.na(matching_rows)]

                    if (length(matching_rows) > 0) {
                        finalRes$pValue[matching_rows] <- res[[pvalue_col]]

                        # Only update FDR if column exists and has values
                        if (!is.null(fdr_col) && length(res[[fdr_col]]) > 0) {
                            finalRes$pValueFDR[matching_rows] <- res[[fdr_col]]
                        } else {
                            # Calculate FDR only on actual PADOG p-values
                            adjusted_pvals <- p.adjust(res[[pvalue_col]], method = "fdr")
                            finalRes$pValueFDR[matching_rows] <- adjusted_pvals
                            # Non-matching pathways keep pValueFDR = 1 (default)
                        }

                        # Only update score if column exists and has values
                        if (!is.null(score_col) && length(res[[score_col]]) > 0) {
                            finalRes$score[matching_rows] <- res[[score_col]]
                        }
                    }
                }
            } else {
                print("Warning: Expected columns not found in PADOG output")
            }
        } else {
            print("Warning: PADOG returned no results or invalid results")
        }

        return(finalRes)
    }, args = readRDS(${rStringify(rdsFile)}))
`;