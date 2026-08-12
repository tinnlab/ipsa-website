\name{GSA.listsets}
\alias{GSA.listsets}
\title{List the results from a Gene set analysis}
\description{
List the results from a call to  GSA  (Gene set analysis)
}
\usage{
GSA.listsets(GSA.obj, geneset.names = NULL, maxchar = 20, FDRcut = 0.2)
}
\arguments{
  \item{GSA.obj}{ Object returned by GSA function}.
\item{geneset.names}{Optional vector of names for  the gene sets}
  \item{maxchar}{Maximum number of characters in printed output}
\item{FDRcut}{False discovery rate cutpoint for listed sets. A value of 1
will cause all sets to be listed}.
}

\details{This function  list the sigificant gene sets, based on a
call to the GSA (Gene set analysis) function. }



\value{
A list with components
\item{FDRcut}{The false discovery rate threshold used.}
\item{negative}{A table of the negative gene sets. "Negative" means that
lower expression of most genes in the gene set correlates with
higher values of the phenotype y. Eg for two classes coded 1,2,
lower expression correlates with class 2. For survival data,
lower expression correlates with higher risk, i.e shorter survival
(Be careful, this can be confusing!)}
\item{positive}{A table of the positive gene sets.
"Positive" means that 
higher expression of most genes in the gene set correlates with
higher values of the phenotype y. See "negative" above for more info.}
\item{nsets.neg}{Number of negative gene sets}
\item{nsets.pos}{Number of positive gene sets}
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

#create some radnom gene sets
genesets=vector("list",50)
for(i in 1:50){
 genesets[[i]]=paste("g",sample(1:1000,size=30),sep="")
}
geneset.names=paste("set",as.character(1:50),sep="")

GSA.obj<-GSA(x,y, genenames=genenames, genesets=genesets,  resp.type="Two class unpaired", nperms=100)


GSA.listsets(GSA.obj, geneset.names=geneset.names,FDRcut=.5)


}

\keyword{univar}% at least one, from doc/KEYWORDS
\keyword{survival}
\keyword{ts}
\keyword{nonparametric}
