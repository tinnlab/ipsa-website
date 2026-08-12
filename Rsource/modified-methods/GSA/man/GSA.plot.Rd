\name{GSA.plot}
\alias{GSA.plot}
\title{Plot the results from a Gene set analysis}
\description{
Plots the results from a call to  GSA  (Gene set analysis)
}
\usage{
GSA.plot(GSA.obj, fac=1, FDRcut = 1)
}
\arguments{
  \item{GSA.obj}{ Object returned by GSA function}.
\item{fac}{value for jittering points in plot ("factor" in called to jitter()}
\item{FDRcut}{False discovery rate cutpoint for  sets to be plotted. A value of 1
(the default) will cause all sets to be plotted}.
}

\details{This function  makes a plot of the significant gene sets, based on a
call to the GSA (Gene set analysis) function. }


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

GSA.plot(GSA.obj)

}

\keyword{univar}% at least one, from doc/KEYWORDS
\keyword{survival}
\keyword{ts}
\keyword{nonparametric}
