import fs from "fs";
import {exec} from "child_process";
import {Random} from "meteor/random";
import path from "path"
import {analysisContext, register, unregister} from "./processRegistry"

const {tempDir, RsourceDir, RscriptCmd} =  Meteor.settings.private

// Cap BLAS/OpenMP threads for every spawned R process. R/OpenBLAS otherwise
// spawns a thread pool sized to the host core count (e.g. 192), which wastes
// ~12-37 CPU-seconds of thread-spawn overhead on EVERY R invocation and, worse,
// explodes under the method-level mclapply parallelism (workers x BLAS threads).
// The app gets its parallelism from mclapply(mc.cores = RParallelCore); BLAS
// itself only needs a single thread for these small matrix ops. Validated: the
// env propagates through the `conda run … Rscript` wrapper.
const R_BLAS_THREADS = String(Meteor.settings.private.RBlasThreads ?? 1)
const R_THREAD_ENV = {
    OMP_NUM_THREADS: R_BLAS_THREADS,
    OPENBLAS_NUM_THREADS: R_BLAS_THREADS,
    MKL_NUM_THREADS: R_BLAS_THREADS,
    R_DATATABLE_NUM_THREADS: R_BLAS_THREADS,
}

// Safety-net timeout for a single R computation. Normal runs return well within
// this; it only reaps a genuinely stuck process so a method can't hang forever
// and orphan the R subtree. Default 20 minutes.
const R_TIMEOUT_MS = Meteor.settings.private.RTimeoutMs ?? 1200000

export default async (cmd, context = {}) => {
    // Associate the spawned R process with the running analysis (if any) so it
    // can be cancelled. analysisId can be passed explicitly or inherited from
    // the surrounding AsyncLocalStorage context set by analysis.start etc.
    const analysisId = context.analysisId ?? analysisContext.getStore()?.analysisId
    cmd = `
            library(parallel)
            library(doParallel)
            library(foreach)
            jsonlite::toJSON((function(){
                r <- try({
                    (function(){
                        ${cmd}
                    })()
                })
                if (inherits(r, "try-error")){
                    return(list(error = r[1]))
                }
                return(r)
            })(), digits = 15)
       `.trim();

    let Rfile = path.join(tempDir, Random.id() + '.R')
    let resultFile = path.join(tempDir, Random.id() + '.json')

    // console.log({resultFile})

    fs.writeFileSync(Rfile, cmd, "utf8")

    cmd = `
        write(source("${Rfile}")$value, "${resultFile}")
    `

    let Rcmd = path.join(tempDir, Random.id() + '.R')
    fs.writeFileSync(Rcmd, cmd, "utf8")

    try{
        await new Promise((resolve, reject)=>{
            let settled = false
            let timer = null
            const finish = (fn, arg) => {
                if (settled) return
                settled = true
                if (timer) clearTimeout(timer)
                fn(arg)
            }
            // detached: own process group, so killing -pid takes down the whole
            // R subtree (conda wrapper + Rscript) on cancel/timeout.
            const child = exec(`${RscriptCmd} ${Rcmd}`, {
                detached: true,
                env: {...process.env, ...R_THREAD_ENV},
            }, (e, stdout, stderr) => {
                if (analysisId) unregister(analysisId, child)
                if (e) finish(reject, e);
                else finish(resolve)
            })
            if (analysisId) register(analysisId, child)

            // Safety net: kill a genuinely stuck R process group after R_TIMEOUT_MS
            // so the awaiting method can't hang forever / orphan the R subtree.
            timer = setTimeout(() => {
                const signalGroup = (signal) => {
                    try { child.kill(signal) } catch (e) { /* already exited */ }
                    if (typeof child.pid === "number") {
                        try { process.kill(-child.pid, signal) } catch (e) { /* no group / gone */ }
                    }
                }
                signalGroup("SIGTERM")
                setTimeout(() => signalGroup("SIGKILL"), 2000)
                if (analysisId) unregister(analysisId, child)
                finish(reject, new Error(`R computation timed out after ${R_TIMEOUT_MS} ms`))
            }, R_TIMEOUT_MS)
        })

        let data = fs.readFileSync(resultFile, "utf8")

        let r = JSON.parse(data);

        if (r.error){
            throw new Error(r.error);
        }

        try{
            fs.unlinkSync(Rfile)
            fs.unlinkSync(resultFile)
        } catch (e){
            //Do nothing
        }

        return r;
    } catch (e) {
        console.error({e})
        console.error("Error when executing R command:")
        console.error(cmd);

        throw e;
    }

}



