\name{GSA.genescores}
\alias{GSA.genescores}
\title{Individual gene scores from a  gene set analysis}
\description{
Compute individual gene scores from a  gene set analysis 
}
\usage{
GSA.genescores(geneset.number, genesets,  GSA.obj,  genenames, negfirst=FALSE)
}
\arguments{
  \item{geneset.number}{Number indicating which  gene set is to examined}
\item{genesets}{The gene set collection}
  \item{GSA.obj}{Object returned by function GSA}
\item{genenames}{Vector of gene names for gene in expression dataset}
\item{negfirst}{Should negative genes be listed first? Default FALSE}
}

\details{
Compute individual gene scores from a  gene set analysis.
Useful for
looking ``inside'' a gene set that has been called significant by GSA.}


\value{
A list with components
\item{res}{Matrix of gene names and gene scores (eg t-statistics)  for each gene in the  gene set},
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

GSA.obj<-GSA(x,y, genenames=genenames, genesets=genesets,  resp.type="Two class unpaired", nperms=100)

# look at 10th gene set

GSA.genescores(10, genesets, GSA.obj, genenames)


}

\keyword{univar}% at least one, from doc/KEYWORDS
\keyword{survival}
\keyword{ts}
\keyword{nonparametric}
