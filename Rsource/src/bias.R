.fishersMethod <- function(x) {
    pchisq(-2 * sum(log(x)), df=2*length(x), lower=FALSE)
}

.stoufferMethod <- function(x) {
    pnorm(sum(qnorm(x)) / sqrt(length(x)))
}

.IrwinHallCumulative <- function(x,n) {
    #x is the sum of p-values
    1/factorial(n) * sum(sapply(0:floor(x), function(k) (-1)^k * choose(n,k) * (x-k)^(n)))
}

.additiveMethod <- function(x) {
    n <- length(x)
    if (n <= 20) {
        .IrwinHallCumulative(sum(x),n)
    } else {
        pnorm(sum(x),n/2,sqrt(n/12),lower=TRUE)
    }
}

.zValMethod <- function(x) {
    th <- 6.3613409024040556972 # 1e-10
    x <- qnorm(x)
    x[x > th] <- th
    x[x < -th] <- -th
    pnorm(mean(x))

    # x <- qnorm(x/2)
    # x[x > th] <- th
    # x[x < -th] <- -th


}

commbinePValues <- function(method = "addCLT", p.values){
    if (method == "addCLT"){
        p.values <- .additiveMethod(p.values)
    } else if (method == "fishers"){
        p.values <- .fishersMethod(p.values)
    } else if (method == "stouffer"){
        p.values <- .stoufferMethod(p.values)
    } else if (method == "minP"){
        p.values <- min(p.values)
    } else if (method == "zVal"){
        p.values <- .zValMethod(p.values)
    } else {
        stop("Method not supported")
    }
    return(p.values)
}
