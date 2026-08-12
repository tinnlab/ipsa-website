\name{GSA}
\alias{GSA}
\title{Gene set analysis}
\description{
Determines the significance of  pre-defined sets of genes  with respect to
 an outcome
variable, such as a group indicator, a quantitative variable or a survival time
}
\usage{
GSA(x,y, genesets, genenames,
method=c("maxmean","mean","absmean"), resp.type=c("Quantitative","Two class unpaired","Survival","Multiclass", "Two class paired", "tCorr", "taCorr"),
censoring.status=NULL,random.seed=NULL,  knn.neighbors=10,
s0=NULL, s0.perc=NULL,minsize=15,maxsize=500,
restand=TRUE,restand.basis=c("catalog","data"),
 nperms=200, 
xl.mode=c("regular","firsttime","next20","lasttime"), 
xl.time=NULL, xl.prevfit=NULL)

}
\arguments{
  \item{x}{Data x: p by n matrix of features (expression values),
one observation per column (missing values allowed); y: n-vector of outcome measurements}
\item{y}{Vector of response values:  1,2 for two class
problem, or 1,2,3 ... for multiclass problem, or real numbers for quantitative
or survival problems}
\item{genesets}{Gene set collection (a list)}
\item{genenames}{Vector of genenames in expression dataset}
\item{method}{Method for summarizing a gene set: "maxmean" (default), "mean" or "absmean"}
  \item{resp.type}{Problem type: "quantitative" for a continuous parameter;
"Two class unpaired" ; "Survival" for censored survival outcome; "Multiclass" :
more than 2 groups, coded 1,2,3...; "Two class paired" for paired outcomes, coded -1,1 (first pair), -2,2 (second pair), etc}
\item{censoring.status}{Vector of censoring status values for survival problems,
1 mean death or failure, 0 means censored}
\item{random.seed}{Optional initial seed for random number generator (integer)}
\item{knn.neighbors}{Number of nearest neighbors to use for imputation
of missing features values}
\item{s0}{Exchangeability factor  for denominator of test statistic; Default
is automatic choice}
\item{s0.perc}{Percentile of standard  deviation values to use for s0; default is
automatic choice; -1 means s0=0 (different from s0.perc=0, meaning
s0=zeroeth percentile of  standard  deviation values= min of sd values)}
\item{minsize}{Minimum number of genes in  genesets to be  considered}
\item{maxsize}{Maximum number of genes in  genesets to be considered}
\item{restand}{Should restandardization be done? Default TRUE},
\item{restand.basis}{What should be used to do the  restandardization?
The set of genes in the genesets ("catalog", the default) or the
genes in the data set ("data")}
\item{nperms}{Number of permutations used to estimate false discovery rates}
\item{xl.mode}{Used by Excel interface}
\item{xl.time}{Used by Excel interface}
\item{xl.prevfit}{Used by Excel interface}
}

\details{Carries out a Gene set analysis, as described in the paper
by Efron and Tibshirani (2006). It differs from a Gene Set Enrichment Analysis
(Subramanian et al 2006)
in its use of the "maxmean" statistic: this is the mean of the positive or
negative part of gene scores in the gene set, whichever is large in absolute
values.  Efron and Tibshirani shows that this is often more powerful
than the modified KS statistic used in GSEA.
GSA also does "restandardization" of the genes (rows), on top of the
permutation of columns (done in GSEA).
 Gene set analysis is applicable to microarray data
and other data with a large number of features. This is also the R package
that is called by the "official" SAM Excel package v3.0.
The format of the response vector y and the calling sequence
is illustrated in the examples below. A more complete  description
is given in the SAM manual
at http://www-stat.stanford.edu/~tibs/SAM}



\value{
A list with components
\item{GSA.scores}{Gene set scores  for each gene set}
\item{GSA.scores.perm}{Matrix of Gene set scores from permutions,  one column per
permutation}
\item{fdr.lo}{Estimated false discovery rates for negative gene sets
(negative means lower expression correlates with  class 2 in two sample problems,
 lower expression correlates with  increased y for quantitative problems,
 lower expression correlates with higher risk for survival problems)}
\item{fdr.hi}{Estimated false discovery rates for positive gene sets; positive
is opposite of negative, as defined above}
\item{pvalues.lo}{P-values for negative gene sets}
\item{pvalues.hi}{P-values for positive gene sets}
\item{stand.info}{Information from restandardization process}
\item{stand.info.star}{Information from restandardization process in permutations}
\item{ngenes}{Number of genes in union of gene sets}
\item{nperms}{Number of permutations used}
\item{gene.scores}{Individual gene scores (eg t-statistics for two class problem)}
\item{s0}{Computed  exchangeability factor}
\item{s0.perc}{Computed percentile of standard deviation values.
           s0= s0.perc percentile of the gene standard deviations}
\item{call}{The call to GSA}
\item{x}{For internal use}
\item{y}{For internal use}
\item{genesets}{For internal use}
\item{genenames}{For internal use}
\item{r.obs}{For internal use}
\item{r.star}{For internal use}
\item{gs.mat}{For internal use}
\item{gs.ind}{For internal use}
\item{catalog}{For internal use}
\item{catalog.unique}{For internal use}
}


 \references{Efron, B. and   Tibshirani, R.  
On testing the significance of sets of genes. Stanford tech report rep 2006.
http://www-stat.stanford.edu/~tibs/ftp/GSA.pdf

Subramanian, A. and Tamayo, P. Mootha, V. K. and Mukherjee, S. and Ebert, B. L. and Gillette, M. A. and Paulovich, A. and Pomeroy, S. L. and Golub, T. R. and Lander, E. S. and Mesirov, J. P. (2005)  A knowledge-based approach for interpreting genome-wide expression profiles. PNAS. 102, pg 15545-15550.
}

\author{Robert Tibshirani}


\examples{

######### two class unpaired comparison
# y must take values 1,2

set.seed(100)
x<-matrix(rnorm(1000*20),ncol=20)
dd<-sample(1:1000,size=100)

u<-matrix(2*rnorm(100),ncol=10,nrow=100)
x[dd,11:20]<-x[dd,11:20]+u
y<-c(rep(1,10),rep(2,10))


genenames=paste("g",1:1000,sep="")

#create some random gene sets
genesets=vector("list",50)
for(i in 1:50){
 genesets[[i]]=paste("g",sample(1:1000,size=30),sep="")
}
geneset.names=paste("set",as.character(1:50),sep="")

GSA.obj<-GSA(x,y, genenames=genenames, genesets=genesets,  resp.type="Two class unpaired", nperms=100)


GSA.listsets(GSA.obj, geneset.names=geneset.names,FDRcut=.5)



#to use  "real" gene set collection, we read it in from a gmt file:
# 
# geneset.obj<- GSA.read.gmt("file.gmt")
# 
# where file.gmt is a gene set collection from GSEA collection or
#  or the website http://www-stat.stanford.edu/~tibs/GSA, or one
# that you have created yourself. Then

#   GSA.obj<-GSA(x,y, genenames=genenames, genesets=geneset.obj$genesets,  resp.type="Two class unpaired", nperms=100)
#
#



}

\keyword{univar}% at least one, from doc/KEYWORDS
\keyword{survival}
\keyword{ts}
\keyword{nonparametric}
