\name{GSA.read.gmt}
\alias{GSA.read.gmt}
\title{Read in a  gene set collection from a .gmt file}
\description{
Read in a  gene set collection from a .gmt file
}
\usage{
GSA.read.gmt(filename)
}
\arguments{
  \item{filename}{The name of a file to read data values from. Should be
a tab-separated text file, with one row per gene set. Column 1 has gene set
names (identifiers), column 2 has gene set descriptions, remaining columns are gene ids for genes in that
geneset}.
}

\details{This function  reads in a geneset collection from a  .gmt text file,
and creates  an R object that can be used as input into GSA.
We use UniGene symbols for our gene set names in our .gmt files and expression datasets,
to match the  two.
However the user is free to use other identifiers, as long as the same ones
are used in the  gene set collections and expression datasets.
}

\value{
A list with components
\item{genesets}{List of gene names (identifiers) in each gene set},
\item{geneset.names}{Vector of gene set names (identifiers)},
\item{geneset.descriptions}{Vector of gene set descriptions}
}

 \references{Efron, B. and   Tibshirani, R.  
On testing the significance of sets of genes. Stanford tech report rep 2006.
http://www-stat.stanford.edu/~tibs/ftp/GSA.pdf
}

\author{Robert Tibshirani}


\examples{



# read in  functional pathways gene set file from Broad institute GSEA website
# http://www.broad.mit.edu/gsea/msigdb/msigdb_index.html
# You have to register first and then download the file C2.gmt from
#   their site

#GSA.read.gmt(C2.gmt)

}

\keyword{univar}% at least one, from doc/KEYWORDS
\keyword{survival}
\keyword{ts}
\keyword{nonparametric}
