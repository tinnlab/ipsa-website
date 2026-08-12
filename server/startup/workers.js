// import { Meteor } from 'meteor/meteor';
// import cluster from 'cluster';
//
// global._workers = []
//
// if (cluster.isMaster) {
//     for (let i = 0; i < (process.env.WORKER_NUMBER || 2); ++i){
//         let env = {...process.env, PORT: Number(process.env.PORT) + i + 1}
//         let worker = cluster.fork(env);
//         _workers.push(worker);
//
//         (function initWorker(worker){
//             worker.on('error', function(code, signal) {
//                 console.log('worker ' + worker.process.pid + ' died');
//                 _workers.splice(_workers.indexOf(worker), 1);
//
//                 worker = cluster.fork(env);
//                 _workers.push(worker);
//                 initWorker(worker);
//             });
//         })(worker)
//     }
//
//     global.workerEval = async (func, params, ignoreReturn = false) => {
//         return new Promise(async (resolve, reject) => {
//             let availableWorker = _workers.find(w => !w.isBusy);
//
//             if (!availableWorker) {
//                 availableWorker = await new Promise((resolve, reject) => {
//                     let interval = setInterval(() => {
//                         let availableWorker = _workers.find(w => !w.isBusy);
//                         if (availableWorker) {
//                             clearInterval(interval);
//                             resolve(availableWorker)
//                         }
//                     }, 100);
//                 });
//             }
//
//             availableWorker.isBusy = true;
//             availableWorker.send({cmd: 'eval', code: func.toString(), params, ignoreReturn});
//             availableWorker.once('message', (msg) => {
//                 availableWorker.isBusy = false;
//                 if (msg.cmd === 'result') {
//                     resolve(msg.result);
//                 }
//                 if (msg.cmd === 'error') {
//                     reject(msg.error);
//                 }
//             });
//         })
//     }
// } else {
//   // Start the worker
//     process.on('message', async function(msg) {
//         // we only want to intercept messages that have a chat property
//         if (msg.cmd === "eval") {
//             let {code, params} = msg;
//
//             try {
//                 let result = await eval(`(${code})(params)`);
//                 process.send({
//                     cmd: "result",
//                     result: msg.ignoreReturn ? undefined : result
//                 });
//
//             } catch (e) {
//                 process.send({
//                     cmd: "error",
//                     error: e.message
//                 });
//             }
//         }
//     });
// }