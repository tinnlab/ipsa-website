\name{GSA.correlate}
\alias{GSA.correlate}
\title{"Correlates" a gene set collection with a  given list of gene nams}
\description{
"Correlates" a gene set collection with a  given list of gene names. Gives info
on the overlap between the collection and the list of genes
}
\usage{
GSA.correlate(GSA.genesets.obj, genenames)
}
\arguments{
\item{GSA.genesets.obj}{Gene set collection, created for example by GSA.read.gmt}
\item{genenames}{Vector of gene names in expression daatset}
}

\details{
 Gives info
on the overlap between a gene set collection and the list of gene names.
This is for information purposes, to find out, for example,
how many genes in the list of genes appear in the gene set collection.}



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

GSA.correlate(genesets, genenames)





}

\keyword{univar}% at least one, from doc/KEYWORDS
\keyword{survival}
\keyword{ts}
\keyword{nonparametric}
