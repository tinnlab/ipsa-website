GSEA_para <- function(
  input.ds,
  input.cls,
  gene.ann = "",
  gs.db,
  gs.ann = "",
  output.directory = "",
  doc.string = "GSEA.analysis",
  non.interactive.run = F,
  reshuffling.type = "sample.labels",
  nperm = 1000,
  weighted.score.type = 1,
  nom.p.val.threshold = -1,
  fwer.p.val.threshold = -1,
  fdr.q.val.threshold = 0.25,
  topgs = 10,
  adjust.FDR.q.val = F,
  gs.size.threshold.min = 25,
  gs.size.threshold.max = 500,
  reverse.sign = F,
  preproc.type = 0,
  random.seed = 123456,
  perm.type = 0,
  fraction = 1.0,
  replace = F,
  save.intermediate.results = F,
  OLD.GSEA = F,
  use.fast.enrichment.routine = T, ncore = 1) {
  
  # This is a methodology for the analysis of global molecular profiles called Gene Set Enrichment Analysis (GSEA). It determines
  # whether an a priori defined set of genes shows statistically significant, concordant differences between two biological
  # states (e.g. phenotypes). GSEA operates on all genes from an experiment, rank ordered by the signal to noise ratio and
  # determines whether members of an a priori defined gene set are nonrandomly distributed towards the top or bottom of the
  # list and thus may correspond to an important biological process. To assess significance the program uses an empirical
  # permutation procedure to test deviation from random that preserves correlations between genes.
  #
  # For details see Subramanian et al 2005
  #
  # Inputs:
  #   input.ds: Input gene expression Affymetrix dataset file in RES or GCT format
  #   input.cls:  Input class vector (phenotype) file in CLS format
  #   gene.ann.file: Gene microarray annotation file (Affymetrix Netaffyx *.csv format) (default: none)
  #   gs.file: Gene set database in GMT format
  #   output.directory: Directory where to store output and results (default: .)
  #   doc.string:  Documentation string used as a prefix to name result files (default: "GSEA.analysis")
  #   non.interactive.run: Run in interactive (i.e. R GUI) or batch (R command line) mode (default: F)
  #   reshuffling.type: Type of permutation reshuffling: "sample.labels" or "gene.labels" (default: "sample.labels")
  #   nperm: Number of random permutations (default: 1000)
  #   weighted.score.type: Enrichment correlation-based weighting: 0=no weight (KS), 1=standard weigth, 2 = over-weigth (default: 1)
  #   nom.p.val.threshold: Significance threshold for nominal p-vals for gene sets (default: -1, no thres)
  #   fwer.p.val.threshold: Significance threshold for FWER p-vals for gene sets (default: -1, no thres)
  #   fdr.q.val.threshold: Significance threshold for FDR q-vals for gene sets (default: 0.25)
  #   topgs: Besides those passing test, number of top scoring gene sets used for detailed reports (default: 10)
  #   adjust.FDR.q.val: Adjust the FDR q-vals (default: F)
  #   gs.size.threshold.min: Minimum size (in genes) for database gene sets to be considered (default: 25)
  #   gs.size.threshold.max: Maximum size (in genes) for database gene sets to be considered (default: 500)
  #   reverse.sign: Reverse direction of gene list (pos. enrichment becomes negative, etc.) (default: F)
  #   preproc.type: Preprocessing normalization: 0=none, 1=col(z-score)., 2=col(rank) and row(z-score)., 3=col(rank). (default: 0)
  #   random.seed: Random number generator seed. (default: 123456)
  #   perm.type: Permutation type: 0 = unbalanced, 1 = balanced. For experts only (default: 0)
  #   fraction: Subsampling fraction. Set to 1.0 (no resampling). For experts only (default: 1.0)
  #   replace: Resampling mode (replacement or not replacement). For experts only (default: F)
  #   OLD.GSEA: if TRUE compute the OLD GSEA of Mootha et al 2003
  #   use.fast.enrichment.routine: if true it uses a faster version to compute random perm. enrichment "GSEA.EnrichmentScore2"
  #
  #   Output:
  #    The results of the method are stored in the "output.directory" specified by the user as part of the input parameters.
  #      The results files are:
  #    - Two tab-separated global result text files (one for each phenotype). These files are labeled according to the doc
  #      string prefix and the phenotype name from the CLS file: <doc.string>.SUMMARY.RESULTS.REPORT.<phenotype>.txt
  #    - One set of global plots. They include a.- gene list correlation profile, b.- global observed and null densities, c.- heat map
  #      for the entire sorted dataset, and d.- p-values vs. NES plot. These plots are in a single JPEG file named
  #      <doc.string>.global.plots.<phenotype>.jpg. When the program is run interactively these plots appear on a window in the R GUI.
  #    - A variable number of tab-separated gene result text files according to how many sets pass any of the significance thresholds
  #      ("nom.p.val.threshold," "fwer.p.val.threshold," and "fdr.q.val.threshold") and how many are specified in the "topgs"
  #      parameter. These files are named: <doc.string>.<gene set name>.report.txt.
  #   - A variable number of gene set plots (one for each gene set report file). These plots include a.- Gene set running enrichment
  #      "mountain" plot, b.- gene set null distribution and c.- heat map for genes in the gene set. These plots are stored in a
  #      single JPEG file named <doc.string>.<gene set name>.jpg.
  #  The format (columns) for the global result files is as follows.
  #  GS : Gene set name.
  # SIZE : Size of the set in genes.
  # SOURCE : Set definition or source.
  # ES : Enrichment score.
  # NES : Normalized (multiplicative rescaling) normalized enrichment score.
  # NOM p-val : Nominal p-value (from the null distribution of the gene set).
  # FDR q-val: False discovery rate q-values
  # FWER p-val: Family wise error rate p-values.
  # Tag %: Percent of gene set before running enrichment peak.
  # Gene %: Percent of gene list before running enrichment peak.
  # Signal : enrichment signal strength.
  # FDR (median): FDR q-values from the median of the null distributions.
  # glob.p.val: P-value using a global statistic (number of sets above the set's NES).
  #
  # The rows are sorted by the NES values (from maximum positive or negative NES to minimum)
  #
  # The format (columns) for the gene set result files is as follows.
  #
  # #: Gene number in the (sorted) gene set
  # GENE : gene name. For example the probe accession number, gene symbol or the gene identifier gin the dataset.
  # SYMBOL : gene symbol from the gene annotation file.
  # DESC : gene description (title) from the gene annotation file.
  # LIST LOC : location of the gene in the sorted gene list.
  # S2N : signal to noise ratio (correlation) of the gene in the gene list.
  # RES : value of the running enrichment score at the gene location.
  # CORE_ENRICHMENT: is this gene is the "core enrichment" section of the list? Yes or No variable specifying in the gene location is before (positive ES) or after (negative ES) the running enrichment peak.
  #
  # The rows are sorted by the gene location in the gene list.
  # The function call to GSEA returns a  two element list containing the two global result reports as data frames ($report1, $report2).
  #
  # results1: Global output report for first phenotype
  # result2:  Global putput report for second phenotype
  #
  # The Broad Institute
  # SOFTWARE COPYRIGHT NOTICE AGREEMENT
  # This software and its documentation are copyright 2003 by the
  # Broad Institute/Massachusetts Institute of Technology.
  # All rights are reserved.
  #
  # This software is supplied without any warranty or guaranteed support
  # whatsoever. Neither the Broad Institute nor MIT can be responsible for
  # its use, misuse, or functionality.
  
  print(" *** Running GSEA Analysis...")
  
  if (OLD.GSEA == T) {
    print("Running OLD GSEA from Mootha et al 2003")
  }
  
  # Copy input parameters to log file
  
  # Start of GSEA methodology
  
  if (.Platform$OS.type == "windows") {
    memory.limit(6000000000)
    memory.limit()
    #      print(c("Start memory size=",  memory.size()))
  }
  
  # Read input data matrix
  
  set.seed(seed=random.seed, kind = NULL)
  adjust.param <- 0.5
  
  
  time1 <- proc.time()
  
  dataset <- input.ds
  
  gene.labels <- row.names(dataset)
  sample.names <- names(dataset)
  A <- data.matrix(dataset)
  cols <- length(A[1,])
  rows <- length(A[,1])
  
  # preproc.type control the type of pre-processing: threshold, variation filter, normalization
  
  if (preproc.type == 1) {  # Column normalize (Z-score)
    A <- GSEA.NormalizeCols(A)
  } else if (preproc.type == 2) { # Column (rank) and row (Z-score) normalize
    for (j in 1:cols) {  # column rank normalization
      A[,j] <- rank(A[,j])
    }
    A <- GSEA.NormalizeRows(A)
  } else if (preproc.type == 3) { # Column (rank) norm.
    for (j in 1:cols) {  # column rank normalization
      A[,j] <- rank(A[,j])
    }
  }
  
  # Read input class vector
  
  if(is.list(input.cls)) {
    CLS <- input.cls
  } else {
    CLS <- GSEA.ReadClsFile(file=input.cls)
  }
  class.labels <- CLS$class.v
  class.phen <- CLS$phen
  
  if (reverse.sign == T) {
    phen1 <- class.phen[2]
    phen2 <- class.phen[1]
  } else {
    phen1 <- class.phen[1]
    phen2 <- class.phen[2]
  }
  
  # sort samples according to phenotype
  
  col.index <- order(class.labels, decreasing=F)
  class.labels <- class.labels[col.index]
  sample.names <- sample.names[col.index]
  for (j in 1:rows) {
    A[j, ] <- A[j, col.index]
  }
  names(A) <- sample.names
  
  
  Ng <- length(gs.db)
  gs.names <- names(gs.db)
  size.G <- sapply(gs.db, length) 
  gs <- matrix(NA, nrow=Ng, ncol=max(size.G))
  for(i in seq_len(Ng)) gs[i, seq_len(size.G[i])] <- gs.db[[i]]
  
  gs.desc <- gs.names
  
  N <- length(A[,1])
  Ns <- length(A[1,])
  
  # Read gene and gene set annotations if gene annotation file was provided
  
  all.gene.descs <- vector(length = N, mode ="character")
  all.gene.symbols <- vector(length = N, mode ="character")
  all.gs.descs <- vector(length = Ng, mode ="character")
  
  if (is.data.frame(gene.ann)) {
    temp <- gene.ann
    a.size <- length(temp[,1])
    print(c("Number of gene annotation file entries:", a.size))
    accs <- as.character(temp[,1])
    locs <- match(gene.labels, accs)
    all.gene.descs <- as.character(temp[locs, "Gene.Title"])
    all.gene.symbols <- as.character(temp[locs, "Gene.Symbol"])
    rm(temp)
  } else  if (gene.ann == "") {
    for (i in 1:N) {
      all.gene.descs[i] <- gene.labels[i]
      all.gene.symbols[i] <- gene.labels[i]
    }
  } else {
    temp <- read.delim(gene.ann, header=T, sep=",", comment.char="", as.is=T)
    a.size <- length(temp[,1])
    print(c("Number of gene annotation file entries:", a.size))
    accs <- as.character(temp[,1])
    locs <- match(gene.labels, accs)
    all.gene.descs <- as.character(temp[locs, "Gene.Title"])
    all.gene.symbols <- as.character(temp[locs, "Gene.Symbol"])
    rm(temp)
  }
  
  if (is.data.frame(gs.ann)) {
    temp <- gs.ann
    a.size <- length(temp[,1])
    print(c("Number of gene set annotation file entries:", a.size))
    accs <- as.character(temp[,1])
    locs <- match(gs.names, accs)
    all.gs.descs <- as.character(temp[locs, "SOURCE"])
    rm(temp)
  } else if (gs.ann == "") {
    for (i in 1:Ng) {
      all.gs.descs[i] <- gs.desc[i]
    }
  } else {
    temp <- read.delim(gs.ann, header=T, sep="\t", comment.char="", as.is=T)
    a.size <- length(temp[,1])
    print(c("Number of gene set annotation file entries:", a.size))
    accs <- as.character(temp[,1])
    locs <- match(gs.names, accs)
    all.gs.descs <- as.character(temp[locs, "SOURCE"])
    rm(temp)
  }
  
  
  Obs.indicator <- matrix(nrow= Ng, ncol=N)
  Obs.RES <- matrix(nrow= Ng, ncol=N)
  
  Obs.ES <- vector(length = Ng, mode = "numeric")
  Obs.arg.ES <- vector(length = Ng, mode = "numeric")
  Obs.ES.norm <- vector(length = Ng, mode = "numeric")
  
  time2 <- proc.time()
  
  # GSEA methodology
  
  # Compute observed and random permutation gene rankings
  
  obs.s2n <- vector(length=N, mode="numeric")
  signal.strength <- vector(length=Ng, mode="numeric")
  tag.frac <- vector(length=Ng, mode="numeric")
  gene.frac <- vector(length=Ng, mode="numeric")
  coherence.ratio <- vector(length=Ng, mode="numeric")
  obs.phi.norm <- matrix(nrow = Ng, ncol = nperm)
  correl.matrix <- matrix(nrow = N, ncol = nperm)
  obs.correl.matrix <- matrix(nrow = N, ncol = nperm)
  order.matrix <- matrix(nrow = N, ncol = nperm)
  obs.order.matrix <- matrix(nrow = N, ncol = nperm)
  
  nperm.per.call <- 100
  n.groups <- nperm %/% nperm.per.call
  n.rem <- nperm %% nperm.per.call
  n.perms <- c(rep(nperm.per.call, n.groups), n.rem)
  n.ends <- cumsum(n.perms)
  n.starts <- n.ends - n.perms + 1
  
  if (n.rem == 0) {
    n.tot <- n.groups
  } else {
    n.tot <- n.groups + 1
  }
  
  for (nk in 1:n.tot) {
    call.nperm <- n.perms[nk]
    
    message(paste("permutations: ", n.starts[nk], "--", n.ends[nk], sep=" "))
    
    O <- GSEA.GeneRanking(A, class.labels, gene.labels, call.nperm, permutation.type = perm.type, sigma.correction = "GeneCluster", fraction=fraction, replace=replace, reverse.sign = reverse.sign)
    
    order.matrix[,n.starts[nk]:n.ends[nk]] <- O$order.matrix
    obs.order.matrix[,n.starts[nk]:n.ends[nk]] <- O$obs.order.matrix
    correl.matrix[,n.starts[nk]:n.ends[nk]] <- O$s2n.matrix
    obs.correl.matrix[,n.starts[nk]:n.ends[nk]] <- O$obs.s2n.matrix
    rm(O)
  }
  
  mode(order.matrix) <- "integer"
  order.matrix <- data.frame(order.matrix)
  
  
  obs.s2n <- apply(obs.correl.matrix, 1, median)  # using median to assign enrichment scores
  obs.index <- order(obs.s2n, decreasing=T)
  obs.s2n   <- sort(obs.s2n, decreasing=T)
  
  obs.gene.labels <- gene.labels[obs.index]
  obs.gene.descs <- all.gene.descs[obs.index]
  obs.gene.symbols <- all.gene.symbols[obs.index]
  
  for (r in 1:nperm) {
    correl.matrix[, r] <- correl.matrix[order.matrix[,r], r]
  }
  for (r in 1:nperm) {
    obs.correl.matrix[, r] <- obs.correl.matrix[obs.order.matrix[,r], r]
  }
  
  correl.matrix <- data.frame(correl.matrix)
  
  gene.list2 <- obs.index
  for (i in 1:Ng) {
    # print(paste("Computing observed enrichment for gene set:", i, gs.names[i], sep=" "))
    gene.set <- gs[i, !is.na(gs[i,])]
    gene.set2 <- vector(length=length(gene.set), mode = "numeric")
    gene.set2 <- match(gene.set, gene.labels)
    
    if (OLD.GSEA == F) {
      GSEA.results <- GSEA.EnrichmentScore(gene.list=gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector = obs.s2n)
    } else {
      GSEA.results <- OLD.GSEA.EnrichmentScore(gene.list=gene.list2, gene.set=gene.set2)
    }
    Obs.ES[i] <- GSEA.results$ES
    Obs.arg.ES[i] <- GSEA.results$arg.ES
    Obs.RES[i,] <- GSEA.results$RES
    Obs.indicator[i,] <- GSEA.results$indicator
    if (Obs.ES[i] >= 0) {  # compute signal strength
      tag.frac[i] <- sum(Obs.indicator[i,1:Obs.arg.ES[i]])/size.G[i]
      gene.frac[i] <- Obs.arg.ES[i]/N
    } else {
      tag.frac[i] <- sum(Obs.indicator[i, Obs.arg.ES[i]:N])/size.G[i]
      gene.frac[i] <- (N - Obs.arg.ES[i] + 1)/N
    }
    signal.strength[i] <- tag.frac[i] * (1 - gene.frac[i]) * (N / (N - size.G[i]))
  }
  
  # Compute enrichment for random permutations
  
  phi <- matrix(nrow = Ng, ncol = nperm)
  phi.norm <- matrix(nrow = Ng, ncol = nperm)
  obs.phi <- matrix(nrow = Ng, ncol = nperm)
  
  order.matrix.sorted <- data.frame(apply(order.matrix, 2, order))
  obs.order.matrix.sorted <- data.frame(apply(obs.order.matrix, 2, order))
  
  ##Add parallel
  # registerDoParallel(ncore)
  # if (reshuffling.type == "sample.labels") { # reshuffling phenotype labels
  # 
  #   res <- foreach (i = 1:Ng) %dopar% {
  #     phi <- rep(0, nperm)
  #     obs.phi <- rep(0, nperm)
  # 
  #     # print(paste("Computing random permutations' enrichment for gene set:", i, gs.names[i], sep=" "))
  #     gene.set <- gs[i, !is.na(gs[i,])]
  #     gene.set2 <- vector(length=length(gene.set), mode = "numeric")
  #     gene.set2 <- match(gene.set, gene.labels)
  #     gene.set2 <- gene.set2[!is.na(gene.set2)]
  #     for (r in 1:nperm) {
  #       gene.list2 <- order.matrix[,r]
  #       if (use.fast.enrichment.routine == F) {
  #         GSEA.results <- GSEA.EnrichmentScore(gene.list=gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=correl.matrix[, r])
  #       } else {
  #         GSEA.results <- GSEA.EnrichmentScore2(gene.list=gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=correl.matrix[, r], gene.list.order = order.matrix.sorted[, r])
  #       }
  #       phi[r] <- GSEA.results$ES
  #     }
  # 
  #     if (fraction < 1.0) { # if resampling then compute ES for all observed rankings
  #       for (r in 1:nperm) {
  #         obs.gene.list2 <- obs.order.matrix[,r]
  #         if (use.fast.enrichment.routine == F) {
  #           GSEA.results <- GSEA.EnrichmentScore(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r])
  #         } else {
  #           GSEA.results <- GSEA.EnrichmentScore2(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r], gene.list.order = obs.order.matrix.sorted[, r])
  #         }
  #         obs.phi[r] <- GSEA.results$ES
  #       }
  #     } else { # if no resampling then compute only one column (and fill the others with the same value)
  #       obs.gene.list2 <- obs.order.matrix[,1]
  #       if (use.fast.enrichment.routine == F) {
  #         GSEA.results <- GSEA.EnrichmentScore(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r])
  #       } else {
  #         GSEA.results <- GSEA.EnrichmentScore2(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r], gene.list.order = obs.order.matrix.sorted[, r])
  #       }
  #       obs.phi[1] <- GSEA.results$ES
  #       for (r in 2:nperm) {
  #         obs.phi[r] <- obs.phi[1]
  #       }
  #     }
  #     list(phi=phi, obs.phi = obs.phi)
  #   }
  # 
  # } else if (reshuffling.type == "gene.labels") { # reshuffling gene labels
  #   res <- foreach (i = 1:Ng) %dopar% {
  #     phi <- rep(0, nperm)
  #     obs.phi <- rep(0, nperm)
  # 
  #     gene.set <- gs[i, !is.na(gs[i,])]
  #     gene.set2 <- vector(length=length(gene.set), mode = "numeric")
  #     gene.set2 <- match(gene.set, gene.labels)
  #     for (r in 1:nperm) {
  #       reshuffled.gene.labels <- sample(1:rows)
  #       if (use.fast.enrichment.routine == F) {
  #         GSEA.results <- GSEA.EnrichmentScore(gene.list=reshuffled.gene.labels, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.s2n)
  #       } else {
  #         GSEA.results <- GSEA.EnrichmentScore2(gene.list=reshuffled.gene.labels, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.s2n, gene.list.order = order.matrix.sorted[, r])
  #       }
  #       phi[r] <- GSEA.results$ES
  #     }
  #     if (fraction < 1.0) { # if resampling then compute ES for all observed rankings
  #       for (r in 1:nperm) {
  #         obs.gene.list2 <- obs.order.matrix[,r]
  #         if (use.fast.enrichment.routine == F) {
  #           GSEA.results <- GSEA.EnrichmentScore(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r])
  #         } else {
  #           GSEA.results <- GSEA.EnrichmentScore2(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r], gene.list.order = obs.order.matrix.sorted[, r])
  #         }
  #         obs.phi[r] <- GSEA.results$ES
  #       }
  #     } else { # if no resampling then compute only one column (and fill the others with the same value)
  #       obs.gene.list2 <- obs.order.matrix[,1]
  #       if (use.fast.enrichment.routine == F) {
  #         GSEA.results <- GSEA.EnrichmentScore(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r])
  #       } else {
  #         GSEA.results <- GSEA.EnrichmentScore2(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r], gene.list.order = obs.order.matrix.sorted[, r])
  #       }
  #       obs.phi[1] <- GSEA.results$ES
  #       for (r in 2:nperm) {
  #         obs.phi[r] <- obs.phi[1]
  #       }
  #     }
  #     list(phi=phi, obs.phi = obs.phi)
  #   }
  # }
  # stopImplicitCluster()
  # 
  # phi <- Reduce(rbind, lapply(res, function(x) x$phi ))
  # obs.phi <- Reduce(rbind, lapply(res, function(x) x$obs.phi ))
  

  registerDoParallel(ncore)
  n_split <- max(floor(Ng/50), 1)

  folds <- caret::createFolds(1:Ng, n_split)

  res <- foreach(fold = folds) %dopar% {
    phi <- matrix(nrow = length(fold), ncol = nperm)
    obs.phi <- matrix(nrow = length(fold), ncol = nperm)

    if (reshuffling.type == "sample.labels") { # reshuffling phenotype labels

      for (i in 1:length(fold)) {
        j <- fold[i]
        # print(paste("Computing random permutations' enrichment for gene set:", i, gs.names[i], sep=" "))
        gene.set <- gs[j, !is.na(gs[j,])]
        gene.set2 <- vector(length=length(gene.set), mode = "numeric")
        gene.set2 <- match(gene.set, gene.labels)
        gene.set2 <- gene.set2[!is.na(gene.set2)]
        for (r in 1:nperm) {
          gene.list2 <- order.matrix[,r]
          if (use.fast.enrichment.routine == F) {
            GSEA.results <- GSEA.EnrichmentScore(gene.list=gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=correl.matrix[, r])
          } else {
            GSEA.results <- GSEA.EnrichmentScore2(gene.list=gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=correl.matrix[, r], gene.list.order = order.matrix.sorted[, r])
          }
          phi[i, r] <- GSEA.results$ES
        }

        if (fraction < 1.0) { # if resampling then compute ES for all observed rankings
          for (r in 1:nperm) {
            obs.gene.list2 <- obs.order.matrix[,r]
            if (use.fast.enrichment.routine == F) {
              GSEA.results <- GSEA.EnrichmentScore(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r])
            } else {
              GSEA.results <- GSEA.EnrichmentScore2(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r], gene.list.order = obs.order.matrix.sorted[, r])
            }
            obs.phi[i, r] <- GSEA.results$ES
          }
        } else { # if no resampling then compute only one column (and fill the others with the same value)
          obs.gene.list2 <- obs.order.matrix[,1]
          if (use.fast.enrichment.routine == F) {
            GSEA.results <- GSEA.EnrichmentScore(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r])
          } else {
            GSEA.results <- GSEA.EnrichmentScore2(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r], gene.list.order = obs.order.matrix.sorted[, r])
          }
          obs.phi[i, 1] <- GSEA.results$ES
          for (r in 2:nperm) {
            obs.phi[i, r] <- obs.phi[i, 1]
          }
        }
      }

    } else if (reshuffling.type == "gene.labels") { # reshuffling gene labels
      for (i in 1:Ng) {
        j <- fold[i]
        gene.set <- gs[j, !is.na(gs[j,])]
        gene.set2 <- vector(length=length(gene.set), mode = "numeric")
        gene.set2 <- match(gene.set, gene.labels)
        for (r in 1:nperm) {
          reshuffled.gene.labels <- sample(1:rows)
          if (use.fast.enrichment.routine == F) {
            GSEA.results <- GSEA.EnrichmentScore(gene.list=reshuffled.gene.labels, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.s2n)
          } else {
            GSEA.results <- GSEA.EnrichmentScore2(gene.list=reshuffled.gene.labels, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.s2n, gene.list.order = order.matrix.sorted[, r])
          }
          phi[i, r] <- GSEA.results$ES
        }
        if (fraction < 1.0) { # if resampling then compute ES for all observed rankings
          for (r in 1:nperm) {
            obs.gene.list2 <- obs.order.matrix[,r]
            if (use.fast.enrichment.routine == F) {
              GSEA.results <- GSEA.EnrichmentScore(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r])
            } else {
              GSEA.results <- GSEA.EnrichmentScore2(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r], gene.list.order = obs.order.matrix.sorted[, r])
            }
            obs.phi[i, r] <- GSEA.results$ES
          }
        } else { # if no resampling then compute only one column (and fill the others with the same value)
          obs.gene.list2 <- obs.order.matrix[,1]
          if (use.fast.enrichment.routine == F) {
            GSEA.results <- GSEA.EnrichmentScore(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r])
          } else {
            GSEA.results <- GSEA.EnrichmentScore2(gene.list=obs.gene.list2, gene.set=gene.set2, weighted.score.type=weighted.score.type, correl.vector=obs.correl.matrix[, r], gene.list.order = obs.order.matrix.sorted[, r])
          }
          obs.phi[i, 1] <- GSEA.results$ES
          for (r in 2:nperm) {
            obs.phi[i, r] <- obs.phi[i, 1]
          }
        }
      }
    }
    list(phi = phi, obs.phi = obs.phi)
  }

  for (i in 1:length(res)) {
    phi[folds[[i]], ] <- res[[i]]$phi
    obs.phi[folds[[i]], ] <- res[[i]]$obs.phi
  }
  
  
  # Compute 3 types of p-values
  
  # Find nominal p-values
  
  print("Computing nominal p-values...")
  
  p.vals <- matrix(0, nrow = Ng, ncol = 2)
  
  if (OLD.GSEA == F) {
    for (i in 1:Ng) {
      pos.phi <- NULL
      neg.phi <- NULL
      for (j in 1:nperm) {
        if (phi[i, j] >= 0) {
          pos.phi <- c(pos.phi, phi[i, j])
        } else {
          neg.phi <- c(neg.phi, phi[i, j])
        }
      }
      ES.value <- Obs.ES[i]
      if (ES.value >= 0) {
        p.vals[i, 1] <- signif(sum(pos.phi >= ES.value)/length(pos.phi), digits=5)
      } else {
        p.vals[i, 1] <- signif(sum(neg.phi <= ES.value)/length(neg.phi), digits=5)
      }
    }
  } else {  # For OLD GSEA compute the p-val using positive and negative values in the same histogram
    for (i in 1:Ng) {
      if (Obs.ES[i] >= 0) {
        p.vals[i, 1] <-  sum(phi[i,] >= Obs.ES[i])/length(phi[i,])
        p.vals[i, 1] <-  signif(p.vals[i, 1], digits=5)
      } else {
        p.vals[i, 1] <-  sum(phi[i,] <= Obs.ES[i])/length(phi[i,])
        p.vals[i, 1] <-  signif(p.vals[i, 1], digits=5)
      }
    }
  }
  
  # Find effective size
  
  erf <- function (x)
  {
    2 * pnorm(sqrt(2) * x)
  }
  
  KS.mean <- function(N) { # KS mean as a function of set size N
    S <- 0
    for (k in -100:100) {
      if (k == 0) next
      S <- S + 4 * (-1)**(k + 1) * (0.25 * exp(-2 * k * k * N) - sqrt(2 * pi) *  erf(sqrt(2 * N) * k)/(16 * k * sqrt(N)))
    }
    return(abs(S))
  }
  
  # KS.mean.table <- vector(length=5000, mode="numeric")
  
  # for (i in 1:5000) {
  #    KS.mean.table[i] <- KS.mean(i)
  # }
  
  # KS.size <-  vector(length=Ng, mode="numeric")
  
  # Rescaling normalization for each gene set null
  
  print("Computing rescaling normalization for each gene set null...")
  
  if (OLD.GSEA == F) {
    for (i in 1:Ng) {
      pos.phi <- NULL
      neg.phi <- NULL
      for (j in 1:nperm) {
        if (phi[i, j] >= 0) {
          pos.phi <- c(pos.phi, phi[i, j])
        } else {
          neg.phi <- c(neg.phi, phi[i, j])
        }
      }
      
      if (is.null(pos.phi)){
          pos.phi = 1
      }
      if (is.null(neg.phi)){
          neg.phi = 1
      }
      
      pos.m <- mean(pos.phi)
      neg.m <- mean(abs(neg.phi))
      
      #         if (Obs.ES[i] >= 0) {
      #            KS.size[i] <- which.min(abs(KS.mean.table - pos.m))
      #         } else {
      #            KS.size[i] <- which.min(abs(KS.mean.table - neg.m))
      #         }
      
      pos.phi <- pos.phi/pos.m
      neg.phi <- neg.phi/neg.m
      for (j in 1:nperm) {
        if (phi[i, j] >= 0) {
          phi.norm[i, j] <- phi[i, j]/pos.m
        } else {
          phi.norm[i, j] <- phi[i, j]/neg.m
        }
      }
      for (j in 1:nperm) {
        if (obs.phi[i, j] >= 0) {
          obs.phi.norm[i, j] <- obs.phi[i, j]/pos.m
        } else {
          obs.phi.norm[i, j] <- obs.phi[i, j]/neg.m
        }
      }
      if (Obs.ES[i] >= 0) {
        Obs.ES.norm[i] <- Obs.ES[i]/pos.m
      } else {
        Obs.ES.norm[i] <- Obs.ES[i]/neg.m
      }
    }
  } else {  # For OLD GSEA does not normalize using empirical scaling
    for (i in 1:Ng) {
      for (j in 1:nperm) {
        phi.norm[i, j] <- phi[i, j]/400
      }
      for (j in 1:nperm) {
        obs.phi.norm[i, j] <- obs.phi[i, j]/400
      }
      Obs.ES.norm[i] <- Obs.ES[i]/400
    }
  }
  
  # Save intermedite results
  
  if (save.intermediate.results == T) {
    
    filename <- paste(output.directory, doc.string, ".phi.txt", sep="", collapse="")
    write.table(phi, file = filename, quote=F, col.names= F, row.names=F, sep = "\t")
    
    filename <- paste(output.directory, doc.string, ".obs.phi.txt", sep="", collapse="")
    write.table(obs.phi, file = filename, quote=F, col.names= F, row.names=F, sep = "\t")
    
    filename <- paste(output.directory, doc.string, ".phi.norm.txt", sep="", collapse="")
    write.table(phi.norm, file = filename, quote=F, col.names= F, row.names=F, sep = "\t")
    
    filename <- paste(output.directory, doc.string, ".obs.phi.norm.txt", sep="", collapse="")
    write.table(obs.phi.norm, file = filename, quote=F, col.names= F, row.names=F, sep = "\t")
    
    filename <- paste(output.directory, doc.string, ".Obs.ES.txt", sep="", collapse="")
    write.table(Obs.ES, file = filename, quote=F, col.names= F, row.names=F, sep = "\t")
    
    filename <- paste(output.directory, doc.string, ".Obs.ES.norm.txt", sep="", collapse="")
    write.table(Obs.ES.norm, file = filename, quote=F, col.names= F, row.names=F, sep = "\t")
  }
  
  # Compute FWER p-vals
  
  print("Computing FWER p-values...")
  
  if (OLD.GSEA == F) {
    max.ES.vals.p <- NULL
    max.ES.vals.n <- NULL
    for (j in 1:nperm) {
      pos.phi <- NULL
      neg.phi <- NULL
      for (i in 1:Ng) {
        if (phi.norm[i, j] >= 0) {
          pos.phi <- c(pos.phi, phi.norm[i, j])
        } else {
          neg.phi <- c(neg.phi, phi.norm[i, j])
        }
      }
      if (length(pos.phi) > 0) {
        max.ES.vals.p <- c(max.ES.vals.p, max(pos.phi))
      }
      if (length(neg.phi) > 0) {
        max.ES.vals.n <- c(max.ES.vals.n, min(neg.phi))
      }
    }
    for (i in 1:Ng) {
      ES.value <- Obs.ES.norm[i]
      if (Obs.ES.norm[i] >= 0) {
        p.vals[i, 2] <- signif(sum(max.ES.vals.p >= ES.value)/length(max.ES.vals.p), digits=5)
      } else {
        p.vals[i, 2] <- signif(sum(max.ES.vals.n <= ES.value)/length(max.ES.vals.n), digits=5)
      }
    }
  } else {  # For OLD GSEA compute the FWER using positive and negative values in the same histogram
    max.ES.vals <- NULL
    for (j in 1:nperm) {
      max.NES <- max(phi.norm[,j])
      min.NES <- min(phi.norm[,j])
      if (max.NES > - min.NES) {
        max.val <- max.NES
      } else {
        max.val <- min.NES
      }
      max.ES.vals <- c(max.ES.vals, max.val)
    }
    for (i in 1:Ng) {
      if (Obs.ES.norm[i] >= 0) {
        p.vals[i, 2] <- sum(max.ES.vals >= Obs.ES.norm[i])/length(max.ES.vals)
      } else {
        p.vals[i, 2] <- sum(max.ES.vals <= Obs.ES.norm[i])/length(max.ES.vals)
      }
      p.vals[i, 2] <-  signif(p.vals[i, 2], digits=4)
    }
  }
  
  # Compute FDRs
  
  print("Computing FDR q-values...")
  
  NES <- vector(length=Ng, mode="numeric")
  phi.norm.mean  <- vector(length=Ng, mode="numeric")
  obs.phi.norm.mean  <- vector(length=Ng, mode="numeric")
  phi.norm.median  <- vector(length=Ng, mode="numeric")
  obs.phi.norm.median  <- vector(length=Ng, mode="numeric")
  phi.norm.mean  <- vector(length=Ng, mode="numeric")
  obs.phi.mean  <- vector(length=Ng, mode="numeric")
  FDR.mean <- vector(length=Ng, mode="numeric")
  FDR.median <- vector(length=Ng, mode="numeric")
  phi.norm.median.d <- vector(length=Ng, mode="numeric")
  obs.phi.norm.median.d <- vector(length=Ng, mode="numeric")
  
  Obs.ES.index <- order(Obs.ES.norm, decreasing=T)
  Orig.index <- seq(1, Ng)
  Orig.index <- Orig.index[Obs.ES.index]
  Orig.index <- order(Orig.index, decreasing=F)
  Obs.ES.norm.sorted <- Obs.ES.norm[Obs.ES.index]
  gs.names.sorted <- gs.names[Obs.ES.index]
  
  
  count.col.norm.pos <- colSums(phi.norm >= 0)
  obs.count.col.norm.pos <- colSums(obs.phi.norm >= 0)
  count.col.norm.neg <- colSums(phi.norm < 0)
  obs.count.col.norm.neg <- colSums(obs.phi.norm < 0)
  
  registerDoParallel(ncore)
  count.col.all <- foreach(k = 1:Ng) %dopar% {
    NES[k] <- Obs.ES.norm.sorted[k]
    ES.value <- NES[k]
    if(ES.value > 0)
    {
      (colSums(phi.norm >= ES.value)/count.col.norm.pos)[count.col.norm.pos > 0]
    }
    else
    {
      (colSums(phi.norm <= ES.value)/count.col.norm.neg)[count.col.norm.neg > 0]
    }
    
  }
  obs.count.col.all <- foreach(k = 1:Ng) %dopar% {
    NES[k] <- Obs.ES.norm.sorted[k]
    ES.value <- NES[k]
    if(ES.value > 0)
    {
      (colSums(obs.phi.norm >= ES.value)/obs.count.col.norm.pos)[obs.count.col.norm.pos > 0]
    }
    else
    {
      (colSums(obs.phi.norm <= ES.value)/obs.count.col.norm.neg)[obs.count.col.norm.neg > 0]
    }
  }
  stopImplicitCluster()
  
  for (k in 1:Ng) {
    NES[k] <- Obs.ES.norm.sorted[k]
    ES.value <- NES[k]

    ##Matrix
    count.col <- rep(0, nperm)
    obs.count.col <- rep(0, nperm)
    if(ES.value > 0)
    {
      count.col.norm <- count.col.norm.pos
      obs.count.col.norm <- obs.count.col.norm.pos
      count.col[count.col.norm > 0] <- count.col.all[[k]] #(colSums(phi.norm >= ES.value)/count.col.norm)[count.col.norm > 0]
      obs.count.col[obs.count.col.norm > 0] <- obs.count.col.all[[k]] #(colSums(obs.phi.norm >= ES.value)/obs.count.col.norm)[obs.count.col.norm > 0]
      
    } else {
      count.col.norm <- count.col.norm.neg
      obs.count.col.norm <- obs.count.col.norm.neg
      count.col[count.col.norm > 0] <- count.col.all[[k]] #(colSums(phi.norm <= ES.value)/count.col.norm)[count.col.norm > 0]
      obs.count.col[obs.count.col.norm > 0] <- obs.count.col.all[[k]] #(colSums(obs.phi.norm <= ES.value)/obs.count.col.norm)[obs.count.col.norm > 0]
    }
    
    phi.norm.mean[k] <- mean(count.col)
    obs.phi.norm.mean[k] <- mean(obs.count.col)
    phi.norm.median[k] <- median(count.col)
    obs.phi.norm.median[k] <- median(obs.count.col)
    FDR.mean[k] <- ifelse(phi.norm.mean[k]/obs.phi.norm.mean[k] < 1, phi.norm.mean[k]/obs.phi.norm.mean[k], 1)
    FDR.median[k] <- ifelse(phi.norm.median[k]/obs.phi.norm.median[k] < 1, phi.norm.median[k]/obs.phi.norm.median[k], 1)
  }
  
  # adjust q-values
  
  if (adjust.FDR.q.val == T) {
    pos.nes <- length(NES[NES >= 0])
    min.FDR.mean <- FDR.mean[pos.nes]
    min.FDR.median <- FDR.median[pos.nes]
    for (k in seq(pos.nes - 1, 1, -1)) {
      if (FDR.mean[k] < min.FDR.mean) {
        min.FDR.mean <- FDR.mean[k]
      }
      if (min.FDR.mean < FDR.mean[k]) {
        FDR.mean[k] <- min.FDR.mean
      }
    }
    
    neg.nes <- pos.nes + 1
    min.FDR.mean <- FDR.mean[neg.nes]
    min.FDR.median <- FDR.median[neg.nes]
    for (k in seq(neg.nes + 1, Ng)) {
      if (FDR.mean[k] < min.FDR.mean) {
        min.FDR.mean <- FDR.mean[k]
      }
      if (min.FDR.mean < FDR.mean[k]) {
        FDR.mean[k] <- min.FDR.mean
      }
    }
  }
  
  obs.phi.norm.mean.sorted <- obs.phi.norm.mean[Orig.index]
  phi.norm.mean.sorted <- phi.norm.mean[Orig.index]
  FDR.mean.sorted <- FDR.mean[Orig.index]
  FDR.median.sorted <- FDR.median[Orig.index]
  
  #   Compute global statistic
  
  glob.p.vals <- vector(length=Ng, mode="numeric")
  NULL.pass <- vector(length=nperm, mode="numeric")
  OBS.pass <- vector(length=nperm, mode="numeric")
  
  NULL.pos.pos <- colSums(phi.norm >= 0)
  OBS.pos.pos <- colSums(obs.phi.norm >= 0)
  NULL.pos.neg <- colSums(phi.norm < 0)
  OBS.pos.neg <- colSums(obs.phi.norm < 0)
  
  registerDoParallel(ncore)
  NULL.pass.all <- foreach(k = 1:Ng) %dopar% {
    NES[k] <- Obs.ES.norm.sorted[k]
    if(NES[k] > 0)
    {
      (colSums(phi.norm >= NES[k])/NULL.pos.pos)[NULL.pos.pos > 0]
    }
    else
    {
      (colSums(phi.norm <= NES[k])/NULL.pos.neg)[NULL.pos.neg > 0]
    }
    
  }
  OBS.pass.all <- foreach(k = 1:Ng) %dopar% {
    NES[k] <- Obs.ES.norm.sorted[k]
    if(NES[k] > 0)
    {
      (colSums(obs.phi.norm >= NES[k])/OBS.pos.pos)[OBS.pos.pos > 0] 
    }
    else
    {
      (colSums(obs.phi.norm <= NES[k])/OBS.pos.neg)[OBS.pos.neg > 0] 
    }
  }
  stopImplicitCluster()
  
  for (k in 1:Ng) {
    NES[k] <- Obs.ES.norm.sorted[k]

    ##Matrix
    if (NES[k] >= 0) {
      NULL.pos <- NULL.pos.pos
      NULL.pass <- rep(0, nperm)
      NULL.pass[NULL.pos > 0] <- NULL.pass.all[[k]] #(colSums(phi.norm >= NES[k])/NULL.pos)[NULL.pos > 0]
      OBS.pos <- OBS.pos.pos
      OBS.pass <- rep(0, nperm)
      OBS.pass[OBS.pos > 0] <- OBS.pass.all[[k]] #(colSums(obs.phi.norm >= NES[k])/OBS.pos)[OBS.pos > 0] 
      
    } else {
      NULL.pos <- NULL.pos.neg
      NULL.pass <- rep(0, nperm)
      NULL.pass[NULL.pos > 0] <- NULL.pass.all[[k]] #(colSums(phi.norm <= NES[k])/NULL.pos)[NULL.pos > 0]
      OBS.pos <- OBS.pos.neg
      OBS.pass <- rep(0, nperm)
      OBS.pass[OBS.pos > 0] <- OBS.pass.all[[k]] #(colSums(obs.phi.norm <= NES[k])/OBS.pos)[OBS.pos > 0] 
    }
    
    glob.p.vals[k] <- sum(NULL.pass >= mean(OBS.pass))/nperm
  }
  glob.p.vals.sorted <- glob.p.vals[Orig.index]
  
  # Produce results report
  
  print("Producing result tables and plots...")
  
  Obs.ES <- signif(Obs.ES, digits=5)
  Obs.ES.norm <- signif(Obs.ES.norm, digits=5)
  p.vals <- signif(p.vals, digits=4)
  signal.strength <- signif(signal.strength, digits=3)
  tag.frac <- signif(tag.frac, digits=3)
  gene.frac <- signif(gene.frac, digits=3)
  FDR.mean.sorted <- signif(FDR.mean.sorted, digits=5)
  FDR.median.sorted <-  signif(FDR.median.sorted, digits=5)
  glob.p.vals.sorted <- signif(glob.p.vals.sorted, digits=5)
  
  report <- data.frame(cbind(gs.names, size.G, all.gs.descs, Obs.ES, Obs.ES.norm, p.vals[,1], FDR.mean.sorted, p.vals[,2], tag.frac, gene.frac, signal.strength, FDR.median.sorted, glob.p.vals.sorted))
  names(report) <- c("GS", "SIZE", "SOURCE", "ES", "NES", "NOM p-val", "FDR q-val", "FWER p-val", "Tag", "Gene", "Signal", "FDR (median)", "glob.p.val")
  #       print(report)
  report2 <- report
  report.index2 <- order(Obs.ES.norm, decreasing=T)
  for (i in 1:Ng) {
    report2[i,] <- report[report.index2[i],]
  }
  report3 <- report
  report.index3 <- order(Obs.ES.norm, decreasing=F)
  for (i in 1:Ng) {
    report3[i,] <- report[report.index3[i],]
  }
  phen1.rows <- length(Obs.ES.norm[Obs.ES.norm >= 0])
  phen2.rows <- length(Obs.ES.norm[Obs.ES.norm < 0])
  report.phen1 <- report2[1:phen1.rows,]
  report.phen2 <- report3[1:phen2.rows,]
  
  if (output.directory != "")  {
    if (phen1.rows > 0) {
      filename <- paste(output.directory, doc.string, ".SUMMARY.RESULTS.REPORT.", phen1,".txt", sep="", collapse="")
      write.table(report.phen1, file = filename, quote=F, row.names=F, sep = "\t")
    }
    if (phen2.rows > 0) {
      filename <- paste(output.directory, doc.string, ".SUMMARY.RESULTS.REPORT.", phen2,".txt", sep="", collapse="")
      write.table(report.phen2, file = filename, quote=F, row.names=F, sep = "\t")
    }
  }
  
  
  
  return(list(report1 = report.phen1, report2 = report.phen2))
  
}  # end of definition of GSEA.analysis
