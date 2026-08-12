\name{GSA.make.features}
\alias{GSA.make.features}
\title{Creates features from a GSA analysis that can be used in other procedures}
\description{
Creates features from a GSA analysis that can be used in other procedures,
for example, sample classification.
}
\usage{
GSA.make.features(GSA.func.obj, x, genesets, genenames)
}
\arguments{
\item{GSA.func.obj}{Object returned by GSA.func}
\item{x}{Expression dataset from which the features are to be created}
\item{genesets}{Gene set collection}
\item{genenames}{Vector of gene names in expression dataset}
}

\details{
Creates features from a GSA analysis that can be used in other procedures,
for example, sample classification.
For example, suppose the GSA analysis  computes a  maxmean score for gene set
1 that is positive, based on the  mean of the positive part of
the scores  in that
gene set. Call the  subset of genes  with positive scores "A". Then  we compute a new feature for this geneset, for each sample,
by computing the mean of the scores for genes in A, setting other gene scores
to zero.
}



 \references{Efron, B. and   Tibshirani, R.  
On testing the significance of sets of genes. Stanford tech report rep 2006.
http://www-stat.stanford.edu/~tibs/ftp/GSA.pdf
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

GSA.func.obj<-GSA.func(x,y, genenames=genenames, genesets=genesets,  resp.type="Two class unpaired")


GSA.make.features(GSA.func.obj, x, genesets, genenames)





}

\keyword{univar}% at least one, from doc/KEYWORDS
\keyword{survival}
\keyword{ts}


