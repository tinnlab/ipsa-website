\name{GSA-internal}
\title{Internal GSA functions}
\alias{print.GSA.func}
\alias{print.GSA}
\alias{summary.GSA.genesets}
\alias{ttest.func}
\alias{cox.func}
\alias{multiclass.func}
\alias{quantitative.func}
\alias{varr}
\alias{coxvar}
\alias{coxstuff}
\alias{ests0}
\alias{GSA.xl.genescores}
\alias{GSA.xl.correlate}
\alias{GSA.xl.summary}
\alias{GSA.xl.plot}
\alias{GSA.xl.summary.genesets}


\description{Internal samr functions}

\usage{
\S3method{print}{GSA.func}(x, ...) 
\S3method{print}{GSA}(x, ...) 
\S3method{summary}{GSA.genesets}(object, ...)
varr(x, meanx=NULL) 
coxvar(x, y, ic, offset = rep(0., length(y)), coxstuff.obj = NULL)
coxstuff(x, y, ic, offset = rep(0., length(y))) 
est.s0(tt,sd,s0.perc=seq(0,1, by=.05))
GSA.xl.genescores(GSA.listsets.obj, genesets,  GSA.obj,  genenames)
GSA.xl.plot(GSA.obj,  fac=.10, FDRcut=1)
GSA.xl.summary.genesets(GSA.genesets.obj)
GSA.xl.correlate(GSA.genesets.obj, genenames)
ttest.func(x, y, s0 = 0, sd=NULL)
cox.func(x, y, censoring.status, s0 = 0)
multiclass.func(x, y, s0 = 0)
quantitative.func(x, y, s0 = 0)
}
\author{Robert Tibshirani}

\details{
  These are not to be called by the user.
}
\keyword{internal}

