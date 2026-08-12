\name{GSA.func}
\alias{GSA.func}
\title{Gene set analysis without permutations}
\description{
Determines the significance of pre-defined sets of genes  with respect to 
 an outcome
variable, such as a group indicator, quantitative variable or  survival time.
This is the basic function called by GSA.
}
\usage{
GSA.func(x,y, genesets, genenames,geneset.names=NULL,
 method=c("maxmean","mean","absmean"), resp.type=c("Quantitative",
"Two class unpaired","Survival","Multiclass", "Two class paired",  "tCorr", "taCorr" ),
censoring.status=NULL,
 first.time = TRUE, return.gene.ind = TRUE, 
ngenes = NULL, gs.mat =NULL, gs.ind = NULL,
 catalog = NULL, catalog.unique =NULL, 
s0 = NULL, s0.perc = NULL, minsize = 15, maxsize= 500, restand = TRUE, restand.basis=c("catalog","data")) 
}

\arguments{
\item{x}{Data x: p by n matrix of features,
one observation per column (missing values allowed)}
\item{y}{Vector of response values:  1,2 for two class
problem, or 1,2,3 ... for multiclass problem, or real numbers for quantitative
or survival problems}
\item{genesets}{Gene set collection (a list)}
\item{genenames}{Vector of genenames in expression dataset}
\item{geneset.names}{Optional vector of gene set names}
\item{method}{Method for summarizing a gene set: "maxmean" (default), "mean" or "absmean"}
  \item{resp.type}{Problem type: "quantitative" for a continuous parameter;
"Two class unpaired" ; "Survival" for censored survival outcome; "Multiclass" :
more than 2 groups; "Two class paired" for paired outcomes, coded -1,1 (first pair), -2,2 (second pair), etc  }
\item{censoring.status}{Vector of censoring status values for survival problems,
1 mean death or failure, 0 means censored)}
\item{first.time}{internal use}
\item{return.gene.ind}{internal use}
\item{ngenes}{internal use}
\item{gs.mat}{internal use}
\item{gs.ind}{internal use}
\item{catalog}{internal use}
\item{catalog.unique}{internal use}
\item{s0}{Exchangeability factor  for denominator of test statistic; Default
is automatic choice}
\item{s0.perc}{Percentile of standard  deviation values to use for s0; default is
automatic choice; -1 means s0=0 (different from s0.perc=0, meaning
s0=zeroeth percentile of  standard  deviation values= min of sd values}
\item{minsize}{Minimum number of genes in  genesets to be  considered}
\item{maxsize}{Maximum number of genes in  genesets to be considered}
\item{restand}{Should restandardization be done? Default TRUE}
\item{restand.basis}{What should be used to do the  restandardization?
The set of genes in the genesets ("catalog", the default) or the
genes in the data set ("data")}
}

\details{Carries out a Gene set analysis, computing the gene set scores.
This function does not do any permutations for estimation of  false discovery rates.
GSA calls this function to estimate  FDRs.
}


\value{
A list with components
\item{scores}{Gene set scores  for each gene set},
\item{norm.scores}{Gene set scores  transformed by the inverse Gaussian cdf},
\item{mean}{Means of gene  expression values for each sample}
\item{sd}{Standard deviation of gene  expression values for each sample}
\item{gene.ind}{List indicating whch genes in each positive  gene set
 had positive individual scores, and similarly for negative gene sets}
\item{geneset.names}{Names of the gene sets}
\item{nperms}{Number of permutations used}
\item{gene.scores}{Individual gene scores (eg t-statistics for two class problem)}
\item{s0}{Computed  exchangeability factor}
\item{s0.perc}{Computed percentile of standard deviation values}
\item{stand.info}{ Information computed  used in the restandardization process}
\item{method}{Method used (from call to GSA.func)}
\item{call}{The call to GSA}
}


 \references{Efron, B. and   Tibshirani, R.  
On testing the significance of sets of genes. Stanford tech report rep 2006.
http://www-stat.stanford.edu/~tibs/ftp/GSA.pdf}

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

GSA.func.obj<-GSA.func(x,y, genenames=genenames, genesets=genesets,  resp.type="Two class unpaired")




#to use  "real" gene set collection, we read it in from a gmt file:
# 
# geneset.obj<- GSA.read.gmt("file.gmt")
# 
# where file.gmt is a gene set collection from GSEA collection or
#  or the website http://www-stat.stanford.edu/~tibs/GSA, or one
# that you have created yourself. Then

#   GSA.func.obj<-GSA.func(x,y, genenames=genenames, genesets=geneset.obj$genesets,  resp.type="Two class unpaired")
#
#



}

\keyword{univar}% at least one, from doc/KEYWORDS
\keyword{survival}
\keyword{ts}
\keyword{nonparametric}
